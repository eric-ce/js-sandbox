import dataPool from "../../lib/data/DataPool.js";
import { calculateMiddlePos, calculateDistance, formatMeasurementValue, areCoordinatesEqual, checkOverlayType, getOverlayByPosition, convertToLatLng, } from "../../lib/helper/googleHelper.js";
import { getNeighboringValues } from "../../lib/helper/helper.js";
import { MeasureModeGoogle } from "./MeasureModeGoogle.js";

/** @typedef {{lat: number, lng: number}} LatLng */

/**
 * @typedef InteractiveAnnotationsState
 * @property {google.maps.Polyline[]} polylines
 * @property {google.maps.OverlayView[]} labels
 */
/**
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {{lat:number, lng:number}} mapPoint - The point on the map where the event occurred
 * @property {{x:number, y:number}} screenPoint - The screen coordinates of the event
 */
/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */

/** @typedef {import('../../lib/input/GoogleMapsInputHandler').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../../components/MeasureComponentBase').MeasureComponentBase} MeasureComponentBase */
/** @typedef {import('../../lib/state/StateManager').StateManager} StateManager */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/interaction/GoogleDragHandler.js').GoogleDragHandler} DragHandler */
/** @typedef {import('../../lib/interaction/GoogleHighlightHandler.js').GoogleHighlightHandler} HighlightHandler */

/**
 * Handles multiple distance measurement specifically for Google Map.
 * @extends MeasureModeGoogle
 */
class MultiDistanceGoogle extends MeasureModeGoogle {
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polylines: [], // Array to store polyline references
        labels: [], // Array to store label references
        totalLabels: [] // Array to store total label references
    }
    /** @type {LatLng} */
    #coordinate = null;
    /** @type {MeasurementGroup} */
    measure = null; // measure data used internally 
    /** @type {LatLng[]} */
    coordsCache = [];
    /** @type {number[]} */
    #distances = []; // Array to store distances between points

    /**
     * Listeners for point markers.
     * @private
     */
    #pointMarkerListeners = {
        mousedown: (marker, event) => {
            if (!event.domEvent) return; // Ensure domEvent is available
            // Prevent map drag, default behavior
            event.domEvent.stopPropagation();
            event.domEvent.preventDefault();

            // MIDDLE CLICK EVENT: Check for middle mouse button (button === 1)
            if (event.domEvent.button === 1) {
                this._removePointFromMeasure(marker);

                if (this.coordsCache.length === 0) {
                    this.resetValuesModeSpecific();
                }
            }

            // LEFT DOWN EVENT: Check for left mouse button (button === 0) for dragging
            else if (event.domEvent.button === 0) {
                if (!this.dragHandler) return; // Ensure dragHandler is available
                // When the measure is finished
                // DO NOT use isMeasurementComplete flag here, because it is not set when the measure is not started yet, think of switch mode case
                if (this.coordsCache.length === 0) {
                    this.dragHandler._handleDragStart(marker, event);
                }
            }
            // this.resetValuesModeSpecific();
        },
        click: (marker, event) => {
            // Prevent map drag, default behavior
            event.domEvent?.stopPropagation();
            event.domEvent?.preventDefault();
            // Case: it is during measure
            if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) {
                const pointIndex = this.coordsCache.findIndex(coordinate => areCoordinatesEqual(coordinate, marker.positions[0]));
                if (pointIndex === -1) return false;
                const isFirstPoint = pointIndex === 0;

                // if it click on the first point then forms perimeter
                if (isFirstPoint) {
                    // -- Feature: forms perimeter --
                    this._formsPerimeter(marker);
                }
            } else {
                this._resumeMeasure(marker);
            }
        }
    };

    #polylineListeners = {
        mousedown: (polyline, event) => {
            if (event.domEvent.button === 1) {
                // Prevent map drag, default behavior
                event.domEvent?.stopPropagation();
                event.domEvent?.preventDefault();
                // When the measure is completed or not started yet, make it interactive
                // Switch mode case: isMeasurementComplete flags is not used (false) when at the beginning before the measure starts
                if (this.coordsCache.length === 0) {
                    // Handle polyline click logic here, if needed
                    this._removeLineSet(polyline);
                }
            }
        }
    }

    #labelMarkerListeners = {
        click: (label, event) => {
            if (this.flags.isActive) {
                // Prevent map drag, default behavior
                event.domEvent?.stopPropagation();
                event.domEvent?.preventDefault();
                if (this.coordsCache.length === 0) {
                    // Handle label click logic here, if needed
                    console.log("Label clicked:", label);
                    // TODO: editable label text
                }
            }
        }
    }

    /**
     * Creates an instance of MultiDistanceGoogle.
     * @param {GoogleMapsInputHandler} inputHandler
     * @param {DragHandler} dragHandler
     * @param {HighlightHandler} highlightHandler
     * @param {MeasureComponentBase} drawingHelper
     * @param {StateManager} stateManager
     * @param {EventEmitter} emitter
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("MultiDistanceGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
        }

        super("multi_distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter)

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false; // Initialize drag mode flag
        this.flags.isReverse = false; // Initialize reverse flag

        /** @type {MeasurementGroup} */
        this.measure = this._createDefaultMeasure(); // Create a new measure object
    }

    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }

    // get coordinate() {
    //     return this.#coordinate;
    // }


    /******************
     * EVENTS HANDLER *
     ******************/
    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left clicks, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     * @returns {Promise<void>}
     */
    handleLeftClick = async (eventData) => {
        // -- Validate input parameters and safety check --
        if (!eventData || !eventData.mapPoint || this.flags.isDragMode) return;

        // Ignore any click within 200 ms of drag‑end to prevent drag-end and left click clash issue
        if (this.dragHandler?.lastDragEndTs && (Date.now() - this.dragHandler?.lastDragEndTs) < 200) {
            return;
        }

        this._startMeasure();
    }

    _startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coordsCache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coordsCache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = this._createDefaultMeasure(); // Create a new measure object

            // Establish data relationship
            this.measure.coordinates = this.coordsCache; // when cache changed groups will be changed due to reference by address
        }

        // -- Create point marker --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            clickable: true, // Make the point clickable
            listeners: this.#pointMarkerListeners
        });
        if (!point) return;
        point.status = "pending"; // Set status to pending

        // Update the coordsCache based on the measurement direction
        if (this.flags.isReverse) {
            this.coordsCache.unshift(this.#coordinate);
        } else {
            this.coordsCache.push(this.#coordinate);
        }

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        if (this.coordsCache.length > 1) {
            // Determine the indices of the previous and current points based on the measurement direction
            const [prevIndex, currIndex] = this.flags.isReverse
                ? [0, 1] // If reversing, use the first two points
                : [this.coordsCache.length - 2, this.coordsCache.length - 1]; // Otherwise, use the last two points

            const positions = [this.coordsCache[prevIndex], this.coordsCache[currIndex]];

            // -- Create Annotations --
            // Create the line
            this._createOrUpdateLine(positions, this.#interactiveAnnotations.polylines, {
                status: "pending",
                color: this.stateManager.getColorState("line"),
                clickable: false,
                listeners: this.#polylineListeners
            });

            // Create the label
            const { distances } = this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                status: "pending",
                clickable: false
            });

            // -- Handle Distances record --
            this.#distances.push(...distances); // Store the distance in the cache

            // Create the total label
            const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
                status: "pending",
                clickable: false
            });

            // -- Update current measure data --
            this.measure.status = "pending";
            if (this.#distances.length > 0 && typeof totalDistance === "number") {
                const record = { distances: [...this.#distances], totalDistance };
                this.measure._records[0] = record // Update distances record
            }

            // Update dataPool with the measure data
            dataPool.updateOrAddMeasure({ ...this.measure });
        }
    }

    /**
     * Forms a perimeter by connecting the last point to the first point.   
     * @param {google.maps.Marker} point - The point marker representing the clicked point. 
     * @returns {void}
     */
    _formsPerimeter(point) {
        // User confirmation
        const userConfirmation = confirm('Do you want it to form a perimeter?');
        if (!userConfirmation) return; // If the user does not confirm, exit

        // -- Update coordsCache --
        const pointPosition = point.positions[0];
        this.coordsCache.push(pointPosition); // Add the point to the cache

        // -- Complete the measure --
        this._finalizeMeasure(); // Finalize the measurement
    }

    /**
     * Resumes a measurement by the clicked point.
     * @param {google.maps.Marker} point - The point marker representing the clicked point.
     * @returns {void}
     */
    _resumeMeasure(point) {
        // Find the measure data
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return;

        // -- Handle Measure Data --
        // Get the measure data from the data pool
        const measureData = dataPool.getMeasureById(measureId);
        if (!measureData) return;

        // convert measure data coordinates from cartographic degrees to Cartesian3
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToLatLng(cartographicDegrees));
        this.measure = measureData;
        this.measure.status = "pending"; // Set the measure status to pending

        // Find the index of the point in the measure coordinates
        const pointIndex = this.measure.coordinates.findIndex(coordinate => areCoordinatesEqual(coordinate, point.positions[0]));

        // -- Resume Measure --
        // Resume measure only when the point is the first or last point
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === this.measure.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            // Confirm the resume action
            const confirmResume = window.confirm(`Do you want to resume this measure? id: ${measureId}`);
            if (!confirmResume) return;

            // Set variables and flags to resume measuring
            this.coordsCache = this.measure.coordinates;

            this.flags.isMeasurementComplete = false; // reset the flag to continue measuring
            this.flags.isReverse = isFirstPoint; // If the point is the first point, set the reverse flag to true

            // Resume start the measurement process
            this._startMeasure(); // Start the measurement process
        }
    }


    /**********************
     * MOUSE MOVE FEATURE *
     **********************/
    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     * @returns {Promise<void>}
     */
    handleMouseMove = async (eventData) => {
        if (!eventData || !eventData.mapPoint) return;

        const pos = eventData.mapPoint; // Already {latitude, longitude}
        if (!pos) return;
        this.#coordinate = pos; // Store for later use

        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                // Moving coordinate data
                const positions = this.flags.isReverse ?
                    [this.coordsCache[0], this.#coordinate] :
                    [this.coordsCache[this.coordsCache.length - 1], this.#coordinate];

                // Moving line: remove if existed, create if not existed
                this._createOrUpdateLine(positions, this.#interactiveAnnotations.polylines, {
                    status: "moving",
                    color: this.stateManager.getColorState("move"),
                    clickable: false
                });

                // Moving label: update if existed, create if not existed
                this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                    status: "moving",
                    clickable: false
                });
                break;
            default:
                // this.handleHoverHighlighting();
                break;
        }
    }


    /***********************
     * RIGHT CLICK FEATURE *
     ***********************/
    handleRightClick = async (eventData) => {
        if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) { // prevent user to right click on first action

            // update coordinate data cache
            if (this.flags.isReverse) {
                this.coordsCache.unshift(this.#coordinate);
            } else {
                this.coordsCache.push(this.#coordinate);
            }

            // Create last point
            const lastPoint = this.drawingHelper._addPointMarker(this.#coordinate, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
                clickable: true,
                listeners: this.#pointMarkerListeners
            });
            if (!lastPoint) return; // If point creation fails, exit
            lastPoint.status = "completed";

            this._finalizeMeasure();
        }
    }

    _finalizeMeasure() {
        const lastPositions = this.flags.isReverse ?
            [this.coordsCache[0], this.coordsCache[1]] :
            [this.coordsCache[this.coordsCache.length - 2], this.coordsCache[this.coordsCache.length - 1]];

        // -- Create last annotations --
        // Create last line
        this._createOrUpdateLine(lastPositions, this.#interactiveAnnotations.polylines, {
            status: "completed",
            color: this.stateManager.getColorState("line"),
            clickable: true,
            listeners: this.#polylineListeners
        });

        // Create last label
        const { distances } = this._createOrUpdateLabel(lastPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            clickable: true
        });


        // -- Handle Distances record --
        this.#distances.push(...distances); // Store the last distance in the cache

        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "completed",
            clickable: true
        });


        // -- Update annotations status --
        // update points status
        this.pointCollection.forEach(point => {
            if (point.id.includes(this.mode) && point.status === "pending") {
                point.status = "completed"
                point.clickable = true;
            }
        });
        // update pending status line to completed
        const pendingPolylines = this.#interactiveAnnotations.polylines.filter(line => line.status === "pending");
        pendingPolylines.forEach(polyline => {
            polyline.setOptions({ status: "completed", clickable: true });
        });
        // update pending status labels to completed
        const pendingLabels = this.#interactiveAnnotations.labels.filter(label => label.status === "pending");
        pendingLabels.forEach(label => {
            label.setOptions({ status: "completed", clickable: true });
        });


        // -- Handle Measure Data --
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record // Update distances record
        }
        this.measure.coordinates = this.coordsCache.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        this.measure.status = "completed";

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Reset to clean up after finish
        this.resetValuesModeSpecific();

        // Set flag
        this.flags.isMeasurementComplete = true;
    }


    /************************
     * Middle CLICK FEATURES *
     ************************/
    /**
     * Removes a point marker during measurement.
     * @param {google.maps.Marker} point - The point marker to remove.
     * @returns {void}
     */
    _removePointFromMeasure(point) {
        // Validate input parameters
        if (!point || !Array.isArray(point.positions) || point.positions.length === 0) return;

        // confirmation 
        const userConfirmation = window.confirm(`Do you want to remove this point?`) // Confirm the removal action
        if (!userConfirmation) return;

        // -- Remove point --
        this.drawingHelper._removePointMarker(point); // Remove the point marker

        // -- Set Measure and Distances --
        // Find the measure data by ID
        const measureId = Number(point.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID 
        this.measure = this._findMeasureById(measureId);    // Set the measure
        if (!this.measure) return;  // If the measure is not found, exit
        this.#distances = [...this.measure._records[0].distances]; // Get the distances from the measure data
        // clone the coordinates from the measure data
        // this.measure.coordinates is the `original coordinates`, this.coordsCache is the `updated coordinates`
        let positions = this.measure.coordinates.map(pos => ({ ...pos }));

        // Find the point index in the measure coordinates
        const pointPositionIndices = this.measure.coordinates
            .map((coordinate, index) => areCoordinatesEqual(coordinate, point.position) ? index : -1)
            .filter(index => index !== -1);
        if (pointPositionIndices.length === 0) return; // If the point is not found, exit

        // -- Update positions --
        // Set positions to filter out pointPositionIndices
        positions = positions.filter((_, index) => !pointPositionIndices.includes(index));

        // remove related lines
        const polylines = this.drawingHelper._getLineByPositions([point.positions[0]]);
        if (!Array.isArray(polylines) || polylines.length === 0) return; // If no lines are found, exit
        polylines.forEach(line => {
            this.drawingHelper._removePolyline(line); // Remove the line

            // Case: during measuring, remove the line from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.polylines.length === 0) return; // If there are no polylines, exit
            const lineToRemoveIndex = this.#interactiveAnnotations.polylines.findIndex(l =>
                areCoordinatesEqual(l.positions[0], line.positions[0]) &&
                areCoordinatesEqual(l.positions[1], line.positions[1])
            );
            if (lineToRemoveIndex === -1) return; // If the line is not found, exit
            this.#interactiveAnnotations.polylines.splice(lineToRemoveIndex, 1); // Remove the line from this interactive annotations        });
        });

        // remove related labels
        const labelMarkers = this.drawingHelper._getLabelByPosition([point.positions[0]]);
        if (!Array.isArray(labelMarkers) || labelMarkers.length === 0) return; // If no labels are found, exit
        labelMarkers.forEach(label => {
            // Safety check: assume moving or total labels should not be removed here
            const isMovingLabel = label.status === "moving";
            const isTotalLabel = label.id.startsWith(`annotate_${this.mode}_total_label`);
            this.#interactiveAnnotations.totalLabels = isTotalLabel ? [label] : [];
            if (isMovingLabel || isTotalLabel) return;

            this.drawingHelper._removeLabel(label); // Remove the label            

            // Case: during measuring, remove the label from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.labels.length === 0) return; // If there are no labels, exit
            const labelToRemoveIndex = this.#interactiveAnnotations.labels.findIndex(l => areCoordinatesEqual(l.position, label.position));
            if (labelToRemoveIndex === -1) return; // If the label is not found, exit
            this.#interactiveAnnotations.labels.splice(labelToRemoveIndex, 1);
        });

        // Find neighboring coordinate
        const { previous, current, next } = getNeighboringValues(this.measure.coordinates, pointPositionIndices[0]); // find the point position neighboring positions.
        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete; // Check if it is measuring
        // Case: the removing point is in the middle of the positions
        if (previous && next) {
            const reconnectedPositions = [previous, next];

            // -- Create polyline --
            this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                status: isMeasuring ? "pending" : "completed",
                color: this.stateManager.getColorState("line"),
                clickable: true,
                listeners: this.#polylineListeners
            });
            // -- Create label --
            const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                status: isMeasuring ? "pending" : "completed",
                clickable: true
            });

            // -- Handle Distances record --
            // Don't calculate all distances from coordsCache due to performance and consistency
            this.#distances.splice(pointPositionIndices[0] - 1, 2);
            this.#distances.splice(pointPositionIndices[0] - 1, 0, distances[0]);
        }
        // Case: The removing point is the first point
        else if (next) {
            // this.#distances.splice(pointIndex, 1) // Remove the first distance
            // Case: Perimeter remove first point 
            const isPerimeter = areCoordinatesEqual(this.measure.coordinates[0], this.measure.coordinates[this.measure.coordinates.length - 1]);
            if (isPerimeter) {
                // reconnect first and last point
                if (positions.length > 2) {
                    const reconnectedPositions = [positions[0], positions[positions.length - 1]];
                    // -- Create polyline --
                    this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                        status: isMeasuring ? "pending" : "completed",
                        color: this.stateManager.getColorState("line"),
                        clickable: true,
                        listeners: this.#polylineListeners
                    });
                    // -- Create label --
                    const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                        status: isMeasuring ? "pending" : "completed",
                        clickable: true
                    });

                    // -- Handle Distances record --
                    // remove the first and the last distance in this.#distances and insert distances value to the last index
                    this.#distances.splice(0, 1); // Remove the first distance
                    this.#distances.splice(this.#distances.length - 1, 1); // Remove the last distance
                    this.#distances.push(...distances); // Add the new distance to the end of the distances array
                }
                // Case: triangle, it will become two point line, which doesn't need reconnect
                else {
                    // -- Handle Distances record --
                    this.#distances.splice(0, 1); // Remove the first distance
                    this.#distances.splice(this.#distances.length - 1, 1); // Remove the last distance
                }
            }
        }
        // Case: The removing point is the last point
        else if (previous) {
            this.#distances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
        }

        // -- Reposition the total label --
        const { totalDistance } = this._createOrUpdateTotalLabel(positions, this.#interactiveAnnotations.totalLabels, {
            status: isMeasuring ? "pending" : "completed",
            clickable: true
        });

        // Case: if only one point left, remove the remaining point and labels
        if (positions.length === 1) {
            const lastPosition = positions[0];

            // Remove the remaining point and labels 
            const lastPoint = this.drawingHelper._getPointByPosition(lastPosition);
            const lastLabels = this.drawingHelper._getLabelByPosition([lastPosition]);

            if (lastPoint) {
                this.drawingHelper._removePointMarker(lastPoint); // Remove the last point marker
            }
            if (Array.isArray(lastLabels) && lastLabels.length > 0) {
                lastLabels.forEach(label => {
                    this.drawingHelper._removeLabel(label); // Remove the label marker
                });
            }
            // -- Handle Measure Data --
            const measureId = Number(lastPoint.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
            if (isNaN(measureId)) return; // If the measure ID is not a number, exit
            this.coordsCache = []; // Clear the coordsCache
            this.#distances = []; // Clear the distances cache
            dataPool.removeMeasureById(measureId); // Remove the measure from the data pool
            return; // Exit after removing the last point and labels
        }

        // -- Update current measure data --
        this.measure.status = isMeasuring ? "pending" : "completed"; // Update the measure status
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record // Update distances record
        }
        this.measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        // Update dataPool with the measure data
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Update current measure variables --
        if (isMeasuring) {
            this.coordsCache = positions.map(pos => ({ ...pos })); // Update the coordsCache with the remaining positions
        }
    }

    /**
     * Removes an entire line set, including related points, labels, and polygons.
     * @param {google.maps.Polyline} polyline - The polyline to remove.
     * @returns {void}
     */
    _removeLineSet(polyline) {
        if (!polyline) return;

        // confirmation 
        const userConfirmation = window.confirm(`Do you want to remove this entire line set?`) // Confirm the removal action
        if (!userConfirmation) return;

        const measureId = Number(polyline.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID

        const { points, polylines, labels, polygons } = this.drawingHelper._getRelatedOverlaysByMeasureId(measureId);


        points.forEach(point => {
            this.drawingHelper._removePointMarker(point); // Remove the point marker
        });

        labels.forEach(label => {
            this.drawingHelper._removeLabel(label); // Remove the label
        });

        polylines.forEach(polyline => {
            this.drawingHelper._removePolyline(polyline); // Remove the polyline
        });

        polygons.forEach(polygon => {
            this.drawingHelper._removePolygon(polygon); // Remove the polygon
        });

        // remove the measure data from dataPool
        dataPool.removeMeasureById(measureId);
    }

    /******************
     * EVENT HANDLING *
     *    FOR DRAG    *
     ******************/
    /**
     * Handle graphics updates during dragging operation.
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    updateGraphicsOnDrag(measure) {
        // -- Handling positions -- 
        const draggedPositionIndices = measure.coordinates
            .map((coord, index) => areCoordinatesEqual(coord, this.dragHandler.draggedObjectInfo.beginPosition) ? index : -1)
            .filter(index => index !== -1);
        if (draggedPositionIndices.length === 0) return; // If the dragged position is not found, exit

        // Update the dragged position with the new coordinate
        const positions = [...measure.coordinates];
        draggedPositionIndices.forEach(index => {
            positions[index] = this.dragHandler.coordinate;
        });

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndices[0]);

        let draggedPositions = [];
        // -- Handle dragged positions --
        if (previous && next) {
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {
            // Case: forms perimeter
            if (draggedPositionIndices.length === 2) {  // length of 2 means two positions matching beginPosition
                draggedPositions = [[this.dragHandler.coordinate, next], [this.dragHandler.coordinate, positions[positions.length - 2]]];
            }
            // Case: first position
            if (draggedPositionIndices.length === 1) {
                draggedPositions = [[this.dragHandler.coordinate, next]];
            }
        }
        if (draggedPositions.length === 0) return; // safe exit if no dragged positions are available


        // -- Update polyline --
        this._createOrUpdateLine(draggedPositions, this.dragHandler.draggedObjectInfo.lines, {
            status: "moving",
            color: this.stateManager.getColorState("move"),
            clickable: false
        });

        // -- Update label --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            clickable: false
        });


        // -- Handle Distances record --
        this.#distances = [...measure._records[0].distances];
        // Case: distances length is 1 means the draggedPositionIndex is either first or last index in the measure coordinates
        if (distances.length === 1) {
            if (next) { // Case: dragging the first position
                this.#distances[0] = distances[0]; // Update the first distance
            } else if (previous) { // Case: dragging the last position
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
            }
        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            // Case: dragging the first or last position of perimeter
            if (draggedPositionIndices.length === 2) {
                this.#distances[draggedPositionIndices[0]] = distances[0];
                this.#distances[draggedPositionIndices[1] - 1] = distances[1];
            }
            // Case: dragging the middle position
            if (draggedPositionIndices.length === 1) {
                if (previous && next) {
                    this.#distances[draggedPositionIndices[0] - 1] = distances[0];
                    this.#distances[draggedPositionIndices[0]] = distances[1];
                }
            }
        } else {
            console.warn("Unexpected distances length during drag finalization:", distances.length);
            return; // Exit if the distances length is not as expected
        }


        // -- Handle total label --
        this._createOrUpdateTotalLabel(positions, this.dragHandler.draggedObjectInfo.totalLabels, {
            status: "moving",
            clickable: false,
        });
    };

    /**
     * Finalize graphics updates for the end of drag operation
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    finalizeDrag(measure) {
        // -- Handling positions -- 
        const draggedPositionIndices = measure.coordinates
            .map((coord, index) => areCoordinatesEqual(coord, this.dragHandler.draggedObjectInfo.beginPosition) ? index : -1)
            .filter(index => index !== -1);
        if (draggedPositionIndices.length === 0) return; // If the dragged position is not found, exit

        // Update the dragged position with the new coordinate
        const positions = [...measure.coordinates];
        draggedPositionIndices.forEach(index => {
            positions[index] = this.dragHandler.coordinate;
        });

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndices[0]);

        let draggedPositions = [];
        // -- Handle dragged positions --
        if (previous && next) { // Case: dragging the middle position
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {  // Case: dragging the last position
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {  // Case: dragging the first position
            // Case: forms perimeter
            if (draggedPositionIndices.length === 2) {  // length of 2 means two positions matching beginPosition
                draggedPositions = [[this.dragHandler.coordinate, next], [this.dragHandler.coordinate, positions[positions.length - 2]]];
            }
            // Case: first position
            if (draggedPositionIndices.length === 1) {
                draggedPositions = [[this.dragHandler.coordinate, next]];
            }
        }
        if (draggedPositions.length === 0) return; // safe exit if no dragged positions are available

        // -- Finalize Line Graphics --
        // -- Handle polyline --
        this._createOrUpdateLine(draggedPositions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line"),
            clickable: true,
            listeners: this.#polylineListeners
        });

        // -- Finalize Label Graphics --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            clickable: true
        });


        // -- Handle Distances record --
        this.#distances = [...measure._records[0].distances];
        // Case: distances length is 1 means the draggedPositionIndex is either first or last index in the measure coordinates
        if (distances.length === 1) {
            if (next) { // Case: dragging the first position
                this.#distances[0] = distances[0]; // Update the first distance
            } else if (previous) { // Case: dragging the last position
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
            }
        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            // Case: dragging the first or last position of perimeter
            if (draggedPositionIndices.length === 2) {
                this.#distances[draggedPositionIndices[0]] = distances[0];
                this.#distances[draggedPositionIndices[1] - 1] = distances[1];
            }
            // Case: dragging the middle position
            if (draggedPositionIndices.length === 1) {
                if (previous && next) {
                    this.#distances[draggedPositionIndices[0] - 1] = distances[0];
                    this.#distances[draggedPositionIndices[0]] = distances[1];
                }
            }
        } else {
            console.warn("Unexpected distances length during drag finalization:", distances.length);
            return; // Exit if the distances length is not as expected
        }


        // -- Finalize Total Label Graphics --
        const { totalDistance } = this._createOrUpdateTotalLabel(positions, this.dragHandler.draggedObjectInfo.totalLabels, {
            status: "completed",
            clickable: true
        });


        // --- Update Measure Data ---
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            measure._records[0] = record; // Update distances record
        }
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.status = "completed"; // Update the measure status

        return measure;
    }


    /**********
     * HELPER *
     **********/
    _createOrUpdateLine(positions, polylinesArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(polylinesArray) || !Array.isArray(positions) || positions.length === 0) {
            console.warn("_createOrUpdateLine: input parameters are invalid.");
            return;
        }

        // default options
        const {
            status = "pending",
            color = this.stateManager.getColorState("move"),
            clickable = false,
            ...rest
        } = options;


        // Determine if `positions` represents multiple line segments (typically for drag)
        const isNested = positions.length > 0 && Array.isArray(positions[0]);

        // 2. REMOVAL PHASE
        // -- Check for and remove existing polyline --
        if (polylinesArray.length > 0) {
            // Case: remove all lines if positions is nested. Nested positions means it is from dragging operation
            if (isNested) {
                // remove all lines in the lines array
                polylinesArray.forEach(lineToRemove => {
                    this.drawingHelper._removePolyline(lineToRemove);
                });
                polylinesArray.length = 0; // Clear the array
            }
            // Case: remove lines that has status "moving"
            else {
                for (let i = polylinesArray.length - 1; i >= 0; i--) {
                    const line = polylinesArray[i];
                    // Ensure line exists and has a status property before checking
                    if (line && line.status === "moving") {
                        this.drawingHelper._removePolyline(line);
                        polylinesArray.splice(i, 1);
                    }
                }
            }
        }
        // 3. CREATION PHASE
        if (isNested) {
            // -- Create multiple polylines for nested positions --
            positions.forEach(posSet => {
                const newLineInstance = this.drawingHelper._addPolyline(posSet, {
                    color,
                    id: `annotate_${this.mode}_line_${this.measure.id}`, // Consider making ID more specific if needed (e.g., adding status)
                    clickable,
                    ...rest
                });
                if (!newLineInstance) return;

                // -- Handle Metadata Update --
                newLineInstance.status = status; // Set status on the new instance
                // -- Handle References Update --
                polylinesArray.push(newLineInstance);
            })
        } else {
            // -- Create a new single polyline --
            const newLineInstance = this.drawingHelper._addPolyline(positions, {
                color,
                id: `annotate_${this.mode}_line_${this.measure.id}`, // Consider making ID more specific if needed (e.g., adding status)
                clickable,
                ...rest
            });
            if (!newLineInstance) return;

            // -- Handle Metadata Update --
            newLineInstance.status = status; // Set status on the new instance
            // -- Handle References Update --
            polylinesArray.push(newLineInstance);
        }
    }

    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelInstances: null }; // Validate input positions
        };

        // default options
        const {
            status = "pending", // Default pending status
            clickable = false,
            ...rest
        } = options;

        // Determine if `positions` represents multiple line segments (typically for drag)
        const isNested = Array.isArray(positions[0]);

        let distances = [];
        let labelInstances = [];

        // 2. UPDATE LOGIC
        if (labelsArray.length > 0) {
            // Case: update MULTIPLE LABELS, typically for drag operation
            if (isNested) {
                // Assume: nested positions length should be same as labelsArray length
                positions.forEach((posSet, index) => {
                    labelInstances = labelsArray;
                    const segmentDistance = calculateDistance(posSet[0], posSet[1]);
                    const segmentFormattedText = formatMeasurementValue(segmentDistance, "meter");
                    const segmentMiddlePos = calculateMiddlePos(posSet);
                    if (!segmentDistance || !segmentMiddlePos) return;

                    const labelToUpdate = labelInstances[index];

                    // -- Handle Label Visual Update --
                    labelToUpdate.setPosition(segmentMiddlePos); // update position
                    // Ensure getLabel() exists and returns an object before spreading
                    const currentLabelOptions = labelToUpdate.getLabel();
                    if (currentLabelOptions) {
                        labelToUpdate.setLabel({ ...currentLabelOptions, text: segmentFormattedText, clickable }); // update text
                    } else {
                        // Fallback if getLabel() is not as expected
                        labelToUpdate.setLabel({ text: segmentFormattedText, clickable });
                    }

                    // -- Handle Label Metadata Update --
                    labelToUpdate.status = status;
                    labelToUpdate.positions = posSet.map(pos => ({ ...pos })); // store positions

                    // -- Handle records Update --
                    distances.push(segmentDistance); // Collect distances for each segment
                });
            }
            // Case: update SINGLE LABEL, typically for moving operation 
            else {
                const segmentDistance = calculateDistance(positions[0], positions[1]);
                const segmentFormattedText = formatMeasurementValue(segmentDistance, "meter");
                const segmentMiddlePos = calculateMiddlePos(positions);

                const labelInstance = labelsArray.find(label => label.status === "moving");
                if (labelInstance) {
                    // -- Handle Label Visual Update --
                    labelInstance.setPosition(segmentMiddlePos); // update position
                    const currentLabelOptions = labelInstance.getLabel();
                    if (currentLabelOptions) {
                        labelInstance.setLabel({ ...currentLabelOptions, text: segmentFormattedText, clickable }); // update text
                    } else {
                        // Fallback if getLabel() is not as expected
                        labelInstance.setLabel({ text: segmentFormattedText, clickable });
                    }

                    // -- Handle Label Metadata Update --
                    labelInstance.status = status;
                    labelInstance.positions = positions.map(pos => ({ ...pos })); // store positions

                    // -- Handle references Update --
                    labelInstances = [labelInstance]; // Get the label that is currently being moved
                    distances = [segmentDistance]; // Store the distance for the single segment
                }
            }
        }

        // 3. CREATE LOGIC
        if (labelInstances.length === 0) {
            const segmentDistance = calculateDistance(positions[0], positions[1]);

            const labelInstance = this.drawingHelper._addLabel(positions, segmentDistance, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                clickable,
                ...rest
            });

            // Update the distances 
            distances = [segmentDistance]; // Store the distance for the single segment

            // Safe exit if label creation fails, but return the distances
            if (!labelInstance) {
                console.warn("_createOrUpdateLabel: Failed to create new label instance.");
                return { distances, labelInstances: null }; // Return distance but null instance
            }

            // -- Handle Label Metadata Update --
            labelInstance.positions = positions.map(pos => ({ ...pos })); // store positions
            labelInstance.status = status; // Set status

            // -- Handle References Update --
            labelInstances.push(labelInstance); // Store the new label instance in the array
            labelsArray.push(labelInstance);
        }

        return { distances, labelInstances };
    }

    _createOrUpdateTotalLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelInstance: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            clickable = false,
            ...rest
        } = options;

        const totalDistance = this.#distances.reduce((acc, val) => acc + val, 0);
        const formattedText = `Total: ${formatMeasurementValue(totalDistance, "meter")}`;
        const labelPosition = positions[positions.length - 1]; // Use the last position for the total label

        let labelInstance = null;

        // -- Update existing label --
        if (labelsArray.length > 0) {
            labelInstance = labelsArray[0]; // Get the reference from the array
        } else {
            const existedTotalLabel = this.labelCollection.find(label => label.id === `annotate_${this.mode}_total_label_${this.measure.id}`); // Find the label by ID      
            if (existedTotalLabel) {
                labelInstance = existedTotalLabel; // If it exists, use it
            }
        }

        // Update labelInstance if it exists
        if (labelInstance) {
            // -- Handle Label Visual Update --
            labelInstance.setPosition(labelPosition); // update position
            // Ensure getLabel() exists and returns an object before spreading
            const currentLabelOptions = labelInstance.getLabel();
            if (currentLabelOptions) {
                labelInstance.setLabel({ ...currentLabelOptions, text: formattedText, clickable }); // update text
            } else {
                // Fallback if getLabel() is not as expected
                labelInstance.setLabel({ text: formattedText, clickable });
            }
        }

        // -- Create new label --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel([labelPosition], formattedText, null, {
                clickable,
                id: `annotate_${this.mode}_total_label_${this.measure.id}`,
                ...rest
            });
            // update references
            labelsArray.push(labelInstance);
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { totalDistance, labelInstance: null }; // Early exit if labelInstance is not valid
        }

        // -- Handle Label Metadata Update --
        labelInstance.status = status; // Set status
        labelInstance.positions = [{ ...labelPosition }] // Store positions copy

        return { totalDistance, labelInstance }; // Return the newly created instance
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        this.flags.isReverse = false;

        // Reset variables
        this.coordsCache = [];
        this.#coordinate = null; // Clear the coordinate
        this.#distances = []; // Clear the distances
        this.#interactiveAnnotations.polylines = []; // Clear polylines
        this.#interactiveAnnotations.labels = []; // Clear labels
        this.#interactiveAnnotations.totalLabels = []; // Clear total labels

        // Reset the measure data
        this.measure = super._createDefaultMeasure(); // Reset measure to default state
    }
}

export { MultiDistanceGoogle };
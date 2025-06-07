import dataPool from "../../lib/data/DataPool.js";
import { calculateMiddlePos, calculateDistance, formatMeasurementValue, areCoordinatesEqual, checkOverlayType, } from "../../lib/helper/googleHelper.js";
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
    #markerListeners = {
        mousedown: (marker, event) => {
            if (event.domEvent) {
                // MIDDLE CLICK EVENT: Check for middle mouse button (button === 1)
                if (event.domEvent.button === 1) {
                    // Prevent map drag, default behavior
                    event.domEvent.stopPropagation();
                    event.domEvent.preventDefault();

                    this._removePointFromMeasure(marker); // Call removePointFromMeasure for middle click
                }
                // LEFT DOWN EVENT: Check for left mouse button (button === 0) for dragging
                else if (event.domEvent.button === 0) {
                    if (this.dragHandler && this.flags.isActive) {
                        // Prevent map drag, default behavior
                        event.domEvent?.stopPropagation();
                        event.domEvent?.preventDefault();
                        // When the measure is completed and no current measurement is in progress
                        if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) {
                            // Tell the drag handler to start dragging this specific marker
                            this.dragHandler._handleDragStart(marker, event);
                        }
                    }
                }
            }
        },
        click: (marker, event) => {
            if (this.flags.isActive) {
                // Prevent map drag, default behavior
                event.domEvent?.stopPropagation();
                event.domEvent?.preventDefault();

                this._formsPerimeter(marker);
            }
        }
    };

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
            listeners: this.#markerListeners
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
                clickable: false
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

    _formsPerimeter(marker) {
        // during measuring
        if (this.coordsCache.length > 0 && !this.flags.isMeasurementComplete) {
            // Find the first point 
            const pointIndex = this.coordsCache.findIndex(coordinate => areCoordinatesEqual(coordinate, marker.position));
            if (pointIndex === -1) return;
            const isFirstPoint = pointIndex === 0;

            if (isFirstPoint) {
                const pointPosition = marker.positions[0];

                // const positions = [this.coordsCache[this.coordsCache.length - 1], pointPosition];
                this.coordsCache.push(pointPosition); // Add the point to the cache

                this._finalizeMeasure(); // Finalize the measurement
            }
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
                const positions = [this.coordsCache[this.coordsCache.length - 1], this.#coordinate];

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

            // Update the this.coords cache and this.measure coordinates
            this.coordsCache.push(this.#coordinate);

            // Create last point
            const lastPoint = this.drawingHelper._addPointMarker(this.#coordinate, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
                clickable: true,
                listeners: this.#markerListeners
            });
            if (!lastPoint) return; // If point creation fails, exit
            lastPoint.status = "completed";

            this._finalizeMeasure();
        }
    }

    _finalizeMeasure() {
        const lastPositions = [this.coordsCache[this.coordsCache.length - 2], this.coordsCache[this.coordsCache.length - 1]];

        // -- APPROACH 2: Update/ Reuse existing polyline and label --
        // Create last line
        this._createOrUpdateLine(lastPositions, this.#interactiveAnnotations.polylines, {
            status: "completed",
            color: this.stateManager.getColorState("line"),
            clickable: true
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
            if (point.id.includes(this.mode)) {
                point.status = "completed"
                point.clickable = true;
            }
        });

        // update polylines status
        this.#interactiveAnnotations.polylines.forEach(polyline => {
            if (polyline.id.includes(this.mode)) {
                polyline.setOptions({ status: "completed", clickable: true }); // Make the polyline clickable
            }
        });
        // update labels status
        this.#interactiveAnnotations.labels.forEach(label => {
            if (label.id.includes(this.mode)) {
                label.setOptions({ status: "completed", clickable: true }); // Make the label clickable
            }
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
     * RIGHT CLICK FEATURES *
     ************************/
    _removePointFromMeasure(marker) {
        // TODO: implement the logic for removing a point from the measure
        return;
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
            clickable: true
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

        if (!labelPosition) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { totalDistance, labelInstance: null }; // Return early if middle position is invalid
        }

        let labelInstance = null;

        // -- Update existing label --
        if (labelsArray.length > 0) {
            labelInstance = labelsArray[0]; // Get the reference from the array

            // Check if the reference is a valid Google Maps Marker
            if (!labelInstance) {
                console.warn("_createOrUpdateLabel: Invalid object found in labelsArray. Attempting to remove and recreate.");
                labelsArray.length = 0; // Clear the array to trigger creation below
            } else {
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
        }

        // -- Create new label --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel([labelPosition], totalDistance, "meter", {
                clickable,
                id: `annotate_${this.mode}_total_label_${this.measure.id}`,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return { totalDistance, labelInstance: null }; // Return totalDistance but null instance
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { totalDistance, labelInstance: null }; // Early exit if labelInstance is not valid
        }

        // -- Handle Metadata Update --
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
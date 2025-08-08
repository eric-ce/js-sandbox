import dataPool from "../../lib/data/DataPool.mjs";
import { calculateDistance, areCoordinatesEqual, convertToLatLng, checkLayerType } from "../../lib/helper/leafletHelper.mjs";
import { getNeighboringValues, formatMeasurementValue, showCustomNotification } from "../../lib/helper/helper.mjs";
import { MeasureModeLeaflet } from "./MeasureModeLeaflet.mjs";

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {Array<{latitude: number, longitude: number, height?: number}|number|string>} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("leaflet")
 */
/** 
 * @typedef NormalizedEventData
 * @property {{lat: number, lng:number}} mapPoint - The map coordinates
 * @property {{x:number,y:number}} screenPoint - The screen coordinates
 * @property {object} domEvent - The DOM event object
 * @property {object} leafletEvent - The Leaflet event object
 * @property {object} target - The target of the event (e.g., map, marker, etc.)
 * @property {object} layer - The Leaflet layer object
 */
// -- Dependencies types --
/** @typedef {import('../../lib/data/DataPool.mjs').DataPool} DataPool */
/** @typedef {import('../../lib/input/LeafletInputHandler.mjs').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/interaction/LeafletDragHandler.mjs').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/interaction/LeafletHighlightHandler.mjs').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.mjs').StateManager} StateManager*/
/** @typedef {import('../../components/leafletAnnotation.mjs').leafletAnnotation} leafletAnnotation */

/** @typedef {{polylines: L.polyline[], labels: L.tooltip[]}} InteractiveAnnotationsState */
/** @typedef {{lat:number, lng:number}} Coordinate*/


class MultiDistanceLeaflet extends MeasureModeLeaflet {
    /** @type {Coordinate} */
    #coordinate = null;
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polylines: [],
        labels: [],
        totalLabels: []
    };
    /** @type {MeasurementGroup} */
    measure = null;
    /** @type {Coordinate[]} */
    coordsCache = [];
    /** @type {number[]} */
    #distances = []; // Array to store distances between points

    /**
     * Listeners for point markers.
     * @private
     */
    #pointMarkerListeners = {
        mousedown: (marker, event) => {
            // Only handle left mouse button (button 0)
            if (event.domEvent?.button !== 0) return;

            if (this.dragHandler && this.flags.isActive) {
                // Prevent map drag, default behavior
                event.domEvent.stopPropagation();
                event.domEvent.preventDefault();

                // DO NOT use isMeasurementComplete flag here, because it is not set when the measure is not started yet, think of switch mode case
                if (this.coordsCache.length === 0) {
                    this.dragHandler._handleDragStart(marker, event);
                }
            }
        },
        click: (marker, event) => {
            // Prevent map drag, default behavior
            event.domEvent?.stopPropagation();
            event.domEvent?.preventDefault();

            // Prevent click event from firing immediately after a drag operation.
            // A drag is determined if the isDragging flag is true or if a drag ended recently.
            if (this.dragHandler?.isDragging || (this.dragHandler?.lastDragEndTs && (Date.now() - this.dragHandler.lastDragEndTs) < 200)) {
                return;
            }

            // Case: it is during measure
            if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) {
                const pointPositions = marker?.feature?.properties?.positions || [];
                const pointIndex = this.coordsCache.findIndex(coordinate => areCoordinatesEqual(coordinate, pointPositions[0]));
                if (pointIndex === -1) return;
                const isFirstPoint = pointIndex === 0;
                // if it click on the first point then forms perimeter
                if (isFirstPoint) {
                    // -- Feature: forms perimeter --
                    this._formsPerimeter(marker);
                }
            }
        }
    };


    /**
     * 
     * @param {LeafletInputHandler} inputHandler 
     * @param {LeafletDragHandler} dragHandler 
     * @param {LeafletHighlightHandler} highlightHandler 
     * @param {leafletAnnotation} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter || !app) {
            throw new Error("MultiDistanceLeaflet requires inputHandler, drawingHelper (with map), stateManager, emitter, and app.");
        }

        super("multi-distances", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false; // Initialize drag mode flag
        this.flags.isReverse = false; // Initialize reverse flag

        /** @type {MeasurementGroup} */
        this.measure = this._createDefaultMeasure();

        // Listen to right click event
        // this.emitter.on('annotation-contextmenu-leaflet', this._handleContextMenu);
    }


    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }
    get coordinate() {
        return this.#coordinate;
    }


    /******************
     * EVENTS HANDLER *
     ******************/
    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
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
            interactive: true, // Make the point interactive
            status: "pending", // Set status to pending
            listeners: this.#pointMarkerListeners,
        });
        if (!point) return;

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
                interactive: false,
            });

            // Create the label
            const { distances } = this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                status: "pending",
                interactive: false
            });

            // -- Handle Distances record --
            if (this.flags.isReverse) {
                this.#distances.unshift(...distances); // Prepend distance if reversing
            } else {
                this.#distances.push(...distances); // Append distance otherwise
            }

            // Create the total label
            const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
                status: "pending",
                interactive: false
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
     * @param {L.CircleMarker} point - The point marker representing the clicked point. 
     * @returns {void}
     */
    _formsPerimeter(point) {
        // User confirmation
        const userConfirmation = confirm('Do you want it to form a perimeter?');
        if (!userConfirmation) return; // If the user does not confirm, exit

        // -- Update coordsCache --
        const pointPosition = point.feature.properties?.positions[0];
        this.coordsCache.push(pointPosition); // Add the point to the cache

        // -- Complete the measure --
        this._finalizeMeasure(); // Finalize the measurement
    }


    /**********************
     * MOUSE MOVE FEATURE *
     **********************/
    /**
    * Handles mouse move events on the map.
    * @param {NormalizedEventData} eventData - The event data containing information about the click event.
    * @returns {Void}
    */
    handleMouseMove = async (eventData) => {
        if (!eventData || !eventData.mapPoint) return;

        // update coordinate
        const pos = eventData.mapPoint;
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
                    interactive: false
                });

                // Moving label: update if existed, create if not existed
                this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                    status: "moving",
                    interactive: false
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
                interactive: true,
                status: "completed", // Set status to completed 
                listeners: this.#pointMarkerListeners,
            });
            if (!lastPoint) return; // If point creation fails, exit

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
            interactive: true
        });

        // Create last label
        const { distances } = this._createOrUpdateLabel(lastPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            interactive: true
        });

        // -- Handle Distances record --
        if (this.flags.isReverse) {
            this.#distances.unshift(...distances); // Prepend distance if reversing
        } else {
            this.#distances.push(...distances); // Append distance otherwise
        }

        // Create the total label
        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "completed",
            interactive: true
        });

        // -- Update annotations status --
        // Update points status and interactive
        this._updatePendingItemsToCompleted(this.pointCollection.getLayers(), `annotate_${this.mode}`);
        // Update polylines status and interactive
        this._updatePendingItemsToCompleted(this.#interactiveAnnotations.polylines, `annotate_${this.mode}`);
        // Update labels status and interactive
        this._updatePendingItemsToCompleted(this.#interactiveAnnotations.labels, `annotate_${this.mode}`);

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


    /**********************
     *    RIGHT CLICK     *
     * CONTEXT MENU EVENT *
     **********************/
    _getContextMenuAdditionalItems(layer) {
        const itemList = [];
        const layerType = checkLayerType(layer);

        switch (layerType) {
            case "point":
                itemList.push({ text: "Remove Point", event: () => this._removePointFromMeasure(layer) });

                // -- Handle Resume Measure --
                const resumeContext = this._getPointContextForResume(layer);
                // Check if resumeContext is valid and it is not a perimeter measure case
                const canResume = resumeContext &&
                    !areCoordinatesEqual(
                        resumeContext.measureData.coordinates[0],
                        resumeContext.measureData.coordinates[resumeContext.measureData.coordinates.length - 1]
                    )
                if (canResume) {
                    itemList.push({
                        text: "Resume measure",
                        event: () => {
                            this._getOrSetModeInstance("multi-distances");
                            this._resumeMeasure(resumeContext.pointIndex, resumeContext.measureData)
                        }
                    });
                }
                break;
            case "polyline":
                break;
        }

        return itemList;
    }

    _getPointContextForResume(point) {
        // Find the measure data
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return;

        // -- Handle Measure Data --
        // Get the measure data from the data pool
        const measureData = dataPool.getMeasureById(measureId);
        // Only completed measures can be resumed
        if (!measureData || measureData.status !== "completed") {
            return null;
        }

        // convert measure data coordinates from cartographic degrees to latLng format
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToLatLng(cartographicDegrees));

        // Find the index of the clicked point within the measure's coordinates
        const pointPosition = point.feature?.properties?.positions[0];
        if (!pointPosition) return null;

        const pointIndex = measureData.coordinates.findIndex(coordinate => areCoordinatesEqual(coordinate, pointPosition));
        if (pointIndex === -1) return null;

        // Check if the point is the first or the last one
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === measureData.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            return { pointIndex, measureData };
        }

        return null;
    }

    _resumeMeasure(pointIndex, measureData) {
        if (measureData === undefined || pointIndex === undefined) return;

        // Set the component's state to the measure being resumed
        this.measure = measureData;
        this.measure.status = "pending";
        this.distances = [...this.measure._records[0].distances];
        this.coordsCache = this.measure.coordinates;

        // Determine if resuming from the start or end
        const isFirstPoint = pointIndex === 0;

        // Set flags to continue measuring
        this.flags.isMeasurementComplete = false;
        this.flags.isReverse = isFirstPoint;

        // Optional: Add a user notification
        showCustomNotification(`Resuming measure id: ${this.measure.id}`, this._container);
    }


    /**
     * Removes a point marker during measurement.
     * @param {L.CircleMarker} point - The point marker to remove.
     * @returns {void}
     */
    _removePointFromMeasure(point) {
        // Validate input parameters
        if (!point || !point?.feature?.properties) return;
        const pointPositions = point?.feature?.properties?.positions;
        if (!Array.isArray(pointPositions) || pointPositions.length === 0) return;

        // confirmation 
        // const userConfirmation = window.confirm(`Do you want to remove this point?`) // Confirm the removal action
        // if (!userConfirmation) {
        //     this._refreshMapDrag();
        //     return;
        // };

        // -- Remove point --
        this.drawingHelper._removePointMarker(point); // Remove the point marker

        // -- Set Measure and Distances --
        // Find the measure data by ID
        const measureId = Number(point.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID 
        this.measure = this._findMeasureById(measureId);    // Set the measure
        if (!this.measure) {
            this._refreshMapDrag();
            return; // If the measure is not found, exit
        }
        this.#distances = [...this.measure._records[0].distances]; // Get the distances from the measure data
        // clone the coordinates from the measure data
        // this.measure.coordinates is the `original coordinates`, this.coordsCache is the `updated coordinates`
        let positions = this.measure.coordinates.map(pos => ({ ...pos }));

        // Find the point index in the measure coordinates
        const pointPositionIndices = this.measure.coordinates
            .map((coordinate, index) => areCoordinatesEqual(coordinate, pointPositions[0]) ? index : -1)
            .filter(index => index !== -1);
        if (pointPositionIndices.length === 0) {
            this._refreshMapDrag();
            return; // If the point is not found, exit
        }

        // -- Update positions --
        // Set positions to filter out pointPositionIndices
        positions = positions.filter((_, index) => !pointPositionIndices.includes(index));

        // remove related lines
        const polylines = this.drawingHelper._getLineByPositions([pointPositions[0]]);
        if (!Array.isArray(polylines) || polylines.length === 0) {
            this._refreshMapDrag();
            return; // If no lines are found, exit
        }

        polylines.forEach(line => {
            this.drawingHelper._removePolyline(line); // Remove the line

            const linePositions = line?.feature?.properties?.positions;
            if (!Array.isArray(linePositions) || linePositions.length === 0) return; // If no line positions are found, exit

            // Case: during measuring, remove the line from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.polylines.length === 0) return; // If there are no polylines, exit
            const lineToRemoveIndex = this.#interactiveAnnotations.polylines.findIndex(l => {
                const lineToRemovePositions = l?.feature?.properties?.positions;
                return areCoordinatesEqual(lineToRemovePositions[0], linePositions[0]) &&
                    areCoordinatesEqual(lineToRemovePositions[1], linePositions[1]);
            });
            if (lineToRemoveIndex === -1) return; // If the line is not found, exit
            this.#interactiveAnnotations.polylines.splice(lineToRemoveIndex, 1); // Remove the line from this interactive annotations        });
        });

        // remove related labels
        const labelMarkers = this.drawingHelper._getLabelByPosition([pointPositions[0]]);
        if (!Array.isArray(labelMarkers) || labelMarkers.length === 0) return; // If no labels are found, exit
        labelMarkers.forEach(label => {
            // Safety check: assume moving or total labels should not be removed here
            const isMovingLabel = label?.feature?.properties?.status === "moving";
            const isTotalLabel = label.id.startsWith(`annotate_${this.mode}_total-label`);
            if (isMovingLabel || isTotalLabel) return;

            this.drawingHelper._removeLabel(label); // Remove the label            

            // Case: during measuring, remove the label from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.labels.length === 0) return; // If there are no labels, exit
            const labelToRemoveIndex = this.#interactiveAnnotations.labels.findIndex(l => areCoordinatesEqual(l.position, label.position));
            if (labelToRemoveIndex === -1) return; // If the label is not found, exit
            this.#interactiveAnnotations.labels.splice(labelToRemoveIndex, 1);
        });

        // set existed total label 
        const labels = this.labelCollection.getLayers();
        if (Array.isArray(labels) && labels.length > 0) {
            this.#interactiveAnnotations.totalLabels = labels.filter(label => label.id.startsWith(`annotate_${this.mode}_total-label_${this.measure.id}`));
        }

        // Find neighboring coordinate
        const { previous, current, next } = getNeighboringValues(this.measure.coordinates, pointPositionIndices[0]); // find the point position neighboring positions.

        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete; // Check if it is measuring
        const isPerimeter = areCoordinatesEqual(this.measure.coordinates[0], this.measure.coordinates[this.measure.coordinates.length - 1]);
        const graphicsStatus = isMeasuring ? "pending" : "completed"; // Determine the graphics status based on measuring state
        // Case: Perimeter measure, it can only be measure completed or measure not yet started
        if (isPerimeter) {
            if (previous && next) {  // Case: the removing point is in the middle of the positions
                // Case: The minimum shape is a triangle that consists of 4 points. Less than 4 means it is not a shape
                if (positions.length === 3) {
                    positions.pop(); // Remove the last point if it is less than 4 points
                    // -- Handle Distances record --
                    this.#distances.splice(pointPositionIndices[0] - 1, 2);
                } else {
                    const reconnectedPositions = [previous, next];
                    // -- Create polyline --
                    this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                        status: graphicsStatus,
                        color: this.stateManager.getColorState("line"),
                        interactive: true,
                    });
                    // -- Create label --
                    const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                        status: graphicsStatus,
                        interactive: true
                    });

                    // -- Handle Distances record --
                    // Don't calculate all distances from coordsCache due to performance and consistency
                    this.#distances.splice(pointPositionIndices[0] - 1, 2, distances[0]); // remove and insert the new distance
                }
            } else if (next) {  // Case: The removing point is the first point
                if (positions.length > 2) {
                    positions.push(positions[0]); // Reconnect the first point to the last point
                    const reconnectedPositions = [positions[0], positions[positions.length - 2]];  // the last point primitive is the length-2 because first point equals to last point in perimeter.
                    // -- Create polyline --
                    this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                        status: graphicsStatus,
                        color: this.stateManager.getColorState("line"),
                        interactive: true,
                    });
                    // -- Create label --
                    const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                        status: graphicsStatus,
                        interactive: true
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
            } else if (previous) {  // Case: The removing point is the last point
                this.#distances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
            }

            showCustomNotification(`Point removed from measure ${measureId}`, this._container)
        }

        // Case: Normal measure, it could be during measuring or measure completed or measure not yet started
        if (!isPerimeter) {
            if (previous && next) {  // Case: the removing point is in the middle of the positions
                const reconnectedPositions = [previous, next];
                // -- Create polyline --
                this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                    status: graphicsStatus,
                    color: this.stateManager.getColorState("line"),
                    interactive: true,
                });
                // -- Create label --
                const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                    status: graphicsStatus,
                    interactive: true
                });

                // -- Handle Distances record --
                // Don't calculate all distances from coordsCache due to performance and consistency
                this.#distances.splice(pointPositionIndices[0] - 1, 2, distances[0]); // remove and insert the new distance
            } else if (next) {  // Case: The removing point is the first point
                this.#distances.splice(0, 1) // Remove the first distance
            } else if (previous) {  // Case: The removing point is the last point
                this.#distances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
            }
        }
        // -- End of Handle Reconnection and distance record --

        // -- Reposition the total label --
        const { totalDistance } = this._createOrUpdateTotalLabel(positions, this.#interactiveAnnotations.totalLabels, {
            status: graphicsStatus,
            interactive: true
        });

        // Case: if only one point left, remove the remaining point and labels
        if (positions.length === 1) {
            this._removeRemaining(positions); // Remove the remaining point and labels
            this._refreshMapDrag(); // Refresh the map dragging, to solve issue the middle click keep dragging
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

        // Refresh the map dragging, to solve issue the middle click keep dragging
        this._refreshMapDrag();

        // Show notification
        showCustomNotification(`Point removed from measure ${measureId}`, this._container);
    }

    /**
     * Removes the remaining point and labels when only one point is left in the measure.
     * @param {{lat:number,lng:number}[]} positions - The positions to be removed
     * @returns {void}
     */
    _removeRemaining(positions) {
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

        // Show notification
        showCustomNotification(`Last point removed from measure ${measureId}`, this._container);
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
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

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
            interactive: false
        });

        // -- Update label --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            interactive: false
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
            interactive: false,
        });
    }

    /**
     * Finalize graphics updates for the end of drag operation
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    finalizeDrag(measure) {
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

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
            interactive: true,
        });

        // -- Finalize Label Graphics --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            interactive: true
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
            interactive: true
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
    /**
      * Create or update the label.
      * If the label exists in labelsArray, update its position and text, else create a new one.
      * Manages the reference within the provided labelsArray.
      * @param {{lat:number,lng:number}[]} positions - Array of positions (expects 2) to calculate distance and middle point.
      * @param {L.tooltip[]} labelsArray - The array (passed by reference) that holds the label instance. This array will be modified. Caution: this is not the labelCollection.
      * @param {Object} [options={}] - Options for the label.
      * @return {{ distance:number, labelInstance:L.tooltip|null }} - The calculated distance and the created/updated label instance, or null if failed.
      */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelInstances: null }; // Validate input positions
        };

        // default options
        const {
            status = "pending", // Default pending status
            color = "rgba(0, 0, 0, 1)",
            interactive = false,
            id = `annotate_${this.mode}_label_${this.measure.id}`,
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
                    const labelToUpdate = labelInstances[index];
                    const segmentDistance = calculateDistance(posSet[0], posSet[1]); // Calculate distance for the segment
                    const formattedText = formatMeasurementValue(segmentDistance, "meter"); // Format the distance text

                    // Update label visuals and metadata
                    this._updateLabel(labelToUpdate, posSet, formattedText, {
                        id,
                        status,
                        color,
                        interactive,
                        ...rest
                    });

                    // -- Handle records Update --
                    segmentDistance && distances.push(segmentDistance); // Collect distances for each segment
                });
            }
            // Case: update SINGLE LABEL, typically for moving operation 
            else {
                // Find the moving label instance
                const labelInstance = labelsArray.find(label => label?.feature?.properties?.status === "moving");
                if (labelInstance) {
                    const segmentDistance = calculateDistance(positions[0], positions[1]); // Calculate distance for the segment
                    const formattedText = formatMeasurementValue(segmentDistance, "meter"); // Format the distance text

                    // Update label visuals and metadata
                    this._updateLabel(labelInstance, positions, formattedText, {
                        id,
                        status,
                        color,
                        interactive,
                        ...rest
                    });

                    // -- Handle References Update --
                    labelInstances = [labelInstance];
                    distances = [segmentDistance];
                }
            }
        }

        // 3. CREATE LOGIC
        if (labelInstances.length === 0) {
            const segmentDistance = calculateDistance(positions[0], positions[1]);

            const labelInstance = this.drawingHelper._addLabel(positions, segmentDistance, "meter", {
                id,
                status,
                interactive,
                ...rest
            });

            // Update the distances 
            distances = [segmentDistance]; // Store the distance for the single segment

            // Safe exit if label creation fails, but return the distances
            if (!labelInstance) {
                console.warn("_createOrUpdateLabel: Failed to create new label instance.");
                return { distances, labelInstances: null }; // Return distance but null instance
            }

            // -- Handle References Update --
            labelInstances.push(labelInstance); // Store the new label instance in the array
            labelsArray.push(labelInstance);
        }

        return { distances, labelInstances };
    }

    _createOrUpdateTotalLabel(positions, labelsArray, options = {}) {
        // Input validation
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelInstance: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            color = "rgba(0, 0, 0, 1)",
            interactive = false,
            id = `annotate_${this.mode}_total-label_${this.measure.id}`,
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
        } else {
            const existedTotalLabel = this.labelCollection.getLayers().find(label => label.id === `annotate_${this.mode}_total-label_${this.measure.id}`); // Find the label by ID      
            if (existedTotalLabel) {
                labelInstance = existedTotalLabel; // If it exists, use it
            }
        }

        // -- Update label if exists --
        if (labelInstance) {
            // Update label visuals and metadata
            this._updateLabel(labelInstance, [labelPosition], formattedText, {
                interactive,
                id,
                status,
                ...rest
            });
        }

        // -- Create new label if not exists --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel([labelPosition], formattedText, null, {
                id,
                interactive,
                status,
                color,
                ...options
            });

            // -- Handle References Update --
            labelInstance && labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { totalDistance, labelInstance: null }; // Early exit if labelInstance is not valid
        }

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
        this.#interactiveAnnotations.polylines = []; // Clear the polylines
        this.#interactiveAnnotations.labels = [];  // Clear the labels
        this.#interactiveAnnotations.totalLabels = [];  // Clear the total labels

        // Reset the measure data
        this.measure = super._createDefaultMeasure(); // Reset measure to default state
    }
}

export { MultiDistanceLeaflet };
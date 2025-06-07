import dataPool from "../../lib/data/DataPool.js";
import { calculateDistance, calculateMiddlePos, formatMeasurementValue, areCoordinatesEqual } from "../../lib/helper/leafletHelper.js";
import { getNeighboringValues } from "../../lib/helper/helper.js";
import { MeasureModeLeaflet } from "./MeasureModeLeaflet.js";

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

// -- Dependencies types --
/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/LeafletInputHandler.js').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/interaction/LeafletDragHandler.js').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/interaction/LeafletHighlightHandler.js').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/LeafletMeasure.js').LeafletMeasure} LeafletMeasure */

/** @typedef {{domEvent:object, layer: object, leafletEvent: object, mapPoint: {lat: number, lng:number}, screenPoint: {x:number,y:number}, target: object }} EventDataState */
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
     * 
     * @param {LeafletInputHandler} inputHandler 
     * @param {LeafletDragHandler} dragHandler 
     * @param {LeafletHighlightHandler} highlightHandler 
     * @param {LeafletMeasure} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("MultiDistanceLeaflet requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("multi_distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false; // Initialize drag mode flag
        this.flags.isReverse = false; // Initialize reverse flag

        /** @type {MeasurementGroup} */
        this.measure = this._createDefaultMeasure();
    }


    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }


    /******************
     * EVENTS HANDLER *
     ******************/
    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events on the map.
     * @param {EventDataState} eventData - The event data containing information about the click event.
     * @returns {Void}
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

        const markerListener = {
            // Add any specific marker options here if needed
            // Pass the mousedown listener
            listeners: {
                mousedown: (marker, event) => {
                    // Check if drag handler exists and is active
                    if (this.dragHandler && this.flags.isActive) {
                        // Prevent map drag, default behavior
                        event.domEvent?.stopPropagation();
                        event.domEvent?.preventDefault();

                        // Tell the drag handler to start dragging this specific marker
                        this.dragHandler._handleDragStart(marker, event);
                    }
                },
            }
        };

        // -- Create point marker --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            interactive: false,
            ...markerListener
        });
        if (!point) return;
        point.status = "pending"; // Set status to pending

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

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
                interactive: false
            });

            // Create the label
            const { distances } = this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                status: "pending",
                interactive: false
            });

            // -- Handle Distances record --
            this.#distances.push(...distances); // Store the distance in the cache

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


    /**********************
     * MOUSE MOVE FEATURE *
     **********************/
    /**
    * Handles mouse move events on the map.
    * @param {EventDataState} eventData - The event data containing information about the click event.
    * @returns {Void}
    */
    handleMouseMove = async (eventData) => {
        if (!eventData || !eventData.mapPoint) return;

        // update coordinate
        const pos = eventData.mapPoint;
        if (!pos) return;
        this.#coordinate = pos; // Store for later use

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:// Moving coordinate data
                const positions = [this.coordsCache[this.coordsCache.length - 1], this.#coordinate];

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

            // Update the this.coords cache and this.measure coordinates
            this.coordsCache.push(this.#coordinate);

            const markerListener = {
                // Add any specific marker options here if needed
                // Pass the mousedown listener
                listeners: {
                    mousedown: (marker, event) => {
                        // Check if drag handler exists and is active
                        if (this.dragHandler && this.flags.isActive) {
                            // Prevent map drag, default behavior
                            event.domEvent?.stopPropagation();
                            event.domEvent?.preventDefault();

                            // Tell the drag handler to start dragging this specific marker
                            this.dragHandler._handleDragStart(marker, event);
                        }
                    },
                }
            };
            // Create last point
            const lastPoint = this.drawingHelper._addPointMarker(this.#coordinate, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
                status: "completed",
                interactive: true,
                ...markerListener
            });
            if (!lastPoint) return; // If point creation fails, exit

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
            interactive: true
        });

        // Create last label
        const { distances } = this._createOrUpdateLabel(lastPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            interactive: true
        });

        // -- Handle Distances record --
        this.#distances.push(...distances); // Store the last distance in the cache

        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "completed",
            interactive: true
        });


        // -- Update annotations status --
        // update points status
        this.pointCollection.getLayers().forEach(point => {
            if (point.id.includes(this.mode) && point.status !== "completed") {
                point.status = "completed" // Set the status to completed
                if (point.options.interactive === false && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                    point.options.interactive = true; // Make the point interactive
                    this.drawingHelper._refreshLayerInteractivity(point);
                }
            }
        });
        // update polylines status
        this.#interactiveAnnotations.polylines.forEach(polyline => {
            if (polyline.id.includes(this.mode) && polyline.status !== "completed") {
                polyline.status = "completed"; // Set the status to completed
                if (polyline.options.interactive === false && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                    polyline.options.interactive = true; // Make the polyline interactive
                    this.drawingHelper._refreshLayerInteractivity(polyline);
                }
            }
        });
        // update labels status
        this.#interactiveAnnotations.labels.forEach(label => {
            if (label.id.includes(this.mode) && label.status !== "completed") {
                label.status = "completed"; // Set the status to completed
                if (label.options.interactive === false && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                    label.options.interactive = true; // Make the label interactive
                    this.drawingHelper._refreshLayerInteractivity(label);
                }
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
            interactive: true
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
     * Creates a new polyline or updates an existing one based on positions.
     * Manages the reference within the provided polylinesArray.
     * @param {{lat: number, lng: number}[]} positions - Array of positions to create or update the line.
     * @param {L.polyline[]} polylinesArray - The array (passed by reference) that holds the polyline instance. This array will be modified. Caution: this is not the polylineCollection.
     * @param {Object} [options={}] - Options for the line.
     * @returns {L.polyline | null} The created or updated polyline instance, or null if failed.
     */
    _createOrUpdateLine(positions, polylinesArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(polylinesArray) || !Array.isArray(positions) || positions.length === 0) {
            console.warn("_createOrUpdateLine: input parameters are invalid.");
            return;
        }

        // default options
        const {
            status = "pending", // Default pending status
            color = this.stateManager.getColorState("move"),
            interactive = false,
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
                    interactive,
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
                interactive,
                ...rest
            });
            if (!newLineInstance) return;

            // -- Handle Metadata Update --
            newLineInstance.status = status; // Set status on the new instance
            // -- Handle References Update --
            polylinesArray.push(newLineInstance);
        }
    }

    /**
      * Create or update the label.
      * If the label exists in labelsArray, update its position and text, else create a new one.
      * Manages the reference within the provided labelsArray.
      * @param {{lat:number,lng:number}[]} positions - Array of positions (expects 2) to calculate distance and middle point.
      * @param {L.tooltip[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified. Caution: this is not the labelCollection.
      * @param {Object} [options={}] - Options for the label.
      * @param {string|null} [options.status=null] - Status to set on the label instance.
      * @return {{ distance: number, labelInstance: L.tooltip | null }} - The calculated distance and the created/updated label instance, or null if failed.
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
                    labelToUpdate.setLatLng(segmentMiddlePos); // update position

                    // Create HTML element for label content
                    const contentElement = document.createElement('span');
                    contentElement.style.color = color;
                    contentElement.textContent = segmentFormattedText;

                    // Set the content of the label
                    labelToUpdate.setContent(contentElement); // update content
                    // Update interactive state
                    const oldInteractiveState = labelToUpdate.options.interactive;
                    // Compare the old with current interactive state, only update interactive if different
                    if (oldInteractiveState !== interactive) {
                        // Update the interactive
                        labelToUpdate.options.interactive = interactive;
                        // Refresh the layer to apply the new interactive state. 
                        if (this.drawingHelper && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                            this.drawingHelper._refreshLayerInteractivity(labelToUpdate);
                        }
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
                    labelInstance.setLatLng(segmentMiddlePos); // update position

                    // Create HTML element for label content
                    const contentElement = document.createElement('span');
                    contentElement.style.color = color;
                    contentElement.textContent = segmentFormattedText;

                    // Set the content of the label
                    labelInstance.setContent(contentElement); // update content
                    // Update interactive state
                    const oldInteractiveState = labelInstance.options.interactive;
                    // Compare the old with current interactive state, only update interactive if different
                    if (oldInteractiveState !== interactive) {
                        // Update the interactive
                        labelInstance.options.interactive = interactive;
                        // Refresh the layer to apply the new interactive state. 
                        if (this.drawingHelper && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                            this.drawingHelper._refreshLayerInteractivity(labelInstance);
                        }
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
            color = "rgba(0, 0, 0, 1)",
            interactive = false,
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
                labelInstance.setLatLng(labelPosition); // update position

                // Create HTML element for label content
                const contentElement = document.createElement('span');
                contentElement.style.color = color;
                contentElement.textContent = formattedText;

                // Set the content of the label
                labelInstance.setContent(contentElement); // update content

                // Update interactive state
                const oldInteractiveState = labelInstance.options.interactive;
                // Compare the old with current interactive state, only update interactive if different
                if (oldInteractiveState !== interactive) {
                    // Update the interactive
                    labelInstance.options.interactive = interactive;
                    // Refresh the layer to apply the new interactive state. 
                    if (this.drawingHelper && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                        this.drawingHelper._refreshLayerInteractivity(labelInstance);
                    }
                }
            }
        }

        // -- Create new label --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel([labelPosition], formattedText, null, {
                interactive,
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
        this.#interactiveAnnotations.polylines = []; // Clear the polylines
        this.#interactiveAnnotations.labels = [];  // Clear the labels
        this.#interactiveAnnotations.totalLabels = [];  // Clear the total labels

        // Reset the measure data
        this.measure = super._createDefaultMeasure(); // Reset measure to default state
    }
}

export { MultiDistanceLeaflet };
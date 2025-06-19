import dataPool from "../../lib/data/DataPool.js";
import { calculateDistance, calculateMiddlePos, formatMeasurementValue, areCoordinatesEqual, convertToLatLng } from "../../lib/helper/leafletHelper.js";
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


class TwoPointsDistanceLeaflet extends MeasureModeLeaflet {
    /** @type {Coordinate} */
    #coordinate = null;
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polylines: [],
        labels: []
    };
    /** @type {MeasurementGroup} */
    measure = null;
    /** @type {Coordinate[]} */
    coordsCache = [];

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
            throw new Error("TwoPointsDistanceLeaflet requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        /** @type {MeasurementGroup} */
        this.measure = this._createDefaultMeasure();
    }

    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }


    /*****************
     * EVENT HANDLER *
     *****************/
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
            ...markerListener
        });
        if (!point) return;
        point.status = "pending"; // Set status to pending

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        if (this.coordsCache.length === 2) {
            // update status pending annotations
            const pointsArray = this.pointCollection.getLayers();
            pointsArray.forEach(point => {
                if (point && point.id.includes(this.mode)) {
                    point.status = "completed"
                }
            });

            // -- APPROACH 2: Update/ Reuse existing polyline and label --
            // -- Handle polyline --
            this._createOrUpdateLine(this.coordsCache, this.#interactiveAnnotations.polylines, {
                status: "completed",
                color: this.stateManager.getColorState("line"),
                interactive: true
            });

            // -- Handle label --
            const { distance } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                interactive: true,
            });

            // Update this.measure
            this.measure._records.push(distance);
            this.measure.status = "completed";

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });

            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;

            // Clean up the current measure state, to prepare for the next measure
            this.coordsCache = [];
            this.#interactiveAnnotations.polylines = []; // Clear moving polylines
            this.#interactiveAnnotations.labels = [];  // Clear moving labels

        }
    }

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
            case isMeasuring:
                if (this.coordsCache.length === 1) {
                    const positions = [this.coordsCache[0], pos].filter(Boolean); // Filter out any null value

                    // Validate leaflet positions
                    if (positions.length < 2) {
                        console.error("Leaflet positions are empty or invalid:", positions);
                        return;
                    }

                    // Moving line: remove if existed, create if not existed
                    this._createOrUpdateLine(positions, this.#interactiveAnnotations.polylines, {
                        status: "moving",
                        color: this.stateManager.getColorState("move"),
                        interactive: false
                    });

                    // Moving label: update if existed, create if not existed
                    this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                        status: "moving",
                        // showBackground: false
                        interactive: false
                    });
                }
                break;
            default:
                // this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
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
        const anchorPosition = measure.coordinates.find(cart => !areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (!anchorPosition) {
            console.warn("LeafletDragHandler: Could not find other position for polyline update.");
            return;
        }

        const positions = [anchorPosition, this.dragHandler.coordinate]
            .map(pos => convertToLatLng(pos)) // Convert each position
            .filter(Boolean); // Remove any null results if conversion failed

        // Check if we still have two valid points after filtering
        if (positions.length < 2) {
            console.warn("Failed to get two valid positions after conversion.");
            return;
        }

        // -- Handle polyline --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "moving",
            color: this.stateManager.getColorState("move"),
            interactive: false
        });

        // -- Handle label --
        this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            interactive: false
        });
    }

    /**
     * Finalize graphics updates for the end of drag operation
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    finalizeDrag(measure) {
        const anchorPosition = measure.coordinates.find(cart => !areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (!anchorPosition) {
            console.warn("GoogleDragHandler: Could not find other position for polyline update.");
            return;
        }

        const positions = [anchorPosition, this.dragHandler.coordinate]
            .map(pos => convertToLatLng(pos)) // Convert each position
            .filter(Boolean); // Remove any null results if conversion failed

        // Check if we still have two valid points after filtering
        if (positions.length < 2) {
            console.warn("Failed to get two valid positions after conversion.");
            return;
        }

        // -- Finalize Line Graphics --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line"),
            interactive: true
        });

        // -- Finalize Label Graphics --
        const { distance } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            interactive: true
        });

        // -- Update dragHandler variables --
        this.dragHandler.draggedObjectInfo.endPosition = this.dragHandler.coordinate; // Update end position


        // --- Update Measure Data ---
        measure._records = [distance]; // Update new distance record
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
        // Validate positions input
        if (!Array.isArray(positions) || positions.length < 2 || !positions[0] || !positions[1]) {
            console.warn("_createOrUpdateLine: Requires an array with at least two valid positions.");
            return null;
        }
        // Validate polylinesArray input
        if (!Array.isArray(polylinesArray)) {
            console.warn("_createOrUpdateLine: polylinesArray argument must be an array.");
            return null;
        }

        // Default options
        const {
            status = null,
            color = this.stateManager.getColorState("move"), // Default color if not provided
            interactive = false,
            ...rest
        } = options;

        let lineInstance = null;

        // -- Update existing polyline --
        if (polylinesArray.length > 0) {
            lineInstance = polylinesArray[0]; // Get the reference from the array

            // Simplified Check: Assumes if exists, it's valid.
            if (!lineInstance) { // Check if the retrieved reference is truthy
                console.warn("_createOrUpdateLine: Invalid (null/undefined) object found in polylinesArray. Attempting to remove and recreate.");
                polylinesArray.length = 0; // Clear the array to trigger creation below
                // Fall through to the creation block (lineInstance is null)
            } else {
                // -- Handle Polyline Visual Update --
                // Assumes lineInstance is a valid Polyline if it exists
                lineInstance.setLatLngs(positions); // Update path of the line, requires L.latLng[]
                lineInstance.setStyle({ color: color }); // Update color

                // Update lineInstance interactive attribute
                const oldInteractiveState = lineInstance.options.interactive;
                // Compare the old with current interactive state, only update interactive if different
                if (oldInteractiveState !== interactive) {
                    // Update the interactive
                    lineInstance.options.interactive = interactive;
                    // Refresh the layer to apply the new interactive state. 
                    if (this.drawingHelper && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                        this.drawingHelper._refreshLayerInteractivity(lineInstance);
                    }
                }
            }
        }

        // --- Creation new polyline ---
        // This block runs if polylinesArray was empty OR if the existing entry was invalid (!lineInstance was true above)
        if (!lineInstance) { // Check if we need to create (either initially empty or cleared due to invalid entry)
            lineInstance = this.drawingHelper._addPolyline(positions, {
                color,
                id: `annotate_${this.mode}_line_${this.measure.id}`,
                interactive,
                ...rest
            });

            if (!lineInstance) {
                console.error("_createOrUpdateLine: Failed to create new polyline instance.");
                return null; // Return null if creation failed
            }

            // -- Handle References Update --
            polylinesArray.push(lineInstance); // Push the new instance into the referenced array
        }

        // --- Common Updates (for both existing and newly created) ---
        // -- Handle Metadata Update --
        lineInstance.status = status; // Set status
        lineInstance.positions = positions.map(pos => ({ ...pos })); // Store a copy of positions

        return lineInstance; // Return the instance
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
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distance: null, labelInstance: null }; // Validate input positions
        }

        // Default options
        const {
            status = null,
            color = "rgba(0,0,0,1)",
            interactive = false,
            ...rest
        } = options;

        const distance = calculateDistance(positions[0], positions[1]); // calculate distance
        const formattedText = formatMeasurementValue(distance, "meter"); // Format the distance value
        const middlePos = calculateMiddlePos(positions); // calculate label position

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            // Return distance but null instance if middle position calculation fails
            return { distance, labelInstance: null };
        }

        let labelInstance = null;

        // -- Update existing label --
        if (labelsArray.length > 0) {
            labelInstance = labelsArray[0]; // Get the reference from the array

            // Check if the reference is a valid Tooltip instance
            if (!labelInstance) {
                console.warn("_createOrUpdateLabel: Invalid object found in labelsArray. Attempting to remove and recreate.");
                labelsArray.length = 0; // Clear the array to trigger creation below
            } else {
                // -- Handle Label Visual Update --
                labelInstance.setLatLng(middlePos); // update position

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
            labelInstance = this.drawingHelper._addLabel(positions, distance, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                interactive,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return { distance, labelInstance: null }; // Return distance but null instance
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { distance, labelInstance: null }; // Return distance but null instance
        }

        // -- Handle Metadata Update --
        labelInstance.status = status; // Set status
        labelInstance.positions = positions.map(pos => ({ ...pos })); // Store positions copy

        return { distance, labelInstance }; // Return the newly created instance
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        this.#coordinate = null;

        // Clear cache
        this.coordsCache = [];
    }
}

export { TwoPointsDistanceLeaflet };
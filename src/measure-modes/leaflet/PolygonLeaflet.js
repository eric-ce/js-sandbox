import dataPool from "../../lib/data/DataPool.js";
import { areCoordinatesEqual, calculateArea, calculateMiddlePos, convertToLatLng, formatMeasurementValue } from "../../lib/helper/leafletHelper.js";
import { MeasureModeBase } from "../MeasureModeBase.js";

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

class PolygonLeaflet extends MeasureModeBase {
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polygons: [],
        labels: []
    }
    /** @type {Coordinate} */
    #coordinate = null;
    /** @type {MeasurementGroup} */
    measure = null; // measure data used internally 
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
            throw new Error("PolygonLeaflet requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("area", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter)

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false; // Initialize drag mode flag

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

            // Establish data relation
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
            id: `annotate_area_point_${this.measure.id}`,
            ...markerListener
        });
        if (!point) return;
        point.status = "pending"; // Set status to pending

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Handle Polygon --
        // If three points create the polygon
        if (this.coordsCache.length > 2) {
            this._createOrUpdatePolygon(this.coordsCache, this.#interactiveAnnotations.polygons, {
                status: "pending",
                color: this.stateManager.getColorState("polygon"),
                interactive: false // Disable interactivity for the polygon
            });

            this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "pending",
                interactive: false // Disable interactivity for the label
            });
        }
    }

    /**
     * Handles mouse move events on the map.
     * @param {EventDataState} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleMouseMove = async (eventData) => {
        if (!eventData || !eventData.mapPoint) return;

        const pos = eventData.mapPoint; // Already {latitude, longitude}
        if (!pos) return;
        this.#coordinate = pos; // Store for later use

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 2 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                const movingDataCache = [...this.coordsCache, this.#coordinate];
                // -- Handle Polygon
                this._createOrUpdatePolygon(movingDataCache, this.#interactiveAnnotations.polygons, {
                    status: "moving",
                    color: "#FFFF00",
                    interactive: false // Disable interactivity during moving
                });

                // -- Handle Label --
                this._createOrUpdateLabel(movingDataCache, this.#interactiveAnnotations.labels, {
                    status: "moving",
                    interactive: false // Disable interactivity during moving
                });
                break;
            default:
                // this.handleHoverHighlighting();  // highlight the line when hovering
                break;
        }
    }

    /**
     * Handles right-click events on the map.
     * @param {EventDataState} eventData - The event data containing information about the click event.
     */
    handleRightClick = async (eventData) => {
        if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) return; // Early exit, the measure is not yet started or it is finished

        // update coordinate data cache
        this.coordsCache.push(this.#coordinate); // Update the coordinate cache

        // update status pending annotations
        const pointsArray = this.pointCollection.getLayers();
        pointsArray.forEach(point => {
            if (point && point.id.includes(this.mode)) {
                point.status = "completed"
            }
        });

        // -- Create final point --
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

        // create final point
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: "#FF0000",
            id: `annotate_area_point_${this.measure.id}`,
            ...markerListener,
        });
        if (!point) return;
        point.status = "completed"; // Set status to completed

        // -- Handle Polygon --
        this._createOrUpdatePolygon(this.coordsCache, this.#interactiveAnnotations.polygons, {
            status: "completed",
            color: this.stateManager.getColorState("polygon"),
            interactive: true // Enable interactivity for the final polygon
        });

        // -- Handle Label --
        const { area } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
            status: "completed",
            interactive: true // Enable interactivity for the final label
        });

        // -- Update data --
        this.measure._records = [area ?? null]; // Store the area in the measure object
        this.measure.status = "completed"; // Update the measure status

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Set flags
        this.flags.isMeasurementComplete = true; // Set the measurement as complete

        // Clear cache
        this.coordsCache = [];
        this.#interactiveAnnotations.polygons = []; // Clear the polygon reference
        this.#interactiveAnnotations.labels = []; // Clear the moving labels reference
    }

    /******************
     * EVENT HANDLING *
     *    FOR DRAG    *
     ******************/
    /**
     * Handle graphics updates during dragging operation.
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     */
    updateGraphicsOnDrag(measure) {
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // Convert to positions to LatLng format - to ensure positions value are consistent 
        const latLngArray = positions.map(coord => convertToLatLng(coord));

        // -- Handle polygon --
        this._createOrUpdatePolygon(latLngArray, this.dragHandler.draggedObjectInfo.polygons, {
            status: "moving",
            color: this.stateManager.getColorState("move"),
            interactive: false // Disable interactivity during moving
        });

        // -- Handle label --
        this._createOrUpdateLabel(latLngArray, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            interactive: false // Disable interactivity during moving
        });
    }

    /**
    * Finalize graphics updates for the end of drag operation
    * @param {MeasurementGroup} measure - The measure object data from drag operation.
    */
    finalizeDrag(measure) {
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // Convert to positions to LatLng format - to ensure positions value are consistent 
        const latLngArray = positions.map(coord => convertToLatLng(coord));

        // -- Finalize polygon --
        this._createOrUpdatePolygon(latLngArray, this.dragHandler.draggedObjectInfo.polygons, {
            status: "completed",
            color: this.stateManager.getColorState("polygon"),
            interactive: true // Enable interactivity for the final polygon
        });

        // -- Finalize Label --
        const { area } = this._createOrUpdateLabel(latLngArray, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            interactive: true // Enable interactivity for the final label
        });

        // --- Update Measure Data ---
        measure._records = [area]; // Update new area record
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.status = "completed"; // Update the measure status

        return measure;
    }


    /**********
     * HELPER *
     **********/
    /**
     * Creates a new polygon or updates an existing one based on positions.
     * Manages the reference within the provided polygonsArray.
     * @param {{lat: number, lng: number}[]} positions - Array of positions to create or update the polygon.
     * @param {L.polygon[]} polygonsArray - The array (passed by reference) that holds the polygon instance. This array will be modified.
     * @param {Object} [options={}] - Options for the polygon.
     * @returns {L.polygon | null} The created or updated polygon instance, or null if failed.
     */
    _createOrUpdatePolygon(positions, polygonsArray, options = {}) {
        // Validate positions input
        if (!Array.isArray(polygonsArray) || !Array.isArray(positions) || positions.length < 3) {
            console.warn("_createOrUpdatePolygon: Invalid input. Must provide an array of positions with at least 3 points.");
            return null;
        }

        // default options
        const {
            status = null,
            color = this.stateManager.getColorState("polygon"),
            interactive = false,
            ...rest
        } = options;

        let polygonInstance = null;

        // -- Update polygon --
        if (polygonsArray.length > 0) {
            polygonInstance = polygonsArray[0]; // Assuming only one polygon for simplicity
            if (!polygonInstance) {
                console.warn("_createOrUpdatePolygon: No valid polygon instance found.");
                polygonsArray.length = 0; // Clear the array to trigger creation below
            } else {
                // -- Handle Polygon Visual Update --
                polygonInstance.setLatLngs(positions); // update position
                polygonInstance.setStyle({ color: color }); // Change color to indicate moving state

                // Update interactive state
                const oldInteractiveState = polygonInstance.options.interactive;
                // Compare the old with current interactive state, only update interactive if different
                if (oldInteractiveState !== interactive) {
                    // Update the interactive
                    polygonInstance.options.interactive = interactive;
                    // Refresh the layer to apply the new interactive state. 
                    if (this.drawingHelper && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                        this.drawingHelper._refreshLayerInteractivity(polygonInstance);
                    }
                }
            }
        }

        // --- Create Polygon ---
        // This block is executed if the polygon instance is not found in the array
        if (!polygonInstance) { // Check if we need to create (either initially empty or cleared due to invalid entry)
            polygonInstance = this.drawingHelper._addPolygon(positions, {
                color,
                id: `annotate_area_polygon_${this.measure.id}`,
                interactive,
                ...rest
            });

            if (!polygonInstance) {
                console.warn("_createOrUpdatePolygon: Failed to create polygon instance.");
                return null;
            }

            // -- Handle References Update -- 
            polygonsArray.push(polygonInstance); // Store polygon reference for interaction use
        }

        // --- Common Updates (for both existing and newly created) ---
        // -- Handle Polygon Metadata Update --
        polygonInstance.status = status; // Set status
        polygonInstance.positions = positions.map(pos => ({ ...pos })); // Store a copy of positions

        return polygonInstance; // Return the polygon instance
    }

    /**
      * Create or update the label.
      * If the label exists in labelsArray, update its position and text, else create a new one.
      * Manages the reference within the provided labelsArray.
      * @param {{lat:number,lng:number}[]} positions - Array of positions (expects 2) to calculate distance and middle point.
      * @param {L.tooltip[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified.
      * @param {Object} [options={}] - Options for the label.
      * @param {string|null} [options.status=null] - Status to set on the label instance.
      * @return {{ distance: number, labelInstance: L.tooltip | null }} - The calculated distance and the created/updated label instance, or null if failed.
      */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { area: null, labelInstance: null }; // Validate input positions
        }

        // default options
        const {
            status = null,
            color = 'rgba(0,0,0,1)',
            interactive = false,
            ...rest
        } = options;

        const area = calculateArea(positions);
        const formattedText = formatMeasurementValue(area, "squareMeter");
        const middlePos = calculateMiddlePos(positions); // Calculate the middle position for the label

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { area: null, labelInstance: null }; // Return early if middle position is invalid
        }

        let labelInstance = null;

        // -- Update label if existed--
        if (labelsArray.length > 0) {
            labelInstance = labelsArray[0]; // Get reference to the existing label instance

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

        // -- Create Label --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel(positions, area, "squareMeter", {
                id: `annotate_area_label_${this.measure.id}`,
                interactive,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return { area, labelInstance: null }; // Return area but null instance
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance);
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { distance, labelInstance: null }; // Return distance but null instance
        }

        // -- Handle Metadata Update --
        labelInstance.status = status; // Set status
        labelInstance.positions = positions.map(pos => ({ ...pos })); // Store a copy of positions

        return { area, labelInstance };
    }

    /*******************
     * OVERRIDE METHOD *
     *******************/
    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset temporary coordinate cache
        this.#coordinate = null;

        this.coordsCache = []; // Clear cache
    }
}

export { PolygonLeaflet };
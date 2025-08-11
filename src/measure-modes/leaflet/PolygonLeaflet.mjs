import { areCoordinatesEqual, calculateArea, calculateMiddlePos, convertToLatLng } from "../../lib/helper/leafletHelper.mjs";
import { deconstructIdForMetadata, formatMeasurementValue } from "../../lib/helper/helper.mjs";
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

class PolygonLeaflet extends MeasureModeLeaflet {
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
     * Listeners for point markers.
     * @private
     */
    #markerListeners = {
        mousedown: (marker, event) => {
            // Only handle left mouse button (button 0)
            if (event.domEvent?.button !== 0) return;

            // Check if drag handler exists and is active
            if (this.dragHandler && this.flags.isActive) {
                // Prevent map drag, default behavior
                event.domEvent?.stopPropagation();
                event.domEvent?.preventDefault();

                // Tell the drag handler to start dragging this specific marker
                this.dragHandler._handleDragStart(marker, event);
            }
        },
    };

    /**
     * 
     * @param {LeafletInputHandler} inputHandler 
     * @param {LeafletDragHandler} dragHandler 
     * @param {LeafletHighlightHandler} highlightHandler 
     * @param {leafletAnnotation} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     * @param {object} app
     * @param {DataPool} dataPool
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter || !app || !dataPool) {
            throw new Error("PolygonLeaflet requires inputHandler, drawingHelper (with map), stateManager, emitter, app, and dataPool.");
        }

        super("area", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool);

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

    get coordinate() {
        return this.#coordinate;
    }


    /******************
     * EVENTS HANDLER *
     ******************/
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

        // -- Create point marker --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_area_point_${this.measure.id}`,
            interactive: true,
            status: "pending", // Set status to pending
            listeners: this.#markerListeners
        });
        if (!point) return;

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Handle Polygon --
        // If three points create the polygon
        if (this.coordsCache.length > 2) {
            this._createOrUpdatePolygon(this.coordsCache, this.#interactiveAnnotations.polygons, {
                status: "pending",
                color: this.stateManager.getColorState("polygon"),
                interactive: false // Disable interactivity for the polygon
            });

            const { area } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "pending",
                interactive: false // Disable interactivity for the label
            });

            this.measure._records = [area]; // Store the area in the measure object
        }

        // -- Update dataPool --
        this.dataPool.updateOrAddMeasure({ ...this.measure });
    }

    /**
     * Handles mouse move events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
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
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     */
    handleRightClick = async (eventData) => {
        if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) return; // Early exit, the measure is not yet started or it is finished

        // update coordinate data cache
        this.coordsCache.push(this.#coordinate); // Update the coordinate cache

        // -- Update annotations status --
        // Update points status and interactive
        this._updatePendingItemsToCompleted(this.pointCollection.getLayers(), `annotate_${this.mode}`); // Update points status and interactive


        // -- Create final point --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: "#FF0000",
            id: `annotate_area_point_${this.measure.id}`,
            interactive: true, // Make the point interactive
            status: "completed", // Set status to completed
            listeners: this.#markerListeners
        });
        if (!point) return;

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
        this.measure._records = [area]; // Store the area in the measure object
        this.measure.status = "completed"; // Update the measure status

        // Update to data pool
        this.dataPool.updateOrAddMeasure({ ...this.measure });

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
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

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
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

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
            id = `annotate_${this.mode}_polygon_${this.measure.id}`,
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

                // -- Handle Metadata to update polygon --
                Object.assign(polygonInstance.feature.properties, {
                    status,
                    positions: positions.map(pos => ({ ...pos })),
                    ...(id && deconstructIdForMetadata(id)) // Deconstruct id for metadata
                });
                polygonInstance.feature.id = id; // Update the id on the polygon instance feature
                polygonInstance.id = id; // Update the id on the polygon instance
            }
        }

        // --- Create Polygon ---
        // This block is executed if the polygon instance is not found in the array
        if (!polygonInstance) { // Check if we need to create (either initially empty or cleared due to invalid entry)
            polygonInstance = this.drawingHelper._addPolygon(positions, {
                color,
                id,
                status,
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

        if (!polygonInstance) {
            console.warn("_createOrUpdatePolygon: No valid polygon instance found after creation.");
            return null; // Return null if no valid polygon instance is found
        }

        return polygonInstance; // Return the polygon instance
    }

    /**
     * Create or update the label.
     * If the label exists in labelsArray, update its position and text, else create a new one.
     * Manages the reference within the provided labelsArray.
     * @param {{lat:number,lng:number}[]} positions - Array of positions to calculate area and middle point.
     * @param {L.tooltip[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified.
     * @param {Object} [options={}] - Options for the label.
     * @param {string|null} [options.status=null] - Status to set on the label instance.
     * @return {{ area: number, labelInstance: L.tooltip | null }} - The calculated area and the created/updated label instance, or null if failed.
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
            id = `annotate_${this.mode}_label_${this.measure.id}`,
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
                // Update label visuals and metadata
                labelInstance = this._updateLabel(labelInstance, positions, formattedText, {
                    status,
                    color,
                    interactive,
                    id,
                    ...rest
                })
            }
        }

        // -- Create Label --
        if (!labelInstance) {
            labelInstance = this.drawingHelper._addLabel(positions, area, "squareMeter", {
                id,
                interactive,
                status,
                color,
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
            return { area, labelInstance: null }; // Return area but null instance
        }

        return { area, labelInstance };
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset variables
        this.coordsCache = []; // Clear cache
        this.#coordinate = null;
        this.#interactiveAnnotations.polygons = []; // Clear the polygon reference
        this.#interactiveAnnotations.labels = []; // Clear the moving labels reference

        // Reset measure data to default
        this.measure = this._createDefaultMeasure(); // Reset measure to default state
    }
}

export { PolygonLeaflet };
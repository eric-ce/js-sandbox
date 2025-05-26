import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeGoogle } from "./MeasureModeGoogle";
import { areCoordinatesEqual, calculateArea, calculateMiddlePos, convertToLatLng, formatMeasurementValue } from "../../lib/helper/googleHelper.js";


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
 * Handles polygon area measurement specifically for Google Maps.
*/
class PolygonGoogle extends MeasureModeGoogle {
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polygons: [],
        labels: []
    }

    /** @type {LatLng} */
    #coordinate = null;

    /** @type {MeasurementGroup} */
    measure = null; // measure data used internally 

    /** @type {LatLng[]} */
    coordsCache = [];

    /**
     * Creates an instance of PolygonGoogle.
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
            throw new Error("PolygonGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
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
     * Handles left clicks, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
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
                // --- ADD MOUSEUP LISTENER HERE ---
                // mouseup: (event) => { // 'event' here is google.maps.MapMouseEvent
                //     // Check if a drag sequence was potentially active
                //     if (this.dragHandler && this.dragHandler.isDragging) {
                //         event.domEvent?.stopPropagation(); // Avoid stopping propagation here too
                //         event.domEvent?.preventDefault(); // Prevent potential text selection, etc.

                //         // Directly call the drag handler's end method
                //         this.dragHandler._handleDragEnd(event);
                //     }
                // }
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
                clickable: false
            });

            this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "pending",
            });
        }
    }

    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
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
                    clickable: false
                });

                // -- Handle Label --
                this._createOrUpdateLabel(movingDataCache, this.#interactiveAnnotations.labels, {
                    status: "moving",
                });
                break;
            default:
                // this.handleHoverHighlighting();  // highlight the line when hovering
                break;
        }
    }

    /**
     * Handles right clicks, using normalized event data.
     * @param {NormalizedEventData} eventData 
     */
    handleRightClick = async (eventData) => {
        if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) return; // Early exit, the measure is not yet started or it is finished

        // update coordinate data cache
        this.coordsCache.push(this.#coordinate); // Update the coordinate cache

        // -- Update annotations status --
        // update status pending annotations
        this.pointCollection.forEach(point => {
            if (point.id.includes(this.mode)) {
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
                }
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
            clickable: true
        });

        // -- Handle Label --
        const { area } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
            status: "completed",
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
            clickable: false
        });

        // -- Handle label --
        this._createOrUpdateLabel(latLngArray, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
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
            clickable: true
        });

        // -- Finalize Label --
        const { area } = this._createOrUpdateLabel(latLngArray, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
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
     * Creates or updates a polygon on the map.
     * It also stores status and positions in the instance.
     * @param {LatLng[]} positions - Array of positions to be updated or created
     * @param {google.maps.Polygon[]} polygonsArray - Array of polygons to be updated or created, NOT The polygon collection
     * @param {object} options - Options for polygon creation/updating 
     * @returns {google.maps.Polygon} - The created or updated polygon instance
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
            clickable = false,
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
                polygonInstance.setPaths(positions); // update position
                polygonInstance.setOptions({ strokeColor: color, clickable }); // Change color to indicate moving state
            }
        }

        // --- Create Polygon ---
        // This block is executed if the polygon instance is not found in the array
        if (!polygonInstance) { // Check if we need to create (either initially empty or cleared due to invalid entry)
            polygonInstance = this.drawingHelper._addPolygon(positions, {
                color,
                id: `annotate_area_${this.measure.id}`,
                clickable,
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
     * Creates or updates a label on the map.
     * It also stores status and positions in the instance.
     * @param {LatLng[]} positions - Array of positions to be updated or created
     * @param {google.maps.Marker[]} labelsArray - Array of labels to be updated or created, NOT The label collection
     * @param {object} options - Options for label creation/updating
     * @returns {{area: number, labelInstance: google.maps.Marker}} - The created or updated label instance and area
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
            clickable = false,
            // add more options here if needed
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

            // Check if the reference is a valid Google Maps Marker
            if (!labelInstance) {
                console.warn("_createOrUpdateLabel: Invalid object found in labelsArray. Attempting to remove and recreate.");
                labelsArray.length = 0; // Clear the array to trigger creation below
            } else {
                // -- Handle Label Visual Update --
                labelInstance.setPosition(middlePos); // update position
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
            labelInstance = this.drawingHelper._addLabel(positions, area, "squareMeter", {
                id: `annotate_area_label_${this.measure.id}`,
                status: status,
                clickable,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return { area, labelInstance: null }; // Return area but null instance
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return { area, labelInstance: null }; // Early exit if labelInstance is not valid
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
};

export { PolygonGoogle };
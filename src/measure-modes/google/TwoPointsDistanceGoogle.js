import dataPool from "../../lib/data/DataPool.js";
import { convertToLatLng, calculateMiddlePos, calculateDistance, formatMeasurementValue, areCoordinatesEqual, checkOverlayType, } from "../../lib/helper/googleHelper.js";
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
 * Handles two-point distance measurement specifically for Google Map.
 * @extends MeasureModeGoogle
 */
class TwoPointsDistanceGoogle extends MeasureModeGoogle {
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        polylines: [], // Array to store polyline references
        labels: [] // Array to store label references
    }
    /** @type {LatLng} */
    #coordinate = null;
    /** @type {MeasurementGroup} */
    measure = null; // measure data used internally 
    /** @type {LatLng[]} */
    coordsCache = [];

    /**
     * Creates an instance of TwoPointsDistanceGoogle.
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
            throw new Error("TwoPointsDistanceGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
        }

        super("distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter)

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
            this.pointCollection.forEach(point => {
                if (point.id.includes(this.mode)) {
                    point.status = "completed"
                }
            });
            // -- APPROACH 2: Update/ Reuse existing polyline and label --
            // -- Handle polyline --
            this._createOrUpdateLine(this.coordsCache, this.#interactiveAnnotations.polylines, {
                status: "completed",
                color: this.stateManager.getColorState("line"),
                clickable: true
            });

            // -- Handle label --
            const { distance } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                clickable: true
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
    };

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
                if (this.coordsCache.length === 1) {
                    // moving positions
                    const positions = [convertToLatLng(this.coordsCache[0]), this.#coordinate].filter(Boolean);

                    // Validate google positions
                    if (positions.length < 2) {
                        console.error("Google positions are empty or invalid:", positions);
                        return;
                    }

                    // validate positions
                    if (!positions || positions.length === 0 || positions.some(pos => pos === null)) {
                        console.error("Google positions are empty or invalid:", positions);
                        return;
                    }

                    // Moving line: update if existed, create if not existed
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
                }
                break;
            default:
                // this.handleHoverHighlighting();
                break;
        }
    };

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
            console.warn("GoogleDragHandler: Could not find other position for polyline update.");
            return;
        }
        const positions = [anchorPosition, this.dragHandler.coordinate];

        // -- Handle polyline --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "moving",
            color: this.stateManager.getColorState("move"),
            clickable: false
        });

        // -- Handle label --
        this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            clickable: false
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
        const positions = [anchorPosition, this.dragHandler.coordinate];

        // -- Finalize Line Graphics --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line"),
            clickable: true
        });

        // -- Finalize Label Graphics --
        const { distance } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            clickable: true
        });

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
      * @param {google.maps.Polyline[]} polylinesArray - The array (passed by reference) that holds the polyline instance. This array will be modified.
      * @param {Object} [options={}] - Options for the line.
      * @returns {google.maps.Polyline | null} The created or updated polyline instance, or null if failed.
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
            clickable = false,
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
                lineInstance.setPath(positions); // Update path of the line
                lineInstance.setOptions({ strokeColor: color, clickable }); // Update color
            }
        }
        // --- Creation Block (if needed) ---
        // This block runs if polylinesArray was empty OR if the existing entry was invalid (!lineInstance was true above)
        if (!lineInstance) { // Check if we need to create (either initially empty or cleared due to invalid entry)
            lineInstance = this.drawingHelper._addPolyline(positions, {
                color,
                // Assumes this.measure.id is always available when creating
                id: `annotate_${this.mode}_line_${this.measure.id}`,
                clickable,
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
        lineInstance.positions = positions.map(p => ({ ...p })); // Store a copy of positions

        return lineInstance; // Return the instance
    }

    /**
      * Create or update the label (Google Maps Marker).
      * If the label exists in labelsArray, update its position and text, else create a new one.
      * Manages the reference within the provided labelsArray.
      * @param {{lat:number,lng:number}[]} positions - Array of positions (expects 2) to calculate distance and middle point.
      * @param {google.maps.Marker[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified.
      * @param {Object} [options={}] - Options for the label.
      * @param {string|null} [options.status=null] - Status to set on the label instance.
      * @return {{ distance: number, labelInstance: google.maps.Marker | null }} - The calculated distance and the created/updated label instance, or null if failed.
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
            clickable = false,
            // add more options here if needed
            ...rest
        } = options;

        const distance = calculateDistance(positions[0], positions[1]); // calculate distance
        const formattedText = formatMeasurementValue(distance, "meter"); // Format the distance value
        const middlePos = calculateMiddlePos(positions); // calculate label position

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { distance, labelInstance: null }; // Return early if middle position is invalid
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
            labelInstance = this.drawingHelper._addLabel(positions, distance, "meter", {
                clickable,
                id: `annotate_${this.mode}_label_${this.measure.id}`,
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
            return { distance, labelInstance: null }; // Early exit if labelInstance is not valid
        }

        // -- Handle Metadata Update --
        labelInstance.status = status; // Set status
        labelInstance.positions = positions.map(pos => ({ ...pos })); // Store positions copy

        return { distance, labelInstance }; // Return the newly created instance
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

export { TwoPointsDistanceGoogle };
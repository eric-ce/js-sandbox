import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeGoogle } from "./MeasureModeGoogle.js";

/**
 * @typedef InteractiveAnnotationsState
 * @property {google.maps.Marker[]} labels
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


class PointInfoGoogle extends MeasureModeGoogle {
    /** @type {LatLng} */
    #coordinate = null;
    /** @type {MeasurementGroup} */
    measure = null; // measure data used internally 
    /** @type {LatLng[]} */
    coordsCache = [];
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        labels: [],
    };

    /** @type {HTMLElement} */ // the overlay to show the coordinate info
    #coordinateInfoOverlay;

    /**
     * Listeners for point markers.
     * @private
     */
    #markerListeners = {
        mousedown: (marker, event) => { // Use mousedown for both drag and middle-click
            if (event.domEvent) {
                // MIDDLE CLICK EVENT: Check for middle mouse button (button === 1)
                if (event.domEvent.button === 1) {
                    // Prevent map drag, default behavior
                    event.domEvent.stopPropagation();
                    event.domEvent.preventDefault();

                    this._removePointInfo(marker); // Call removePointInfo for middle click
                }
                // LEFT DOWN EVENT: Check for left mouse button (button === 0) for dragging
                else if (event.domEvent.button === 0) {
                    if (this.dragHandler && this.flags.isActive) {
                        // Prevent map drag, default behavior
                        event.domEvent.stopPropagation();
                        event.domEvent.preventDefault();

                        this.dragHandler._handleDragStart(marker, event); // Tell the drag handler to start dragging this specific marker
                    }
                }
            }
        }
    };


    /**
     * 
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
            throw new Error("PointInfoGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
        }

        super("pointInfo", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter)

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


        // -- Create point marker --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            clickable: true, // Make the point marker clickable
            listeners: this.#markerListeners
        });
        if (!point) return;
        point.status = "completed"; // Set status to pending

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Handle label --
        this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
            status: "completed",
            clickable: true,
        });

        // -- Handle Data --
        this.measure._records.push(this.coordsCache[0].lat, this.coordsCache[0].lng);
        this.measure.status = "completed";

        // -- Update Data Pool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Update State --
        this.flags.isMeasurementComplete = true;

        // -- Reset Values --
        // Clean up the current measure state, to prepare for the next measure
        this.coordsCache = [];
        this.#interactiveAnnotations.labels = [];
    }

    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     * @returns {Promise<void>}
     */
    handleMouseMove = async (eventData) => {
        if (!eventData || !eventData.mapPoint) return;

        const pos = eventData.mapPoint; // Already {latitude, longitude}
        const screenPos = eventData.screenPoint; // Screen coordinates {x, y}
        if (!pos) return;

        this.#coordinate = pos; // Store for later use

        // -- Coordinate info overlay --
        // Ensure the coordinate info overlay DOM element is created
        if (!this.#coordinateInfoOverlay) {
            this._createCoordinateInfoOverlay(); // This method still needs to run to create the div
        }

        // Update Coordinate info overlay
        if (this.#coordinateInfoOverlay) { // Check if creation was successful
            // Pass both map coordinate (for display) and screen coordinate (for positioning)
            this.updateCoordinateInfoOverlay(this.#coordinate, screenPos);
        }
    }

    /**
     * To remove a point marker and its associated label.
     * @param {google.maps.Marker} marker - The marker to remove. 
     * @returns {null|void} - Returns null if the marker is not found, otherwise returns void.
     */
    _removePointInfo(marker) {
        // Get the measure id
        const idParts = marker.id.split("_");
        const measureId = idParts[idParts.length - 1]; // Extract the measure ID from the marker ID

        // -- Confirm deletion --
        // Use js confirm dialog to confirm deletion
        const confirmDelete = window.confirm(`Do you want to delete this point at measure id ${measureId}?`);
        if (!confirmDelete) return;

        // -- Remove point --
        this.drawingHelper._removePointMarker(marker);

        // -- Remove label --
        const labelToRemove = this.labelCollection.find(label => label.id.includes(measureId));
        if (!labelToRemove) return null;
        this.drawingHelper._removeLabel(labelToRemove);

        // -- Remove data --
        dataPool.removeMeasureById(measureId); // Remove data from data pool
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

        const position = this.dragHandler.coordinate;

        // -- Handle label --
        this._createOrUpdateLabel([position], this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            clickable: false,
        });

        // -- Hide the coordinate info overlay --
        if (this.#coordinateInfoOverlay) {
            this.#coordinateInfoOverlay.style.display = 'none';
        }
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

        const position = this.dragHandler.coordinate;

        // -- Finalize Label Graphics --
        this._createOrUpdateLabel([position], this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            clickable: true,
        });

        // --- Update Measure Data ---
        measure._records = [position.lat, position.lng]; // Update new records
        measure.coordinates = [{ ...position }]; // Update coordinates
        measure.status = "completed"; // Update the measure status
    }


    /**********
     * HELPER *
     **********/
    /**
     * Create or update the label.
     * If the label exists in labelsArray, update its position and text, else create a new one.
     * Manages the reference within the provided labelsArray.
     * @param {{lat:number,lng:number}[]} positions - Array of positions to place the label.
     * @param {google.maps.Marker[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified.
     * @param {Object} [options={}] - Options for the label.
     * @return {{ labelInstance: google.maps.Marker}|null} - The created/updated label instance, or null if failed.
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.error("Invalid input: positions and labelsArray must be arrays.");
            return null;
        }

        // Default options
        const {
            clickable = false,
            status = null,
            // add more options here if needed
            ...rest
        } = options;

        const formattedText = `lat: ${positions[0].lat.toFixed(6)}, lng: ${positions[0].lng.toFixed(6)}`;
        const labelPos = positions[0]; // Use the first position for the label

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
                labelInstance.setPosition(labelPos); // update position
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
            labelInstance = this.drawingHelper._addLabel(positions, formattedText, null, {
                clickable,
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return null; // Return area but null instance
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return null; // Early exit if labelInstance is not valid
        }

        // -- Handle Metadata Update --
        labelInstance.status = status; // Set status
        labelInstance.positions = positions.map(pos => ({ ...pos })); // Store positions copy

        return { labelInstance };
    }

    /**
     * Creates a coordinate info overlay element to display coordinate information.
     * This overlay is positioned relative to the map's container.
     * @returns {HTMLElement} - The coordinate info overlay element.
     */
    _createCoordinateInfoOverlay() {
        this.#coordinateInfoOverlay = document.createElement("div");
        this.#coordinateInfoOverlay.className = "coordinate-info-overlay google-maps-info-overlay"; // Added specific class
        // Define styles as an object
        const styles = {
            position: "absolute",
            pointerEvents: "none",
            padding: "6px 12px",
            display: "none",
            backgroundColor: "#1F1F1F", // M3 Dark theme surface color (approx)
            color: "#E2E2E2",             // M3 Dark theme on-surface text color (approx)
            borderRadius: "12px",
            fontFamily: "'Roboto', Arial, sans-serif",
            fontSize: "14px",
            lineHeight: "1.5",
            zIndex: "1001",
            whiteSpace: "nowrap",
            boxShadow: "0px 1px 2px rgba(0,0,0,0.3), 0px 2px 6px 2px rgba(0,0,0,0.15)" // M3 Dark theme elevation 2 shadow (approx)
        };

        // Apply styles using Object.assign
        Object.assign(this.#coordinateInfoOverlay.style, styles);

        // Append to the map's div container
        if (this.map && typeof this.map.getDiv === 'function') {
            this.map.getDiv().appendChild(this.#coordinateInfoOverlay);
        } else {
            console.error("PointInfoGoogle: Map div container not found for overlay.");
            return null;
        }

        return this.#coordinateInfoOverlay;
    }

    /**
      * Update and display the current coordinate info to the coordinateInfoOverlay.
      * Content and position of the overlay are based on the provided mapPoint and screenPoint.
      * @param {{lat:number, lng:number}} mapPoint - The current map coordinate ({lat, lng}) to display.
      * @param {{x: number, y: number}} screenPoint - The current screen coordinate to position the overlay.
      */
    updateCoordinateInfoOverlay(mapPoint, screenPoint) {
        if (!this.#coordinateInfoOverlay) {
            // console.warn("PointInfoGoogle: Coordinate info overlay div not created.");
            return;
        }
        // No longer strictly need #mapProjection for positioning if using screenPoint directly
        // but it might be useful if you ever need to convert back for other reasons.

        if (!mapPoint || typeof mapPoint.lat !== 'number' || typeof mapPoint.lng !== 'number') {
            // console.warn("PointInfoGoogle: Invalid mapPoint provided for display.");
            this.#coordinateInfoOverlay.style.display = 'none';
            return;
        }
        if (!screenPoint || typeof screenPoint.x !== 'number' || typeof screenPoint.y !== 'number') {
            // console.warn("PointInfoGoogle: Invalid screenPoint provided for positioning.");
            this.#coordinateInfoOverlay.style.display = 'none';
            return;
        }

        // -- Update overlay content (uses mapPoint) --
        const displayInfo = `Lat: ${mapPoint.lat.toFixed(6)}<br>Lng: ${mapPoint.lng.toFixed(6)}`;
        this.#coordinateInfoOverlay.innerHTML = displayInfo;

        // -- Set overlay style and position (uses screenPoint) --
        // Position the overlay relative to the map's container div using the mouse's screen coordinates
        // Add some offset so it doesn't sit directly under the cursor
        this.#coordinateInfoOverlay.style.left = `${screenPoint.x + 15}px`; // Offset from cursor
        this.#coordinateInfoOverlay.style.top = `${screenPoint.y - 30}px`;  // Position above and to the right of cursor
        this.#coordinateInfoOverlay.style.display = 'block';
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset variables
        this.coordsCache = []; // Reset coordinates cache
        this.#coordinate = null; // Reset coordinate
        this.#interactiveAnnotations.labels = []; // Reset labels

        // Clear coordinate info overlay
        if (this.#coordinateInfoOverlay) {
            this.#coordinateInfoOverlay.remove();
            this.#coordinateInfoOverlay = null;
        };

        this.measure = super._createDefaultMeasure(); // Reset measure to default
    }
}

export { PointInfoGoogle };
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeLeaflet } from "./MeasureModeLeaflet";

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
/** 
 * @typedef EventDataState
 * @property {object} domEvent - The DOM event object
 * @property {object} layer - The Leaflet layer object
 * @property {object} leafletEvent - The Leaflet event object
 * @property {{lat: number, lng:number}} mapPoint - The map coordinates
 * @property {{x:number,y:number}} screenPoint - The screen coordinates
 * @property {object} target - The target element of the event
 */

/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/LeafletInputHandler.js').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/interaction/LeafletDragHandler.js').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/interaction/LeafletHighlightHandler.js').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/LeafletMeasure.js').LeafletMeasure} LeafletMeasure */

/** @typedef {{labels: L.tooltip[]}} InteractiveAnnotationsState */
/** @typedef {{lat:number, lng:number}} Coordinate*/


class PointInfoLeaflet extends MeasureModeLeaflet {
    /** @type {Coordinate} */
    #coordinate = null;
    /** @type {InteractiveAnnotationsState} */
    #interactiveAnnotations = {
        labels: []
    };
    /** @type {MeasurementGroup} */
    measure = null;
    /** @type {Coordinate[]} */
    coordsCache = [];

    /** @type {HTMLElement} */ // the overlay to show the coordinate info
    #coordinateInfoOverlay;

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

                    this.map?.dragging.disable();
                    this._removePointInfo(marker); // Call removePointInfo for middle click
                    this.map?.dragging.enable();
                }
                // LEFT DOWN EVENT: Check for left mouse button (button === 0) for dragging
                else if (event.domEvent.button === 0) {
                    if (this.dragHandler && this.flags.isActive) {
                        // Prevent map drag, default behavior
                        event.domEvent?.stopPropagation();
                        event.domEvent?.preventDefault();

                        // Tell the drag handler to start dragging this specific marker
                        this.dragHandler._handleDragStart(marker, event);
                    }
                }
            }
        }
    };


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
            throw new Error("PointInfoLeaflet requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("pointInfo", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

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

        // -- Create point marker --
        const point = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            interactive: true, // Make the point marker interactive
            listeners: this.#markerListeners,
        });

        if (!point) return;
        point.status = "completed"; // Set status to pending

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Handle label --
        this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
            status: "completed",
            interactive: true,
        });

        // Update this.measure
        this.measure._records.push(this.coordsCache[0].lat, this.coordsCache[0].lng);
        this.measure.status = "completed";

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        // set flag that the measure has ended
        this.flags.isMeasurementComplete = true;

        // Clean up the current measure state, to prepare for the next measure
        this.coordsCache = [];
        this.#interactiveAnnotations.labels = [];  // Clear moving labels
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
     * @param {L.CircleMarker} marker - The marker to be removed.
     * @return {void}
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
        console.log(this.labelCollection)
        // -- Remove label --
        const labelToRemove = this.labelCollection.getLayers().find(label => label.id.includes(measureId));
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
            interactive: false,
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
            interactive: true,
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
     * @param {{lat:number,lng:number}[]} positions - Array of positions to place the label
     * @param {L.tooltip[]} labelsArray - The array (passed by reference) that holds the label instance (Marker). This array will be modified. Caution: this is not the labelCollection.
     * @param {Object} [options={}] - Options for the label.
     * @return {{labelInstance: L.tooltip}|null} - The created/updated label instance, or null if failed.
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return null;
        }

        // Default options
        const {
            status = null,
            color = "rgba(0,0,0,1)",
            interactive = false,
            ...rest
        } = options;

        const formattedText = `lat: ${positions[0].lat.toFixed(6)}, lng: ${positions[0].lng.toFixed(6)}`;
        const labelPos = positions[0]; // Use the first position for the label

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
                labelInstance.setLatLng(labelPos); // update position

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
            labelInstance = this.drawingHelper._addLabel(positions, formattedText, null, {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                interactive,
                ...rest
            });

            if (!labelInstance) {
                console.error("_createOrUpdateLabel: Failed to create new label instance.");
                return null;
            }

            // -- Handle References Update --
            labelsArray.push(labelInstance); // Push the new instance into the referenced array
        }

        if (!labelInstance) {
            console.warn("_createOrUpdateLabel: No valid label instance found.");
            return null;
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
        if (this.map && typeof this.map.getContainer === 'function') {
            const mapContainer = this.map.getContainer();
            mapContainer.appendChild(this.#coordinateInfoOverlay);
        } else {
            console.error("PointInfoLeaflet: Map container not found for overlay.");
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

        // Clear coordinate info overlay if it exists
        if (this.#coordinateInfoOverlay) {
            this.#coordinateInfoOverlay.remove();
            this.#coordinateInfoOverlay = null;
        };

        // Reset variables
        this.coordsCache = [];
        this.#coordinate = null;
        this.#interactiveAnnotations.labels = [];

        // Reset measure to default
        this.measure = this._createDefaultMeasure(); // Reset measure to default state
    }
}

export { PointInfoLeaflet };
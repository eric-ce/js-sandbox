import dataPool from "../data/DataPool.js";
import { getOverlayByPosition } from "../helper/googleHelper.js";


/** @typedef {import('../input/GoogleMapsInputHandler.js')} GoogleMapsInputHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'| string} mapName - Map provider name ("google")
 */


/**
 * Handles drag events for Google Maps.
 */
class GoogleDragHandler {
    // -- Public Fields: dependencies --
    /** @type {google.maps.Map} */
    map
    /** @type {GoogleMapsInputHandler} */
    inputHandler;
    /** @type {EventEmitter} */
    emitter;

    // -- Public Fields: variables --
    activeModeInstance = null;
    isDragging = false; // Flag to indicate if dragging is in progress
    draggedObjectInfo = null;
    /** @type {MeasurementGroup} */
    measure = null; // Temporary measure data for reference

    mouseMoveListener = null;
    mouseUpListener = null; // Store listener refs for removal
    lastDragEndTs = null; // Timestamp of the last drag end event

    pointCollection;
    labelCollection;
    polylineCollection;
    polygonCollection;

    // -- Private Fields: variables --
    #coordinate = null;

    constructor(map, inputHandler, emitter, callbacks = {}) {
        this.map = map;
        this.inputHandler = inputHandler;
        this.emitter = emitter;

        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo(); // Initialize the dragged object info
    }

    get coordinate() {
        return this.#coordinate; // Getter for coordinate
    }

    activate(modeInstance) {
        // Validate the variables from modeInstance
        if (!modeInstance || typeof modeInstance.mode !== 'string' || typeof modeInstance.flags !== 'object') {
            console.error("CesiumDragHandler activate requires a valid modeInstance with 'mode' and 'flags'.");
            return;
        }

        this.activeModeInstance = modeInstance; // Store the mode instance

        this.pointCollection = this.activeModeInstance.pointCollection; // Store the point collection
        this.labelCollection = this.activeModeInstance.labelCollection; // Store the label collection
        this.polylineCollection = this.activeModeInstance.polylineCollection; // Store the polyline collection
        this.polygonCollection = this.activeModeInstance.polygonCollection; // Store the polygon collection
    }

    deactivate() {
        this._removeDragListeners(); // Ensure listeners are removed

        this.activeModeInstance = null;

        this._resetValue(); // Reset state    
    }

    /**
     * Handles the drag start event for the marker.
     * @param {google.maps.Marker | google.maps.marker.AdvancedMarkerElement} marker - The marker that was clicked.
     * @param {NormalizedEventData} eventData - The normalized event data from the marker listener.
     */
    _handleDragStart(marker, eventData) {
        // initialize map dragging, default enabled
        this.map.setOptions({ draggable: true });

        if (!this.activeModeInstance || this.isDragging || !eventData.mapPoint) {
            console.log("Drag Start Aborted. Reason:", {
                hasActiveInstance: !!this.activeModeInstance,
                isDragging: this.isDragging,
                hasMapPoint: !!eventData.mapPoint
            });
            return;
        }

        const dragBeginPosition = eventData.mapPoint; // {lat, lng}

        // Find the associated measurement data
        this.measure = this.activeModeInstance._findMeasureByCoordinate(dragBeginPosition);
        if (!this.measure) {
            console.warn("GoogleDragHandler: Could not find measure data for dragged marker at", dragBeginPosition);
            return;
        }

        // Set status to pending (consistency)
        this.measure.status = "pending";

        // Disable map dragging during annotation drag
        this.map.setOptions({ draggable: false });

        // Store drag info using consistent names
        this.draggedObjectInfo.beginPoint = marker; // Equivalent to Cesium's primitive
        this.draggedObjectInfo.beginPosition = marker.getPosition(); // Equivalent to Cesium's position
        // beginScreenPoint might be less relevant if not using screen distance threshold
        // this.draggedObjectInfo.beginScreenPoint = eventData.screenPoint;

        const { polylines, labelMarkers, polygons } = getOverlayByPosition(
            dragBeginPosition,
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection
        ); // Get associated graphics
        this.draggedObjectInfo.lines = polylines; // Store associated lines
        this.draggedObjectInfo.labels = labelMarkers; // Store associated labels
        this.draggedObjectInfo.polygons = polygons; // Store associated polygons

        // Set status to pending (consistency)
        this.measure.status = "pending";
        // Update data pool (consistency)
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Attach mousemove and mouseup listeners via the InputHandler
        this.mouseMoveListener = this.inputHandler.on('mousemove', this._handleDrag);
        this.mouseUpListener = this.inputHandler.on('leftup', this._handleDragEnd);
    }

    _handleDrag = (eventData) => {
        // Set dragging State
        if (!this.isDragging) {
            this.isDragging = true;
            if (this.activeModeInstance) this.activeModeInstance.flags.isDragMode = true;
        }

        // Early exit if isDragging state is false
        if (!this.isDragging || !eventData.mapPoint || !this.draggedObjectInfo.beginPoint) {
            return;
        }

        // Use moving point as coordinate
        this.#coordinate = eventData.mapPoint; // Store current coordinate {lat, lng}

        // --- Update Dragging Point ---
        // Update dragging point style
        this.draggedObjectInfo.beginPoint.setIcon({
            ...this.draggedObjectInfo.beginPoint.getIcon(),
            strokeWeight: 2,
            strokeColor: "#FFFF00"
        });

        this.draggedObjectInfo.beginPoint.setPosition(this.#coordinate); // Update the marker visual position on the map
        this.draggedObjectInfo.beginPoint.positions = [{ ...this.#coordinate }]; // Update the position data in the marker object
        this.draggedObjectInfo.beginPoint.status = "moving";

        // --- Update Associated Geometry (Approach 2: Reuse/Update) ---
        this.activeModeInstance?.updateGraphicsOnDrag(this.measure); // Update graphics on drag (optional)
    }

    _handleDragEnd = (eventData) => {
        this.inputHandler.off('mousemove', this._handleDrag); // Remove listener early

        // Re-enable map dragging
        this.map.setOptions({ draggable: true });

        if (!this.isDragging || !this.measure) { // Check measure reference
            this._resetValue(); // Ensure reset even if something went wrong: consider it as exit dragging
            return;
        }

        // -- Handle point --
        // Update the dragged point visual style and position
        this.draggedObjectInfo.beginPoint.setIcon({
            ...this.draggedObjectInfo.beginPoint.getIcon(),
            strokeWeight: 0, // Reset stroke weight 
            strokeColor: "#FF0000" // FIXME: replace the color using stateManager to make consistent color
        });
        this.draggedObjectInfo.beginPoint.setPosition(this.#coordinate); // Update the marker position on the map
        // Update metadata in the marker object
        this.draggedObjectInfo.beginPoint.positions = [{ ...this.#coordinate }]; // Update the position data in the marker object
        this.draggedObjectInfo.beginPoint.status = "completed"; // Update status to completed

        // -- Finalize Associated Geometry --
        this.activeModeInstance?.finalizeDrag(this.measure);

        // Update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Emit consistent event (optional)
        this.emitter.emit("drag-end", {
            measureData: { ...this.measure },
            draggedObjectInfo: { ...this.draggedObjectInfo }, // Send snapshot before reset
        });

        // Log the time of the last drag end event to solve left click trigger too fast issue
        this.lastDragEndTs = Date.now();

        // Reset values
        this._resetValue(); // Reset state variables and flags

    }

    _createDefaultDraggedObjectInfo() {
        // Consistent structure with CesiumDragHandler
        return {
            /** @type {google.maps.Marker | google.maps.marker.AdvancedMarkerElement | null} */
            beginPoint: null, // The marker being dragged
            /** @type {{lat: number, lng: number} | null} */
            beginPosition: null, // The position where dragging started
            // beginScreenPoint: null, // Optional
            lines: [], // Less relevant for Google's update approach
            labels: [], // Less relevant for Google's update approach
            /** @type {{lat: number, lng: number} | null} */
            endPosition: null, // The position where dragging ended
            /** @type {google.maps.Marker | google.maps.marker.AdvancedMarkerElement | null} */
            endPoint: null, // The marker where dragging ended
            // endLines: [], // Less relevant
            // endLabels: [], // Less relevant
        };
    }

    _resetValue() {
        // Reset flags
        this.isDragging = false;
        if (this.activeModeInstance) { // Check if instance exists before accessing flags
            this.activeModeInstance.flags.isDragMode = false;
        }

        // Reset coordinate
        this.#coordinate = null;

        // Reset the dragged object info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo();
        this.measure = null; // Reset the measure reference
    }

    _removeDragListeners() {
        if (this.mouseMoveListener) {
            // Assuming inputHandler.on returns a reference or function to remove
            // If inputHandler.on returns void, this needs adjustment based on inputHandler's implementation
            this.inputHandler.off('mousemove', this._handleDrag); // Use the correct reference/callback
            this.mouseMoveListener = null;
        }
        if (this.mouseUpListener) {
            this.inputHandler.off('leftup', this._handleDragEnd); // Use the correct reference/callback
            this.mouseUpListener = null;
        }
    }

    destroy() {
        this.deactivate(); // Ensure cleanup
    }
}


export { GoogleDragHandler };
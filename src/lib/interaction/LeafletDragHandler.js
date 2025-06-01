import dataPool from "../data/DataPool.js";
import { getVectorByPosition, findMeasureByCoordinate, convertToLatLng } from "../helper/leafletHelper.js";


/** @typedef {import('../input/LeafletInputHandler.js')} LeafletInputHandler */
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
 * Handles drag events for Leaflet Maps.
 */
class LeafletDragHandler {
    // -- Public Fields: dependencies --
    /** @type {L.Map} */
    map
    /** @type {LeafletInputHandler} */
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
        this.activeModeInstance = null;

        this._resetValue(); // Reset state, temporary data, and listeners   
    }

    /**
     * Handles the drag start event for the marker.
     * @param {L.circleMarker} marker - The marker that was clicked.
     * @param {NormalizedEventData} eventData - The normalized event data from the marker listener.
     */
    _handleDragStart(marker, eventData) {
        // Enable map dragging by default (might be disabled from previous drag)
        this.map?.dragging.enable();

        if (!this.activeModeInstance || this.isDragging || !eventData.mapPoint) {
            return;
        }

        const dragBeginPosition = eventData.mapPoint; // {lat, lng}

        // Find the associated measurement data (Requires _findMeasureByCoordinate in the mode)
        // this.measure = findMeasureByCoordinate(dragBeginPosition, dataPool.getAllMeasures("cartographicDegrees"), "leaflet");
        this.measure = this.activeModeInstance._findMeasureByCoordinate(dragBeginPosition);

        if (!this.measure) {
            console.warn("LeafletDragHandler: Could not find measure data for dragged marker at", dragBeginPosition);
            return;
        }

        // -- Handle Measure Data -- 
        this.measure.status = "pending"; // set status to pending
        this.measure.coordinates = this.measure.coordinates.map(coord => convertToLatLng(coord)); // Convert coordinates to Leaflet LatLng format

        // Disable map dragging during annotation drag
        this.map?.dragging.disable();

        // Store drag info
        this.draggedObjectInfo.beginPoint = marker;
        this.draggedObjectInfo.beginPosition = marker.getLatLng(); // Get Leaflet LatLng object

        // Find associated graphics (Requires a leafletHelper.getOverlayByPosition)
        const { polylines, labelMarkers, polygons } = getVectorByPosition(
            dragBeginPosition,
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection
        );
        this.draggedObjectInfo.lines = polylines;
        this.draggedObjectInfo.labels = labelMarkers;
        this.draggedObjectInfo.polygons = polygons;

        // -- Store total label primitive reference --
        // Assume total label should have only one per measure
        const totalLabel = this.labelCollection.getLayers().find(label => label.id === `annotate_${this.activeModeInstance.mode}_total_label_${this.measure.id}`)
        if (totalLabel) this.draggedObjectInfo.totalLabels = [totalLabel] // Store total label if exists

        // Update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Attach mousemove and mouseup listeners via the InputHandler
        this.mouseMoveListener = this.inputHandler.on('mousemove', this._handleDrag);
        this.mouseUpListener = document.addEventListener('mouseup', this._handleDragEnd);
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
        this.draggedObjectInfo.beginPoint.setStyle({
            weight: 2,
            color: "#FFFF00",
            fillColor: "#FF0000"
        }); // Update the marker style
        this.draggedObjectInfo.beginPoint.setLatLng(this.#coordinate); // Update the marker position

        // Update custom properties on the marker object itself
        this.draggedObjectInfo.beginPoint.positions = [{ ...this.#coordinate }]; // Assuming you store position this way
        this.draggedObjectInfo.beginPoint.status = "moving";

        // --- Update Associated Geometry (Approach 2: Reuse/Update) ---
        this.activeModeInstance?.updateGraphicsOnDrag(this.measure); // Update graphics on drag (optional)
    }

    _handleDragEnd = (eventData) => {
        // Re-enable map dragging
        this.map?.dragging.enable();

        if (!this.isDragging || !this.measure) { // Check measure reference
            this._resetValue(); // Ensure reset even if something went wrong: consider it as exit dragging
            return;
        }

        // -- Handle point --
        // Update the dragged point visual style and position
        this.draggedObjectInfo.beginPoint.setStyle({
            color: "#FF0000",
            fillColor: "#FF0000"
        });
        this.draggedObjectInfo.beginPoint.setLatLng(this.#coordinate); // Update the marker position
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
            /** @type {L.Polyline[]} */
            lines: [], // Less relevant for Google's update approach
            /** @type {L.Marker[]} */
            labels: [], // Less relevant for Google's update approach
            /** @type {L.Marker[]} */
            totalLabels: [],
            /** @type {L.Polygon[]} */
            polygons: [],
            /** @type {{lat: number, lng: number} | null} */
            endPosition: null, // The position where dragging ended
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

        // Reset listeners
        this._removeDragListeners(); // Ensure listeners are removed
    }

    /**
     * Removes drag listeners to prevent memory leaks.
     */
    _removeDragListeners() {
        // Always attempt to remove the mousemove listener from the inputHandler
        this.inputHandler.off('mousemove', this._handleDrag); // Use the correct reference/callback
        this.mouseMoveListener = null;

        // remove the mouseup listener from the document
        document.removeEventListener('mouseup', this._handleDragEnd); // Use the correct reference/callback
        this.mouseUpListener = null;
    }

    /**
     * Cleans up the handler by removing listeners and resetting state.
     */
    destroy() {
        this.deactivate(); // Ensure cleanup
    }
};

export { LeafletDragHandler };
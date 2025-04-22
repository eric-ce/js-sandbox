import dataPool from "../data/DataPool.js";
import { calculateDistance, convertToGoogleCoord, convertToLatLng } from "../helper/googleHelper.js";

class GoogleDragHandler {
    constructor(map, inputHandler, emitter, callbacks = {}) {
        this.map = map;
        this.inputHandler = inputHandler;
        this.emitter = emitter;

        this.activeModeInstance = null;
        this.isDragging = false;

        this.draggedObjectInfo = {
            beginPoint: null,       // The google.maps.Marker being dragged
            beginPosition: null,    // {lat, lng}
            movingLines: [],
            movingLabels: [],
            endPoint: null,
            endPosition: null,
            originalIndex: -1,      // Index of the point within measure.coordinates
        };

        this.measure = null;        // temporary measure data for reference

        this.mouseMoveListener = null; // Store listener refs for removal
        this.mouseUpListener = null;

        this.pointCollection = null;
        this.labelCollection = null;
        this.polylineCollection = null;
    }

    activate(modeInstance) {
        // Validate the variables from modeInstance
        if (!modeInstance || typeof modeInstance.mode !== 'string' || typeof modeInstance.flags !== 'object') {
            console.error("CesiumDragHandler activate requires a valid modeInstance with 'mode' and 'flags'.");
            return;
        }

        this.activeModeInstance = modeInstance; // Store the mode instance\

        this.pointCollection = this.activeModeInstance.pointCollection; // Store the point collection
        this.labelCollection = this.activeModeInstance.labelCollection; // Store the label collection
        this.polylineCollection = this.activeModeInstance.polylineCollection; // Store the polyline collection

    }

    deactivate() {
        this._removeDragListeners(); // Ensure listeners are removed
        this.activeModeInstance = null;
        this._resetValue(); // Reset state    
    }
    /**
     * Called by the mode instance when a mousedown event occurs on a draggable marker.
     * Renamed from _handleDragStart to match the intended usage pattern.
     * @param {google.maps.Marker | google.maps.marker.AdvancedMarkerElement} marker - The marker that was clicked.
     * @param {NormalizedEventData} eventData - The normalized event data from the marker listener.
     */
    _handleDragStart(marker, eventData) {
        // initialize map dragging, default enabled
        this.map.setOptions({ draggable: true });

        if (!this.activeModeInstance || this.isDragging || !eventData.mapPoint) {
            return; // Not active, already dragging, or missing event data
        }

        // Custom callbacks (consistency with Cesium)
        // if (typeof this.callbacks.onDragBegin === 'function') {
        //     this.callbacks.onDragBegin(eventData);
        // }

        const dragBeginPosition = eventData.mapPoint; // {lat, lng}

        // Find the associated measurement data
        const measure = this.activeModeInstance._findMeasureByCoordinate(dragBeginPosition);
        if (!measure) {
            console.warn("GoogleDragHandler: Could not find measure data for dragged marker at", dragBeginPosition);
            return;
        }

        // Find the index of the dragged point
        const originalIndex = measure.coordinates.findIndex(coord =>
            // Use the comparison method from the active mode
            this.activeModeInstance._areCoordinatesEqual(coord, dragBeginPosition)
        );
        if (originalIndex === -1) {
            console.warn("GoogleDragHandler: Could not find coordinate index in measure data for dragged marker.");
            return;
        }

        console.log("GoogleDragHandler: Starting drag for marker:", marker.id, "Measure:", measure.id, "Index:", originalIndex);

        // Disable map dragging during annotation drag
        this.map.setOptions({ draggable: false });

        // Store drag info using consistent names
        this.draggedObjectInfo.beginPoint = marker; // Equivalent to Cesium's primitive
        this.draggedObjectInfo.beginPosition = dragBeginPosition;
        // beginScreenPoint might be less relevant if not using screen distance threshold
        // this.draggedObjectInfo.beginScreenPoint = eventData.screenPoint;

        this.measure = measure; // Store reference to measure data

        // Store original index
        this.draggedObjectInfo.originalIndex = originalIndex;

        // Set status to pending (consistency)
        this.measure.status = "pending";
        // Update data pool (consistency)
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Attach mousemove and mouseup listeners via the InputHandler
        this.mouseMoveListener = this.inputHandler.on('mousemove', this._handleDrag);
        this.mouseUpListener = this.inputHandler.on('leftup', this._handleDragEnd);
    }

    _handleDrag = (eventData) => {
        // Check drag threshold (consistency, optional for Google Maps)
        // const dragThreshold = 5;
        // const moveDistance = google.maps.geometry.spherical.computeDistanceBetween(
        //     new google.maps.LatLng(this.draggedObjectInfo.beginPosition),
        //     new google.maps.LatLng(eventData.mapPoint)
        // ); // This calculates map distance, not screen distance. Screen distance check might be complex.
        // if (!this.isDragging && moveDistance > someThreshold) {
        //     this.isDragging = true;
        //     this.activeModeInstance.flags.isDragMode = true;
        // }
        // For simplicity, assume dragging starts immediately after startDraggingMarker is called
        if (!this.isDragging) {
            this.isDragging = true;
            if (this.activeModeInstance) this.activeModeInstance.flags.isDragMode = true;
        }

        if (!this.isDragging || !eventData.mapPoint || !this.draggedObjectInfo.beginPoint) {
            return;
        }


        this.coordinate = eventData.mapPoint; // Store current coordinate {lat, lng}

        // --- Update Dragging Point ---
        // Update the visual marker position
        this.draggedObjectInfo.beginPoint.setPosition(this.coordinate);
        this.draggedObjectInfo.beginPoint.positions = [this.coordinate]; // Update the position in the marker object
        this.draggedObjectInfo.beginPoint.status = "moving";

        // --- Update Associated Geometry (Approach 2: Reuse/Update) ---
        const measure = this.measure; // Use the stored measure reference
        const index = this.draggedObjectInfo.originalIndex;

        // Example for TwoPointsDistanceGoogle: Update polyline and label
        if (measure && index !== -1 && this.activeModeInstance?.mode === 'distance' && measure.coordinates.length === 2) {
            // Find the associated polyline and label (assuming they exist and are stored in mode instance)
            // const polyline = this.activeModeInstance.polylineCollection?.find(p => p.dataId === measure.id);
            const otherPosition = measure.coordinates.find(pos => pos.lat !== this.draggedObjectInfo.beginPosition.lat || pos.lng !== this.draggedObjectInfo.beginPosition.lng); // Find the other position in the measure
            const movingLines = this._findAssociatedPolylineByPositions(otherPosition, measure, this.activeModeInstance.polylineCollection); // Use the helper method
            this.draggedObjectInfo.movingLines = movingLines; // Store the moving lines for consistency
            // const movingLabels = this.activeModeInstance.labelCollection?.find(l => l.dataId === measure.id); // Use dataId for labels too

            if (!otherPosition) {
                console.warn("GoogleDragHandler: Could not find other position for polyline update.");
                return;
            }
            if (Array.isArray(movingLines) && movingLines.length > 0) {
                const polyline = this.draggedObjectInfo.movingLines[0];

                // Update the position in the path array based on the dragged index
                polyline.setPath([otherPosition, this.coordinate]);
                polyline.positions = [otherPosition, this.coordinate];
                polyline.status = "moving";
            }

            // if (label) {
            //     // Recalculate distance and middle position for the label
            //     const otherIndex = index === 0 ? 1 : 0;
            //     const otherPointLatLng = polyline?.getPath()?.getAt(otherIndex); // Get the *current* position of the other point
            //     if (otherPointLatLng) {
            //         const currentLatLng = new google.maps.LatLng(this.coordinate.lat, this.coordinate.lng);
            //         const distance = calculateDistance(currentLatLng, otherPointLatLng);
            //         const middlePos = calculateMiddlePos([currentLatLng, otherPointLatLng]);
            //         const formattedText = formatMeasurementValue(distance, "meter");

            //         label.setPosition(middlePos);
            //         label.setLabel({ ...label.getLabel(), text: formattedText });
            //         // Optional: Add custom properties for consistency
            //         // label.customData = { status: "moving" };
            //     }
            // }
        }
        // Add logic for other modes (area, etc.) here if needed

        // Custom callbacks (consistency)
        // if (typeof this.callbacks.onDrag === 'function') {
        //     this.callbacks.onDrag(eventData);
        // }
    }

    _handleDragEnd = (eventData) => {
        this.inputHandler.off('mousemove', this._handleDrag); // Remove listener early

        // Re-enable map dragging
        this.map.setOptions({ draggable: true });

        // if (!this.isDragging || !this.measure) { // Check measure reference
        //     this._resetValue(); // Ensure reset even if something went wrong
        //     return;
        // }

        // Use last known coordinate or event data
        const finalPosition = this.coordinate || eventData.mapPoint || this.draggedObjectInfo.beginPosition;

        // --- Finalize the update ---
        const measure = this.measure;
        const index = this.draggedObjectInfo.originalIndex;

        if (measure && index !== -1 && finalPosition) {
            // Update the coordinate in the data model
            measure.coordinates[index] = { latitude: finalPosition.lat, longitude: finalPosition.lng, height: 0 }; // Assuming height 0

            // Recalculate final measurement value if needed (e.g., distance)
            let finalDistance = null;
            if (measure.coordinates.length === 2) {
                const pos1 = convertToGoogleCoord(measure.coordinates[0]);
                const pos2 = convertToGoogleCoord(measure.coordinates[1]);
                finalDistance = calculateDistance(pos1, pos2);
                measure._records = [finalDistance]; // Update records
                // Update label text one last time (optional, _handleDrag should be sufficient)
                const label = this.activeModeInstance?.labelCollection?.find(l => l.dataId === measure.id);
                if (label) {
                    const formattedText = formatMeasurementValue(finalDistance, "meter");
                    label.setLabel({ ...label.getLabel(), text: formattedText });
                    // label.customData = { status: "completed" };
                }
            }
            // Add final calculations for other modes here

            measure.status = "completed";

            // Update data pool
            dataPool.updateOrAddMeasure({ ...measure });

            // Store final state info for consistency before reset (if needed for event)
            this.draggedObjectInfo.endPosition = finalPosition;
            this.draggedObjectInfo.endPoint = this.draggedObjectInfo.beginPoint;
            // endLines/endLabels might be less relevant as we updated existing ones
            // this.draggedObjectInfo.endLines = [polyline];
            // this.draggedObjectInfo.endLabels = [label];

            // Custom callbacks (consistency)
            // if (typeof this.callbacks.onDragEnd === 'function') {
            //     this.callbacks.onDragEnd(eventData);
            // }

            // Emit consistent event (optional)
            this.emitter.emit("drag-end", {
                measureData: { ...this.measure },
                draggedObjectInfo: { ...this.draggedObjectInfo }, // Send snapshot before reset
            });

        } else {
            console.warn("GoogleDragHandler: Could not finalize drag end, missing data.");
            // Potentially revert changes if needed
        }

        // --- Cleanup ---
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
            originalIndex: -1, // Index of the point in measure.coordinates
            // movingLines: [], // Less relevant for Google's update approach
            // movingLabels: [], // Less relevant for Google's update approach
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
        this.coordinate = null;

        // Reset the dragged object info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo();
        this.measure = null; // Reset the measure reference

        // Ensure listeners are removed (might be redundant if called from deactivate/dragEnd)
        this._removeDragListeners();
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

    /*****************
     * HELPER METHOD *
     *****************/
    /**
     * Find any associated polyline from polylineCollection based on a provided position.
     *
     * @param {{lat:number, lng:number} | google.maps.LatLng } positions. The position(s) to find the associated polyline(s).
     * @param {Measure} measure - The measure object containing the ID to lookup against.
     * @param {google.maps.Polyline[]} polylineCollection - The collection of polylines to search through.
     * @return {google.maps.Polyline[] | null} - The associated polyline(s) or null if not found.
     */
    _findAssociatedPolylineByPositions(position, measure, polylineCollection) {
        if (!measure?.id || !Array.isArray(polylineCollection) || !position) return null;

        const matches = [];

        for (const p of polylineCollection) {
            if (!p.id.includes(measure.id)) continue;

            const path = Array.isArray(p.positions) && p.positions.length > 1
                ? p.positions
                : p.getPath().getArray();

            if (path.some(latLng => this.activeModeInstance._areCoordinatesEqual(latLng, position))) {
                matches.push(p);    // ← same reference as in the original array
            }
        }
        // Return the matched polyline(s) or null if none found
        return matches.length > 0 ? matches : null;
    }
};

export { GoogleDragHandler };
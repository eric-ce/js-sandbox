import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPointMarkers,
    createPolyline,
    createPolylines,
    createPolygon,
    removePointMarker,
    removePolyline,
    removePolygon,
    createLabelMarkers,
    createLabelMarker,
    removeLabel,
} from "../lib/helper/googleHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class GoogleMeasure extends MeasureComponentBase {
    constructor() {
        super();
    }

    _addLabel(positions, value, unit, options = {}) {
        return createLabelMarker(this.map, positions, value, unit, options);
    }
    _addLabelsFromArray(positions, valueArray, unit, options = {}) {
        return createLabelMarkers(this.map, positions, valueArray, unit, options);
    }

    _removeLabel(label) {
        removeLabel(label);
    }

    _addPointMarker(position, color = "#FF0000", options = {}) {
        // console.log("GoogleMeasure._addPointMarker called with:", position, color, options);
        if (!this.map || !position) return null;
        try {
            const marker = createPointMarker(this.map, position, color, options);
            if (marker) {
                // --- Add Click Listener ---
                // Store dataId if provided in options
                marker.__measureDataId = options.dataId;
                google.maps.event.addListener(marker, 'click', (event) => {
                    // Prevent map click listener from firing
                    event.domEvent?.stopPropagation();
                    // Prepare data for the event emission
                    const clickInfo = {
                        type: 'marker',
                        graphic: marker, // The marker instance itself
                        mapPoint: { lat: event.latLng.lat(), lng: event.latLng.lng() },
                        dataId: marker.__measureDataId, // Include the associated data ID
                        event: event // Original Google Maps event
                    };
                    this._notifyAnnotationClicked(clickInfo);
                });
                // --- End Add Click Listener ---
            }
            return marker;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addPointMarker:", error);
            return null;
        }
    }

    _addPointMarkersFromArray(positions, color = "#FF0000", options = {}) {
        return createPointMarkers(this.map, positions, color, options);
    }

    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options);
    }

    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options);
    }

    _addPolygon(positions, color = "#A52A2A", options = {}) {
        return createPolygon(this.map, positions, color, options);
    }

    _removePointMarker(marker) {
        removePointMarker(marker);
    }

    _removePolyline(polyline) {
        removePolyline(polyline);
    }

    _removePolygon(polygon) {
        removePolygon(polygon);
    }

    /**
     * Emits an 'annotation:click' event when a managed graphic is clicked.
     * @param {object} clickInfo - Details about the clicked annotation.
     * @param {'marker'|'polyline'|'polygon'|'label'} clickInfo.type - The type of graphic clicked.
     * @param {any} clickInfo.graphic - The map graphic object itself.
     * @param {{lat: number, lng: number} | null} clickInfo.mapPoint - Click coordinates.
     * @param {string | undefined} clickInfo.dataId - The ID of the associated measurement data.
     * @param {google.maps.MapMouseEvent | google.maps.PolylineMouseEvent} clickInfo.event - The original event.
     * @private
     */
    _notifyAnnotationClicked(clickInfo) {
        if (!this.emitter) {
            console.warn("GoogleMeasure: Emitter not available, cannot emit annotation:click event.");
            return;
        }
        console.log(`GoogleMeasure: Emitting annotation:click`, clickInfo);
        this.emitter.emit('annotation:click', clickInfo);
    }

}

customElements.define("google-measure", GoogleMeasure);
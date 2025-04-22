import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPointMarkers,
    createPolyline,
    createPolylines,
    createPolygon,
    createLabelMarkers,
    createLabelMarker,
    removeOverlay
} from "../lib/helper/googleHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class GoogleMeasure extends MeasureComponentBase {
    constructor() {
        super();
    }

    /**
     * Adds a point marker to the map at the specified position.
     * @param {{lat:number,lng:number}} position - The position where the marker will be added
     * @param {string} [color="#FF0000"] - The color of the marker (default is "#FF0000")
     * @param {object} [options={}] - Optional configuration for the marker
     * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|null} The created marker or null if an error occurs.
     */
    _addPointMarker(position, options = {}) {
        // console.log("GoogleMeasure._addPointMarker called with:", position, color, options);
        if (!this.map || !position) return null;
        try {
            // Separate listeners from other marker options
            const { listeners, ...markerOptions } = options;

            const point = createPointMarker(this.map, position, markerOptions);

            // Attach listeners if provided
            if (point && listeners && typeof listeners === 'object') {
                for (const eventName in listeners) {
                    if (typeof listeners[eventName] === 'function') {
                        // Use addListener for robust event handling on markers/overlays
                        point.addListener(eventName, (event) => {
                            const latLng = event.latLng;
                            const pixel = event.pixel; // Note: pixel coords might not always be available depending on event/context

                            const eventData = {
                                mapPoint: latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null,
                                screenPoint: pixel ? { x: pixel.x, y: pixel.y } : { x: NaN, y: NaN }, // Provide fallback
                                domEvent: event.domEvent // Pass original DOM event - CRUCIAL for button check
                            };
                            // Pass the marker itself and the event object to the callback
                            listeners[eventName](point, eventData);
                        });
                    }
                }
            }

            return point;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addPointMarker:", error);
            return null;
        }
    }

    /**
     * Adds multiple point markers to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions 
     * @param {string} [color="#FF0000"]
     * @param {object} [options={}] - Optional configuration for the marker
     * @returns {google.maps.marker.AdvancedMarkerElement[]|google.maps.Marker[]|null} The created marker or null if an error occurs.
     */
    _addPointMarkersFromArray(positions, options = {}) {
        return createPointMarkers(this.map, positions, options);
    }

    /**
     * Adds a polyline to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {string} [color="#A52A2A"] - The color of the polyline (default is "#A52A2A")
     * @param {object} [options={}] - Optional configuration for the polyline
     * @returns {google.maps.Polyline|undefined} The created polyline.
     */
    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options);
    }

    /**
     * Adds multiple polylines to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {string} [color="#A52A2A"] - The color of the polyline (default is "#A52A2A")
     * @param {object} [options={}] - Optional configuration for the polyline
     * @returns {google.maps.Polyline[]|undefined} The created polyline.
     */
    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options);
    }

    /**
     * Creates a label marker on the provided map at the given position.
     * @param {{lat:number,lng:number}[]}} positions - Array of position objects
     * @param {number|string} value - The value to display on the label marker
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} [options={}] - Optional configuration for the label marker
     * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|undefined} The created marker.
     */
    _addLabel(positions, value, unit, options = {}) {
        return createLabelMarker(this.map, positions, value, unit, options);
    }

    /**
     * Creates multiple label markers on the provided map at the given positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {number[]|string[]} valueArray - Array of values to display on the label markers
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} [options={}] - Optional configuration for the label markers
     * @returns {google.maps.marker.AdvancedMarkerElement[]|google.maps.Marker[]|undefined} The created marker.
     */
    _addLabelsFromArray(positions, valueArray, unit, options = {}) {
        return createLabelMarkers(this.map, positions, valueArray, unit, options);
    }

    /**
     * Adds a polygon to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {string} [color="#A52A2A"] color - The color of the polygon (default is "#A52A2A")
     * @param {object} [options={}] = - Optional configuration for the polygon
     * @returns {google.maps.Polygon|undefined} The created polygon.
     */
    _addPolygon(positions, color = "#A52A2A", options = {}) {
        return createPolygon(this.map, positions, color, options);
    }

    /**
     * Removes a point marker from the map.
     * @param {google.maps.marker.AdvancedMarkerElement|google.maps.Marker} marker 
     */
    _removePointMarker(marker) {
        removeOverlay(marker);
    }

    /**
     * Removes a polyline from the map.
     * @param {google.maps.Polyline} polyline 
     */
    _removePolyline(polyline) {
        removeOverlay(polyline);
    }

    /**
     * Removes a label marker from the map.
     * @param {google.maps.marker.AdvancedMarkerElement|google.maps.Marker} label - The label marker(s) to remove
     */
    _removeLabel(label) {
        removeOverlay(label);
    }

    /**
     * Removes a polygon from the map.
     * @param {} polygon 
     */
    _removePolygon(polygon) {
        removeOverlay(polygon);
    }

    /**
     * Emits an 'annotation:click' event when a managed graphic is clicked.
     * @param {object} clickInfo - Details about the clicked annotation.
     * @param {'marker'|'polyline'|'polygon'|'label'} clickInfo.type - The type of graphic clicked.
     * @param {any} clickInfo.graphic - The map graphic object itself.
     * @param {{lat: number, lng: number} | null} clickInfo.mapPoint - Click coordinates.
     * @param {string | undefined} clickInfo.dataId - The ID of the associated measurement data.
     * @param {google.maps.MapMouseEvent | google.maps.PolylineMouseEvent} clickInfo.event - The original event.
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
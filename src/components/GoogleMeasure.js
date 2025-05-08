// import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPolyline,
    createPolygon,
    createLabelMarker,
    removeOverlay
} from "../lib/helper/googleHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";


/** @typedef {google.maps.Marker} Marker */
/** @typedef {google.maps.Polyline} Polyline */
/** @typedef {google.maps.Polygon} Polygon */
/** @typedef {google.maps.marker.AdvancedMarkerElement} AdvancedMarkerElement */

/**
 * GoogleMeasure class for managing Google Maps measure components.
 * This class extends the MeasureComponentBase and provides methods to add, remove, and manage map graphics such as points, polylines, polygons, and labels.
 */
export default class GoogleMeasure extends MeasureComponentBase {
    /**@type {Marker[]} */
    #pointCollection = []; // Array to store points
    /**@type {google.maps.Polyline[]} */
    #polylineCollection = []; // Array to store lines
    /**@type {google.maps.Marker[]} */
    #labelCollection = []; // Array to store polygons
    /**@type {google.maps.Polygon[]} */
    #polygonCollection = []; // Array to store polygons

    constructor() {
        super();
    }

    get pointCollection() {
        return this.#pointCollection;
    }

    get polylineCollection() {
        return this.#polylineCollection;
    }

    get labelCollection() {
        return this.#labelCollection;
    }

    get polygonCollection() {
        return this.#polygonCollection;
    }

    /**
     * Adds a point marker to the map at the specified position.
     * @param {{lat:number,lng:number}} position - The position where the marker will be added
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

            // Store the point in the collection
            point && this.#pointCollection.push(point);

            return point;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addPointMarker:", error);
            return null;
        }
    }

    /**
     * Adds multiple point markers to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions 
     * @param {object} [options={}] - Optional configuration for the marker
     * @returns {AdvancedMarkerElement[]|Marker[]|null} The created marker or null if an error occurs.
     */
    _addPointMarkersFromArray(positions, options = {}) {
        if (!this.map || !Array.isArray(positions)) return null;

        // const points = createPointMarkers(this.map, positions, options);
        const pointsArray = positions.map((pos) => {
            return this._addPointMarker(pos, options);
        }).filter(Boolean);

        return pointsArray;
    }

    /**
     * Adds a polyline to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {object} [options={}] - Optional configuration for the polyline
     * @returns {Polyline | null} The created polyline.
     */
    _addPolyline(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length < 2) return null;

        // Create the polyline
        const polyline = createPolyline(this.map, positions, options);
        if (!polyline) return null;

        // Store the polyline in the collection
        polyline && this.#polylineCollection.push(polyline);

        return polyline;
    }

    /**
     * Adds multiple polylines to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {object} [options={}] - Optional configuration for the polyline
     * @returns {Polyline[]|[]} The created polyline.
     */
    _addPolylinesFromArray(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length < 2) return [];


        // Create the polylines instance
        const addedPolylines = [];

        // Iterate through the positions array, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i += 2) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the polyline
            const polyline = this._addPolyline(positionsPair, options);
            if (polyline) {
                addedPolylines.push(polyline);
            }
        }

        return addedPolylines; // Return the array of successfully added polylines
    }

    /**
     * Creates a label marker on the provided map at the given position.
     * @param {{lat:number,lng:number}[]}} positions - Array of position objects
     * @param {number|string} value - The value to display on the label marker
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} [options={}] - Optional configuration for the label marker
     * @returns {AdvancedMarkerElement | Marker | null} The created marker.
     */
    _addLabel(positions, value, unit, options = {}) {
        if (!this.map || !Array.isArray(positions)) return null;

        // Create the label
        const label = createLabelMarker(this.map, positions, value, unit, options);
        if (!label) return null;

        // Store the label in the collection
        label && this.#labelCollection.push(label);

        return label;
    }

    /**
     * Creates multiple label markers on the provided map at the given positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {number[]|string[]} valueArray - Array of values to display on the label markers
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} [options={}] - Optional configuration for the label markers
     * @returns {AdvancedMarkerElement[] | Marker[] | []} The created marker.
     */
    _addLabelsFromArray(positions, valueArray, unit, options = {}) {
        if (!this.map || !Array.isArray(positions)) return [];

        // Create the label primitives
        const addedLabels = [];
        // Iterate through the positions array, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i += 2) {
            const label = this._addLabel([positions[i], positions[i + 1]], valueArray[i], unit, options);
            if (label) {
                addedLabels.push(label);
            }
        }

        return addedLabels; // Return the array of successfully added labels
    }

    /**
     * Adds a polygon to the map at the specified positions.
     * @param {{lat:number,lng:number}[]} positions - Array of position objects
     * @param {object} [options={}] = - Optional configuration for the polygon
     * @returns {Polygon|null} The created polygon.
     */
    _addPolygon(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length < 3) return null;

        // Create the polygon
        const polygon = createPolygon(this.map, positions, options);
        if (!polygon) return null;

        // Store the polygon in the collection
        polygon && this.#polygonCollection.push(polygon);

        return polygon;
    }

    /**
     * Removes a point marker from the map.
     * @param {AdvancedMarkerElement|Marker} marker 
     */
    _removePointMarker(marker) {
        // remove the overlay from the map
        removeOverlay(marker);

        // remove the marker from the collection
        const index = this.#pointCollection.indexOf(marker);
        if (index > -1) {
            this.#pointCollection.splice(index, 1);
        }
    }

    /**
     * Removes a polyline from the map.
     * @param {Polyline} polyline 
     */
    _removePolyline(polyline) {
        // remove the overlay from the map
        removeOverlay(polyline);

        // remove the polyline from the collection
        const index = this.#polylineCollection.indexOf(polyline);
        if (index > -1) {
            this.#polylineCollection.splice(index, 1);
        }
    }

    /**
     * Removes a label marker from the map.
     * @param {AdvancedMarkerElement|Marker} label - The label marker(s) to remove
     */
    _removeLabel(label) {
        // remove the overlay from the map
        removeOverlay(label);

        // remove the label from the collection
        const index = this.#labelCollection.indexOf(label);
        if (index > -1) {
            this.#labelCollection.splice(index, 1);
        }
    }

    /**
     * Removes a polygon from the map.
     * @param {Polygon} polygon - The polygon to remove 
     */
    _removePolygon(polygon) {
        // remove the overlay from the map
        removeOverlay(polygon);

        // remove the polygon from the collection
        const index = this.#polygonCollection.indexOf(polygon);
        if (index > -1) {
            this.#polygonCollection.splice(index, 1);
        }
    }

    /**
     * Clears all collections of points, polylines, labels, and polygons from the map.
     */
    clearCollections() {
        // Remove overlays from map
        this.#pointCollection.forEach(p => removeOverlay(p));
        this.#polylineCollection.forEach(p => removeOverlay(p));
        this.#labelCollection.forEach(l => removeOverlay(l));
        this.#polygonCollection.forEach(p => removeOverlay(p));

        // Clear collections
        this.#pointCollection = [];
        this.#polylineCollection = [];
        this.#labelCollection = [];
        this.#polygonCollection = [];
    }

    // /**
    //  * Emits an 'annotation:click' event when a managed graphic is clicked.
    //  * @param {object} clickInfo - Details about the clicked annotation.
    //  * @param {'marker'|'polyline'|'polygon'|'label'} clickInfo.type - The type of graphic clicked.
    //  * @param {any} clickInfo.graphic - The map graphic object itself.
    //  * @param {{lat: number, lng: number} | null} clickInfo.mapPoint - Click coordinates.
    //  * @param {string | undefined} clickInfo.dataId - The ID of the associated measurement data.
    //  * @param {google.maps.MapMouseEvent | google.maps.PolylineMouseEvent} clickInfo.event - The original event.
    //  */
    // _notifyAnnotationClicked(clickInfo) {
    //     if (!this.emitter) {
    //         console.warn("GoogleMeasure: Emitter not available, cannot emit annotation:click event.");
    //         return;
    //     }
    //     console.log(`GoogleMeasure: Emitting annotation:click`, clickInfo);
    //     this.emitter.emit('annotation:click', clickInfo);
    // }
}

customElements.define("google-measure", GoogleMeasure);
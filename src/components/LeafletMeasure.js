import {
    createCircleMarker,
    createPolygon,
    createPolyline,
    createLabelTooltip,
} from "../lib/helper/leafletHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class LeafletMeasure extends MeasureComponentBase {
    /** @type {L.FeatureGroup | null} - store the markers */
    #pointCollection = null;
    /** @type {L.FeatureGroup | null} - store the polyline vectors */
    #polylineCollection = null;
    /** @type {L.FeatureGroup | null} - store the labels tooltips */
    #labelCollection = null;
    /** @type {L.FeatureGroup | null} - store the polygon vectors */
    #polygonCollection = null;

    constructor() {
        super();
    }

    _initializeMapSpecifics() {
        // -- Create Collections --
        this.#pointCollection = L.featureGroup().addTo(this.map);
        this.#polylineCollection = L.featureGroup().addTo(this.map);
        this.#labelCollection = L.featureGroup().addTo(this.map);
        this.#polygonCollection = L.featureGroup().addTo(this.map);

        // -- Handle Vectors Z-Index (Pane) --
        this.map.getPane('markerPane').style.zIndex = 650; // Higher than default markerPane (600)
        this.map.getPane('overlayPane').style.zIndex = 450; // Higher than default overlayPane (400)
    }

    get pointCollection() {
        return this.#pointCollection;
    }
    get labelCollection() {
        return this.#labelCollection;
    }
    get polylineCollection() {
        return this.#polylineCollection;
    }
    get polygonCollection() {
        return this.#polygonCollection;
    }


    // Implementation of abstract methods from the base class
    _addPointMarker(position, options = {}) {
        // -- Validate dependencies --
        if (!this.map || !position) {
            console.warn("LeafletMeasure: Failed to add point marker. Map or position is not defined.");
            return null;
        }

        try {
            // Separate listeners from other marker options
            const { listeners, status = null, ...markerOptions } = options;

            // Create the point marker (assuming helper doesn't add to map)
            const pointMarker = createCircleMarker(position, markerOptions);

            if (pointMarker) {
                // -- Handle Metadata --
                pointMarker.status = status; // Add custom properties if needed

                // --- Attach Listeners (Leaflet Style) ---
                if (listeners && typeof listeners === 'object') {
                    for (const eventName in listeners) {
                        if (typeof listeners[eventName] === 'function') {
                            // Use marker.on() for Leaflet
                            pointMarker.on(eventName, (leafletEvent) => {
                                // Normalize Leaflet event data (similar to GoogleMapsInputHandler)
                                const eventData = {
                                    mapPoint: leafletEvent.latlng ? { lat: leafletEvent.latlng.lat, lng: leafletEvent.latlng.lng } : null,
                                    screenPoint: leafletEvent.containerPoint ? { x: leafletEvent.containerPoint.x, y: leafletEvent.containerPoint.y } : { x: NaN, y: NaN }, // Provide fallback
                                    domEvent: leafletEvent.originalEvent, // Pass original DOM event
                                    leafletEvent: leafletEvent // Keep original Leaflet event if needed
                                };

                                // Pass the marker itself and the normalized event data to the callback
                                // This matches the signature expected by your mode's listener functions
                                listeners[eventName](pointMarker, eventData);

                                // Optional: Stop propagation if needed within the original listener
                                // L.DomEvent.stopPropagation(leafletEvent); // Or handle in the mode's listener
                            });
                        }
                    }
                }
                // --- End Attach Listeners ---

                // -- Add to the collection --
                this.#pointCollection.addLayer(pointMarker);
            }

            return pointMarker;

        } catch (error) {
            console.error("LeafletMeasure: Error in _addPointMarker:", error);
            return null;
        }
    }

    _addPointMarkersFromArray(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.warn("LeafletMeasure: Point collection not initialized for bulk add.");
            return []; // Return empty array on failure
        }

        const addedMarkers = [];

        positions.forEach(pos => {
            // Call the single marker method for each position
            // Pass the common options object
            const marker = this._addPointMarker(pos, options);
            if (marker) {
                addedMarkers.push(marker);
            }
            // If _addPointMarker returns null, it's skipped
        });


        return addedMarkers; // Return the array of successfully added markers
    }

    _addPolyline(positions, options = {}) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length < 2) {
            console.error("Invalid positions array for polyline:", positions);
            return null;
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Create Polyline --
        const polyline = createPolyline(positions, options);

        if (polyline) {
            // -- Handle Metadata --
            polyline.status = status;
            // -- Add to the collection --
            this.#polylineCollection.addLayer(polyline);
        }
        return polyline;
    }

    _addPolylinesFromArray(positionsArray, options = {}) {
        if (!this.map || !Array.isArray(positionsArray) || positionsArray.length === 0) {
            console.warn("LeafletMeasure: Invalid or empty positions array for _addPolylinesFromArray.");
            return [];
        }

        // Create the polyline
        const addedPolylines = [];
        // Iterate over the positions array in pairs, 2 positions as a pair
        for (let i = 0; i < positionsArray.length - 1; i += 2) {
            const positions = positionsArray.slice(i, i + 2); // Get two positions for the polyline
            const polyline = this._addPolyline(positions, options);
            if (polyline) {
                addedPolylines.push(polyline);
            }
        }

        return addedPolylines;
    }

    _addPolygon(positions, options = {}) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length < 3) {
            console.error("Invalid positions array for polygon:", positions);
            return null;
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Create Polygon --
        const polygon = createPolygon(positions, options);
        if (polygon) {
            // -- Handle Metadata --
            polygon.status = status;
            // -- Add to the collection --
            this.#polygonCollection.addLayer(polygon);
        }
        return polygon;
    }

    _addLabel(positions, value, unit, options) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.error("Label collection is not initialized.");
            return null;
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Create Label --
        const label = createLabelTooltip(positions, value, unit, options);
        if (label) {
            // -- Handle Metadata --
            label.status = status;
            // -- Add to the collection --
            this.#labelCollection.addLayer(label);
        }
        return label;
    }

    _addLabelsFromArray(positionsArray, valueArray, unit, options = {}) {
        if (!this.map || !Array.isArray(positionsArray) || !Array.isArray(valueArray)) {
            console.warn("LeafletMeasure: Invalid or mismatched positions/value arrays for _addLabelsFromArray.");
            return [];
        }

        // Create the label
        const addedLabels = [];
        // Iterate over the positions array in pairs, 2 positions as a pair
        for (let i = 0; i < positionsArray.length - 1; i += 2) {
            const label = this._addLabel([positionsArray[i], positionsArray[i + 1]], valueArray[i], unit, options);
            if (label) {
                addedLabels.push(label);
            }
        }

        return addedLabels; // Return the array of successfully added polylines
    }

    _removePointMarker(marker) {
        if (this.#pointCollection && marker) {
            // Remove from the collection
            this.#pointCollection.removeLayer(marker);
        }
    }

    _removePolyline(polyline) {
        if (this.#polylineCollection && polyline) {
            this.#polylineCollection.removeLayer(polyline);
        }
    }

    _removePolygon(polygon) {
        if (this.#polygonCollection && polygon) {
            this.#polygonCollection.removeLayer(polygon);
        }
    }

    _removeLabel(label) {
        if (this.#labelCollection && label) {
            this.#labelCollection.removeLayer(label);
        }
    }
}

customElements.define("leaflet-measure", LeafletMeasure);
import {
    createCircleMarker,
    createPolygon,
    createPolyline,
    createLabelTooltip,
    checkLayerType,
    areCoordinatesEqual,
} from "../lib/helper/leafletHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";


/**
 * LeafletMeasure class to provide measurement drawing functionalities in Leaflet. 
 * Overrides methods from MeasureComponentBase to implement Leaflet-specific features.
 * @extends {MeasureComponentBase}
 */
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
        // -- Validate dependencies --
        if (!this.map || this.mapName !== "leaflet") return;

        // if collections are already initialized, do nothing
        if (this.#pointCollection || this.#polylineCollection || this.#labelCollection || this.#polygonCollection) return;

        // -- Create Collections --
        this.#pointCollection = L.featureGroup().addTo(this.map);
        this.#polylineCollection = L.featureGroup().addTo(this.map);
        this.#labelCollection = L.featureGroup().addTo(this.map);
        this.#polygonCollection = L.featureGroup().addTo(this.map);

        // -- Handle Vectors Z-Index (Pane) --
        this.map.getPane('markerPane').style.zIndex = 650; // Higher than default markerPane (600)
        this.map.getPane('overlayPane').style.zIndex = 450; // Higher than default overlayPane (400)
    }


    /**********
     * GETTER *
     **********/
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
        if (!this.map || !position) return null;

        // initialize the collections if not already done
        if (!this.#pointCollection) {
            this._initializeMapSpecifics();
        }

        // Separate listeners from other marker options
        const { listeners, ...rest } = options;

        // Create the point marker (assuming helper doesn't add to map)
        const pointMarker = createCircleMarker(position, { ...rest });
        if (!pointMarker) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            pointMarker.on('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(pointMarker);
            });
            pointMarker.on('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

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

        return pointMarker;
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

    /**
     * Adds a polyline to the map.
     * @param {*} positions - Array of positions for the polyline
     * @param {object} [options={}] - Options for the polyline
     * @returns {L.Polyline|null} - The created polyline or null if failed
     */
    _addPolyline(positions, options = {}) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length < 2) {
            console.error("Invalid positions array for polyline:", positions);
            return null;
        }

        // initialize the collections if not already done
        if (!this.#polylineCollection) {
            this._initializeMapSpecifics();
        }

        // Separate listeners from other marker options
        const { listeners, ...rest } = options;

        // -- Create Polyline --
        const polyline = createPolyline(positions, { ...rest });
        if (!polyline) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            polyline.on('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(polyline);
            });
            polyline.on('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

        // --- Attach Listeners (Leaflet Style) ---
        if (listeners && typeof listeners === 'object') {
            for (const eventName in listeners) {
                if (typeof listeners[eventName] === 'function') {
                    // Use marker.on() for Leaflet
                    polyline.on(eventName, (leafletEvent) => {
                        // Normalize Leaflet event data (similar to GoogleMapsInputHandler)
                        const eventData = {
                            mapPoint: leafletEvent.latlng ? { lat: leafletEvent.latlng.lat, lng: leafletEvent.latlng.lng } : null,
                            screenPoint: leafletEvent.containerPoint ? { x: leafletEvent.containerPoint.x, y: leafletEvent.containerPoint.y } : { x: NaN, y: NaN }, // Provide fallback
                            domEvent: leafletEvent.originalEvent, // Pass original DOM event
                            leafletEvent: leafletEvent // Keep original Leaflet event if needed
                        };

                        // Pass the marker itself and the normalized event data to the callback
                        // This matches the signature expected by your mode's listener functions
                        listeners[eventName](polyline, eventData);

                        // Optional: Stop propagation if needed within the original listener
                        // L.DomEvent.stopPropagation(leafletEvent); // Or handle in the mode's listener
                    });
                }
            }
        }

        // -- Add to the collection --
        this.#polylineCollection.addLayer(polyline);

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

        // initialize the collections if not already done
        if (!this.#polygonCollection) {
            this._initializeMapSpecifics();
        }

        // -- Create Polygon --
        const polygon = createPolygon(positions, options);
        if (!polygon) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            polygon.on('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(polygon);
            });
            polygon.on('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

        // -- Add to the collection --
        this.#polygonCollection.addLayer(polygon);

        return polygon;
    }

    _addLabel(positions, value, unit, options) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.error("Label collection is not initialized.");
            return null;
        }

        // initialize the collections if not already done
        if (!this.#labelCollection) {
            this._initializeMapSpecifics();
        }

        // -- Create Label --
        const label = createLabelTooltip(positions, value, unit, options);
        if (!label) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            label.on('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(label);
            });
            label.on('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

        // -- Add to the collection --
        this.#labelCollection.addLayer(label);
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


    /********************
     * UTILITY FEATURES *
     ********************/
    /**
     * Refreshes a layer's interactivity by removing and re-adding it to its collection.
     * This ensures Leaflet re-initializes event bindings based on current options.
     * @param {L.Layer} layerInstance - The Leaflet layer to refresh.
     */
    _refreshLayerInteractivity(layerInstance) {
        if (!layerInstance) return;

        const layerType = checkLayerType(layerInstance);

        switch (layerType) {
            case "point":
                if (this.#pointCollection && this.#pointCollection.hasLayer(layerInstance)) {
                    this.#pointCollection.removeLayer(layerInstance);
                    this.#pointCollection.addLayer(layerInstance);
                }
                break;
            case "polyline":
                if (this.#polylineCollection && this.#polylineCollection.hasLayer(layerInstance)) {
                    this.#polylineCollection.removeLayer(layerInstance);
                    this.#polylineCollection.addLayer(layerInstance);
                }
                break;
            case "polygon":
                if (this.#polygonCollection && this.#polygonCollection.hasLayer(layerInstance)) {
                    this.#polygonCollection.removeLayer(layerInstance);
                    this.#polygonCollection.addLayer(layerInstance);
                }
                break;
            case "label":
                if (this.#labelCollection && this.#labelCollection.hasLayer(layerInstance)) {
                    this.#labelCollection.removeLayer(layerInstance);
                    this.#labelCollection.addLayer(layerInstance);
                }
                break;
            default:
                return;
        }
    }


    /*****************
     * FIND GRAPHICS *
     *****************/
    /**
     * Finds a point primitive by its position in the point collection.
     * @param {{lat:number,lng:number}} position - The position to find the point primitive 
     * @returns {L.circleMarker | null} - The point primitive if found, otherwise null
     */
    _getPointByPosition(position) {
        // -- Validate dependencies --
        if (!this.#pointCollection || !position) return null;

        // Get all points in the collection
        const points = this.#pointCollection.getLayers();
        if (!Array.isArray(points) || points.length === 0) return null;
        // Find the point marker that matches the position
        let foundPointMarker = null;

        for (const point of points) {
            if (point &&
                Array.isArray(point.positions) &&
                point.positions.some(p => areCoordinatesEqual(p, position))
            ) {
                foundPointMarker = point;
                break; // Exit loop once found
            }
        }
        return foundPointMarker || null; // Return the found point marker or null if not found
    }

    /**
    * Finds a polyline primitive by its positions in the polyline collection.
    * Find lines exact match for two points, or line for any match for one point.
    * @param {{lat:number,lng:number}[]} positions - The positions to find the polyline primitive
    * @returns {L.Polyline[] | null} - The polyline primitive if found, otherwise null
    */
    _getLineByPositions(positions) {
        if (!this.#polylineCollection || !Array.isArray(positions) || positions.length === 0) return null;

        // Get all polylines in the collection
        const polylines = this.#polylineCollection.getLayers();
        if (!Array.isArray(polylines) || polylines.length === 0) return null;

        // Find the polyline(s) that match the positions
        const foundPolylines = [];
        // Case1: the positions is one point, find the lines that has some position matched
        if (positions.length === 1) {
            const targetPosition = positions[0];
            const matchingLines = polylines.filter(polyline =>
                polyline.positions && polyline.positions.some(pos => areCoordinatesEqual(pos, targetPosition))
            );
            if (matchingLines.length > 0) {
                foundPolylines.push(...matchingLines);
            }
        }
        // Case2: the positions is two points, find the line that exactly matches the two points
        else if (positions.length === 2) {
            const pos1 = positions[0];
            const pos2 = positions[1];
            // Find returns the first matching polyline or undefined
            const matchingLine = polylines.find(polyline => {
                // Check if the polyline has exactly two positions
                if (polyline.positions && polyline.positions.length === 2) {
                    // Compare the positions of the polyline with the provided positions
                    return areCoordinatesEqual(polyline.positions[0], pos1) &&
                        areCoordinatesEqual(polyline.positions[1], pos2);
                }
                return false; // Not a match
            });
            if (matchingLine) {
                foundPolylines.push(matchingLine); // Add the single found primitive to the array
            }
        }

        // Return the array of found primitives if any were found, otherwise return null.
        return foundPolylines.length > 0 ? foundPolylines : null;
    }

    /**
     * Finds label primitives by their associated position(s).
     * If `positions` is a single position, it matches `label.position`.
     * If `positions` is an array of 1 position, it matches any label where `label.positions` contains that point.
     * If `positions` is an array of 2 positions, it matches any label where `label.positions` exactly matches those two points in order.
     * @param {{lat:number,lng:number} | {lat:number,lng:number}[]} positions - The position or an array of positions to find the label primitive(s).
     * @returns {L.Tooltip[] | null} - An array of matching label primitives if found, otherwise null.
     */
    _getLabelByPosition(positions) {
        if (!this.#labelCollection || (!positions)) return null;

        // Get all labels in the collection
        const labels = this.#labelCollection.getLayers();
        if (!Array.isArray(labels) || labels.length === 0) return null;

        // Find the label(s) that match the positions
        const foundLabels = [];
        for (const label of labels) {
            // Check if label has positions property
            if (label && Array.isArray(label.positions)) {
                // If positions is a single position, check if it matches any position in label.positions
                if (Array.isArray(positions) && positions.length === 1) {
                    if (label.positions.some(p => areCoordinatesEqual(p, positions[0]))) {
                        foundLabels.push(label);
                    }
                }
                // If positions is an array of two positions, check for exact match
                else if (Array.isArray(positions) && positions.length === 2) {
                    if (areCoordinatesEqual(label.positions[0], positions[0]) &&
                        areCoordinatesEqual(label.positions[1], positions[1])) {
                        foundLabels.push(label);
                    }
                }
                // If positions is a single position object, check for exact match
                else if (typeof positions === 'object' && 'lat' in positions && 'lng' in positions) {
                    if (label.positions.some(p => areCoordinatesEqual(p, positions))) {
                        foundLabels.push(label);
                    }
                }
            }
        }
        return foundLabels.length > 0 ? foundLabels : null; // Return the found labels or null if not found
    }

    /**
     * Finds all related overlays (points, polylines, labels, polygons) by a given measureId.
     * @param {number|string} measureId - The measureId to search for in the overlays.
     * @returns {{points: L.CircleMarker[], polylines: L.Polyline[], labels: L.Tooltip[], polygons: L.Polygon[]}|null} - An object containing arrays of related overlays or null if no measureId is provided.
     */
    _getRelatedOverlaysByMeasureId(measureId) {
        if (!measureId) return null;
        // convert measureId to string if it is not
        if (typeof measureId !== "string") {
            measureId = String(measureId);
        }

        const relatedOverlays = {
            points: [],
            polylines: [],
            labels: [],
            polygons: [],
        };
        // Find related points
        const points = this.#pointCollection.getLayers();
        if (!Array.isArray(points) || points.length === 0) return relatedOverlays; // Return empty if no points
        relatedOverlays.points = points.filter(marker => {
            // Check if the marker has a 'measureId' property and matches the provided measureId
            return marker && marker.id && marker.id.includes(measureId);
        });

        // Find related polygons
        const polygons = this.#polygonCollection.getLayers();
        if (Array.isArray(polygons) && polygons.length > 0) {
            relatedOverlays.polygons = polygons.filter(polygon => {
                // Check if the polygon has a 'measureId' property and matches the provided measureId
                return polygon && polygon.id && polygon.id.includes(measureId);
            });
        }

        // Find related polylines
        const polylines = this.#polylineCollection.getLayers();
        if (Array.isArray(polylines) && polylines.length > 0) {
            relatedOverlays.polylines = polylines.filter(polyline => {
                // Check if the polyline has a 'measureId' property and matches the provided measureId
                return polyline && polyline.id && polyline.id.includes(measureId);
            });
        }

        // Find related labels
        const labels = this.#labelCollection.getLayers();
        if (Array.isArray(labels) && labels.length > 0) {
            relatedOverlays.labels = labels.filter(label => {
                // Check if the label has a 'measureId' property and matches the provided measureId
                return label && label.id && label.id.includes(measureId);
            });
        }

        return relatedOverlays;
    }


    /******************
     * REMOVE FEATURE *
     ******************/
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
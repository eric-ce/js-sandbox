import { deconstructIdForMetadata } from "../lib/helper/helper.mjs";
import {
    createCircleMarker,
    createPolygon,
    createPolyline,
    createLabelTooltip,
    checkLayerType,
    areCoordinatesEqual,
} from "../lib/helper/leafletHelper.mjs";
import { AnnotationComponentBase } from "./AnnotationComponentBase.mjs";


/**
 * leafletAnnotation class to provide measurement drawing functionalities in Leaflet. 
 * Overrides methods from AnnotationComponentBase to implement Leaflet-specific features.
 * @extends {AnnotationComponentBase}
 */
export default class LeafletAnnotation extends AnnotationComponentBase {
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

        // -- Add Highlight Event Listeners to Collections --
        this._addHighlightEventListenersToCollection(this.#pointCollection);
        this._addHighlightEventListenersToCollection(this.#polylineCollection);
        this._addHighlightEventListenersToCollection(this.#labelCollection);
        this._addHighlightEventListenersToCollection(this.#polygonCollection);

        // -- Add Picker Event Listeners to Collections --
        this._addPickerEventListenersToCollection(this.#pointCollection);
        this._addPickerEventListenersToCollection(this.#polylineCollection);
        this._addPickerEventListenersToCollection(this.#labelCollection);
        this._addPickerEventListenersToCollection(this.#polygonCollection);

        // -- Add Context Menu Event listeners to Collections --
        this._addContextMenuEventListenerToCollection(this.#pointCollection);
        this._addContextMenuEventListenerToCollection(this.#polylineCollection);
        this._addContextMenuEventListenerToCollection(this.#labelCollection);
        this._addContextMenuEventListenerToCollection(this.#polygonCollection);

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

        // Separate listeners from other options
        const {
            listeners,
            status = null,
            id = null,
        } = options;

        // Create the point marker (assuming helper doesn't add to map)
        const pointMarker = createCircleMarker(position, options);
        if (!pointMarker) return null;

        // -- Handle metadata --
        pointMarker.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status,
                positions: [{ ...position }],
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

        // Enhance the pointMarker prototype for metadata access
        this._enhanceLayerPrototypes(pointMarker);

        // Add highlight event listeners
        // this._addHighlightEventListeners(pointMarker);

        // Add Picker event listeners
        // this._addPickerEventListeners(pointMarker);

        // Add custom event listeners
        this._addCustomEventListeners(pointMarker, listeners);

        // Add right click context menu event listener
        // this._addContextMenuEventListener(pointMarker);

        // -- Add to the collection --
        this.#pointCollection.addLayer(pointMarker);
        return pointMarker;
    }

    _addPointMarkersFromArray(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.warn("leafletAnnotation: Point collection not initialized for bulk add.");
            return []; // Return empty array on failure
        }

        const addedMarkers = [];

        positions.forEach(pos => {
            // Call the single marker method for each position
            // Pass the common options object
            const marker = this._addPointMarker(pos, { ...options });
            if (marker) {
                addedMarkers.push(marker);
            }
        });

        return addedMarkers;
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

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        // -- Create Polyline --
        const polyline = createPolyline(positions, options);
        if (!polyline) return null;

        // -- Handle metadata --
        polyline.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status,
                positions: positions.map(pos => ({ ...pos })), // Store original positions
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

        // Enhance the polyline prototype for metadata access
        this._enhanceLayerPrototypes(polyline);

        // Add highlight event listeners
        // this._addHighlightEventListeners(polyline);

        // Add Picker event listeners
        // this._addPickerEventListeners(polyline);

        // Add custom event listeners
        this._addCustomEventListeners(polyline, listeners);

        // Add right click context menu event listener
        // this._addContextMenuEventListener(polyline);

        // -- Add to the collection --
        this.#polylineCollection.addLayer(polyline);

        return polyline;
    }

    _addPolylinesFromArray(positions, options = {}) {
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.warn("leafletAnnotation: Invalid or empty positions array for _addPolylinesFromArray.");
            return [];
        }

        // Create the polyline
        const addedPolylines = [];
        // Iterate over the positions array in pairs, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the polyline
            const polyline = this._addPolyline(positionsPair, options);
            polyline && addedPolylines.push(polyline);
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

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        // -- Create Polygon --
        const polygon = createPolygon(positions, options);
        if (!polygon) return null;

        // -- Handle metadata --
        polygon.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status,
                positions: positions.map(pos => ({ ...pos })), // Store original positions
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

        // Enhance the polygon prototype for metadata access
        this._enhanceLayerPrototypes(polygon);

        // Add highlight event listeners
        // this._addHighlightEventListeners(polygon);

        // Add Picker event listeners
        // this._addPickerEventListeners(polygon);

        // Add custom event listeners
        this._addCustomEventListeners(polygon, listeners);

        // Add right click context menu event listener
        // this._addContextMenuEventListener(polygon);

        // -- Add to the collection --
        this.#polygonCollection.addLayer(polygon);

        return polygon;
    }

    _addLabel(positions, value, unit, options = {}) {
        // -- Validate dependencies --
        if (!this.map || !Array.isArray(positions) || positions.length === 0) {
            console.error("Label collection is not initialized.");
            return null;
        }

        // initialize the collections if not already done
        if (!this.#labelCollection) {
            this._initializeMapSpecifics();
        }

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        // -- Create Label --
        const label = createLabelTooltip(positions, value, unit, options);
        if (!label) {
            console.error("_addLabel: Failed to create label instance."); // ✅ Add this line
            return null;
        }

        // -- Handle metadata --
        label.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status,
                positions: positions.map(pos => ({ ...pos })), // Store original positions
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

        // Enhance the label prototype for metadata access
        this._enhanceLayerPrototypes(label);

        // Add highlight event listeners
        // this._addHighlightEventListeners(label);

        // Add Picker event listeners
        // this._addPickerEventListeners(label);

        // Add custom event listeners
        this._addCustomEventListeners(label, listeners);

        // Add right click context menu event listener
        // this._addContextMenuEventListener(label);

        // -- Add to the collection --
        this.#labelCollection.addLayer(label);
        return label;
    }

    _addLabelsFromArray(positions, valueArray, unit = "meter", options = {}) {
        if (
            !this.map ||
            !Array.isArray(positions) ||
            positions.length === 0 ||
            !Array.isArray(valueArray) ||
            valueArray.length === 0
        ) return [];

        // Create the label
        const addedLabels = [];
        // Iterate over the positions array in pairs, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the label
            const label = this._addLabel(positionsPair, valueArray[i], unit, options);
            label && addedLabels.push(label);
        }

        return addedLabels; // Return the array of successfully added polylines
    }

    /**
    * Enhances the prototype of a Google Maps Overlays with custom getters and setters for easier metadata access.
    * @param {Marker|Polyline|Polygon} overlay - The Google Maps overlay instance to enhance  
    * @returns {void}
    * @private
    */
    _enhanceLayerPrototypes(overlay) {
        // Get the actual prototype of the instance
        const prototype = Object.getPrototypeOf(overlay);

        // Exit if the prototype has already been enhanced to avoid redundant work
        if (prototype.hasOwnProperty('status')) {
            return;
        }

        // --- Define properties to be added to the prototype ---

        // Getter for the entire 'feature' object
        Object.defineProperty(prototype, 'feature', {
            get: function () { return this._feature; },
            set: function (value) { this._feature = value; },
            enumerable: true,
            configurable: true
        });

        // Getter for the 'properties' object within the feature
        Object.defineProperty(prototype, 'properties', {
            get: function () { return this.feature?.properties; },
            enumerable: true,
            configurable: true
        });

        // Getter/setter for 'status'
        Object.defineProperty(prototype, 'status', {
            get: function () {
                return this.properties?.status;
            },
            set: function (newStatus) {
                if (this.properties) {
                    this.properties.status = newStatus;
                }
            },
            enumerable: true,
            configurable: true
        });

        // Getter/setter for 'storedPositions' to avoid conflict with native 'position'
        Object.defineProperty(prototype, 'storedPositions', {
            get: function () {
                return this.properties?.positions;
            },
            set: function (newPositions) {
                if (this.properties) {
                    this.properties.positions = newPositions;
                }
            },
            enumerable: true,
            configurable: true
        });
    }


    /*****************
     * EVENT HANDLER *
     *****************/
    /**
     * Adds highlight event listeners to a collection of Leaflet layers.
     * @param {L.LayerGroup} collection - The collection of layers to add listeners to.
     * @returns {void}
     */
    _addHighlightEventListenersToCollection(collection) {
        if (!collection || !this.highlightHandler) return;

        // Highlight event listeners on the entire collection
        collection.on('mouseover', (event) => {
            const layer = event.layer; // Get the specific layer that was hovered
            this.highlightHandler.applyHoverHighlight(layer);
            const eventData = this._createEventData(event, layer);
            this.emitter.emit('annotation-hovered-leaflet', eventData);
        });

        collection.on('mouseout', (event) => {
            // highlightHandler's removeHoverHighlight should know which object was hovered
            this.highlightHandler.removeHoverHighlight();
            const eventData = this._createEventData(event, null);
            this.emitter.emit('annotation-hovered-leaflet', eventData);
        });
    }

    /**
     * Adds picker event listeners to a collection of Leaflet layers.
     * @param {L.LayerGroup} collection - The collection of layers to add listeners to.
     * @returns {void}
     */
    _addPickerEventListenersToCollection(collection) {
        if (!collection) return;

        collection.on('click', (event) => {
            const layer = event.layer; // Get the specific layer that was clicked
            const eventData = this._createEventData(event, layer);
            this.emitter.emit('annotation-clicked-leaflet', eventData);
        });
    }

    _addContextMenuEventListenerToCollection(collection) {
        if (!collection) return;

        collection.on('contextmenu', (event) => {
            // Prevent the default context menu
            L.DomEvent.preventDefault(event.originalEvent);
            L.DomEvent.stopPropagation(event.originalEvent);

            const layer = event.layer; // Get the specific layer that was right-clicked
            const eventData = this._createEventData(event, layer);
            this.emitter.emit('annotation-contextmenu-leaflet', eventData);
        });
    }

    /**
     * Adds custom event listeners to a Leaflet layer.
     * @param {L.CircleMarker|L.Polyline|L.Polygon|L.Tooltip|L.Layer} layer 
     * @param {{string: function}} listeners - An object event handlers with event names as key and corresponding callback functions as values.
     * @returns {void}
     */
    _addCustomEventListeners(layer, listeners) {
        if (!layer || !listeners || typeof listeners !== 'object') return;

        for (const eventName in listeners) {
            if (typeof listeners[eventName] === 'function') {
                // Use marker.on() for Leaflet
                layer.on(eventName, (event) => {
                    const eventData = this._createEventData(event, layer);
                    listeners[eventName](layer, eventData);
                });
            }
        }
    }

    /**
     * Normalizes a Leaflet event into a consistent format
     * @private
     * @param {L.Event} leafletEvent - The original Leaflet event
     * @returns {Object} - Normalized event data object
     */
    _createEventData(event, layer = null) {
        return {
            mapPoint: event.latlng ? { lat: event.latlng.lat, lng: event.latlng.lng } : null,
            screenPoint: event.containerPoint ?
                { x: event.containerPoint.x, y: event.containerPoint.y } :
                { x: NaN, y: NaN },
            domEvent: event.originalEvent,
            leafletEvent: event,
            target: event.target || null,
            layer: layer || null,
        };
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
            const pointPositions = point.feature?.properties?.positions || [];
            if (point &&
                Array.isArray(pointPositions) &&
                pointPositions.some(p => areCoordinatesEqual(p, position))
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
            const matchingLines = polylines.filter(polyline => {
                const polylinePositions = polyline?.feature?.properties?.positions;
                return polylinePositions && polylinePositions.some(pos => areCoordinatesEqual(pos, targetPosition));
            });
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
                const polylinePositions = polyline?.feature?.properties?.positions;
                if (polylinePositions && polylinePositions.length === 2) {
                    // Compare the positions of the polyline with the provided positions
                    return areCoordinatesEqual(polylinePositions[0], pos1) &&
                        areCoordinatesEqual(polylinePositions[1], pos2);
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
            const labelPositions = label?.feature?.properties?.positions;
            if (!labelPositions || !Array.isArray(labelPositions)) continue; // Skip if no positions

            // If positions is a single position, check if it matches any position in label.positions
            if (Array.isArray(positions) && positions.length === 1) {
                if (labelPositions.some(p => areCoordinatesEqual(p, positions[0]))) {
                    foundLabels.push(label);
                }
            }
            // If positions is an array of two positions, check for exact match
            else if (Array.isArray(positions) && positions.length === 2) {
                if (areCoordinatesEqual(labelPositions[0], positions[0]) &&
                    areCoordinatesEqual(labelPositions[1], positions[1])) {
                    foundLabels.push(label);
                }
            }
            // If positions is a single position object, check for exact match
            else if (typeof positions === 'object' && 'lat' in positions && 'lng' in positions) {
                if (labelPositions.some(p => areCoordinatesEqual(p, positions))) {
                    foundLabels.push(label);
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

    clearCollections() {
        // Clear all collections
        this.#pointCollection && this.#pointCollection.clearLayers();
        this.#polylineCollection && this.#polylineCollection.clearLayers();
        this.#labelCollection && this.#labelCollection.clearLayers();
        this.#polygonCollection && this.#polygonCollection.clearLayers();

        // No need to reset the collections to null, as mode can continue using them
    }
}

customElements.define("leaflet-annotation", LeafletAnnotation);



/***********************
 *  DEPRECATED METHOD  *
 * TO BE DELETED LATER *
 ***********************/
// _addHighlightEventListeners(layer) {
//     if (!layer || !this.highlightHandler) return;

//     // Highlight event listeners
//     layer.on('mouseover', (event) => {
//         this.highlightHandler.applyHoverHighlight(layer);
//         const eventData = this._createEventData(event, layer);
//         this.emitter.emit('annotation-hovered-leaflet', eventData);
//     });
//     layer.on('mouseout', (event) => {
//         // highlightHandler's removeHoverHighlight should know which object was hovered
//         this.highlightHandler.removeHoverHighlight();
//         const eventData = this._createEventData(event, null);
//         this.emitter.emit('annotation-hovered-leaflet', eventData);
//     });
// }

// _addPickerEventListeners(layer) {
//     if (!layer) return;

//     layer.on('click', (event) => {
//         const eventData = this._createEventData(event, layer);
//         this.emitter.emit('annotation-clicked-leaflet', eventData);
//     });
// }

// /**
//  * Adds a context menu event listener to a Leaflet layer.
//  * Context menu refers to the right-click event in Leaflet.
//  * @param {L.CircleMarker|L.Polyline|L.Polygon|L.Tooltip|L.Layer} layer - The Leaflet layer to add the context menu listener to.
//  * @returns {void}
//  */
// _addContextMenuEventListener(layer) {
//     if (!layer) return;

//     layer.on('contextmenu', (event) => {
//         // Prevent the default browser context menu
//         L.DomEvent.preventDefault(event.originalEvent);
//         L.DomEvent.stopPropagation(event.originalEvent);

//         const eventData = this._createEventData(event, layer);
//         this.emitter.emit('annotation-contextmenu-leaflet', eventData);
//     });
// }
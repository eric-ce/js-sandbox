// import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPolyline,
    createPolygon,
    createLabelMarker,
    removeOverlay,
    areCoordinatesEqual
} from "../lib/helper/googleHelper.js";
import { deconstructIdForMetadata } from "../lib/helper/helper.js";
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

    // #customListeners = new Map();
    // #listenerIdCounter = 0;

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

    _initializeMapSpecifics() {
        this._setupDataLayer();
    }

    /**
     * Sets up the Google Maps Data Layer for managing features.
     * @private
     */
    _setupDataLayer() {
        if (!this.map) return;

        // Create a new data layer and set it on the map
        this.dataLayer = new google.maps.Data();
        this.dataLayer.setMap(this.map);
    }


    /*****************
     * FIND GRAPHICS *
     *****************/
    /**
     * Finds a point primitive by its position in the point collection.
     * @param {{lat:number,lng:number}} position - The position to find the point primitive 
     * @returns {google.maps.Marker | null} - The point primitive if found, otherwise null
     */
    _getPointByPosition(position) {
        if (!Array.isArray(this.#pointCollection) || !position) return null;

        let foundPointMarker = null;
        // Iterate through the point collection to find the marker with the matching position
        for (const point of this.#pointCollection) {
            const pointPosition = point?.feature?.properties?.positions;
            // Check the custom 'positions' property
            if (
                pointPosition &&
                Array.isArray(pointPosition) &&
                pointPosition.some(p => areCoordinatesEqual(p, position))
            ) {
                foundPointMarker = point;
                break; // Found the point marker associated with this position
            }
        }
        return foundPointMarker || null; // Return the found point marker or null if not found
    }

    /**
     * Finds a polyline primitive by its positions in the polyline collection.
     * Find lines exact match for two points, or line for any match for one point.
     * @param {{lat:number,lng:number}[]} positions - The positions to find the polyline primitive
     * @returns {google.maps.Polyline[] | null} - The polyline primitive if found, otherwise null
     */
    _getLineByPositions(positions) {
        if (!Array.isArray(this.#polylineCollection) || !Array.isArray(positions) || positions.length === 0) return null;

        const foundPolylines = [];

        // Case1: the positions is one point, find the lines that has some position matched
        if (positions.length === 1) {
            const targetPosition = positions[0];
            const matchingLines = this.#polylineCollection.filter(polyline => {
                const polylinePositions = polyline?.feature?.properties?.positions || [];
                return Array.isArray(polylinePositions) &&
                    polylinePositions.some(pos => areCoordinatesEqual(pos, targetPosition))
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
            const matchingLine = this.#polylineCollection.find(polyline => {
                const polylinePositions = polyline?.feature?.properties?.positions || [];
                // Check if the polyline has exactly two positions
                if (Array.isArray(polylinePositions) && polylinePositions.length === 2) {
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
     * @returns {google.maps.Marker[] | null} - An array of matching label primitives if found, otherwise null.
     */
    _getLabelByPosition(positions) {
        if (!Array.isArray(this.#labelCollection) || (!positions)) return null;

        const foundLabels = [];
        for (const label of this.#labelCollection) {
            const labelPositions = label?.feature?.properties?.positions || [];
            // Check if label has positions property
            if (label && Array.isArray(labelPositions)) {
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
        }
        return foundLabels.length > 0 ? foundLabels : null; // Return the found labels or null if not found
    }

    /**
     * Finds all related overlays (points, polylines, labels, polygons) by a given measureId.
     * @param {number|string} measureId - The measureId to search for in the overlays.
     * @returns {{points: google.maps.Marker[], polylines: Polyline[], labels: google.maps.Marker[], polygons: Polygon[]}|null} - An object containing arrays of related overlays or null if no measureId is provided.
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
        relatedOverlays.points = this.#pointCollection.filter(marker => {
            // Check if the marker has a 'measureId' property and matches the provided measureId
            return typeof marker.id === "string" && marker.id.includes(measureId);
        });
        // Find related polygons
        relatedOverlays.polygons = this.#polygonCollection.filter(polygon => {
            // Check if the polygon has a 'measureId' property and matches the provided measureId
            return typeof polygon.id === "string" && polygon.id.includes(measureId);
        });
        // Find related polylines
        relatedOverlays.polylines = this.#polylineCollection.filter(polyline => {
            // Check if the polyline has a 'measureId' property and matches the provided measureId
            return typeof polyline.id === "string" && polyline.id.includes(measureId);
        });

        // Find related labels
        relatedOverlays.labels = this.#labelCollection.filter(label => {
            // Check if the label has a 'measureId' property and matches the provided measureId
            return typeof label.id === "string" && label.id.includes(measureId);
        });

        return relatedOverlays;
    }


    /*****************************
     * CREATE ANNOTATION FEATURE *
     *****************************/
    /**
     * Adds a point feature to the data layer.
     * @param {{lat: number, lng: number}} position - The position where the point will be added.
     * @param {object} [options={}] - Optional configuration for the point feature.
     * @returns {google.maps.Data.Feature|null} The created data feature or null on failure.
     * @private
     */
    _addDataPoint(position, options = {}) {
        if (!this.dataLayer || !position) return null;

        const {
            id = null,
            status = null,
            // listeners are handled at the data layer level, not per feature
        } = options;

        try {
            const feature = new google.maps.Data.Feature({
                id,
                geometry: new google.maps.Data.Point(position),
                properties: {
                    type: "annotation",
                    mapName: this.mapName,
                    status,
                    positions: [{ ...position }],
                    ...(id && deconstructIdForMetadata(id)),
                }
            });

            // The data layer will return an array of features added.
            const [addedFeature] = this.dataLayer.add(feature);

            return addedFeature;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addDataPoint:", error);
            return null;
        }
    }

    /**
     * Adds a point marker to the map at the specified position.
     * @param {{lat:number,lng:number}} position - The position where the marker will be added
     * @param {object} [options={}] - Optional configuration for the marker
     * @returns {google.maps.Marker|null} The created marker or null if an error occurs.
     */
    _addPointMarker(position, options = {}) {
        // Validate map and position
        if (!this.map || !position) return null;

        // Deconstruct options to set default values 
        const {
            listeners,
            status = null,
            id = null,
        } = options;

        try {
            const point = createPointMarker(this.map, position, options);
            if (!point) return null;

            // Enhance overlay prototype for metadata retrieval
            this._enhancePrimitivePrototypes(point);

            // Store metadata in the overlay
            point.feature = {
                id,
                type: "annotation",
                properties: {
                    mapName: this.mapName,
                    status,
                    positions: [{ ...position }],
                    ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
                }
            };

            // Add highlight event listeners
            this._addHighlightEventListeners(point);

            // Add Picker event listeners
            this._addPickerEventListeners(point);

            // Add custom event listeners
            this._addCustomEventListeners(point, listeners);

            // Store the point in the collection
            this.#pointCollection.push(point);

            this._enhancePrimitivePrototypes(point); // Enhance the prototype for additional properties

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

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        try {
            // Create the polyline
            const polyline = createPolyline(this.map, positions, options);
            if (!polyline) return null;

            // Enhance overlay prototype for metadata retrieval
            this._enhancePrimitivePrototypes(polyline);

            // Store metadata in the overlay
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

            // Add highlight event listeners
            this._addHighlightEventListeners(polyline);

            // Add Picker event listeners
            this._addPickerEventListeners(polyline);

            // Add custom event listeners
            this._addCustomEventListeners(polyline, listeners);

            // Store the polyline in the collection
            this.#polylineCollection.push(polyline);

            return polyline;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addPolyline:", error);
            return null;
        }
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
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the polyline
            const polyline = this._addPolyline(positionsPair, options);
            polyline && addedPolylines.push(polyline);
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

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        try {
            // Create the label
            const label = createLabelMarker(this.map, positions, value, unit, options);
            if (!label) return null;

            // Enhance overlay prototype for metadata retrieval
            this._enhancePrimitivePrototypes(label);

            // Store metadata in the overlay
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

            // Add highlight event listeners
            this._addHighlightEventListeners(label);

            // Add Picker event listeners
            this._addPickerEventListeners(label);

            // Add custom event listeners
            this._addCustomEventListeners(label, listeners);

            // Store the label in the collection
            this.#labelCollection.push(label);

            return label;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addLabel:", error);
            return null;
        }
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
        if (
            !this.map ||
            !Array.isArray(positions) ||
            positions.length === 0 ||
            !Array.isArray(valueArray) ||
            valueArray.length === 0
        ) return [];

        // Create the label primitives
        const addedLabels = [];
        // Iterate through the positions array, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the label
            const label = this._addLabel(positionsPair, valueArray[i], unit, options);
            label && addedLabels.push(label);
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

        const {
            listeners,
            status = null,
            id = null,
        } = options;

        try {
            // Create the polygon
            const polygon = createPolygon(this.map, positions, options);
            if (!polygon) return null;

            // -- Handle metadata --
            // Enhance overlay prototype for metadata retrieval
            this._enhancePrimitivePrototypes(polygon);

            // Store metadata in the overlay
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

            // Add highlight event listeners
            this._addHighlightEventListeners(polygon);

            // Add Picker event listeners
            this._addPickerEventListeners(polygon);

            // Add custom event listeners
            this._addCustomEventListeners(polygon, listeners);

            // Store the polygon in the collection
            this.#polygonCollection.push(polygon);

            return polygon;
        } catch (error) {
            console.error("GoogleMeasure: Error in _addPolygon:", error);
            return null;
        }
    }

    /**
     * Enhances the prototype of a Google Maps Overlays with custom getters and setters for easier metadata access.
     * @param {Marker|Polyline|Polygon} overlay - The Google Maps overlay instance to enhance  
     * @returns {void}
     * @private
     */
    _enhancePrimitivePrototypes(overlay) {
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


    /**************************
     * EVENT HANDLING METHODS *
     **************************/
    /**
     * Adds highlight event listeners to an overlay.
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} overlay - The overlay to add listeners to
     * @private
     */
    _addHighlightEventListeners(overlay) {
        if (!overlay) return;

        // Highlight event listeners
        if (this.highlightHandler) {
            overlay.addListener('mouseover', (event) => {
                const eventData = this._createEventData(event, overlay);
                this.highlightHandler.applyHoverHighlight(overlay);
                // Emit the hover event with the event data
                this.emitter.emit('annotation-hovered-google', eventData);
            });
            overlay.addListener('mouseout', (event) => {
                const eventData = this._createEventData(event, null);
                this.highlightHandler.removeHoverHighlight();
                // Emit the hover event with null annotation to indicate mouse out
                this.emitter.emit('annotation-hovered-google', eventData);
            });
        }
    }

    /**
     * Adds picker event listeners to an overlay.
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} overlay - The overlay to add listeners to
     * @returns {void}
     * @private
     */
    _addPickerEventListeners(overlay) {
        if (!overlay) return;

        overlay.addListener('click', (event) => {
            const eventData = this._createEventData(event, overlay);
            this.emitter.emit('annotation-clicked-google', eventData);
        });
    }

    /**
     * Adds custom event listeners to an overlay.
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} overlay - The overlay to add listeners to
     * @param {object} listeners - Custom listeners object
     * @private
     */
    _addCustomEventListeners(overlay, listeners) {
        if (!overlay || !listeners || typeof listeners !== 'object') return;

        for (const eventName in listeners) {
            if (typeof listeners[eventName] === 'function') {
                overlay.addListener(eventName, (event) => {
                    const eventData = this._createEventData(event);
                    listeners[eventName](overlay, eventData);
                });
            }
        }
    }

    /**
     * Creates normalized event data from a Google Maps event.
     * @param {google.maps.MapMouseEvent} event - The Google Maps event
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} [annotation=null] - The annotation object
     * @returns {object} Normalized event data
     * @private
     */
    _createEventData(event, annotation = null) {
        return {
            mapPoint: event.latLng ? { lat: event.latLng.lat(), lng: event.latLng.lng() } : null,
            screenPoint: this._getContainerRelativeCoords(event.domEvent),
            domEvent: event.domEvent,
            annotation
        };
    }


    /*****************************
     * REMOVE ANNOTATION FEATURE *
     *****************************/
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
        // Define collections with their names for better maintainability
        const collections = [
            { items: this.#pointCollection, name: 'point' },
            { items: this.#polylineCollection, name: 'polyline' },
            { items: this.#labelCollection, name: 'label' },
            { items: this.#polygonCollection, name: 'polygon' }
        ];

        collections.forEach(({ items }) => {
            for (const item of items) {
                removeOverlay(item);
            }
            items.length = 0;
        });
    }


    /******************
     * HELPER METHODS *
     ******************/
    /**
     * Converts viewport coordinates to map container relative coordinates.
     * @param {MouseEvent} domEvent - The DOM mouse event
     * @returns {{x: number, y: number}} Container-relative coordinates
     * @private
     */
    _getContainerRelativeCoords(domEvent) {
        if (!domEvent) return { x: NaN, y: NaN };

        // Get the map container element
        const container = this.container;
        if (!container) return { x: NaN, y: NaN };

        // Get the bounding rectangle of the map container
        const rect = container.getBoundingClientRect();
        if (!rect || rect.width <= 10) return { x: NaN, y: NaN };

        return {
            x: domEvent.clientX - rect.left,
            y: domEvent.clientY - rect.top
        };
    }
}

customElements.define("google-measure", GoogleMeasure);
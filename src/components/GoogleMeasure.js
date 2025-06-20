// import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPolyline,
    createPolygon,
    createLabelMarker,
    removeOverlay,
    areCoordinatesEqual
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
            if (!point) return null;

            // Highlight event listeners
            if (this.highlightHandler) {
                point.addListener('mouseover', () => {
                    this.highlightHandler.applyHoverHighlight(point);
                });
                point.addListener('mouseout', () => {
                    // highlightHandler's removeHoverHighlight should know which object was hovered
                    this.highlightHandler.removeHoverHighlight();
                });
                // Optional: Add click listener for selection highlighting
                // point.addListener('click', (event) => {
                //     // Prevent click from propagating if it's part of a drag
                //     // This check might be more robust if done within the highlightHandler or mode
                //     if (event.domEvent && (event.domEvent.button !== 0 || event.domEvent.metaKey || event.domEvent.ctrlKey)) {
                //         return;
                //     }
                //     // Assuming toggleSelectHighlight or similar method exists
                //     if (typeof this.highlightHandler.toggleSelectHighlight === 'function') {
                //         this.highlightHandler.toggleSelectHighlight(point, event);
                //     } else if (typeof this.highlightHandler.handleClickToSelect === 'function') {
                //         // If your method is named handleClickToSelect and needs eventData
                //         const latLng = event.latLng;
                //         const pixel = event.pixel;
                //         const eventData = {
                //             mapPoint: latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null,
                //             screenPoint: pixel ? { x: pixel.x, y: pixel.y } : { x: NaN, y: NaN },
                //             domEvent: event.domEvent,
                //             graphic: point // Pass the graphic itself
                //         };
                //         this.highlightHandler.handleClickToSelect(eventData);
                //     }
                // });
            }

            // Attach listeners if provided
            if (listeners && typeof listeners === 'object') {
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
            this.#pointCollection.push(point);

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
        try {
            // Separate listeners from other polyline options        
            const { listeners, ...markerOptions } = options;

            // Create the polyline
            const polyline = createPolyline(this.map, positions, markerOptions);
            if (!polyline) return null;

            // Highlight event listeners
            if (this.highlightHandler) {
                polyline.addListener('mouseover', () => {
                    this.highlightHandler.applyHoverHighlight(polyline);
                });
                polyline.addListener('mouseout', () => {
                    // highlightHandler's removeHoverHighlight should know which object was hovered
                    this.highlightHandler.removeHoverHighlight();
                });
            }

            // Attach listeners if provided
            if (polyline && listeners && typeof listeners === 'object') {
                for (const eventName in listeners) {
                    if (typeof listeners[eventName] === 'function') {
                        // Use addListener for robust event handling on markers/overlays
                        polyline.addListener(eventName, (event) => {
                            // const latLng = event.latLng;
                            // const pixel = event.pixel; // Note: pixel coords might not always be available depending on event/context

                            const eventData = {
                                //     mapPoint: latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null,
                                //     screenPoint: pixel ? { x: pixel.x, y: pixel.y } : { x: NaN, y: NaN }, // Provide fallback
                                domEvent: event.domEvent // Pass original DOM event - CRUCIAL for button check
                            };
                            // Pass the marker itself and the event object to the callback
                            listeners[eventName](polyline, eventData);
                        });
                    }
                }
            }

            // Store the polyline in the collection
            polyline && this.#polylineCollection.push(polyline);

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
        if (!this.map || !Array.isArray(positions) || positions.length === 1) return null;

        const {
            status = null,
            ...rest
        } = options;

        // Create the label
        const label = createLabelMarker(this.map, positions, value, unit, { ...rest });
        if (!label) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            label.addListener('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(label);
            });
            label.addListener('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

        // -- Handle metadata --
        label.status = status;

        // Store the label in the collection
        this.#labelCollection.push(label);

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

        // Create the polygon
        const polygon = createPolygon(this.map, positions, options);
        if (!polygon) return null;

        // Highlight event listeners
        if (this.highlightHandler) {
            polygon.addListener('mouseover', () => {
                this.highlightHandler.applyHoverHighlight(polygon);
            });
            polygon.addListener('mouseout', () => {
                // highlightHandler's removeHoverHighlight should know which object was hovered
                this.highlightHandler.removeHoverHighlight();
            });
        }

        // Store the polygon in the collection
        polygon && this.#polygonCollection.push(polygon);

        return polygon;
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
        for (const marker of this.#pointCollection) {
            // Check the custom 'positions' property
            if (
                marker &&
                Array.isArray(marker.positions) &&
                marker.positions.some(p => areCoordinatesEqual(p, position))
            ) {
                foundPointMarker = marker;
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
            const matchingLines = this.#polylineCollection.filter(polyline =>
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
            const matchingLine = this.#polylineCollection.find(polyline => {
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
     * @returns {google.maps.Marker[] | null} - An array of matching label primitives if found, otherwise null.
     */
    _getLabelByPosition(positions) {
        if (!Array.isArray(this.#labelCollection) || (!positions)) return null;

        const foundLabels = [];
        for (const label of this.#labelCollection) {
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
            return marker && marker.id && marker.id.includes(measureId);
        });
        // Find related polygons
        relatedOverlays.polygons = this.#polygonCollection.filter(polygon => {
            // Check if the polygon has a 'measureId' property and matches the provided measureId
            return polygon && polygon.id && polygon.id.includes(measureId);
        });
        // Find related polylines
        relatedOverlays.polylines = this.#polylineCollection.filter(polyline => {
            // Check if the polyline has a 'measureId' property and matches the provided measureId
            return polyline && polyline.id && polyline.id.includes(measureId);
        });

        // Find related labels
        relatedOverlays.labels = this.#labelCollection.filter(label => {
            // Check if the label has a 'measureId' property and matches the provided measureId
            return label && label.id && label.id.includes(measureId);
        });

        return relatedOverlays;
    }


    /******************
     * REMOVE FEATURE *
     ******************/
    /**
     * Removes a point marker from the map.
     * @param {AdvancedMarkerElement|Marker} marker 
     */
    _removePointMarker(marker) {
        // remove the overlay from the map
        removeOverlay(marker);

        // FIXME: remove the listeners from the marker
        if (marker && marker.listeners) {
            for (const eventName in marker.listeners) {
                marker.removeListener(eventName, marker.listeners[eventName]);
            }
        }

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
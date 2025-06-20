// This is the cesium measure web component that will be used in the MapCesium component.
import {
    BlendOption,
} from "cesium";

import { createPointPrimitive, createPolylinePrimitive, createLabelPrimitive, createPolygonPrimitive, convertToCartographicRadians, convertToCartographicDegrees, checkCoordinateType, createPolygonOutlinePrimitive, createGroundPolylinePrimitive, areCoordinatesEqual } from "../lib/helper/cesiumHelper.js";
// import { LogTable } from './shared/LogTable.js';
// import { HelpTable } from './shared/HelpTable.js';
import { MeasureComponentBase } from "./MeasureComponentBase.js";


/**@typedef {import('cesium').Cartesian3} Cartesian3 - the x,y,z coordinate that used in cesium map*/
/**@typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection - the collection of point primitives in cesium map*/
/**@typedef {import('cesium').LabelCollection} LabelCollection - the collection of label primitives in cesium map*/
/**@typedef {import('cesium').Primitive} Primitive - the primitive object in cesium map*/
/**@typedef {import('cesium').PointPrimitive} PointPrimitive - the point primitive object in cesium map*/
/**@typedef {import('cesium').LabelPrimitive} LabelPrimitive - the label primitive object in cesium map*/



/**
 * CesiumMeasure class to provide measurement drawing functionalities in Cesium.
 * Overrides methods from MeasureComponentBase to implement Cesium-specific features.
 * @extends {MeasureComponentBase}
 */
export default class CesiumMeasure extends MeasureComponentBase {
    // --- Private Fields ---
    /** @type {PointPrimitiveCollection | null} */
    #pointCollection = null;
    /** @type {LabelCollection | null} */
    #labelCollection = null;
    /** @type {Primitive[]} */
    #polylineCollection = [];
    /** @type {Primitive[]} */
    #polygonCollection = [];

    constructor() {
        super();
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

    _initializeMapSpecifics() {
        // Initialize Cesium-specific setup
        // setup cesium collection
        this._initializeCesiumCollections();

        // setup moving dot with mouse
        this._setupPointerOverlay();
    }
    /**
     * Initializes Cesium collections for point and label primitives for cesium specific.
     */
    _initializeCesiumCollections() {
        // Use _cesiumPkg (assuming it's set by the base or externally)
        if (!this.cesiumPkg || !this.map || this.mapName !== "cesium") return;

        // if collections are already initialized, do nothing
        if (this.#pointCollection || this.#labelCollection) return;

        // Create new collections using the provided Cesium package
        const pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        const labelCollection = new this.cesiumPkg.LabelCollection();
        pointCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        labelCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        pointCollection.id = "annotate_point_collection";
        labelCollection.id = "annotate_label_collection";

        // Assign to private fields
        this.#pointCollection = this.map.scene.primitives.add(pointCollection);
        this.#labelCollection = this.map.scene.primitives.add(labelCollection);
    }

    /**
     * Setup the moving yellow dot to show the mouse pointer position
     */
    _setupPointerOverlay() {
        if (!this.stateManager) {
            console.warn("CesiumMeasure: StateManager not available for _setupPointerOverlay.");
            return;
        }

        const pointer = document.createElement("div");
        pointer.className = "backdrop";
        pointer.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.map.container.appendChild(pointer);
        this.stateManager.setOverlayState("pointer", pointer);
    }

    /**
     * Adds a point marker to the map at the specified position.
     * @param {Cartesian3} position - The position where the marker will be added
     * @param {object} options - Options for the point primitive
     * @returns {PointPrimitive} The created point primitive or null if an error occurs.
     */
    _addPointMarker(position, options = {}) {
        // -- Validate dependencies --
        if (!this.#pointCollection) {
            console.warn("CesiumMeasure: Point collection not available for _addPointMarker.");
            return null; // Ensure collection is initialized
        }

        // Default options
        const {
            status = null
        } = options;

        // -- Handle position --
        // Get the point position, use clamp position if height is 0
        const noHeight = position.height === 0;
        const pointPosition = noHeight ? this._getClampedPositions([position])[0] : position;
        if (!pointPosition) return null; // Clamping might fail

        // -- Handle visualization --
        // Create the point primitive
        const point = createPointPrimitive(pointPosition, options);
        if (!point) return null;

        // Add to private collection - will add to the cesium map
        const pointPrimitive = this.#pointCollection.add(point);

        // -- Handle metadata --
        pointPrimitive.status = status; // Store status
        pointPrimitive.positions = [{ ...position }]; // Store cloned position

        return pointPrimitive;
    };

    /**
     * Adds multiple point markers to the map at the specified positions.
     * @param {Cartesian3[]} positions - Array of positions where the markers will be added
     * @param {object} options - Options for the point primitives
     * @returns {PointPrimitive[]} An array of the created point primitives (may contain nulls if some failed).
     */
    _addPointMarkersFromArray(positions, options = {}) {
        if (!this.#pointCollection) {
            console.warn("CesiumMeasure: Point collection not available for _addPointMarkersFromArray.");
            return []; // Return empty array if collection not ready
        }
        if (!Array.isArray(positions) || positions.length === 0) {
            console.warn("CesiumMeasure: Invalid or empty positions array for _addPointMarkersFromArray.");
            return []; // Return empty array for invalid input
        }

        // --- Refactored Logic ---
        // Iterate through each position and use the single point adder method
        const pointPrimitives = positions.map(position => {
            // Pass the original position and options to the single marker function
            // _addPointMarker handles clamping internally if needed (though less efficient in a loop)
            return this._addPointMarker(position, options);
        });

        // Filter out any null results if creation failed for some points
        return pointPrimitives.filter(Boolean);
    };

    /**
     * Adds a polyline to the map at the specified positions.
     * @param {Cartesian3[]} positions 
     * @param {object} options - Options for the polyline primitive
     * @returns {Primitive} The created polyline primitive or null if an error occurs.
     */
    _addPolyline(positions, options = {}) {
        // -- Validate dependencies --
        if (!this.cesiumPkg || !this.map) {
            console.warn("CesiumMeasure: Cesium package or map not available for _addPolyline.");
            return null; // Ensure dependencies are available
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Handle position --
        // Get the line positions, use clamp position if height is 0
        const noHeight = positions.some(pos => pos.height === 0);
        const linePositions = noHeight ? this._getClampedPositions(positions) : positions;
        if (!linePositions || linePositions.length < 2) return null; // Need at least 2 points

        // -- Handle visualization --
        // Create the polyline primitive
        const polyline = createPolylinePrimitive(this.cesiumPkg.Primitive, linePositions, options);
        if (!polyline) return null;
        // Add line to to cesium map
        const polylinePrimitive = this.map.scene.primitives.add(polyline);

        // Add to private collection - will not affect visualization, store for reference only
        this.#polylineCollection.push(polylinePrimitive);

        // -- Handle metadata --
        polylinePrimitive.status = status; // Store status

        return polylinePrimitive;
    };


    /**
     * Adds multiple polylines to the map at the specified positions.
     * @param {Cartesian3[]} positions - Array of positions where the polyline will be added
     * @param {object} options - Options for the polyline primitives
     * @returns {Primitive[]} The created polyline primitives or null if an error occurs.
     */
    _addPolylinesFromArray(positions, options = {}) {
        if (!this.cesiumPkg || !this.map || !this.stateManager) return null; // Ensure dependencies are available
        console.log('positions', positions)

        // Get the line positions, use clamp position if height is 0
        const noHeight = positions.some(pos => pos.height === 0);
        const linePositions = noHeight ? this._getClampedPositions(positions) : positions;
        if (!linePositions || linePositions.length < 2) return null;

        // Create the polyline primitives
        const addedPolylines = [];
        // Iterate through the positions array, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the polyline
            const polyline = this._addPolyline(positionsPair, options);
            polyline && addedPolylines.push(polyline);
        }

        return addedPolylines; // Return the array of successfully added polylines
    };

    /**
     * Adds a ground polyline to the map at the specified positions.
     * @param {Cartesian3[]} positions 
     * @param {object} options - Options for the polyline primitive
     * @returns {Primitive} The created polyline primitive or null if an error occurs.
     */
    _addGroundPolyline(positions, options = {}) {
        // -- Validate dependencies --
        if (!this.cesiumPkg || !this.map) {
            console.warn("CesiumMeasure: Cesium package or map not available for _addPolyline.");
            return null; // Ensure dependencies are available
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Handle visualization --
        // Create the polyline primitive
        const polyline = createGroundPolylinePrimitive(this.cesiumPkg.GroundPolylinePrimitive, positions, options);
        if (!polyline) return null;
        // Add line to to cesium map
        const polylinePrimitive = this.map.scene.primitives.add(polyline);

        // Add to private collection - will not affect visualization, store for reference only
        this.#polylineCollection.push(polylinePrimitive);

        // -- Handle metadata --
        polylinePrimitive.status = status; // Store status

        return polylinePrimitive;
    };

    /**
     * Adds a label marker to the map at the specified position.
     * @param {Cartesian3[]} positions 
     * @param {string|number} value - The value to display on the label marker
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} options - Options for the label primitive
     * @returns {LabelPrimitive} The created label primitive or null if an error occurs.
     */
    _addLabel(positions, value, unit, options = {}) {
        // -- Validate dependencies --
        if (!this.#labelCollection || !Array.isArray(positions) || positions.length === 0) {
            console.error("Invalid positions array or empty array");
            return null;
        }

        // Default options
        const {
            status = null,
        } = options

        // -- Handle position --
        // Get the label positions, use clamp position if height is 0
        const noHeight = positions.some(pos => pos.height === 0);
        const labelPositions = noHeight ? this._getClampedPositions(positions) : positions;
        if (!labelPositions || labelPositions.length === 0) return null;

        // -- Handle visualization --
        // Create the label primitive
        const label = createLabelPrimitive(labelPositions, value, unit, options);
        if (!label) return null;

        // Add to private collection
        const labelPrimitive = this.#labelCollection.add(label);

        // -- Handle metadata --
        labelPrimitive.status = status; // Store status
        labelPrimitive.positions = positions.map(pos => ({ ...pos })); // Store cloned position

        return labelPrimitive;
    };

    /**
     * Adds multiple label markers to the map at the specified positions.
     * @param {Cartesian3[]} positions 
     * @param {string[]|number[]} valueArray 
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} options - Options for the label primitives
     * @returns {LabelPrimitive[]|[]} The created label primitives.
     */
    _addLabelsFromArray(positions, valueArray, unit, options = {}) {
        if (!this.#labelCollection ||
            !Array.isArray(positions) ||
            positions.length === 0 ||
            !Array.isArray(valueArray) ||
            valueArray.length === 0
        ) return [];

        // Get the label positions, use clamp position if height is 0
        const noHeight = positions.some(pos => pos.height === 0);
        const labelPositions = noHeight ? this._getClampedPositions(positions) : positions;
        if (!labelPositions || labelPositions.length === 0) return [];

        // Create the label primitives
        const addedLabels = [];
        // Iterate through the positions array, 2 positions as a pair
        for (let i = 0; i < positions.length - 1; i++) {
            const positionsPair = positions.slice(i, i + 2); // Get two positions for the label
            const label = this._addLabel(positionsPair, valueArray[i], unit, options);
            label && addedLabels.push(label);
        }

        return addedLabels; // Return the array of successfully added labels
    };

    /**
     * Adds a polygon to the map at the specified positions.
     * @param {Cartesian3[]} positions - Array of positions where the polygon will be added
     * @param {object} options - Options for the polygon primitive 
     * @returns {Primitive | null} The created polygon primitive or null if an error occurs.
     */
    _addPolygon(positions, options = {}) {
        // -- Validate dependencies --
        if (!Array.isArray(positions) || positions.length < 3) {
            console.warn("CesiumMeasure: Invalid positions array for polygon.");
            return null; // Need at least 3 points
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Handle position --
        // Check the coordinate type
        const coordType = checkCoordinateType(positions[0]); // Assuming positions array value is consistent

        let polygonPositions;
        // Set polygonPositions based on coordinate type
        if (coordType === "cartographicDegrees") {    // Case1: from sync draw
            // Get the polygon positions, use clamp position if height is 0
            const noHeight = positions.some(pos => pos.height === 0);
            polygonPositions = noHeight ? this._getClampedPositions(positions) : positions;
        } else if (coordType === "cartesian3") {   // Case2: from annotation tool
            polygonPositions = positions;
        } else {
            console.warn("CesiumMeasure: Invalid coordinate type for polygon positions.");
            return null;
        }

        // Validate the polygon positions
        if (!polygonPositions || polygonPositions.length < 3) return null; // Need at least 3 points

        // -- Handle visualization --
        // Create the polygon primitive
        const polygon = createPolygonPrimitive(this.cesiumPkg.Primitive, polygonPositions, options);
        if (!polygon) return null;  // Ensure polygon is created successfully

        // Add the polygon primitive to the map
        const polygonPrimitive = this.map.scene.primitives.add(polygon);

        // Add to private collection
        this.#polygonCollection.push(polygonPrimitive);

        // -- Handle metadata --
        polygonPrimitive.status = status; // Add status property

        return polygonPrimitive;
    };

    /**
     * Adds a polygon outline to the map at the specified positions.
     * @param {Cartesian3[]} positions - Array of positions where the polygon outline will be added
     * @param {object} options - Options for the polygon outline primitive
     * @returns {Primitive | null} The created polygon outline primitive or null if an error occurs.
     */
    _addPolygonOutline(positions, options = {}) {
        // -- Validate dependencies --
        if (!Array.isArray(positions) || positions.length < 3) {
            console.warn("CesiumMeasure: Invalid positions array for polygon outline.");
            return null; // Need at least 3 points
        }

        // Default options
        const {
            status = null,
        } = options;

        // -- Handle position --
        const coordType = checkCoordinateType(positions[0]); // Assuming positions array value is consistent

        let polygonPositions;
        // Set polygonPositions based on coordinate type
        if (coordType === "cartographicDegrees") {    // Case1: from sync draw
            // Get the polygon positions, use clamp position if height is 0
            const noHeight = positions.some(pos => pos.height === 0);
            polygonPositions = noHeight ? this._getClampedPositions(positions) : positions;
        } else if (coordType === "cartesian3") {   // Case2: from annotation tool
            polygonPositions = positions;
        } else {
            console.warn("CesiumMeasure: Invalid coordinate type for polygon positions.");
            return null;
        }
        polygonPositions = positions;
        // Validate the polygon positions
        if (!polygonPositions || polygonPositions.length < 3) return null; // Need at least 3 points

        // -- Handle visualization --
        // Create the polygon primitive
        const polygonOutline = createPolygonOutlinePrimitive(this.cesiumPkg.Primitive, polygonPositions, options);
        if (!polygonOutline) return null;  // Ensure polygon is created successfully

        // Add the polygon primitive to the map
        const polygonOutlinePrimitive = this.map.scene.primitives.add(polygonOutline);

        // Add to private collection - shared with polygon primitive
        this.#polygonCollection.push(polygonOutlinePrimitive);

        // -- Handle metadata --
        polygonOutlinePrimitive.status = status; // Store status

        return polygonOutlinePrimitive;
    };

    /*****************
     * FIND GRAPHICS *
     *****************/
    /**
     * Finds a point primitive by its position in the point collection.
     * @param {Cartesian3} position - The position to find the point primitive 
     * @returns {PointPrimitive | null} - The point primitive if found, otherwise null
     */
    _getPointByPosition(position) {
        if (!this.#polylineCollection || !position) return null;

        let foundPoint = null
        const pointsLength = this.#pointCollection.length;
        for (let i = 0; i < pointsLength; i++) {
            const point = this.#pointCollection.get(i);
            if (point && areCoordinatesEqual(point.position, position)) {
                foundPoint = point;
                break;
            }
        }
        return foundPoint || null; // Return the found point or null if not found
    }

    /**
     * Finds a polyline primitive by its positions in the polyline collection.
     * Find lines exact match for two points, or line for any match for one point.
     * @param {Cartesian3[]} positions - The positions to find the polyline primitive
     * @returns {Primitive[] | null} - The polyline primitive if found, otherwise null
     */
    _getLineByPositions(positions) {
        if (!this.#polylineCollection || !positions || positions.length === 0) return null;

        const foundLine = [];

        // Case1: the positions is one point, find the lines that has some position matched
        if (positions.length === 1) {
            const targetPosition = positions[0];
            const matchingLines = this.#polylineCollection.filter(polyline =>
                polyline.positions && polyline.positions.some(pos => areCoordinatesEqual(pos, targetPosition))
            );
            if (matchingLines.length > 0) {
                foundLine.push(...matchingLines);
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
                foundLine.push(matchingLine); // Add the single found primitive to the array
            }
        }

        // Return the array of found primitives if any were found, otherwise return null.
        return foundLine.length > 0 ? foundLine : null;
    }

    /**
     * Finds label primitives by their associated position(s).
     * If `positions` is a single Cartesian3, it matches `label.position`.
     * If `positions` is an array of 1 Cartesian3, it matches any label where `label.positions` contains that point.
     * If `positions` is an array of 2 Cartesian3s, it matches any label where `label.positions` exactly matches those two points in order.
     * @param {Cartesian3 | Cartesian3[]} positions - The Cartesian3 position or an array of Cartesian3 positions to find the label primitive(s).
     * @returns {Label[] | null} - An array of matching label primitives if found, otherwise null.
     */
    _getLabelByPosition(positions) {
        if (!this.#labelCollection || !positions) return null;

        const foundLabels = []; // Changed variable name for clarity

        const isArrayPosition = Array.isArray(positions);
        const labelsLength = this.#labelCollection.length;

        for (let i = 0; i < labelsLength; i++) {
            const label = this.#labelCollection.get(i);
            if (!label) continue; // Skip if label is somehow null

            if (isArrayPosition) {
                // Ensure label.positions exists and is an array before trying to access it
                if (!label.positions || !Array.isArray(label.positions)) continue;

                // Case 1: Input `positions` is an array of one point.
                // Find labels where `label.positions` contains this point.
                if (positions.length === 1) {
                    if (label.positions.some(pos => areCoordinatesEqual(pos, positions[0]))) {
                        foundLabels.push(label);
                    }
                }
                // Case 2: Input `positions` is an array of two points.
                // Find labels where `label.positions` exactly matches these two points in order.
                else if (positions.length === 2) {
                    const pos1 = positions[0];
                    const pos2 = positions[1];

                    // Ensure label.positions has at least two points for comparison
                    if (label.positions.length === 2 &&
                        areCoordinatesEqual(label.positions[0], pos1) &&
                        areCoordinatesEqual(label.positions[1], pos2)
                    ) {
                        foundLabels.push(label);
                        break; // If you only want the first match, break here
                    }
                }
            } else {
                // Case 3: Input `positions` is a single Cartesian3 object.
                // Match against `label.position` (singular).
                if (label.position && areCoordinatesEqual(label.position, positions)) {
                    foundLabels.push(label);
                    break; // If you only want the first match, break here
                }
            }
        }

        // Return the array of found labels if any were found, otherwise return null.
        return foundLabels;
    }

    _getRelatedPrimitivesByMeasureId(measureId) {
        if (!measureId) return null;
        // convert measureId to string if it is not
        if (typeof measureId !== "string") {
            measureId = String(measureId);
        }

        const relatedPrimitives = {
            pointPrimitives: [],
            labelPrimitives: [],
            polylinePrimitives: [],
            polygonPrimitives: []
        };

        // Find related point primitives
        const pointsLength = this.#pointCollection.length;
        for (let i = 0; i < pointsLength; i++) {
            const point = this.#pointCollection.get(i);
            if (!point) continue; // Skip if point is somehow null
            if (point.id && point.id.includes(measureId)) {
                relatedPrimitives.pointPrimitives.push(point);
            }
        }

        // Find related label primitives
        const labelsLength = this.#labelCollection.length;
        for (let i = 0; i < labelsLength; i++) {
            const label = this.#labelCollection.get(i);
            if (!label) continue; // Skip if label is somehow null
            if (label.id && label.id.includes(measureId)) {
                relatedPrimitives.labelPrimitives.push(label);
            }
        }

        // Find related polyline primitives
        relatedPrimitives.polylinePrimitives = this.#polylineCollection.filter(polyline => polyline.id.includes(measureId));

        // Find related polygon primitives
        relatedPrimitives.polygonPrimitives = this.#polygonCollection.filter(polygon => polygon.id.includes(measureId));

        return relatedPrimitives;
    }

    /******************
     * REMOVE FEATURE *
     ******************/
    /**
     * Removes a point marker from its point collection.
     * @param {PointPrimitive} pointPrimitive - The point primitive to remove
     */
    _removePointMarker(pointPrimitive) {
        if (!this.#pointCollection) return false;

        this.#pointCollection.remove(pointPrimitive);
    };

    /**
     * Removes a label from its label collection.
     * @param {LabelPrimitive} labelPrimitive - The label primitive to remove
     */
    _removeLabel(labelPrimitive) {
        if (!this.#labelCollection) return false;

        this.#labelCollection.remove(labelPrimitive);
    };
    /**
     * Removes a polyline from the map.
     * @param {Primitive} polyline 
     */
    _removePolyline(polyline) {
        if (!this.#polylineCollection) return false;

        // Remove the polyline primitive from the map
        this._removePrimitive(polyline);

        // Remove from the polyline collection
        const index = this.#polylineCollection.indexOf(polyline);
        if (index > -1) {
            this.#polylineCollection.splice(index, 1);
        }
    };

    /**
     * Removes a polygon from the map.
     * @param {Primitive} polygon - The polygon primitive to remove
     */
    _removePolygon(polygon) {
        if (!this.#polygonCollection) return false;

        // Remove the polygon primitive from the map
        this._removePrimitive(polygon);

        // Remove from the polygon collection
        const index = this.#polygonCollection.indexOf(polygon);
        if (index > -1) {
            this.#polygonCollection.splice(index, 1);
        }
    };

    /**
     * Removes a primitive from the map.
     * @param {Primitive} primitive 
     */
    _removePrimitive(primitive) {
        // Validate dependencies
        if (!this.map || !primitive) return false;
        // Remove the primitive from the map
        this.map.scene.primitives.remove(primitive);
    };

    /**
     * Clamps positions to the ground and converts them to Cartographic degrees.
     * @param {Cesium.Cartesian3[] | Cesium.Cartographic[]} positions 
     * @returns {Cesium.Cartographic[]} clamped positions in degrees
     */
    _getClampedPositions(positions) {
        const clampedPositions = positions.map(pos => {
            // Convert to cartographic radians
            const cartographic = convertToCartographicRadians(pos);
            if (!cartographic) return null;

            // Get ground height
            const height = this.map.scene.sampleHeight(cartographic) || 0;

            // Convert to cartographic degrees
            const cartographicDegrees = convertToCartographicDegrees(pos);
            // Set the height to the ground height
            cartographicDegrees.height = height;
            return cartographicDegrees;
        }).filter(Boolean); // Filter out null values

        return clampedPositions;
    };

    clearCollections() {
        // Clear point collection
        if (this.#pointCollection) {
            this.#pointCollection.removeAll();
        }

        // Clear label collection
        if (this.#labelCollection) {
            this.#labelCollection.removeAll();
        }

        // Clear polyline collection
        this.#polylineCollection.forEach(polyline => this._removePrimitive(polyline));
        this.#polylineCollection = [];

        // Clear polygon collection
        this.#polygonCollection.forEach(polygon => this._removePrimitive(polygon));
        this.#polygonCollection = [];
    }
}

customElements.define("cesium-measure", CesiumMeasure);
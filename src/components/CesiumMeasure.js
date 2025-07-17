// This is the cesium measure web component that will be used in the MapCesium component.
import {
    BlendOption,
    SceneTransforms,
    defined,
    Entity,
    Cesium3DTileFeature,
    Cartesian3,
} from "cesium";

import { createPointPrimitive, createPolylinePrimitive, createLabelPrimitive, createPolygonPrimitive, convertToCartographicRadians, convertToCartographicDegrees, checkCoordinateType, createPolygonOutlinePrimitive, createGroundPolylinePrimitive, areCoordinatesEqual, createPointerOverlay, convertToCartesian3 } from "../lib/helper/cesiumHelper.js";
// import { LogTable } from './shared/LogTable.js';
// import { HelpTable } from './shared/HelpTable.js';
import { MeasureComponentBase } from "./MeasureComponentBase.js";
import { capitalizeString, deconstructIdForMetadata } from "../lib/helper/helper.js";


/**@typedef {import('cesium').Cartesian3} Cartesian3 - the x,y,z coordinate that used in cesium map*/
/**@typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection - the collection of point primitives in cesium map*/
/**@typedef {import('cesium').LabelCollection} LabelCollection - the collection of label primitives in cesium map*/
/**@typedef {import('cesium').Primitive} Primitive - the primitive object in cesium map*/
/**@typedef {import('cesium').PointPrimitive} PointPrimitive - the point primitive object in cesium map*/
/**@typedef {import('cesium').LabelPrimitive} LabelPrimitive - the label primitive object in cesium map*/

/**@typedef {{latitude: number, longitude: number, height?: number}} CartographicDegrees - CartographicDegrees */

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

    /** @type {Entity|null} */
    #selectedEntity = null;

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
        // const pointer = createPointerOverlay(this.map.container);
        // this.stateManager.setOverlayState("pointer", pointer);

        // TODO: pick object to display data in the info table
    }


    /*********************
     * GRAPHICS FEATURES *
     *********************/
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
        pointCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        pointCollection.id = "annotate_point_collection";
        const labelCollection = new this.cesiumPkg.LabelCollection();
        labelCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        labelCollection.id = "annotate_label_collection";

        // Assign to private fields
        this.#pointCollection = this.map.scene.primitives.add(pointCollection);
        this.#labelCollection = this.map.scene.primitives.add(labelCollection);
    }


    /*************************
     * ADD GRAPHICS FEATURES *
     *************************/
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
            status = null,
            id = null,
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(pointPrimitive);

        // Store metadata in the primitive
        pointPrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status,
                positions: [{ ...position }],
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

        return pointPrimitive;
    };

    /**
     * Enhances Cesium primitive prototypes with custom getters and setters for easier metadata access.
     * This is done once to ensure all created primitives have a consistent API.
     * @private
     */
    _enhancePrimitivePrototypes(primitive) {
        // Get the actual prototype of the instance
        const prototype = Object.getPrototypeOf(primitive);

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
            id = null, // id is used to store metadata
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(polylinePrimitive);

        // Store metadata in the primitive
        polylinePrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status: status,
                positions: linePositions.map(pos => Cartesian3.clone(convertToCartesian3(pos))),
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        }

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
            id = null,
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(polylinePrimitive);

        // Store metadata in the primitive
        polylinePrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status: status,
                positions: positions.map(pos => Cartesian3.clone(convertToCartesian3(pos))),
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };

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
            id = null, // id is used to store metadata
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(labelPrimitive);

        // Store metadata in the primitive
        labelPrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status: status,
                positions: labelPositions.map(pos => Cartesian3.clone(convertToCartesian3(pos))),
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        };
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
            id = null,
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(polygonPrimitive);

        // Store metadata in the primitive
        polygonPrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status: status,
                positions: polygonPositions.map(pos => Cartesian3.clone(convertToCartesian3(pos))),
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        }

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
            id = null,
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
        // Enhance primitive prototype for metadata retrieval
        this._enhancePrimitivePrototypes(polygonOutlinePrimitive);

        // Store metadata in the primitive
        polygonOutlinePrimitive.feature = {
            id,
            type: "annotation",
            properties: {
                mapName: this.mapName,
                status: status,
                positions: polygonPositions.map(pos => Cartesian3.clone(convertToCartesian3(pos))),
                ...(id && deconstructIdForMetadata(id)), // deconstruct id for metadata
            }
        }
        return polygonOutlinePrimitive;
    };



    /**************************
     * FIND GRAPHICS FEATURES *
     **************************/
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
            const matchingLines = this.#polylineCollection.filter(polyline => {
                const { positions: polylinePositions } = polyline.feature.properties;
                return polylinePositions && polylinePositions.some(pos => areCoordinatesEqual(pos, targetPosition))
            });
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
                const { positions: polylinePositions } = polyline.feature.properties;

                // Check if the polyline has exactly two positions
                if (polylinePositions && polylinePositions.length === 2) {
                    // Compare the positions of the polyline with the provided positions
                    return areCoordinatesEqual(polylinePositions[0], pos1) &&
                        areCoordinatesEqual(polylinePositions[1], pos2);
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
                const labelPositions = label?.feature?.properties?.positions;
                // Ensure label.positions exists and is an array before trying to access it
                if (!labelPositions || !Array.isArray(labelPositions) || labelPositions.length === 0) continue;

                // Case 1: Input `positions` is an array of one point.
                // Find labels where `label.positions` contains this point.
                if (positions.length === 1) {
                    if (labelPositions.some(pos => areCoordinatesEqual(pos, positions[0]))) {
                        foundLabels.push(label);
                    }
                }
                // Case 2: Input `positions` is an array of two points.
                // Find labels where `label.positions` exactly matches these two points in order.
                else if (positions.length === 2) {
                    const pos1 = positions[0];
                    const pos2 = positions[1];

                    // Ensure label.positions has at least two points for comparison
                    if (labelPositions.length === 2 &&
                        areCoordinatesEqual(labelPositions[0], pos1) &&
                        areCoordinatesEqual(labelPositions[1], pos2)
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

        // Remove from the polyline collection
        const index = this.#polylineCollection.indexOf(polyline);

        // Remove the polyline primitive from the map
        this._removePrimitive(polyline);

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


    /****************************************
     * DISPLAY INFO TABLE FOR PICKED OBJECT *
     ****************************************/
    _pickedObjectDisplayData(event) {
        console.log("🚀 event:", event);

        // -- Validate dependencies --
        if (!event) return;

        // -- Picked Object --
        const pickedObjects = event.pickedFeature;
        if (pickedObjects.length === 0) return;

        const [pickedObject] = pickedObjects;
        if (!defined(pickedObject) || pickedObject instanceof Cesium3DTileFeature) return;

        const { primitive } = pickedObject;
        if (!primitive) return;

        // -- Show the info table for the picked object --
        this._showInfoTable(primitive);
    }

    _showInfoTable(primitive) {
        // -- Create the description data --
        const descriptionData = this._createDescriptionData(primitive); // handle the primitive data
        if (!descriptionData) return;

        // -- Set the selected entity and create description -- 
        const { id } = primitive;
        const title = descriptionData["Annotate Type"] ?
            `${capitalizeString(descriptionData["Annotate Type"])} Details` : "Unknown Details";
        const selectedEntity = new Entity({
            id: id || null,
            name: title,
            description: this._createPickedObjectDescription(descriptionData)
        });

        // Store reference for cleanup
        this.#selectedEntity = selectedEntity;

        // This assigns the entity to Cesium's selection system
        this.map.selectedEntity = selectedEntity;
    }

    _createDescriptionData(primitive) {
        if (!primitive || !primitive.feature || !primitive.feature.properties) return null;

        const { id } = primitive;
        if (!id) return null; // Ensure id exists

        const { positions, status } = primitive.feature.properties;

        const [annotation, annotate_mode, annotate_type, measureId] = id.split("_");
        const descriptionData = {
            "ID": id,
            "Annotate Mode": annotate_mode,
            "Annotate Type": annotate_type || "N/A",
            "Measure ID": measureId || "N/A",
            "Status": status || "N/A"
        };
        // handle positions
        if (positions.length > 0) {
            const flatPositions = positions.flat();
            flatPositions.forEach((pos, index) => {
                const cartographicDegrees = convertToCartographicDegrees(pos);
                Object.entries(cartographicDegrees).forEach(([key, value]) => {
                    descriptionData[`Pos ${index + 1} ${key}`] = JSON.stringify(value);
                });
            });
        }
        return descriptionData;
    }

    _createPickedObjectDescription(descriptionData) {
        let description = `${'<table class="cesium-infoBox-defaultTable"><tbody>'}`;
        for (const [propertyId, propertyValue] of Object.entries(descriptionData)) {
            description += `<tr><th>${propertyId}</th><td>${propertyValue}</td></tr>`;
        }
        description += `</tbody></table>`;
        return description;
    }


    /*****************
     * RESET FEATURE *
     *****************/
    /**
     * Clear graphics only in the collection
     * It will not reset the collection variables within cesium, so that the collection can be reused.
     * @returns {void}
     */
    clearCollections() {
        // Clear point collection
        if (this.#pointCollection) {
            this.#pointCollection.removeAll();
        }

        // Clear label collection
        if (this.#labelCollection) {
            this.#labelCollection.removeAll();
        }

        // Clear polyline and polygon collections
        const primitiveCollections = [
            { collection: this.#polylineCollection, name: 'polyline' },
            { collection: this.#polygonCollection, name: 'polygon' }
        ];

        primitiveCollections.forEach(({ collection }) => {
            for (let i = collection.length - 1; i >= 0; i--) {
                const primitive = collection[i];
                if (primitive) {
                    this._removePrimitive(primitive);
                }
            }
            collection.length = 0;
        });

        // Clear selected entity
        this._clearSelectedEntity();
    }

    /**
     * Clears the currently selected entity
     * @private
     */
    _clearSelectedEntity() {
        if (this.#selectedEntity) {
            // Clear from Cesium's selection system
            if (this.map.selectedEntity === this.#selectedEntity) {
                this.map.selectedEntity = undefined;
            }
            this.#selectedEntity = null;
        }
    }


    /*********************************
     * GET CLAMPED POSITIONS FEATURE *
     *********************************/
    /**
     * Gets positions with fallback height, tries multiple methods
     * @param {Cesium.Cartesian3[] | Cesium.Cartographic[]} positions 
     * @returns {Cesium.Cartographic[]} positions with best available height
     */
    _getClampedPositions(positions) {
        return positions.map(pos => {
            const cartographicDegrees = convertToCartographicDegrees(pos);
            if (!cartographicDegrees) return null;

            // Use existing height if valid
            if (cartographicDegrees.height !== undefined && cartographicDegrees.height !== 0) {
                return cartographicDegrees;
            }

            let height = null;
            // Approach 1: Globe height (fastest, most reliable)
            if (height === null) {
                height = this._getHeightUsingGlobe(cartographicDegrees);
            }

            // Approach 2: Pick-based height (more accurate but view-dependent)
            if (height === null) {
                height = this._getHeightUsingPick(cartographicDegrees);
            }

            // Approach 3: Async height update (non-blocking, fire-and-forget)
            if (height === null) {
                this._getHeightUsingSampleHeight(cartographicDegrees, pos);
            }

            // Fallback: Set the best available height or fallback to 0
            cartographicDegrees.height = height !== null ? height : 0;

            return cartographicDegrees;
        }).filter(Boolean);
    }

    /**
     * Gets height using pick API as fallback
     * @private
     * @param {CartographicDegrees} cartographicDegrees - Position in degrees
     * @returns {number|null} Height or null if pick fails
     */
    _getHeightUsingPick(cartographicDegrees) {
        try {
            // Convert to Cartesian3 with approximate height for screen projection
            const cartesian = convertToCartesian3(cartographicDegrees);
            if (!cartesian) return null;

            // Convert to screen coordinates
            // -- Handle screen position --
            let screenPoint;
            const { scene } = this.map;
            if (SceneTransforms.worldToWindowCoordinates) {
                // latest screenPosition transform method
                screenPoint = SceneTransforms.worldToWindowCoordinates(scene, cartesian);
            } else if (SceneTransforms.wgs84ToWindowCoordinates) {
                // fallback to use deprecated screenPosition transform method
                screenPoint = SceneTransforms.wgs84ToWindowCoordinates(scene, cartesian);
            } else {
                console.error("SceneTransforms.worldToWindowCoordinates or SceneTransforms.wgs84ToWindowCoordinates is not available in the current version of Cesium.");
            }
            if (!screenPoint) return null;

            // -- Pick position by screen coordinate --
            const pickedCartesian = scene.pickPosition(screenPoint);
            if (pickedCartesian) {
                const pickedCartographic = convertToCartographicRadians(pickedCartesian);
                const height = pickedCartographic ? pickedCartographic.height : null;

                // Check if height is reasonable (same bounds as globe method)
                if (height !== null && height >= -1000 && height <= 10000) {
                    return height;
                }
            }

            return null;
        } catch (error) {
            console.warn('Pick-based height sampling failed:', error);
            return null;
        }
    }

    /**
     * Gets height using globe elevation as fallback
     * @private
     * @param {CartographicDegrees} cartographicDegrees - Position in degrees
     * @returns {number|null} Height or null if sampling fails
     */
    _getHeightUsingGlobe(cartographicDegrees) {
        try {
            const cartographicRadians = convertToCartographicRadians(cartographicDegrees);
            if (!cartographicRadians) return null;

            // Use globe.getHeight for basic terrain height
            const height = this.map.scene.globe.getHeight(cartographicRadians);

            // Check if height is reasonable (between reasonable Earth elevation bounds)
            // Dead Sea: ~-430m, Everest: ~8848m, with some buffer for edge cases
            if (height !== undefined && height >= -1000 && height <= 10000) {
                return height;
            }

            // Return null for unreasonable heights to trigger next approach
            return null;
        } catch (error) {
            console.warn('Globe height sampling failed:', error);
            return null;
        }
    }

    /**
     * Schedules async height update (fire-and-forget)
     * @private
     */
    _getHeightUsingSampleHeight(cartographicDegrees, originalPos) {
        const cartographic = convertToCartographicRadians(originalPos);
        if (cartographic && this.map.scene.sampleHeight) {
            try {
                const heightResult = this.map.scene.sampleHeight(cartographic);

                // Check if it returns a Promise
                if (heightResult && typeof heightResult.then === 'function') {
                    heightResult
                        .then(height => {
                            // Apply reasonableness check before updating
                            if (height !== undefined && height >= -1000 && height <= 10000) {
                                cartographicDegrees.height = height;
                            }
                        })
                        .catch(error => {
                            console.warn('Failed to update height:', error);
                        });
                } else if (typeof heightResult === 'number') {
                    // Synchronous result - apply reasonableness check
                    if (heightResult >= -1000 && heightResult <= 10000) {
                        cartographicDegrees.height = heightResult;
                    }
                }
            } catch (error) {
                console.warn('sampleHeight not available or failed:', error);
            }
        }
    }
}

customElements.define("cesium-measure", CesiumMeasure);


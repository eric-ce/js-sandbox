// This is the cesium measure web component that will be used in the MapCesium component.
import {
    BlendOption,
    SceneTransforms,
    defined,
    Entity,
    Cesium3DTileFeature,
    Cartesian3,
} from "cesium";
// import { TabulatorFull as Tabulator } from 'tabulator-tables';
// import 'tabulator-tables/dist/css/tabulator_midnight.min.css';

import { createPointPrimitive, createPolylinePrimitive, createLabelPrimitive, createPolygonPrimitive, convertToCartographicRadians, convertToCartographicDegrees, checkCoordinateType, createPolygonOutlinePrimitive, createGroundPolylinePrimitive, areCoordinatesEqual, createPointerOverlay, convertToCartesian3 } from "../lib/helper/cesiumHelper.mjs";
// import { LogTable } from './shared/LogTable.mjs';
// import { HelpTable } from './shared/HelpTable.mjs';
import { AnnotationComponentBase } from "./AnnotationComponentBase.mjs";
import { camelCaseToWords, capitalizeString, deconstructIdForMetadata, makeDraggable } from "../lib/helper/helper.mjs";


/**@typedef {import('cesium').Cartesian3} Cartesian3 - the x,y,z coordinate that used in cesium map*/
/**@typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection - the collection of point primitives in cesium map*/
/**@typedef {import('cesium').LabelCollection} LabelCollection - the collection of label primitives in cesium map*/
/**@typedef {import('cesium').Primitive} Primitive - the primitive object in cesium map*/
/**@typedef {import('cesium').PointPrimitive} PointPrimitive - the point primitive object in cesium map*/
/**@typedef {import('cesium').LabelPrimitive} LabelPrimitive - the label primitive object in cesium map*/

/**@typedef {{latitude: number, longitude: number, height?: number}} CartographicDegrees - CartographicDegrees */

/**
 * CesiumAnnotation class to provide measurement drawing functionalities in Cesium.
 * Overrides methods from AnnotationComponentBase to implement Cesium-specific features.
 * @extends {AnnotationComponentBase}
 */
export default class CesiumAnnotation extends AnnotationComponentBase {
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
            console.warn("CesiumAnnotation: Point collection not available for _addPointMarker.");
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
     * Adds multiple point markers to the map at the specified positions.
     * @param {Cartesian3[]} positions - Array of positions where the markers will be added
     * @param {object} options - Options for the point primitives
     * @returns {PointPrimitive[]} An array of the created point primitives (may contain nulls if some failed).
     */
    _addPointMarkersFromArray(positions, options = {}) {
        if (!this.#pointCollection) {
            console.warn("CesiumAnnotation: Point collection not available for _addPointMarkersFromArray.");
            return []; // Return empty array if collection not ready
        }
        if (!Array.isArray(positions) || positions.length === 0) {
            console.warn("CesiumAnnotation: Invalid or empty positions array for _addPointMarkersFromArray.");
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
            console.warn("CesiumAnnotation: Cesium package or map not available for _addPolyline.");
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
            console.warn("CesiumAnnotation: Cesium package or map not available for _addPolyline.");
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
            console.warn("CesiumAnnotation: Invalid positions array for polygon.");
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
            console.warn("CesiumAnnotation: Invalid coordinate type for polygon positions.");
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
            console.warn("CesiumAnnotation: Invalid positions array for polygon outline.");
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
            console.warn("CesiumAnnotation: Invalid coordinate type for polygon positions.");
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

    /**
     * Enhances Cesium primitive prototypes with custom getters and setters for easier metadata access.
     * @param {Primitive|label|PointPrimitive} primitive - The Cesium primitive instance to enhance 
     * @returns {void}
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
        const title = descriptionData["Type"] ?
            `${capitalizeString(descriptionData["Type"])} Details` : "Unknown Details";
        const selectedEntity = new Entity({
            id: id || null,
            name: title,
            description: this._createPickedObjectDescription(descriptionData)
        });

        // Store reference for cleanup
        this.#selectedEntity = selectedEntity;

        // This assigns the entity to Cesium's selection system
        this.map.selectedEntity = selectedEntity;

        // -- Create and show Tabulator table instead of Cesium entity --
        // this._createTabulatorTable(descriptionData, primitive.id);

        // Clear any existing selected entity
        // this._clearSelectedEntity();
    }

    _createDescriptionData(primitive) {
        if (!primitive || !primitive.feature || !primitive.feature.properties) return null;

        const { id } = primitive;
        if (!id) return null; // Ensure id exists

        const excludedKeys = ["positions"]

        const descriptionData = {};
        Object.entries(primitive.feature.properties).forEach(([key, value]) => {
            // Skips the excluded keys
            if (excludedKeys.includes(key)) return;

            // Convert camelCase to words and capitalize the first letter
            const formattedKey = camelCaseToWords(key);
            descriptionData[formattedKey] = value;
        });
        // handle positions
        // if (positions.length > 0) {
        //     const flatPositions = positions.flat();
        //     flatPositions.forEach((pos, index) => {
        //         const cartographicDegrees = convertToCartographicDegrees(pos);
        //         Object.entries(cartographicDegrees).forEach(([key, value]) => {
        //             descriptionData[`Pos ${index + 1} ${key}`] = JSON.stringify(value);
        //         });
        //     });
        // }
        return descriptionData;
    }

    /**
     * Creates a Tabulator table to display the picked object data
     * @param {Object} descriptionData - The data to display in the table
     * @param {string} primitiveId - The ID of the primitive for the table title
     * @private
     */
    _createTabulatorTable(descriptionData, primitiveId) {
        // Inject Tabulator CSS into shadow root if not already present
        // let link = this.container.querySelector('#tabulator_midnight-css');
        // if (!link) {
        //     link = document.createElement('link');
        //     link.id = 'tabulator_midnight-css';
        //     link.rel = 'stylesheet';
        //     link.href = '/styles/tabulator_midnight.min.css'; // Updated path
        //     this.container.appendChild(link);
        // }

        // Find existing container or create new one
        let tableContainer = this.container.querySelector('#cesium-picked-object-table');
        if (!tableContainer) {
            tableContainer = document.createElement('div');
            tableContainer.id = 'cesium-picked-object-table';
            tableContainer.style.cssText = `
                position: absolute;
                top: 0px;
                left: 0px;
                width: 450px;
                max-height: 450px;
                background: rgba(38, 38, 38, 0.95);
                border: 1px solid #444;
                border-radius: 7px;
                z-index: 1001;
            `;

            // Create title div that holds h3 and close button
            const titleDiv = document.createElement('div');
            titleDiv.classList.add('info-table-title-container');
            titleDiv.style.cssText = `
                display: flex;
                justify-content: space-between;
                flex-direction: row-reverse;
                align-items: center;
                font-size: 16px;
                font-weight: bold;
                color: white;
                padding: 4px;
                background: rgba(84, 84, 84, 1);
                border: 1px solid #444;
                border-radius: 7px 7px 0 0;
            `;

            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.cssText = `
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                cursor: pointer;
            `;
            closeBtn.onclick = () => this._closeTabulatorTable();

            // Add title element use h3
            const title = document.createElement('h3');
            title.style.cssText = 'color: white; margin: 0 0 0 5px; font-size: 14px;';

            titleDiv.appendChild(closeBtn);
            titleDiv.appendChild(title);
            tableContainer.appendChild(titleDiv);
            this.container.appendChild(tableContainer);


            // Set initial position and make draggable only once
            const rect = this.container.getBoundingClientRect();
            const tableContainerRect = tableContainer.getBoundingClientRect();
            if (rect && rect.width > 0 && tableContainerRect.width > 0) {
                tableContainer.style.transform = `translate(${rect.right - tableContainerRect.width}px, ${rect.top + 50}px)`;
            }
            // makeDraggable(tableContainer, this.container);
        }

        // Clear existing table content only
        const existingTable = tableContainer.querySelector('.tabulator');
        if (existingTable) {
            existingTable.remove();
        }

        // Update title content
        const title = tableContainer.querySelector('.info-table-title-container h3');
        const objectType = descriptionData["Type"] || "Unknown";
        title.textContent = `${capitalizeString(objectType)} Details`;

        // Transform data for Tabulator
        const tableData = Object.entries(descriptionData).map(([property, value]) => ({
            property,
            value: String(value)
        }));

        // Create table div
        const tableDiv = document.createElement('div');
        tableDiv.style.fontSize = "16px";
        tableDiv.style.padding = "5px 10px";
        tableDiv.style.border = "1px solid #444";
        tableDiv.style.borderRadius = "0 0 7px 7px";
        tableContainer.appendChild(tableDiv);

        // Initialize Tabulator with editable configuration
        const table = new Tabulator(tableDiv, {
            data: tableData,
            layout: "fitColumns",
            height: "300px",
            resizableColumns: true,
            resizableRows: false,
            movableColumns: false,
            history: true, // Enable undo/redo functionality
            columns: [
                {
                    title: "Property",
                    field: "property",
                    width: 120,
                    minWidth: 80,
                    resizable: true,
                    headerFilter: false
                },
                {
                    title: "Value",
                    field: "value",
                    formatter: "textarea",
                    resizable: true,
                    minWidth: 100,
                    headerFilter: false,
                    editor: "input", // Make value column editable
                    editorParams: {
                        search: false,
                    }
                }
            ],
            theme: "midnight",
            // Event handlers for cell editing
            // cellEdited: (cell) => this._onCellEdited(cell, primitiveId),
            // dataChanged: (data) => this._onDataChanged(data, primitiveId)
        });

        // Add event listeners after table initialization
        table.on("cellEdited", (cell) => this._onCellEdited(cell, primitiveId));
        table.on("dataChanged", (data) => this._onDataChanged(data, primitiveId));


        // Store table reference for undo/redo operations
        this._currentTable = table;

        // Add undo/redo buttons to the title bar
        this._addUndoRedoButtons(tableContainer, table);

        // Set initial positions
        const rect = this.container.getBoundingClientRect();
        const tableContainerRect = tableContainer.getBoundingClientRect();
        if (!rect || rect.width === 0 || tableContainerRect === 0) return;
        tableContainer.style.transform = `translate(${rect.width - tableContainerRect.width - 100}px, 50px)`;

        // Make the table draggable
        // makeDraggable(tableContainer, this.container);
    }
    /**
     * Adds undo/redo buttons to the table title bar
     * @param {HTMLElement} tableContainer - The table container element
     * @param {Tabulator} table - The Tabulator instance
     * @private
     */
    _addUndoRedoButtons(tableContainer, table) {
        const titleDiv = tableContainer.querySelector('.info-table-title-container');
        if (!titleDiv) return;

        let buttonContainer = titleDiv.querySelector('.info-table-history-button-container');
        // Create button container
        if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.className = 'info-table-history-button-container';
            buttonContainer.style.cssText = `
            display: flex;
            gap: 5px;
            margin-right: 10px;
            `;
            titleDiv.appendChild(buttonContainer);


            // Undo button
            const undoBtn = document.createElement('button');
            undoBtn.innerHTML = '↶';
            undoBtn.title = 'Undo (Ctrl+Z)';
            undoBtn.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 3px;
                color: white;
                font-size: 14px;
                width: 20px;
                height: 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            undoBtn.onclick = () => table.undo();

            // Redo button
            const redoBtn = document.createElement('button');
            redoBtn.innerHTML = '↷';
            redoBtn.title = 'Redo (Ctrl+Y)';
            redoBtn.style.cssText = undoBtn.style.cssText; // Same styling
            redoBtn.onclick = () => table.redo();

            buttonContainer.appendChild(undoBtn);
            buttonContainer.appendChild(redoBtn);

            // Insert buttons before the close button
            // const closeBtn = titleDiv.querySelector('button');
            // titleDiv.insertBefore(buttonContainer, closeBtn);
            titleDiv.appendChild(buttonContainer);

            // Add keyboard shortcuts
            this._addKeyboardShortcuts(table);
        }
    }

    /**
     * Adds keyboard shortcuts for undo/redo
     * @param {Tabulator} table - The Tabulator instance
     * @private
     */
    _addKeyboardShortcuts(table) {
        // Remove existing listener to avoid duplicates
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
        }

        this._keyboardHandler = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    table.undo();
                } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
                    e.preventDefault();
                    table.redo();
                }
            }
        };

        document.addEventListener('keydown', this._keyboardHandler);
    }

    /**
    * Handles cell edit events to update primitive data
    * @param {Cell} cell - The edited cell
    * @param {string} primitiveId - The primitive ID
    * @private
    */
    _onCellEdited(cell, primitiveId) {
        const property = cell.getRow().getData().property;
        const newValue = cell.getValue();

        console.log(`🔄 Property "${property}" updated to: "${newValue}"`);

        // Update the primitive's feature properties
        this._updatePrimitiveProperty(primitiveId, property, newValue);
    }

    /**
     * Handles data change events (fires after any data modification)
     * @param {Array} data - The current table data
     * @param {string} primitiveId - The primitive ID
     * @private
     */
    _onDataChanged(data, primitiveId) {
        console.log('📊 Table data changed for primitive:', primitiveId, data);
        // You can implement bulk update logic here if needed
    }

    /**
     * Updates a primitive's property value
     * @param {string} primitiveId - The primitive ID
     * @param {string} propertyName - The property name to update
     * @param {any} newValue - The new value
     * @private
     */
    _updatePrimitiveProperty(primitiveId, propertyName, newValue) {
        // Find the primitive by ID
        const primitive = this._findPrimitiveById(primitiveId);
        if (!primitive || !primitive.feature || !primitive.feature.properties) {
            console.warn(`Primitive with ID ${primitiveId} not found or has no properties`);
            return;
        }

        // Convert formatted property name back to original key format
        const originalKey = this._getOriginalPropertyKey(primitive.feature.properties, propertyName);
        if (originalKey) {
            primitive.feature.properties[originalKey] = newValue;
            console.log(`Updated primitive property: ${originalKey} = ${newValue}`);
        } else {
            console.warn(`Original property key not found for: ${propertyName}`);
        }
    }

    /**
     * Finds the original property key from formatted display name
     * @param {Object} properties - The primitive properties object
     * @param {string} formattedKey - The formatted key from the table
     * @returns {string|null} The original property key
     * @private
     */
    _getOriginalPropertyKey(properties, formattedKey) {
        // Find the original key by comparing formatted versions
        return Object.keys(properties).find(key => {
            const formatted = camelCaseToWords(key);
            return formatted === formattedKey;
        });
    }

    /**
     * Finds a primitive by its ID across all collections
     * @param {string} primitiveId - The primitive ID to search for
     * @returns {Primitive|null} The found primitive or null
     * @private
     */
    _findPrimitiveById(primitiveId) {
        // Search in point collection
        const pointsLength = this.#pointCollection?.length || 0;
        for (let i = 0; i < pointsLength; i++) {
            const point = this.#pointCollection.get(i);
            if (point && point.id === primitiveId) return point;
        }

        // Search in label collection
        const labelsLength = this.#labelCollection?.length || 0;
        for (let i = 0; i < labelsLength; i++) {
            const label = this.#labelCollection.get(i);
            if (label && label.id === primitiveId) return label;
        }

        // Search in polyline collection
        const polyline = this.#polylineCollection?.find(p => p.id === primitiveId);
        if (polyline) return polyline;

        // Search in polygon collection
        const polygon = this.#polygonCollection?.find(p => p.id === primitiveId);
        if (polygon) return polygon;

        return null;
    }
    /**
     * Closes and removes the Tabulator table
     * @private
     */
    _closeTabulatorTable() {
        // Clean up keyboard handler
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
            this._keyboardHandler = null;
        }

        // Clear table reference
        this._currentTable = null;

        const tableContainer = this.container.querySelector('#cesium-picked-object-table');
        if (tableContainer) {
            tableContainer.remove();
        }
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

customElements.define("cesium-annotation", CesiumAnnotation);


import * as Cesium from "cesium";
import {
    BoundingSphere,
    Cartesian3,
    Cartographic,
    Color,
    GeometryInstance,
    LabelPrimitive,
    Math as CesiumMath,
    Material,
    Primitive,
    PolygonHierarchy,
    PolygonPipeline,
    PointPrimitive,
    PolylineMaterialAppearance,
    PolylineGeometry,
    PerInstanceColorAppearance
} from "cesium";


/***********************
 * HELPER  FOR GENERAL *
 ***********************/
/**
 * calculate the distance between two points
 * @param {Cartesian3} startPoint - the cartesian coordinates
 * @param {Cartesian3} endPoint - the cartesian coordinates
 * @returns {number} distance - the distance between startPoint and endPoint
 */
export function calculateDistance(startPoint, endPoint) {
    return Cartesian3.distance(startPoint, endPoint);
}

/**
 * Compares two coordinates for approximate equality using a tolerance (epsilon).
 * Handles floating-point inaccuracies inherent in coordinate conversions and calculations.
 *
 * @param {object} coordinate1 - The first coordinate object.
 * @param {object} coordinate2 - The second coordinate object.
 * @param {number} [epsilon=CesiumMath.EPSILON7] - The tolerance for comparison. Smaller values require closer equality.
 * @returns {boolean} - True if the coordinates match within the tolerance; otherwise false.
 */
export function areCoordinatesEqual(coordinate1, coordinate2, epsilon = CesiumMath.EPSILON7) {
    // Basic validation
    if (!coordinate1 || !coordinate2 || typeof coordinate1 !== 'object' || typeof coordinate2 !== 'object') {
        console.warn("areCoordinatesEqual: Invalid coordinate objects provided.");
        return false;
    }

    // Check if both coordinates are of the same type
    const coordinate1Type = checkCoordinateType(coordinate1);
    const coordinate2Type = checkCoordinateType(coordinate2);
    if (coordinate1Type !== coordinate2Type) {
        console.warn(`areCoordinatesEqual: Coordinate types do not match (${coordinate1Type} vs ${coordinate2Type}).`);
        return false;
    }

    // Assume coordinate1Type and coordinate2Type are the same type at this moment
    switch (coordinate1Type) {
        case "cartographicDegrees":
        case "cartographic":
            // Compare each component using Math.equalsEpsilon
            // Note: You might consider different epsilons for angles vs. height if needed,
            // but using a single small epsilon is often sufficient.
            return (
                CesiumMath.equalsEpsilon(coordinate1.longitude, coordinate2.longitude, epsilon) &&
                CesiumMath.equalsEpsilon(coordinate1.latitude, coordinate2.latitude, epsilon) &&
                CesiumMath.equalsEpsilon(coordinate1.height, coordinate2.height, epsilon) // Use same epsilon for height, or adjust if needed (e.g., EPSILON3 for mm precision)
            );

        case "cartesian3":
            return Cartesian3.equalsEpsilon(coordinate1, coordinate2, epsilon);

        default:
            console.warn(`areCoordinatesEqual: Unknown coordType "${coordType}".`);
            return false;
    }
}

/**
 * Convert the coordinate to cartesian3 coordinate
 * @param {{latitude: number, longitude: number, height: number} | Cartographic | Cartesian3} coordinate - cesium coordinate object. It could be either cartographic degrees or cartographic radians or cartesian3
 * @returns {Cartesian3} cartesian - the cartesian3 coordinate
 */
export function convertToCartesian3(coordinate) {
    const coordType = checkCoordinateType(coordinate);
    if (!coordType) return;

    // If it's Cartesian3, return it as is.
    if (coordType === 'cartesian3') {
        return coordinate;
    }
    // If it's Cartographic, convert it to Cartesian3.
    if (coordType === 'cartographic') {
        return Cesium.Cartesian3.fromRadians(coordinate.longitude, coordinate.latitude, coordinate.height);
    }
    // If it's Cartographic degrees, convert it to Cartesian3.
    if (coordType === 'cartographicDegrees') {
        return Cesium.Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude, coordinate.height);
    }

    return null;
}

/**
 * Convert options of Cartesian3 or Cartographic to CartographicDegrees
 * @param {Cartesian3 | Cartographic} coordinate 
 * @returns 
 */
export function convertToCartographicDegrees(coordinate) {
    const coordType = checkCoordinateType(coordinate);
    if (!coordType) return;

    // If it's Cartesian3, convert it to Cartographic degrees.
    if (coordType === 'cartesian3') {
        const cartographic = Cesium.Cartographic.fromCartesian(coordinate);
        return {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: cartographic.height,
        };
    }
    // If it's Cartographic, convert it to Cartographic degrees.
    if (coordType === 'cartographic') {
        return {
            longitude: Cesium.Math.toDegrees(coordinate.longitude),
            latitude: Cesium.Math.toDegrees(coordinate.latitude),
            height: coordinate.height,
        };
    }
    // If it's already in Cartographic degrees, return it as is.
    if (coordType === 'cartographicDegrees') {
        return coordinate;
    }

    return null;
}

/**
 * Convert coordinate to Cartographic coordinate in radians.
 * @param {Cartesian3| Cartographic | {latitude:number, longitude: number, height: number}} coordinate - The coordinate to convert. 
 * @returns {{longitude: number, latitude: number, height: number} | null} - The Cartographic coordinate in radians or null if conversion fails.
 */
export function convertToCartographicRadians(coordinate) {
    const coordType = checkCoordinateType(coordinate);
    if (!coordType) return;

    // If it's Cartesian3, convert it to Cartographic radians.
    if (coordType === 'cartesian3') {
        const cartographic = Cesium.Cartographic.fromCartesian(coordinate);
        return new Cartographic(
            cartographic.longitude,
            cartographic.latitude,
            cartographic.height,
        )
    }
    // If it's Cartographic, convert it to Cartographic radians.
    if (coordType === 'cartographic') {
        return new Cartographic(coordinate.longitude, coordinate.latitude, coordinate.height);
    }

    // If it's already in Cartographic radians, return it as is.
    if (coordType === 'cartographicDegrees') {
        const cartographic = {
            longitude: Cesium.Math.toRadians(coordinate.longitude),
            latitude: Cesium.Math.toRadians(coordinate.latitude),
            height: coordinate.height,
        };

        // Return a new Cartographic object to avoid mutating the original
        return new Cartographic(cartographic.longitude, cartographic.latitude, cartographic.height);
    }

    return null;
}

/**
 * Check the type of coordinate.
 * @param {Cartesian3 | Cartographic} coordinate 
 * @returns {"cartesian3" | "cartographic" | "cartographicDegrees" | null} - The type of coordinate.
 */
export function checkCoordinateType(coordinate) {
    // Error handling: check if the coordinate is defined and an object
    if (!coordinate || typeof coordinate !== 'object') return null;

    // Deconstruct the coordinate object
    const { x, y, z, longitude, latitude, height } = coordinate;

    // Check if the coordinate is in cartesian3
    if ([x, y, z].every(num => typeof num === 'number') || coordinate instanceof Cartesian3) {
        return 'cartesian3';
    }

    // Check if the coordinate is in cesium cartographic instance
    if (coordinate instanceof Cartographic) {
        return 'cartographic'; // if intended to be cartographic radians uses Cesium Cartographic Instance
    }

    // Check if the coordinate is in cartographic or cartographic degrees
    if ((typeof longitude === 'number' && typeof latitude === 'number' && typeof height === 'number')) {
        // return Math.abs(longitude) > 10 ? 'cartographicDegrees' : 'cartographic';
        return 'cartographicDegrees'; // Always return cartographic degrees for now
    }

    return null;
};

/**
 * Format the distance.
 * @param {number} distance - The distance in meters.
 * @returns {string} The formatted distance string.
 */
export function formatDistance(distance) {
    if (distance >= 1_000) {
        // Convert to kilometers
        return (distance / 1_000).toFixed(2) + " km";
    } else if (distance >= 1) {
        // Keep in meters
        return distance.toFixed(2) + " m";
    } else {
        // Convert to centimeters
        return (distance * 100).toFixed(2) + " cm";
    }
}

/**
 * Format the area.
 * @param {number} area - The area in square meters.
 * @returns {string} The formatted area string.
 */
export function formatArea(area) {
    if (area >= 1_000_000) {
        // Convert to square kilometers
        return (area / 1_000_000).toFixed(2) + " km²";
    } else if (area >= 1) {
        // Keep in square meters
        return area.toFixed(2) + " m²";
    } else {
        // Convert to square centimeters
        return (area * 10_000).toFixed(2) + " cm²";
    }
}


/**
 * Converts an array of Cartesian coordinates to clamped Cartesian coordinates using batch processing.
 * Each coordinate is clamped to the terrain height using the Cesium viewer's terrain provider sampleTerrainMostDetailed() method.
 * Coordinates with undefined terrain heights are skipped.
 *
 * @param {Cesium.Cartesian3[]} cartesianArray - An array of Cartesian3 coordinates to be clamped.
 * @param {Cesium.Scene} scene - The Cesium scene instance used to obtain terrain height.
 * @returns {Promise<Cesium.Cartesian3[]>} A promise that resolves to an array of clamped Cartesian3 coordinates.
 * @throws {Error} Throws an error if the input parameters are invalid.
 */
export async function convertCartesianArrayToClamped(cartesianArray, scene) {
    // Validate input parameters
    if (!Array.isArray(cartesianArray) || cartesianArray.length === 0 || !scene || !scene.terrainProvider) {
        throw new Error('Invalid input parameters.');
    }

    // Convert Cartesian3 to Cartographic
    const cartographicArray = cartesianArray.map(cartesian => Cesium.Cartographic.fromCartesian(cartesian));
    if (!Array.isArray(cartographicArray) || cartographicArray.length === 0) {
        console.error("Convert Cartographic failed, check passed coordinate.");
        return null;
    }

    // Sample terrain heights in batch
    const sampledPositions = await Cesium.sampleTerrainMostDetailed(scene.terrainProvider, cartographicArray);

    // Iterate through sampled positions
    const clampedCartesianArray = sampledPositions.map((cartographic) => {
        if (!cartographic.height) {
            console.warn(`Skipping coordinate ${cartographic}: Terrain height undefined.`);
            return null; // Skip if height is undefined
        }

        const clampedCartesian = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            cartographic.height
        );
        if (!clampedCartesian) {
            console.warn(`Skipping coordinate ${cartographic}: Clamped Cartesian conversion failed.`);
            return null; // Skip if conversion fails
        }
    }).filter(Boolean); // Filter out any null values

    return clampedCartesianArray;
}

/**
 * Computes the area of the polygon based on Cartesian3 coordinates.
 * THIS METHOD IS PROVIDED BY CESIUM
 *
 * @param {Cartesian3[]} cartesianArray - Array of Cartesian3 coordinates defining the polygon.
 * @returns {Number} The area of the polygon.
 */
export function computePolygonArea(cartesianArray) {
    let hierarchy = new PolygonHierarchy(cartesianArray);

    // let hierarchy = polygon.polygon.hierarchy._value;
    let indices = PolygonPipeline.triangulate(hierarchy.positions, hierarchy.holes);

    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
        let vector1 = hierarchy.positions[indices[i]];
        let vector2 = hierarchy.positions[indices[i + 1]];
        let vector3 = hierarchy.positions[indices[i + 2]];
        let vectorC = Cartesian3.subtract(vector2, vector1, new Cartesian3());
        let vectorD = Cartesian3.subtract(vector3, vector1, new Cartesian3());
        let areaVector = Cartesian3.cross(vectorC, vectorD, new Cartesian3());
        area += Cartesian3.magnitude(areaVector) / 2.0;
    }
    return area;
}

/**
 * Calculate the middle position of a set of coordinates.
 * For 2 points - return the middle point.
 * For 3 or more points - return the center of the bounding sphere.
 * @param {Cartesian3[] | Cartographic[] | {latitude: number, longitude:number, height: number}[]} positions - The array of coordinates.
 * @returns {Cartesian3 | null} - The middle position or null if invalid input.
 */
export function calculateMiddlePos(positions) {
    if (!Array.isArray(positions) || positions.length < 2) {
        console.warn("calculateMiddlePos: Invalid positions array provided.");
        return null;
    }

    // Convert the coordinates to Cartesian3
    const cartesianArray = positions.map((pos) => convertToCartesian3(pos)).filter(Boolean);
    if (cartesianArray.length < 2) {
        console.error("calculateMiddlePos: Convert Cartesian3 failed, check passed coordinate.");
        return null;
    }

    // Case1: if only two points, return the middle point - for fastest performance
    if (cartesianArray.length === 2) {
        return Cartesian3.lerp(cartesianArray[0], cartesianArray[1], 0.5, new Cartesian3());
    }
    // Case2: if more than two points, calculate the center points from the bounds 
    else {
        // Use the center of the bounding sphere for three or more points (good visual center)
        try {
            // Provide a result Cartesian3 to avoid potential allocation within fromPoints
            const boundingSphere = BoundingSphere.fromPoints(cartesianArray, new BoundingSphere());
            // Ensure the center is valid before returning
            return Cartesian3.clone(boundingSphere.center); // Clone to ensure immutability if needed downstream
        } catch (error) {
            console.error("calculateMiddlePos: Error calculating bounding sphere:", error);
            // Fallback or error handling - returning null might be safest
            return null;
        }
    }
}




/*******************************
 * HELPER FOR CESIUM PRIMITIVE *
 *******************************/
/**
 * Create a point primitive.
 * @param {Cartesian3 | Cartographic} coordinate - The Cartesian3 coordinate of the point.
 * @param {object} [options={}] - Optional configuration for the point primitive.
 * @returns {import('cesium').PointPrimitive} - The point primitive.
 */
export function createPointPrimitive(coordinate, options = {}) {
    if (!coordinate) {
        console.error("Invalid coordinate provided.");
        return null; // Exit early if coordinate is not defined
    }

    // Default options
    const {
        pixelSize = 10,
        color = "rgba(255,0,0,1)",  // for color options: need to use Cesium.Color
        disableDepthTestDistance = Number.POSITIVE_INFINITY,
        id = "annotate_point",
        ...rest
    } = options;

    // Convert coordinate to Cartesian3
    const cartesian = convertToCartesian3(coordinate);
    if (!cartesian) {
        console.error("Convert Cartesian3 failed, check passed coordinate.");
        return null;
    }

    return {
        position: cartesian,
        pixelSize,
        color: Color.fromCssColorString(color), // for color options: need to use Cesium.Color
        disableDepthTestDistance,
        id,
        ...rest
    };
}

/**
 * Create a line primitive with custom width and color.
 * @param {Cesium.Primitive} Primitive - The Cesium primitive
 * @param {Cesium.Cartesian3[] | Cesium.Cartographic[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {object} [options={}] - Optional configuration for the line primitive.
 * @returns {Cesium.Primitive} - The line primitive
 */
export function createPolylinePrimitive(Primitive, coordinateArray, options = {}) {
    // -- Validate dependencies --
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return null;
    };

    // Default options
    const {
        polylineGeometry: polylineGeometryOptions = {}, // Renamed for clarity
        geometryInstance: geometryInstanceOptions = {}, // Renamed for clarity
        color = "rgba(0,255,0,1)",
        width = 3,
        id = "annotate_line",
        ...rest
    } = options;

    // Convert the coordinates to Cartesian3
    const cartesianArray = coordinateArray.map((pos) => convertToCartesian3(pos)).filter(Boolean);
    if (!Array.isArray(cartesianArray) || cartesianArray.length < 2) {
        console.error("Convert Cartesian3 failed");
        return null;
    }

    // --- Polyline Geometry ---
    // Create the line PolylineGeometry
    const lineGeometry = new PolylineGeometry({
        positions: cartesianArray,
        width,
        vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT, // Common default
        ...polylineGeometryOptions // User options override defaults
    })

    // --- Geometry Instance ---
    // Create the line GeometryInstance
    const lineGeometryInstance = new Cesium.GeometryInstance({
        geometry: lineGeometry,
        id: id, // Use the destructured id
        ...geometryInstanceOptions
    });

    // --- Material and Appearance ---
    // Create the material and appearance
    const material = Material.fromType('Color', { color: Color.fromCssColorString(color) });
    const appearance = new PolylineMaterialAppearance({ material: material });

    // --- Primitive ---
    // Create the line Primitive
    const linePrimitive = new Primitive({
        geometryInstances: lineGeometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        vertexCacheOptimize: true,
        interleave: true,
        releaseGeometryInstances: true,
        asynchronous: false,
        ...rest
    });

    // Final check for linePrimitive
    if (!linePrimitive) return null;

    // Add metadata to the line primitive
    linePrimitive.positions = coordinateArray;
    linePrimitive.id = id;

    return linePrimitive;
}

/**
 * Create a line arrow primitive.
 * @param {Cesium.Cartesian3[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {String} modeString - The measure mode string
 * @param {Number} width - The width of the line
 * @param {Cesium.Color} [color = Cesium.Color.YELLOWGREEN] - The color of the line
 * @param {Number} offsetDistance - The distance to offset the arrow from the line
 * @param {Cesium.Primitive} Primitive - The Cesium primitive
 * @returns {Cesium.Primitive} - The line arrow primitive
 */
export function createLineArrowPrimitive(coordinateArray, modeString, width = 10, color = Cesium.Color.YELLOWGREEN, offsetDistance, Primitive) {
    // Exit early if coordinateArray is not defined or has less than 2 positions
    if (!Array.isArray(coordinateArray) || coordinateArray.length !== 2) return;

    // Convert the coordinates to Cartesian3
    const convertedCoordinates = coordinateArray.map((pos) => convertToCartesian3(pos));
    const [startPos, endPos] = convertedCoordinates;

    // Calculate the direction vector
    const direction = Cesium.Cartesian3.subtract(endPos, startPos, new Cesium.Cartesian3());
    const distance = Cesium.Cartesian3.magnitude(direction);

    // Check for zero-length direction vector
    if (distance === 0) {
        console.warn('Start and end positions are the same. Cannot create a valid arrow primitive.');
        return;
    }

    // issue: the arrow line is too close to the line, need to offset the arrow line
    // to solve it by normalize the direction vector and multiply by offset distance
    Cesium.Cartesian3.normalize(direction, direction);
    const offset = Cesium.Cartesian3.multiplyByScalar(direction, offsetDistance, new Cesium.Cartesian3());

    // Adjust the start and end positions by offset
    const adjustedStart = Cesium.Cartesian3.add(startPos, offset, new Cesium.Cartesian3());
    const adjustedEnd = Cesium.Cartesian3.subtract(endPos, offset, new Cesium.Cartesian3());

    // Create the line primitive
    const linePrimitive = createPolylinePrimitive([adjustedStart, adjustedEnd], modeString, width, color, Primitive);

    // Change the material to PolylineArrow
    const material = Cesium.Material.fromType('PolylineArrow', { color: color });
    const appearance = new Cesium.PolylineMaterialAppearance({ material: material });
    linePrimitive.appearance = appearance;

    // Update the id and positions of the line primitive
    linePrimitive.positions = convertedCoordinates;
    linePrimitive.id = generateId(convertedCoordinates, modeString);

    return linePrimitive;
}

export function createGroundPolylinePrimitive(coordinateArray, modeString, color = Cesium.Color.YELLOWGREEN, GroundPolylinePrimitive) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        console.error("Invalid array, needs to pass more than 2 position"); // Exit early if coordinateArray is not defined
    }

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);
    if (convertedCoordinates.length < 2) {
        console.error("Conversion failed, pass correct data type"); // Exit early if coordinateArray is not defined
    }

    const geometryInstance = new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
            positions: convertedCoordinates,
            width: 3
        }),
        id: generateId(convertedCoordinates, modeString),
    });

    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.PolylineMaterialAppearance({ material: material });

    const polylinePrimitive = new GroundPolylinePrimitive({
        geometryInstances: geometryInstance,
        appearance: appearance,
        asynchronous: true,
        releaseGeometryInstances: true,
    });
    polylinePrimitive.isSubmitted = false;
    // FIXME: consider using other property to store the id as the layer primitive also has id property
    // polylinePrimitive.annotateId = generateId(convertedCoordinates, modeString);
    polylinePrimitive.id = generateId(convertedCoordinates, modeString);
    polylinePrimitive.positions = convertedCoordinates;


    return polylinePrimitive;
}

/**
 * Create a label primitive at the center of provided positions.
 * @param {Cartesian3[] | Cartographic[] | {latitude: number, longitude: number, height: number}[]} coordinates - the array of coordinates that contains the start position and end position
 * @param {number | string} value - the value to display on the label primitive
 * @param {"meter" | "squareMeter"} unit - The unit of measurement (default is "meter")
 * @param {object} [options={}] - Optional configuration for the label primitive
 * @returns {LabelPrimitive} - The label primitive
 */
export function createLabelPrimitive(coordinates, value, unit = "meter", options = {}) {
    // --- Input Validation ---
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return null;
    }

    // --- Coordinate Conversion ---
    const cartesianArray = coordinates.map((pos) => convertToCartesian3(pos)).filter(Boolean);
    if (!Array.isArray(cartesianArray) || cartesianArray.length === 0) {
        console.error("Convert Cartesian3 failed, check passed coordinate.");
        return null;
    }


    // --- Center Calculation (Conditional) ---
    let position;
    const numValidCoords = cartesianArray.length;

    if (numValidCoords === 1) {
        // Case 1: Single point
        position = cartesianArray[0];
    } else {
        position = calculateMiddlePos(cartesianArray);
    }

    // --- Text Formatting ---
    let labelString;
    if (unit === "meter") {
        // Case 1: Distance in meters
        labelString = formatDistance(value);
    } else if (unit === "squareMeter") {
        // Case 2: Area in square meters
        labelString = formatArea(value);
    } else {
        // Case 3: Default case - use the text directly
        labelString = value.toString();
    }

    // --- Default Label Options ---
    const defaultOptions = {
        pixelOffset: new Cesium.Cartesian2(0, -20),
        font: "14px Roboto, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("rgba(255, 255, 255, 1)"),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(0, 0, 0, 0.5)'),
        scale: 1.2,
        scaleByDistance: new Cesium.NearFarScalar(1000.0, 1.0, 20000.0, 0.5),
        style: Cesium.LabelStyle.FILL,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // Disable depth test to always show on top

    };
    // --- Merge Options and Return ---
    const labelOptions = {
        ...defaultOptions,
        ...options,
    };

    return {
        position: position,
        text: labelString,
        ...labelOptions
    };
}

/**
 * Creates a polygon primitive.
 * @param {Primitive} Primitive - The Cesium primitive.
 * @param {Cartesian3[] | Cartographic[]} coordinateArray - An array of Cartesian3 coordinates defining the polygon vertices.
 * @param {object} [options={}] - Optional configuration for the polygon primitive.
 * @returns {Primitive|null} - The polygon primitive or null if creation fails.
 */
export function createPolygonPrimitive(Primitive, coordinateArray, options = {}) {
    // -- Validate dependencies --
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) {
        return null;
    };

    // Default options
    const {
        polygonGeometry: polygonGeometryOptions = {}, // Renamed for clarity
        geometryInstance: geometryInstanceOptions = {}, // Renamed for clarity
        color = "rgba(0, 128, 0, 0.8)",
        id = "annotate_polygon",
        ...rest // primitive options
    } = options;

    // Convert the coordinates to Cartesian3
    const cartesianArray = coordinateArray.map((pos) => convertToCartesian3(pos)).filter(Boolean);
    if (!Array.isArray(cartesianArray) || cartesianArray.length < 3) {
        console.error("Convert Cartesian3 failed");
        return null;
    }

    // --- Polygon Geometry ---
    // Create the polygon geometry
    const polygonGeometry = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(cartesianArray),
        perPositionHeight: true,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT, // Default vertex format
        ...polygonGeometryOptions // User options override defaults
    });

    // --- Geometry Instance ---
    // Create the polygon geometry instance
    const polygonGeometryInstance = new GeometryInstance({
        geometry: polygonGeometry,
        id: id, // Use the destructured id
        ...geometryInstanceOptions
    });

    // --- Material and Appearance ---
    // Create the material and appearance
    const material = new Cesium.Material.fromType('Color', { color: Color.fromCssColorString(color) });
    const appearance = new Cesium.EllipsoidSurfaceAppearance({ material: material });

    // --- Primitive ---
    // Create the polygon primitive
    const polygonPrimitive = new Primitive({
        geometryInstances: polygonGeometryInstance,
        asynchronous: false,
        releaseGeometryInstances: true,
        vertexCacheOptimize: true,
        interleave: true,
        appearance: appearance,
        depthFailAppearance: appearance,
        ...rest // primitive options
    });

    // Final check for polygonPrimitive
    if (!polygonPrimitive) return null; // Final check for polygonPrimitive

    // Add metadata to the line primitive
    polygonPrimitive.positions = cartesianArray;
    polygonPrimitive.id = id;

    return polygonPrimitive;
}

/**
 * Creates a polygon outline primitive.
 * @param {Primitive} Primitive - The Cesium primitive.
 * @param {Cartesian3[]| Cesium.Cartographic[]} coordinateArray - An array of coordinates.
 * @param {object} [options={}] - Optional configuration for the polygon outline primitive.
 * @returns {Primitive | null} - The polygon outline primitive or null if creation fails.
 */
export function createPolygonOutlinePrimitive(Primitive, coordinateArray, options = {}) {
    // Validate input coordinates
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) {
        return null;
    };

    // Default options
    const {
        polygonOutlineGeometry: polygonOutlineGeometryOptions = {}, // Renamed for clarity
        geometryInstance: geometryInstanceOptions = {}, // Renamed for clarity
        color = "rgba(0, 128, 0, 0.8)",
        id = "annotate_polygonOutline",
        ...rest // primitive options
    } = options;


    // Convert the coordinates to Cartesian3
    const cartesianArray = coordinateArray.map((pos) => convertToCartesian3(pos));
    if (!Array.isArray(cartesianArray) || cartesianArray.length < 3) {
        console.error("Convert Cartesian3 failed");
        return null;
    }

    // --- PolygonOutline Geometry ---
    // Create the polygon outline geometry
    const polygonOutlineGeometry = new Cesium.PolygonOutlineGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(cartesianArray),
        perPositionHeight: true,
        ...polygonOutlineGeometryOptions
    });

    // --- Geometry Instance ---
    // Create the polygon outline geometry instance
    const polygonOutlineGeometryInstance = new Cesium.GeometryInstance({
        geometry: polygonOutlineGeometry,
        id: id, // Use the destructured id
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(color)),
            depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(color))
        },
        ...geometryInstanceOptions
    });

    // --- Appearance ---
    // Create the material and appearance
    const appearance = new PerInstanceColorAppearance({ flat: true, translucent: false });

    // --- Primitive ---
    // Create the polygon outline primitive
    const polygonOutlinePrimitive = new Primitive({
        geometryInstances: polygonOutlineGeometryInstance,
        asynchronous: false,
        releaseGeometryInstances: true,
        vertexCacheOptimize: true,
        interleave: true,
        appearance: appearance,
        depthFailAppearance: appearance,
        ...rest
    });

    // Final check for polygonOutlinePrimitive
    if (!polygonOutlinePrimitive) return null;

    // Add metadata to the polygon outline primitive
    polygonOutlinePrimitive.positions = cartesianArray;
    polygonOutlinePrimitive.id = id;

    return polygonOutlinePrimitive;
}





/**********************************************
 * HELPER FUNCTIONS FOR MEASURE MODE SPECIFIC *
 **********************************************/
/**
 * Remove the input actions from the screen space event handler - left click, mouse move, right click, left down, left up
 * @param {Cesium.ScreenSpaceEventHandler} handler - The screen space event handler
 */
export function removeInputActions(handler) {
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // handler.removeInputAction(Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
    return handler;
}

/**
 * Get the type of the Cesium picked object.
 * @param {*} pickedObject - The result from viewer.scene.pick
 * @param {string} modeString - The mode string to filter the picked object, e.g., "multi_distance"
 * @returns {string|null} - The type of the picked object ("point", "line", "label", "other") or null if it doesn't match
 */
export function getPickedObjectType(pickedObject, modeString) {
    // Check if pickedObject is defined and has a string 'id' property
    if (!Cesium.defined(pickedObject) || typeof pickedObject.id !== 'string') {
        return null;
    }

    const { id, primitive, status } = pickedObject;

    const searchString = modeString ? `annotate_${modeString}` : `annotate_`;

    // Return null if status is a string and contains 'moving' 
    if (typeof status === 'string' && status.includes('moving')) {
        return null;
    }

    // Determine the type based on the suffix of the 'id'
    const isPoint = modeString ? id.startsWith(`${searchString}_point`) : (id.startsWith(`${searchString}`) && id.includes('_point'));
    const isLine = modeString ? id.startsWith(`${searchString}_line`) : (id.startsWith(`${searchString}`) && id.includes('_line'));
    const isLabel = modeString ? id.startsWith(`${searchString}_label`) : (id.startsWith(`${searchString}`) && id.includes('_label'));
    const isPolygon = modeString ? id.startsWith(`${searchString}_polygon`) : (id.startsWith(`${searchString}`) && id.includes('_polygon'));

    // return the type based on the conditions
    if (isPoint) {
        return 'point';
    } else if (isLine) {
        return 'line';
    } else if (id.includes("tileId") && primitive?.feature?.type === "fireTrail") {
        return 'line'
    } else if (isLabel) {
        return 'label';
    } else if (isPolygon) {
        return 'polygon';
    } else {
        return null; // Return null if none of the conditions match
    }
}

/**
 * Interpolates points between two points based on the interval.
 * @param {Cesium.Cartesian3} pointA - The Cartesian coordinate of the first point.
 * @param {Cesium.Cartesian3} pointB - The Cartesian coordinate of the second point.
 * @param {Scene} scene - viewer.scene
 * @param {number} [interval=2] - The interval between the two points.
 * @returns {Cesium.Cartesian3[]} - The interpolated points.
 */
export function interpolatePoints(pointA, pointB, interval = 2) {
    const points = [];

    // Calculate the distance between the two points
    const distance = Cesium.Cartesian3.distance(pointA, pointB);

    // Determine the number of interpolation points based on the interval
    let numberOfPoints = Math.floor(distance / interval);
    // Error handling: prevent numberOfPoints from being 0
    if (numberOfPoints === 0) numberOfPoints = 1;

    for (let i = 0; i <= numberOfPoints; i++) {
        const t = i / numberOfPoints;
        const interpolatedPoint = Cesium.Cartesian3.lerp(
            pointA,
            pointB,
            t,
            new Cesium.Cartesian3()
        );
        points.push(interpolatedPoint);
    }

    return points;
}

/**
 * Computes detailed pick positions by interpolating points and clamping their heights.
 * @param {Cesium.Cartesian3} startPosition - The starting Cartesian position.
 * @param {Cesium.Cartesian3} endPosition - The ending Cartesian position.
 * @param {Scene} scene - viewer.scene
 * @param {number} [interval=2] - The interval between interpolated points.
 * @returns {Cesium.Cartesian3[]} - The clamped positions with ground heights.
 */
export function computeDetailedPickPositions(startPosition, endPosition, scene, interval = 2) {
    // Interpolate points between the start and end positions
    const interpolatedPoints = interpolatePoints(startPosition, endPosition, interval);

    // Convert interpolated points to Cartographic coordinates
    const interpolatedCartographics = interpolatedPoints.map(point => Cesium.Cartographic.fromCartesian(point));

    // Sample height if supported
    if (scene.sampleHeightSupported) { // sampleHeight() only supports in 3D mode
        const clampedPositions = interpolatedCartographics.map((cartographic) => {
            const height = scene.sampleHeight(cartographic);
            return Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                height !== undefined ? height : cartographic.height // Fallback to original height if sampling fails
            );
        });
        return { interpolatePoints: interpolatedCartographics, clampedPositions };
    }
    // getHeight() approach
    // the height of the surface
    // const groundCartesianArray = interpolatedCartographics.map((cartographic) => {
    //     const height = this.viewer.scene.globe.getHeight(cartographic);
    //     return Cesium.Cartesian3.fromRadians(
    //         cartographic.longitude,
    //         cartographic.latitude,
    //         height
    //     )
    // });

    // sampleTerrainMostDetailed() approach
    // const groundPositions = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, interpolatedCartographics);

    // const groundCartesianArray = interpolatedCartographics.map((cartograhpic) => {
    //     return Cesium.Cartesian3.fromRadians(
    //         cartograhpic.longitude,
    //         cartograhpic.latitude,
    //         surfaceHeight
    //     )
    // });
    // repick the position by convert back to window position to repick the cartesian, drawbacks is the current camera must see the whole target. 
    // const pickedCartesianArray = groundCartesianArray.map((groundCartesian) => {
    //     const windowPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, groundCartesian);
    //     if (windowPosition) {
    //         const cartesian = this.viewer.scene.pickPosition(windowPosition);
    //         if (Cesium.defined(cartesian)) {
    //             return cartesian;
    //         }
    //     }
    // }).filter(cart => cart !== undefined);

    // return groundCartesianArray;

    // Fallback: return original interpolated points if sampling is not supported
    // return interpolatedPoints;
}

/**
 * Calculates the clamped distance between two points by interpolating and summing segment distances.
 * @param {Cesium.Cartesian3} pointA - The first Cartesian coordinate.
 * @param {Cesium.Cartesian3} pointB - The second Cartesian coordinate.
 * @param {Scene} scene - viewer.scene
 * @param {number} [interval=2] - The interval between interpolated points.
 * @returns {{distance: number, clampedPositions: Cesium.Cartesian3[]}} - An object containing:
 *  - `distance`: The total clamped distance between the two points.
 *  - `clampedPositions`: An array of interpolated Cartesian coordinates used in the calculation.
 */
export function calculateClampedDistance(pointA, pointB, scene, interval = 2) {
    const { clampedPositions } = computeDetailedPickPositions(pointA, pointB, scene, interval);
    let distance = 0; // Initialize to 0 instead of null

    for (let i = 0; i < clampedPositions.length - 1; i++) {
        distance += Cesium.Cartesian3.distance(clampedPositions[i], clampedPositions[i + 1]);
    }

    return { distance, clampedPositions };
}

/**
 * Calculates clamped distances between consecutive points in an array of cartesian coordinates.
 * 
 * @param {Cartesian3[]} cartesianArray - Array of cartesian coordinates to calculate distances between.
 * @param {Scene} scene - The Cesium scene object used for ground clamping.
 * @param {number} [interval=2] - Number of intermediate points to generate between each pair of coordinates.
 * @returns {object} Object containing calculated distances and positions.
 * @returns {number[]} .distances - Array of clamped distances between consecutive points.
 * @returns {number} .totalDistance - Sum of all clamped distances.
 * @returns {Cartesian3[][]} .clampedPositions - Array of arrays containing clamped intermediate positions.
 */
export function calculateClampedDistanceFromArray(cartesianArray, scene, interval = 2) {
    const distances = [];
    const clampedPositionsArray = [];
    for (let i = 0; i < cartesianArray.length - 1; i++) {
        const { distance, clampedPositions } = calculateClampedDistance(
            cartesianArray[i],
            cartesianArray[i + 1],
            scene,
            interval
        );
        distances.push(distance);
        clampedPositionsArray.push(...clampedPositions);
    }

    const totalDistance = distances.reduce((a, b) => a + b, 0);
    return { distances, totalDistance, clampedPositions: clampedPositionsArray };
}

/**
 * Calculates the distance between each pair of points in the array and the total distance.
 * @param {Cesium.Cartesian3[]} cartesianArray - An array of Cartesian coordinates.
 * @returns  {{ distances: number[], totalDistance: number }} - The distances between each pair of points and the total distance.
 */
export function calculateDistanceFromArray(cartesianArray) {
    const distances = [];

    for (let i = 0; i < cartesianArray.length - 1; i++) {
        const distance = Cesium.Cartesian3.distance(cartesianArray[i], cartesianArray[i + 1]);
        distances.push(distance);
    }

    const totalDistance = distances.reduce((a, b) => a + b, 0);
    return { distances, totalDistance };
}

/**
 * Get relevant point primitive, line primitive, and label primitive filtered by the position
 * @param {Cesium.Cartesian3} position 
 * @param {string} startsWithMeasureMode - the string of the id starts with, example "annotation_multi_distance"
 * @param {object} scene - The Cesium scene containing the primitives
 * @param {object} pointCollection - The point collection to search in
 * @param {object} labelCollection - The label collection to search in
 * @param {Cesium.Primitive[]} lineCollection - An array containing line Primitive objects.
 * @param {Cesium.Primitive[]} polygonCollection - An array containing polygon Primitive objects.
 * @returns {{pointPrimitive: PointPrimitive | undefined, linePrimitives: Primitive[], labelPrimitives: Label[], polygonPrimitives: Primitive[]}} An object containing the found primitives.
 */
export function getPrimitiveByPointPosition(
    position,
    startsWithMeasureMode,
    scene, // Removed unused parameter
    pointCollection,
    labelCollection,
    polylineCollection,
    polygonCollection
) {
    let foundPointPrimitive = undefined;
    let foundLinePrimitives = [];
    let foundLabelPrimitives = [];
    let foundPolygonPrimitives = [];

    // --- Find the point primitive (using public API) ---
    if (pointCollection) {
        for (let i = 0; i < pointCollection.length; i++) {
            const p = pointCollection.get(i);
            if (p && p.id && typeof p.id === 'string' &&
                p.id.startsWith(startsWithMeasureMode) &&
                !p.id.includes("moving") && // Exclude temporary moving points
                p.show && // Check if the primitive is visible/active
                areCoordinatesEqual(p.position, position)) {
                foundPointPrimitive = p;
                break; // Found the point, no need to check further points
            }
        }
    }

    // --- Find the line primitives ---
    // Assuming lineCollection is a plain array of Cesium.Primitive objects
    if (Array.isArray(polylineCollection) && polylineCollection.length > 0) {
        foundLinePrimitives = polylineCollection.filter(p =>
            p && p.id && typeof p.id === 'string' &&
            p.id.startsWith(startsWithMeasureMode) &&
            !p.id.includes("moving") &&
            p.show && // Check if the primitive is visible/active
            Array.isArray(p.positions) && // Ensure positions array exists
            p.positions.some(cart => areCoordinatesEqual(cart, position))
        );
    }

    // --- Find the label primitives (using public API) ---
    if (labelCollection) {
        // Use a temporary array as filter isn't directly available
        const matchingLabels = [];
        for (let i = 0; i < labelCollection.length; i++) {
            const l = labelCollection.get(i);
            // Ensure 'positions' property exists and is an array before using .some()
            if (l && l.id && typeof l.id === 'string' &&
                l.id.startsWith(startsWithMeasureMode) &&
                !l.id.includes("moving") &&
                l.show && // Check if the primitive is visible/active
                Array.isArray(l.positions) &&
                l.positions.some(cart => areCoordinatesEqual(cart, position))) {
                matchingLabels.push(l);
            }
        }
        foundLabelPrimitives = matchingLabels;
    }


    // --- Find the polygon primitives ---
    // Assuming polygonCollection is a plain array of Cesium.Primitive objects
    if (Array.isArray(polygonCollection) && polygonCollection.length > 0) {
        foundPolygonPrimitives = polygonCollection.filter(p =>
            p && p.id && typeof p.id === 'string' &&
            p.id.startsWith(startsWithMeasureMode) &&
            !p.id.includes("moving") &&
            p.show && // Check if the primitive is visible/active
            Array.isArray(p.positions) && // Ensure positions array exists
            p.positions.some(cart => areCoordinatesEqual(cart, position))
        );
    }

    // Return found primitives (using more descriptive names internally)
    return {
        pointPrimitive: foundPointPrimitive,
        linePrimitives: foundLinePrimitives,
        labelPrimitives: foundLabelPrimitives,
        polygonPrimitives: foundPolygonPrimitives
    };
}



/*********************************
 * HELPER FUNCTIONS FOR FEATURES *
 *********************************/
/**
 * Opens a modal for the user to edit the label name and updates the label primitive.
 * @param {HTMLElement} viewerContainer - The container element of the Cesium viewer.
 * @param {Cesium.Label} label - the label primitive to be updated.
 * @returns {Promise<void>} - A promise that resolves when the label is updated.
 */
export async function editableLabel(viewerContainer, label) {
    try {
        // open a modal for user to edit the label name
        const newLabelName = await setupEditableModal(viewerContainer);

        const labelText = label.text
        let value = null;
        // check the label to see if it has ":"
        if (labelText.includes(":")) {
            // retrieve the distance value
            const [labelName, distance] = label.text.split(":");
            value = distance;
        } else {
            // if the label does not have ":", label value is the distance value
            value = label.text;
        }

        // create the new label text
        const newLabelText = `${newLabelName.trim()} : ${value.trim()}`;
        // set the new label text
        label.text = newLabelText;

        return label;
    } catch (error) {
        return;
    }
}

/**
 * Sets up a modal for the user to edit the label name.
 * @param {HTMLElement} viewerContainer - The container element of the Cesium viewer.
 * @returns {Promise<string>} - A promise that resolves to the new label name.
 */
function setupEditableModal(viewerContainer) {
    return new Promise((resolve, reject) => {
        const modal = document.createElement("div");
        modal.className = "edit-label-modal";

        const style = document.createElement('style');
        style.textContent = `
            .edit-label-modal{
                position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);
                display: flex; justify-content: center; align-items: center; z-index: 2000; color: white; font-size: 20px;
            }
            .edit-label-modal-container{
                background-color: #242526 ; padding: 20px 30px 30px 30px; border-radius: 10px; border: 1px solid #3b4855
            }
            .edit-label-modal-input{
                display: flex; flex-direction: column; gap: 20px;
            }
            .edit-label-modal-input p{
                font-family:Roboto, sans-serif; font-size: 1.25rem
            }  
            .edit-label-modal-input input{
                padding: 5px; margin: 0px 0px 20px 0px;
            }
            .edit-label-modal-buttons{
                display: flex; justify-content: flex-end; gap: 10px; 
            }
            .edit-label-modal-buttons button{
                padding: 5px 10px; border-radius: 5px; border: none; outline: none; cursor: pointer; transition: all .5s ease; 
                font-family:Roboto, sans-serif; 
            }
            .edit-label-modal-buttons button:hover{
                background-color: rgba(245, 245, 245, 0.8);
            }
        `;

        modal.innerHTML = `
        <div class="edit-label-modal-container">
            <div class="edit-label-modal-input">
                <p>Enter new label name</p>
                <input type="text" id="editableLabelInput" />
            </div>
            <div class="edit-label-modal-buttons">
                <button class="label-submit-btn">Submit</button>
                <button class="label-cancel-btn">Cancel</button>
            </div>
        </div>
        `;
        viewerContainer.appendChild(modal);
        viewerContainer.append(style);

        // Focus on the input field
        const input = modal.querySelector("#editableLabelInput");
        input.focus();

        // Add event listener to cancel button
        const removeModal = () => {
            viewerContainer.removeChild(modal)
            modal.removeEventListener("keydown", keyDownHandler);
        };

        const cancelBtn = modal.querySelector(".label-cancel-btn");
        const cancelBtnHandler = () => {
            removeModal();
            reject(null);
        }
        cancelBtn.addEventListener("click", cancelBtnHandler);

        // Add event listener to submit button
        const submitBtn = modal.querySelector(".label-submit-btn");
        const submitBtnHandler = () => {
            const newLabel = modal.querySelector("#editableLabelInput").value;
            removeModal();
            resolve(newLabel);
        }
        submitBtn.addEventListener("click", submitBtnHandler);

        // add event listener for "enter" and "esc" keydown
        const keyDownHandler = (e) => {
            if (e.key === "Enter") {
                submitBtnHandler();
            } else if (e.key === "Escape") {
                cancelBtnHandler();
            }
        }
        modal.addEventListener("keydown", keyDownHandler);
    });
}

/**
 * update the pointer overlay position and color based on the pickedObjects
 * @param {Cesium.Viewer} viewer 
 * @param {HTMLElement} pointerOverlay 
 * @param {Cesium.Cartesian3} cartesian 
 * @param {Array} pickedObjects 
 */
export function updatePointerOverlay(viewer, pointerOverlay, cartesian, pickedObjects) {
    // const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
    // cesium api update for world position to WindowCoordinates
    // const screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
    let screenPosition;
    if (Cesium.SceneTransforms.worldToWindowCoordinates) {
        screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
    } else if (Cesium.SceneTransforms.wgs84ToWindowCoordinates) {
        screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
    }

    if (!pointerOverlay) return;
    pointerOverlay.style.display = 'block';
    pointerOverlay.style.left = `${screenPosition.x - 5}px`;
    pointerOverlay.style.top = `${screenPosition.y - 5}px`;
    pointerOverlay.style.borderRadius = "50%";
    pointerOverlay.style.width = "1px";
    pointerOverlay.style.height = "1px";

    if (pickedObjects.length === 0) {
        pointerOverlay.style.backgroundColor = "yellow";
    } else {
        const annotatePrimitives = pickedObjects.some(pickedObject => {
            // check for its id is string type and start with "annotate"
            return (typeof pickedObject.id === "string" && pickedObject.id.startsWith("annotate"));
        });
        const annotateEntity = pickedObjects.some(pickedObject => {
            return (pickedObject.id instanceof Cesium.Entity);
        });

        // anything other than annotate object will be blue
        pointerOverlay.style.backgroundColor = (!annotatePrimitives && !annotateEntity) ? "blue" : "yellow";
    }
    return pointerOverlay;
}

/**
 * Makes an HTML element draggable within a specified container using CSS transforms.
 * @param {HTMLElement} element - The element to make draggable.
 * @param {HTMLElement} container - The container element used as boundary.
 * @param {function(boolean): void} [onDragStateChange] - Called when dragging starts/ends.
 * @returns {function} Cleanup function.
 */
export function makeDraggable(element, container, onDragStateChange) {
    if (!element || !container) return; // Exit early if element or container is not defined

    let isDragging = false;
    let dragStarted = false;
    let startX = 0, startY = 0;
    const threshold = 5;
    let resizeDebounceTimer = null;

    // Initialize transform values
    let currentX = 0, currentY = 0;

    // Store initial element position and set up correct positioning
    const initPositioning = () => {
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        // Validate container and element rect
        if (!containerRect || !elementRect ||
            containerRect.width === 0 || containerRect.height === 0) return;

        // Default positioning - this positions the element at the bottom left of the container
        const defaultX = 0; // Left edge of container
        const defaultY = 0; // Bottom edge of container (negative values move up)

        // Calculate offsets if element is already positioned
        const style = window.getComputedStyle(element);
        const transform = style.transform;

        if (transform && transform !== 'none') {
            const matrix = transform.match(/matrix\((.+)\)/)?.[1]?.split(', ');
            if (matrix && matrix.length >= 6) {
                currentX = parseFloat(matrix[4]);
                currentY = parseFloat(matrix[5]);
            }
        } else {
            // Apply initial positioning if no transform exists
            updateTransform(defaultX, defaultY);
            currentX = defaultX;
            currentY = defaultY;
        }
    };

    // Helper to clamp a value between min and max
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

    // Update the element's transform
    const updateTransform = (tx, ty) => {
        if (!element) return;
        element.style.transform = `translate(${tx}px, ${ty}px)`;
    };

    const onMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        if (!isDragging && (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold)) {
            isDragging = true;
            dragStarted = true;
            if (onDragStateChange) onDragStateChange(true);
        }

        if (isDragging) {
            const containerRect = container.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();

            // Calculate new position with delta
            let newX = currentX + deltaX;
            let newY = currentY + deltaY;

            // Apply boundaries to keep element inside container
            // For X: 0 to containerWidth-elementWidth
            // For Y: -(containerHeight-elementHeight) to 0 (negative values move up)
            const minX = 0;
            const maxX = containerRect.width - elementRect.width;
            const minY = -(containerRect.height); // Negative value to move up to top
            const maxY = 0 - elementRect.height; // Bottom of container

            newX = clamp(newX, minX, maxX);
            newY = clamp(newY, minY, maxY);

            updateTransform(newX, newY);
        }
    };

    const onMouseUp = () => {
        if (isDragging) {
            // Store current transform values for next drag operation
            const style = window.getComputedStyle(element);
            const transform = style.transform;
            if (transform && transform !== 'none') {
                const matrix = transform.match(/matrix\((.+)\)/)?.[1]?.split(', ');
                if (matrix && matrix.length >= 6) {
                    currentX = parseFloat(matrix[4]);
                    currentY = parseFloat(matrix[5]);
                }
            }

            isDragging = false;
            if (onDragStateChange) onDragStateChange(false);
        }

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e) => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    element.addEventListener('mousedown', onMouseDown);

    // Prevent click events if drag occurred
    const onClick = (e) => {
        if (dragStarted) {
            e.preventDefault();
            e.stopPropagation();
            dragStarted = false;
        }
    };

    element.addEventListener('click', onClick, true);

    // Handle container resizing
    const handleResize = () => {
        if (!element || !container) return;

        if (resizeDebounceTimer) {
            cancelAnimationFrame(resizeDebounceTimer);
        }

        resizeDebounceTimer = requestAnimationFrame(() => {
            try {
                const containerRect = container.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();

                // Recalculate boundaries
                const minX = 0;
                const maxX = containerRect.width - elementRect.width;
                const minY = -(containerRect.height);
                const maxY = 0 - elementRect.height;

                // Ensure element stays within boundaries after resize
                currentX = clamp(currentX, minX, maxX);
                currentY = clamp(currentY, minY, maxY);

                updateTransform(currentX, currentY);
                resizeDebounceTimer = null;
            } catch (e) {
                console.warn('Error in resize handler:', e);
            }
        });
    };

    let resizeObserver = null;

    try {
        resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(container);
    } catch (e) {
        console.warn('ResizeObserver not supported or error occurred:', e);
    }

    window.addEventListener('resize', handleResize);

    // Initialize positioning
    initPositioning();

    // Return cleanup function
    return () => {
        if (resizeObserver) {
            resizeObserver.disconnect();
        }

        if (resizeDebounceTimer) {
            cancelAnimationFrame(resizeDebounceTimer);
        }

        element.removeEventListener('mousedown', onMouseDown);
        element.removeEventListener('click', onClick, true);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('resize', handleResize);
    };
}

/**
 * Shows a custom notification message
 * @param {string} message - The message to display in the notification
 * @param {HTMLElement} viewerContainer - the cesium viewer container to append the notification
 * @returns {HTMLElement} - The notification element
 */
export function showCustomNotification(message, viewerContainer) {
    // Create notification container
    const notification = document.createElement('div');
    notification.classList.add('custom-notification');
    notification.textContent = message;

    // Style the notification
    Object.assign(notification.style, {
        position: 'absolute',
        top: '0px', // Position at the bottom
        left: '50%',
        padding: '14px 24px',
        backgroundColor: '#323232', // Material Design dark background
        color: '#FFFFFF', // White text color
        borderRadius: '4px', // Slightly rounded corners
        boxShadow: '0px 3px 5px rgba(0, 0, 0, 0.2)', // Soft shadow for elevation
        zIndex: '1000',
        opacity: '0',
        transition: 'opacity 0.3s, transform 0.3s',
        width: 'fit-content',
        transform: 'translateX(-50%)', // Start slightly below
        fontFamily: 'Roboto, Arial, sans-serif',
        fontSize: '14px',
        lineHeight: '20px',
    });

    // Add to the document
    viewerContainer.appendChild(notification);

    // Fade in
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 100);

    // Fade out and remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, 500);
    }, 3000);

    return notification;
}



/*********************************
 * DEPRECATED: OUTDATED FUNCTION *
 *********************************/
// /**
//  * Updates an element's position using CSS transform translate based on cesium container.
//  * Automatically adjusts position when container dimensions change.
//  *
//  * @param {HTMLElement} element - The DOM element to reposition
//  * @param {HTMLElement} viewerContainer - The container element (typically the viewer container)
//  * @param {number} dx - The x-coordinate offset (horizontal position)
//  * @param {number} dy - The y-coordinate offset (vertical position)
//  * @returns {function} - Cleanup function to remove observers when no longer needed
//  */
// export function updateTranslatePosition(element, viewerContainer, x, y) {
//     if (!element || !viewerContainer) return () => { };

//     // Function to update position based on current rects
//     const updatePosition = () => {
//         const containerRect = viewerContainer.getBoundingClientRect();
//         const elementRect = element.getBoundingClientRect();

//         // Validate container and element rect
//         if (!containerRect || !elementRect ||
//             containerRect.width === 0 || elementRect.width === 0) return;

//         // const x = Math.round(containerRect.left + dx);
//         // const y = Math.round(-(elementRect.height + dy));

//         // Set the element style translate position
//         element.style.transform = `translate(${x}px, ${-y}px)`;
//         element.style.position = 'absolute'; // Ensure absolute positioning
//     };

//     // Create debounce mechanism for resize events
//     let debounceTimer = null;
//     const handleResize = () => {
//         if (debounceTimer) {
//             cancelAnimationFrame(debounceTimer);
//         }

//         debounceTimer = requestAnimationFrame(() => {
//             updatePosition();
//             debounceTimer = null;
//         });
//     };

//     // Set up ResizeObserver with error handling
//     let resizeObserver = null;
//     try {
//         resizeObserver = new ResizeObserver(() => {
//             handleResize();
//         });
//         resizeObserver.observe(viewerContainer);

//         // Also observe the element itself in case its size changes
//         resizeObserver.observe(element);
//     } catch (e) {
//         console.warn('ResizeObserver not supported or error occurred:', e);
//         // Fallback to window resize event
//         window.addEventListener('resize', handleResize);
//     }

//     // Do initial positioning
//     updatePosition();

//     // Return cleanup function
//     return () => {
//         if (resizeObserver) {
//             resizeObserver.disconnect();
//         }
//         if (debounceTimer) {
//             cancelAnimationFrame(debounceTimer);
//         }
//         window.removeEventListener('resize', handleResize);
//     };
// }


// /**
//  * Generate a unique id for annotation mode with its coordinates.
//  * @param {Cesium.Cartesian3 | Cesium.Cartesian3[]} cartesian - The Cartesian coordinates of the point(s).
//  * @param {string} mode - The mode name of the annotation tool.
//  * @returns {string} id - The unique id for entity or primitive.
//  */
// export function generateId(cartesian, mode) {
//     let coordsId = '';

//     if (Array.isArray(cartesian)) {
//         coordsId = cartesian.map(cartesianToId).join('_');
//     } else {
//         coordsId = cartesianToId(cartesian);
//     }

//     return `annotate_${mode.toLowerCase()}_${coordsId}`;
// }

// /**
//  * Convert a Cartesian3 coordinate to a unique short string ID.
//  * @param {Cesium.Cartesian3} cartesian - The Cartesian coordinate.
//  * @returns {string} - The unique short string.
//  */
// function cartesianToId(cartesian) {
//     // Increase precision to reduce collisions
//     const precision = 5; // Adjust as needed
//     const x = cartesian.x.toFixed(precision);
//     const y = cartesian.y.toFixed(precision);
//     const z = cartesian.z.toFixed(precision);

//     // Simple hash function (djb2)
//     let hash = 5381;
//     const str = `${x},${y},${z}`;
//     for (let i = 0; i < str.length; i++) {
//         hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
//     }
//     // Convert hash to a positive number and then to base36 for brevity
//     return Math.abs(hash).toString(36);
// }

// /**
//  * Create multiple point primitives from an array of coordinates.
//  * @param {Cesium.Cartesian3[] | Cesium.Cartographic[]} coordinates - The array of coordinates.
//  * @param {object} [options={}] - Optional configuration for the point primitive.
//  * @returns {Cesium.PointPrimitive[]} - The array of point primitives.
//  */
// export function createPointPrimitivesFromArray(coordinates, options = {}) {
//     // validate coordinates
//     if (!Array.isArray(coordinates) || coordinates.length === 0) {
//         return null;
//     }

//     const points = coordinates.map((coord) => {
//         const point = createPointPrimitive(coord, options)
//         if (!point) {
//             console.error("Create point primitive failed, check passed coordinate.");
//             return null;
//         }
//         return point;
//     }).filter(Boolean); // Filter out any null values

//     return points;
// }

// /**
//  * Create multiple line primitives from an array of coordinates.
//  * @param {Cesium.Primitive} Primitive - The Cesium primitive
//  * @param {Cesium.Cartesian3[] | Cesium.Cartographic[]} coordinateArray
//  * @param {object} [options={}] - Optional configuration for the line primitive
//  * @returns {Cesium.Primitive[]} - The array of line primitives
//  */
// export function createPolylinePrimitivesFromArray(Primitive, coordinateArray, options = {}) {
//     // Validate coordinates
//     if (!Array.isArray(coordinateArray) || coordinateArray.length % 2 !== 0) {
//         return [];
//     }

//     const lines = [];

//     // Process coordinates in pairs (step by 2)
//     for (let i = 0; i < coordinateArray.length; i += 2) {
//         const line = createPolylinePrimitive(
//             Primitive,
//             [coordinateArray[i], coordinateArray[i + 1]],
//             options
//         );

//         if (line) {
//             lines.push(line);
//         } else {
//             console.error(`Create line primitive failed for coordinates at index ${i} and ${i + 1}`);
//         }
//     }

//     return lines;
// }

// /**
//  * Create multiple label primitives from an array of coordinates and values.
//  * @param {Cesium.Cartesian3[]| Cesium.Cartographic[]} coordinates
//  * @param {string[]|number[]} valueArray
//  * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
//  * @param {object} [options={}] - Optional configuration for the label primitive
//  * @returns {Cesium.LabelPrimitive[]} - The array of label primitives.
//  */
// export function createLabelPrimitivesFromArray(coordinates, valueArray, unit = "meter", options = {}) {
//     // Validate coordinates
//     if (!Array.isArray(coordinates) || coordinates.length < 2) {
//         return null;
//     }

//     const labels = [];

//     for (let i = 0; i < coordinates.length - 1; i++) {

//         const label = createLabelPrimitive([coordinates[i], coordinates[i + 1]], valueArray[i], unit, options);
//         if (label) {
//             labels.push(label);
//         } else {
//             console.error("Create label primitive failed, check passed coordinate.");
//         }
//     }

//     return labels;
// }

// /**
//  * Checks if an object has the structure of a Cartesian3 coordinate.
//  * @param {*} coord - The object to check.
//  * @returns {boolean} True if it has x, y, z number properties.
//  * @private // Indicate intended private use
//  */
// export function isCartesian3(coord) {
//     const hasValue = (coord && coord.x !== undefined && coord.y !== undefined && coord.z !== undefined);
//     // Check for null explicitly as typeof null is 'object'
//     if (!hasValue || typeof coord !== 'object' || coord === null) {
//         return false;
//     }
//     const areNumbers = (typeof coord.x === 'number' && typeof coord.y === 'number' && typeof coord.z === 'number');
//     return areNumbers;
// }


// // Function to generate a unique key for a position by rounding coordinates
// export function positionKey(pos) {
//     return `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;
// }

// /**
//  * Generates a unique ID based on the current timestamp.
//  * @returns {number} - A unique ID based on the current timestamp.
//  */
// export function generateIdByTimestamp() {
//     return new Date().getTime();
// }


// /**
//  * change a line primitive color and clone the original color if not already stored
//  * @param {Cesium.Primitive} linePrimitive - the line geometry primitive
//  * @param {Cesium.Color} color - the color to change
//  * @returns {Cesium.Primitive} - the line primitive with the new color
//  */
// export function changeLineColor(linePrimitive, color = Cesium.Color.YELLOW) {
//     if (!linePrimitive) {
//         throw new Error("Invalid linePrimitive provided.");
//     }

//     // Get the original color before the change
//     const originalColor = linePrimitive.appearance.material.uniforms.color.clone();

//     // Change the color
//     linePrimitive.appearance.material.uniforms.color = color;

//     // if linePrimitive has depthFailAppearance, change the color as well
//     if (linePrimitive.depthFailAppearance && linePrimitive.depthFailAppearance.material) {
//         linePrimitive.depthFailAppearance.material.uniforms.color = color;
//     }
//     return {
//         linePrimitive,
//         originalColor,
//         color: color
//     };
// }

// /**
//  * reset the line primitive color by its original color
//  * @param {Cesium.Primitive} linePrimitive - the line geometry primitive
//  * @returns {Cesium.Primitive} - the line primitive with the new color
//  */
// export function resetLineColor(linePrimitive) {
//     if (linePrimitive.originalColor) {
//         // Reset to the original color
//         linePrimitive.appearance.material.uniforms.color = linePrimitive.originalColor.clone();
//         // if linePrimitive has depthFailAppearance, reset the color as well
//         if (linePrimitive.depthFailAppearance) {
//             linePrimitive.depthFailAppearance.material.uniforms.color = linePrimitive.originalColor.clone();
//         }
//         // linePrimitive.originalColor = null;
//     }
//     return linePrimitive;
// }

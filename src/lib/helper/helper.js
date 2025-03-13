import * as Cesium from "cesium";

/********************************
 * HELPER FUNCTIONS FOR GENERAL *
 ********************************/
/**
 * calculate the distance between two points
 * @param {Cesium.Cartesian3} startPoint - the cartesian coordinates
 * @param {Cesium.Cartesian3} endPoint - the cartesian coordinates
 * @returns {number} distance - the distance between startPoint and endPoint
 */
export function calculateDistance(startPoint, endPoint) {
    return Cesium.Cartesian3.distance(startPoint, endPoint);
}

/**
 * Compares two coordinates based on the specified coordinate type.
 *
 * @param {"cartographicDegrees"|"cartographic"|"cartesian"} [coordType="cartographicDegrees"] - The type of coordinate to compare.
 * @param {Object} coordinate1 - The first coordinate object.
 * @param {Object} coordinate2 - The second coordinate object.
 * @returns {boolean} - True if the coordinates match; otherwise false.
 */
export function areCoordinatesEqual(coordType = "cartographicDegrees", coordinate1, coordinate2) {
    switch (coordType) {
        case "cartographicDegrees":
        case "cartographic":
            return (
                coordinate1.longitude === coordinate2.longitude &&
                coordinate1.latitude === coordinate2.latitude &&
                coordinate1.height === coordinate2.height
            );
        case "cartesian":
            return (
                coordinate1.x === coordinate2.x &&
                coordinate1.y === coordinate2.y &&
                coordinate1.z === coordinate2.z
            );
        default:
            return false;
    }
}

/**
 * Convert the coordinate to cartesian3 coordinate
 * @param {*} coordinate - cesium coordinate object. It could be either cartographic degrees or cartographic radians or cartesian3
 * @returns {Cesium.Cartesian3} cartesian - the cartesian3 coordinate
 */
export function convertToCartesian3(coordinate) {
    if (!Cesium.defined(coordinate)) return;

    let cartesian = coordinate;

    if (coordinate.longitude) {
        const isCartographicDegrees = Math.abs(coordinate.longitude) > 10;
        const isCartographicRadians = Math.abs(coordinate.longitude) <= 10;
        switch (true) {
            case isCartographicDegrees:
                cartesian = Cesium.Cartesian3.fromDegrees(
                    coordinate.longitude,
                    coordinate.latitude,
                    coordinate.height
                );
                break;
            case isCartographicRadians:
                cartesian = Cesium.Cartesian3.fromRadians(
                    coordinate.longitude,
                    coordinate.latitude,
                    coordinate.height
                );
                break;
            default:
                break;
        }
    } else if (coordinate.x) {
        return cartesian; // if it is already cartesian3
    }

    return cartesian;
}

/**
 * Convert the cartesian3 coordinate to cartographic degrees
 * @param {Cesium.Cartesian3} cartesian - The Cartesian3 coordinate to convert to Cartographic degrees.
 * @returns {Object} cartographic - The Cartographic degrees coordinate.
 */
export function cartesian3ToCartographicDegrees(cartesian) {
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return {
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height
    };
}

/**
 * Convert options of Cartesian3 or Cartographic to CartographicDegrees
 * @param {Cartesian3|Cartographic} coordinate 
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

    return;
}

function checkCoordinateType(coordinate) {
    // Error handling: check if the coordinate is defined and an object
    if (!coordinate || typeof coordinate !== 'object') return;

    // Deconstruct the coordinate object
    const { x, y, z, longitude, latitude } = coordinate;

    // Check if the coordinate is in cartesian3
    if ([x, y, z].every(num => typeof num === 'number')) {
        return 'cartesian3';
    }

    // Check if the coordinate is in cartographic or cartographic degrees
    if (typeof longitude === 'number' && typeof latitude === 'number') {
        return Math.abs(longitude) > 10 ? 'cartographicDegrees' : 'cartographic';
    }

    return;
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
 * Generate a unique id for annotation mode with its coordinates. 
 * @param {Cesium.Cartesian3 | Cesium.Cartesian3[]} cartesian - The Cartesian coordinates of the point(s).
 * @param {string} mode - The mode name of the annotation tool.
 * @returns {string} id - The unique id for entity or primitive.
 */
export function generateId(cartesian, mode) {
    let coordsId = '';

    if (Array.isArray(cartesian)) {
        coordsId = cartesian.map(cartesianToId).join('_');
    } else {
        coordsId = cartesianToId(cartesian);
    }

    return `annotate_${mode.toLowerCase()}_${coordsId}`;
}

/**
 * Convert a Cartesian3 coordinate to a unique short string ID.
 * @param {Cesium.Cartesian3} cartesian - The Cartesian coordinate.
 * @returns {string} - The unique short string.
 */
function cartesianToId(cartesian) {
    // Increase precision to reduce collisions
    const precision = 5; // Adjust as needed
    const x = cartesian.x.toFixed(precision);
    const y = cartesian.y.toFixed(precision);
    const z = cartesian.z.toFixed(precision);

    // Simple hash function (djb2)
    let hash = 5381;
    const str = `${x},${y},${z}`;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
    }
    // Convert hash to a positive number and then to base36 for brevity
    return Math.abs(hash).toString(36);
}

// Function to generate a unique key for a position by rounding coordinates
export function positionKey(pos) {
    return `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;
}

// use timestamp to generate id, the id is unique and in integer format
export function generateIdByTimestamp() {
    return new Date().getTime();
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
    if (!Array.isArray(cartesianArray) || !scene || !scene.terrainProvider) {
        throw new Error('Invalid input parameters.');
    }

    // Convert Cartesian3 to Cartographic
    const cartographicArray = cartesianArray.map(cartesian => Cesium.Cartographic.fromCartesian(cartesian));

    // Sample terrain heights in batch
    const sampledPositions = await Cesium.sampleTerrainMostDetailed(scene.terrainProvider, cartographicArray);

    const clampedCartesianArray = [];

    // Iterate through sampled positions
    sampledPositions.forEach((cartographic, index) => {
        if (cartographic.height !== undefined && cartographic.height !== null) {
            const clampedCartesian = Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                cartographic.height
            );
            clampedCartesianArray.push(clampedCartesian);
        } else {
            console.warn(`Skipping coordinate at index ${index}: Terrain height undefined.`);
        }
    });

    return clampedCartesianArray;
}



/*****************************************
 * HELPER FUNCTIONS FOR CESIUM PRIMITIVE *
 *****************************************/
// point primitive
/**
 * Create a point primitive.
 * @param {Cesium.Cartesian3 | Cesium.Cartographic} coordinate - The Cartesian3 coordinate of the point.
 * @param {Cesium.Color} [color=Cesium.Color.RED] - The color of the point.
 * @param {String} [modeString] - The measure mode string
 * @returns {Cesium.PointPrimitive} - The point primitive.
 */
export function createPointPrimitive(coordinate, color = Cesium.Color.RED, modeString) {
    if (!coordinate) return; // Exit early if coordinate is not defined

    //check if coordinate is cartographic degrees or radians or cartesian
    const cartesian = convertToCartesian3(coordinate);

    return {
        position: cartesian,
        pixelSize: 8,
        color: color,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: modeString ? generateId(cartesian, modeString) : undefined,
    };
}

// line primitive
/**
 * Create a line primitive with custom width and color.
 * @param {Cesium.Cartesian3[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {String} modeString - The measure mode string
 * @param {Number} width - The width of the line
 * @param {Cesium.Color} [color = Cesium.Color.YELLOWGREEN] - The color of the line
 * @param {Cesium.Primitive} Primitive - The Cesium primitive
 * @returns {Cesium.Primitive} - The line primitive
 */
export function createPolylinePrimitive(coordinateArray, modeString, width = 3, color = Cesium.Color.YELLOWGREEN, Primitive) {
    // Exit early if coordinateArray is not defined
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) return;

    // Convert the coordinates to Cartesian3
    const convertedCoordinates = coordinateArray.map((pos) => convertToCartesian3(pos));

    // Create the line geometry instance
    const lineGeometry = new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
            positions: convertedCoordinates,
            width,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT
        }),
        id: generateId(convertedCoordinates, modeString),
    });

    // Create the material and appearance
    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.PolylineMaterialAppearance({ material: material });

    // Create the line primitive
    const linePrimitive = new Primitive({
        geometryInstances: lineGeometry,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: true,
        vertexCacheOptimize: true,
        interleave: true,
    });
    // add custom properties positions and id to line primitive
    linePrimitive.positions = convertedCoordinates;
    linePrimitive.id = generateId(convertedCoordinates, modeString);

    return linePrimitive;
}

// line arrow primitive
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

// label primitive
/**
 * Create a label primitive.
 * @param {Cesium.Cartesian3} startPoint - the start point of the line
 * @param {Cesium.Cartesian3} endPoint - the end point of the line
 * @param {number|string} distanceOrText - the distance or text to display on the label
 * @returns {Object} - The label primitive.
 */
export function createLabelPrimitive(startPoint, endPoint, distanceOrText) {
    const midpoint = Cesium.Cartesian3.lerp(startPoint, endPoint, 0.5, new Cesium.Cartesian3());
    const labelOffset = new Cesium.Cartesian2(0, -20);

    const labelString = typeof distanceOrText === 'number' ? formatDistance(distanceOrText) : distanceOrText;

    const scaleByDistance = new Cesium.NearFarScalar(1000.0, 1.0, 20000.0, 0.5);

    return {
        position: midpoint,
        pixelOffset: labelOffset,
        text: labelString,
        font: "14px Roboto, sans-serif",
        fillColor: Cesium.Color.WHITE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        scale: 1.2,
        scaleByDistance: scaleByDistance,
        style: Cesium.LabelStyle.FILL,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // Disable depth test to always show on top
    };
}

// polygon primitive
/**
 * Creates a polygon primitive.
 * @param {Cesium.Cartesian3[]} coordinateArray - An array of Cartesian3 coordinates defining the polygon vertices.
 * @param {string} modeString - The mode string used to generate the ID.
 * @param {Cesium.Color} [color=Cesium.Color.GREEN.withAlpha(0.8)] - The color of the polygon.
 * @param {Cesium.Primitive} Primitive - The Cesium primitive.
 * @returns {Cesium.Primitive|null} - The polygon primitive or null if input is invalid.
 */
export function createPolygonPrimitive(coordinateArray, modeString, color = Cesium.Color.GREEN.withAlpha(0.8), Primitive) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) return null;

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);

    // Create the polygon geometry instance
    const geometryInstance = new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
            perPositionHeight: true,
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
        }),
        id: generateId(convertedCoordinates, modeString),
    });

    // Create the polygon primitive
    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.EllipsoidSurfaceAppearance({ material: material });

    const polygonPrimitive = new Primitive({
        geometryInstances: geometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: true,
        vertexCacheOptimize: true,
        interleave: true,
    });

    // set custom properties to the polygon primitive
    polygonPrimitive.id = generateId(convertedCoordinates, modeString);
    polygonPrimitive.positions = convertedCoordinates;

    return polygonPrimitive;
}

/**
 * Create a polygon outline primitive.
 * @param {Array} coordinateArray - An array of coordinates.
 * @param {string} modeString - The mode string used for generating the ID.
 * @param {Cesium.Color} [color=Cesium.Color.YELLOW] - The color of the polygon outline.
 * @param {Cesium.Primitive} Primitive - The Cesium primitive.
 * @returns {Cesium.Primitive|null} - The polygon outline primitive or null if input is invalid.
 */
export function createPolygonOutlinePrimitive(coordinateArray, modeString, color = Cesium.Color.YELLOW, Primitive) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) return null;

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);

    // create a polygon outline geometry instance
    const geometryInstance = new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonOutlineGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
            perPositionHeight: true
        }),
        id: `${generateId(coordinateArray, modeString)}`,
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
        }
    });

    // create a polygon outline primitive
    const appearance = new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false });

    const polygonOutlinePrimitive = new Primitive({
        geometryInstances: geometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: true,
        vertexCacheOptimize: true,
        interleave: true,
    });

    // set custom properties to the polygon outline primitive
    polygonOutlinePrimitive.id = generateId(convertedCoordinates, modeString);
    polygonOutlinePrimitive.positions = convertedCoordinates;

    return polygonOutlinePrimitive;
}

/**
 * change a line primitive color and clone the original color if not already stored
 * @param {Cesium.Primitive} linePrimitive - the line geometry primitive
 * @param {Cesium.Color} color - the color to change
 * @returns {Cesium.Primitive} - the line primitive with the new color
 */
export function changeLineColor(linePrimitive, color = Cesium.Color.YELLOW) {
    if (!linePrimitive) {
        throw new Error("Invalid linePrimitive provided.");
    }

    // Get the original color before the change
    const originalColor = linePrimitive.appearance.material.uniforms.color.clone();

    // Change the color
    linePrimitive.appearance.material.uniforms.color = color;

    // if linePrimitive has depthFailAppearance, change the color as well
    if (linePrimitive.depthFailAppearance && linePrimitive.depthFailAppearance.material) {
        linePrimitive.depthFailAppearance.material.uniforms.color = color;
    }
    return {
        linePrimitive,
        originalColor,
        color: color
    };
}

/**
 * reset the line primitive color by its original color
 * @param {Cesium.Primitive} linePrimitive - the line geometry primitive
 * @returns {Cesium.Primitive} - the line primitive with the new color
 */
export function resetLineColor(linePrimitive) {
    if (linePrimitive.originalColor) {
        // Reset to the original color
        linePrimitive.appearance.material.uniforms.color = linePrimitive.originalColor.clone();
        // if linePrimitive has depthFailAppearance, reset the color as well
        if (linePrimitive.depthFailAppearance) {
            linePrimitive.depthFailAppearance.material.uniforms.color = linePrimitive.originalColor.clone();
        }
        // linePrimitive.originalColor = null;
    }
    return linePrimitive;
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

    const { id, primitive } = pickedObject;

    const searchString = modeString ? `annotate_${modeString}` : `annotate_`;

    // Return null if 'id' doesn't start with the search string or contains 'moving'
    if (id.includes('moving')) {
        return null;
    }

    // Determine the type based on the suffix of the 'id'
    const isPoint = modeString ? id.startsWith(`${searchString}_point`) : (id.startsWith(`${searchString}`) && id.includes('_point'));
    const isLine = modeString ? id.startsWith(`${searchString}_line`) : (id.startsWith(`${searchString}`) && id.includes('_line'));
    const isLabel = modeString ? id.startsWith(`${searchString}_label`) : (id.startsWith(`${searchString}`) && id.includes('_label'));


    if (isPoint) {
        return 'point';
    } else if (isLine) {
        return 'line';
    } else if (id.includes("tileId") && primitive?.feature?.type === "fireTrail") {
        return 'line'
    } else if (isLabel) {
        return 'label';
    } else {
        return;
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
 * @returns {Object} Object containing calculated distances and positions.
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
 * @param {Object} scene - The Cesium scene containing the primitives
 * @param {Object} pointCollection - The point collection to search in
 * @param {Object} labelCollection - The label collection to search in
 * @returns {Object} An object containing the found pointPrimitive, linePrimitives, and labelPrimitives
 */
export function getPrimitiveByPointPosition(position, startsWithMeasureMode, scene, pointCollection, labelCollection) {
    // get point primitive by position
    const pointPrimitive = pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith(startsWithMeasureMode) &&
        !p.id.includes("moving") &&
        Cesium.Cartesian3.equals(p.position, position)
    );

    // get line primitives by position
    const linePrimitives = scene.primitives._primitives.filter(p =>
        (typeof p.id === "string") &&
        p.id.includes(startsWithMeasureMode) &&
        !p.id.includes("moving") &&
        p.positions.some(cart => Cesium.Cartesian3.equals(cart, position))
    );

    // get label primitives by lines positions
    // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
    const linePositions = linePrimitives.map(p => p.positions);
    const midPoints = linePositions.map((positions) => Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3()));
    const labelPrimitives = midPoints.map(midPoint =>
        labelCollection._labels.find(l => l.id && l.id.startsWith(startsWithMeasureMode) &&
            !l.id.includes("moving") &&
            Cesium.Cartesian3.equals(l.position, midPoint)
        )
    ).filter(label => label !== undefined);

    // Sort labelPrimitives by their text
    labelPrimitives.sort((a, b) => a.text.toUpperCase().localeCompare(b.text.toUpperCase()));

    return { pointPrimitive, linePrimitives, labelPrimitives };
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


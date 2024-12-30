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
        releaseGeometryInstances: false,
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
        releaseGeometryInstances: false
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
        releaseGeometryInstances: false
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
    const searchString = `annotate_${modeString}`;

    // Return null if 'id' doesn't start with the search string or contains 'moving'
    if (id.includes('moving')) {
        return null;
    }

    // Determine the type based on the suffix of the 'id'
    if (id.startsWith(`${searchString}_point`)) {
        return 'point';
    } else if (id.startsWith(`${searchString}_line`)) {
        return 'line';
    } else if (id.includes("tileId") && primitive?.feature?.type === "fireTrail") {
        return 'line'
    } else if (id.startsWith(`${searchString}_label`)) {
        return 'label';
    } else {
        return 'other';
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
        return clampedPositions;
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
    return interpolatedPoints;
}

/**
 * Calculates the clamped distance between two points by interpolating and summing segment distances.
 * @param {Cesium.Cartesian3} pointA - The first Cartesian coordinate.
 * @param {Cesium.Cartesian3} pointB - The second Cartesian coordinate.
 * @param {Scene} scene - viewer.scene
 * @param {number} [interval=2] - The interval between interpolated points.
 * @returns {{distance: number, pickedCartesianGroup: Cesium.Cartesian3[]}} - An object containing:
 *  - `distance`: The total clamped distance between the two points.
 *  - `pickedCartesianGroup`: An array of interpolated Cartesian coordinates used in the calculation.
 */
export function calculateClampedDistance(pointA, pointB, scene, interval = 2) {
    const pickedCartesianGroup = computeDetailedPickPositions(pointA, pointB, scene, interval);
    let distance = 0; // Initialize to 0 instead of null

    for (let i = 0; i < pickedCartesianGroup.length - 1; i++) {
        distance += Cesium.Cartesian3.distance(pickedCartesianGroup[i], pickedCartesianGroup[i + 1]);
    }

    return { distance, pickedCartesianGroup };
}

/**
 * Calculates the clamped distances between each pair of points in the array and the total distance.
 * @param {Cesium.Cartesian3[]} cartesianArray - An array of Cartesian coordinates.
 * @param {Scene} scene - viewer.scene
 * @param {number} [interval=2] - The interval between interpolated points.
 * @returns {{ distances: number[], totalDistance: number, pickedCartesianGroups: Cesium.Cartesian3[] }} - The distances between each pair of points and the total distance.
 */
export function calculateClampedDistanceFromArray(cartesianArray, scene, interval = 2) {
    const distances = [];
    const pickedCartesianGroups = [];
    for (let i = 0; i < cartesianArray.length - 1; i++) {
        const { distance, pickedCartesianGroup } = calculateClampedDistance(cartesianArray[i], cartesianArray[i + 1], scene, interval);
        distances.push(distance);
        pickedCartesianGroups.push(pickedCartesianGroup);
    }

    const totalDistance = distances.reduce((a, b) => a + b, 0);
    return { distances, totalDistance, pickedCartesianGroups };
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
 * Makes an HTML element draggable within a specified container.
 * @param {HTMLElement} element - The HTML element to be made draggable.
 * @param {HTMLElement} container - The container within which the element can be dragged.
 * @param {function(number, number, DOMRect): void} [updatePositionCallback] - Callback function to update the position of the element.
 * @param {function(boolean): void} [onDragStateChange] - Optional callback function to notify when dragging starts or ends.
 */
export function makeDraggable(element, container, updatePositionCallback, onDragStateChange) {
    let posInitialX = 0, posInitialY = 0;  // Initial cursor positions
    let isDragging = false;  // Internal flag to track dragging state
    let dragStarted = false; // Flag to indicate if dragging has started
    const threshold = 5;  // Pixels to move before triggering a drag

    // Function to emit drag state changes
    const emitDragState = (newState) => {
        if (isDragging !== newState) {
            isDragging = newState;
            if (typeof onDragStateChange === 'function') {
                onDragStateChange(isDragging);
            }
        }
    };

    // Retrieves the bounding rectangle of the container
    const fetchContainerRect = () => container.getBoundingClientRect();
    let containerRect = fetchContainerRect();  // Initial dimensions of the container

    // Updates the position of the draggable element
    const updatePosition = (newTop, newLeft) => {
        containerRect = fetchContainerRect();  // Refresh dimensions for dynamic changes

        // Ensure the element remains within container bounds
        newLeft = Math.max(0, Math.min(newLeft, containerRect.width - element.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, containerRect.height - element.offsetHeight));

        // Apply the new position styles to the element
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;

        // Call the callback function with new position and updated container dimensions
        if (updatePositionCallback) {
            updatePositionCallback(newTop, newLeft);
        }
    };

    // Handles the mouse move event to update the element's position
    const elementDrag = (event) => {
        event.preventDefault();
        const deltaX = Math.abs(posInitialX - event.clientX);
        const deltaY = Math.abs(posInitialY - event.clientY);

        if (!isDragging && (deltaX > threshold || deltaY > threshold)) {
            emitDragState(true);
            dragStarted = true;  // Indicate that dragging has started
        }

        if (isDragging) {
            const deltaX = posInitialX - event.clientX;
            const deltaY = posInitialY - event.clientY;

            posInitialX = event.clientX;
            posInitialY = event.clientY;

            const newTop = element.offsetTop - deltaY;
            const newLeft = element.offsetLeft - deltaX;
            updatePosition(newTop, newLeft);
        }
    };

    // Cleans up event listeners when dragging ends
    const closeDragElement = () => {
        document.onmouseup = null;
        document.onmousemove = null;
        if (isDragging) {
            emitDragState(false);
        }
    };

    // Prevent click event if dragging has occurred
    const preventClickAfterDrag = (event) => {
        if (dragStarted) {
            event.stopPropagation();
            event.preventDefault();
            dragStarted = false;  // Reset the flag
        }
    };

    // Initiates dragging
    element.addEventListener('mousedown', (event) => {
        // Avoid dragging when clicking on input elements to allow normal interaction
        if (event.target.tagName.toLowerCase() === 'input' || event.target.tagName.toLowerCase() === 'textarea') {
            return;
        }
        event.preventDefault();
        posInitialX = event.clientX;
        posInitialY = event.clientY;
        dragStarted = false;  // Reset the flag
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    });

    // Attach the click event listener to prevent click after drag
    element.addEventListener('click', preventClickAfterDrag, true);

    // Handle container resize using ResizeObserver
    const handleResize = () => {
        containerRect = fetchContainerRect();  // Refresh container dimensions

        // Get current position of the element
        let currentLeft = parseInt(element.style.left, 10) || 0;
        let currentTop = parseInt(element.style.top, 10) || 0;

        // Adjust position if it's outside the container bounds
        const adjustedLeft = Math.max(0, Math.min(currentLeft, containerRect.width - element.offsetWidth));
        const adjustedTop = Math.max(0, Math.min(currentTop, containerRect.height - element.offsetHeight));

        // Update the position only if it has changed
        if (currentLeft !== adjustedLeft || currentTop !== adjustedTop) {
            element.style.left = `${adjustedLeft}px`;
            element.style.top = `${adjustedTop}px`;

            // Call the updatePositionCallback with new position
            if (updatePositionCallback) {
                updatePositionCallback(adjustedTop, adjustedLeft);
            }
        }
    };

    // Set up ResizeObserver on the container
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Clean up function to remove event listeners and observers when needed
    const cleanup = () => {
        resizeObserver.unobserve(container);
        resizeObserver.disconnect();
        element.removeEventListener('mousedown', this);
        element.removeEventListener('click', preventClickAfterDrag, true);
        document.onmouseup = null;
        document.onmousemove = null;
    };

    // Return the cleanup function optionally
    return cleanup;
}

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


/********************************************
 * DEPRECATED FUNCTIONS, TO BE REMOVE LATER *
 ********************************************/
/**
 * Deprecated function. Use createPolylinePrimitive instead.
 * Create a line geometry instance.
 * @param {Cesium.Cartesian3[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {string} mode - the mode string to filter the picked object. e.g. "multi_distance"
 * @returns {Cesium.GeometryInstance} - The geometry instance of the line.
 */
export function createLineGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) return;

    const convertedCoordinates = coordinateArray.map((pos) => convertToCartesian3(pos));

    return new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
            positions: convertedCoordinates,
            width: 3,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT
        }),
        id: generateId(convertedCoordinates, mode),
    });
}

/**
 * Deprecated function. Use createPolylinePrimitive instead.
 * Create a line primitive.
 * @param {Cesium.GeometryInstance} geometryInstance - line geometry instance
 * @param {Cesium.Color} color - the color of the line
 * @param {Cesium.Primitive} Primitive - the cesium primitive
 * @returns {Cesium.Primitive} - the line primitive
 */
export function createLinePrimitive(geometryInstance, color = Cesium.Color.RED, Primitive) {
    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.PolylineMaterialAppearance({ material: material });

    return new Primitive({
        geometryInstances: geometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: false
    });
}

/**
 * Deprecated function. Use createGroundPolylinePrimitive instead.
 * Create a clamped line geometry instance.
 * @param {Cesium.Cartesian3[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {string} mode - the mode string to filter the picked object. e.g. "multi_distance"
 * @returns {Cesium.GeometryInstance} - The geometry instance of the clamped line.
 */
export function createClampedLineGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) return null;

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);

    return new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
            positions: convertedCoordinates,
            width: 3
        }),
        id: generateId(convertedCoordinates, mode),
    });
}

/**
 * Deprecated function. Use createGroundPolylinePrimitive instead.
 * Create a clamped line primitive.
 * @param {Cesium.GeometryInstance} geometryInstance - the geometry instance of the clamped line
 * @param {Cesium.Color} color - the color of the line
 * @param {Cesium.GroundPolylinePrimitive} GroundPolylinePrimitive - the cesium GroundPolylinePrimitive
 * @returns {Cesium.GroundPolylinePrimitive} - the clamped line primitive
 */
export function createClampedLinePrimitive(geometryInstance, color = Cesium.Color.RED, GroundPolylinePrimitive) {
    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.PolylineMaterialAppearance({ material: material });

    return new GroundPolylinePrimitive({
        geometryInstances: geometryInstance,
        appearance: appearance,
        asynchronous: true,
        releaseGeometryInstances: false,
    });
}

/**
 * Deprecated function: use createPolygonPrimitive instead.
 * Create a polygon geometry instance.
 * @param {Cesium.Cartesian3[]} coordinateArray - the array of cartesian3 coordinates of the polygon
 * @param {string} mode - the mode string to filter the picked object. e.g. "multi_distance" 
 * @returns {Cesium.GeometryInstance} - The geometry instance of the polygon.
 */
export function createPolygonGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) return null;

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);

    return new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
            perPositionHeight: true,
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
        }),
        id: generateId(convertedCoordinates, mode),
    });
}

/**
 * Deprecated function: use createPolygonPrimitive instead.
 * Create a polygon outline geometry instance.
 * @param {Cesium.Cartesian3[]} coordinateArray - the array of cartesian3 coordinates of the polygon
 * @param {string} mode - the mode string to filter the picked object. e.g. "multi_distance"
 * @param {Cesium.Color} color - the color of the polygon outline 
 * @returns {Cesium.GeometryInstance} - The geometry instance of the polygon outline.
 */
export function createPolygonOutlineGeometryInstance(coordinateArray, mode, color = Cesium.Color.YELLOW) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) return null;

    const convertedCoordinates = coordinateArray.map(convertToCartesian3);

    return new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonOutlineGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
            perPositionHeight: true
        }),
        id: `${generateId(coordinateArray, mode)}`,
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
        }
    });
}
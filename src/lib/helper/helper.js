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
        const isCartographicDregrees = Math.abs(coordinate.longitude) > 10;
        const isCartographicRadians = Math.abs(coordinate.longitude) <= 10;
        switch (true) {
            case isCartographicDregrees:
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
 * @param {Cesium.Cartesian3 | Cesium.Cartesian3[]} cartesian - The Cartesian coordinates of the point.
 * @param {string} mode - The mode name of the annotation tool.
 * @returns {string} id - The unique id for entity or primitive.
 */
export function generateId(cartesian, mode) {
    let coordsId = null;
    // cartesian could be either array or cartesian3
    if (Array.isArray(cartesian)) {
        cartesian.forEach((cart) => {
            const coordId = cartesianToId(cart);
            coordsId = coordsId ? coordsId + "_" + coordId : coordId;
        });
    } else {
        coordsId = cartesianToId(cartesian);
    }

    // Create the id using the hash
    return `annotate_${mode.toString().toLowerCase()}_${coordsId}`;
}

/**
 * generate id for cartesian coordinate
 * @param {Cesium.Cartesian3} cartesian 
 * @returns {string} id - the id for the cartesian coordinate
 */
export function cartesianToId(cartesian, isString = true) {
    // Convert the cartesian position to a string
    const positionString = cartesian.toString();

    let hash = 0;
    // Loop through the characters of the position string and calculate the hash
    for (let i = 0; i < positionString.length; i++) {
        const char = positionString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to a 32-bit integer
    }
    // create id using hash
    return isString ? `${Math.abs(hash).toString(36)}` : Math.abs(hash);
}

// Function to generate a unique key for a position by rounding coordinates
export function positionKey(pos) {
    return `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;
}

// use timestamp to generate id, the id is unique and in integer format
export function generateIdByTimestamp() {
    return new Date().getTime();
}

/*****************************************
 * HELPER FUNCTIONS FOR CESIUM PRIMITIVE *
 *****************************************/
// point primitive
/**
 * Create a point primitive.
 * @param {Cesium.Cartesian3} coordinate - The Cartesian3 coordinate of the point.
 * @param {Cesium.Color} color - The color of the point.
 * @returns {Cesium.PointPrimitive} - The point primitive.
 */
export function createPointPrimitive(coordinate, color = Cesium.Color.RED) {
    if (!coordinate) return; // Exit early if coordinate is not defined

    //check if coordinate is cartographic degrees or radians or cartesian
    const cartesian = convertToCartesian3(coordinate);

    return {
        position: cartesian,
        pixelSize: 8,
        color: color,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    }
}

// line primitive
/**
 * Create a line geometry instance.
 * @param {Cesium.Cartesian3[]} coordinateArray - The array of Cartesian3 coordinates of the line.
 * @param {string} mode - the mode string to filter the picked object. e.g. "multi_distance"
 * @returns {Cesium.GeometryInstance} - The geometry instance of the line.
 */
export function createLineGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) return;

    const convertedCoordinates = coordinateArray.map((item) => convertToCartesian3(item));

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
 * Create a polygon geometry instance.
 * @param {Cesium.Cartsian3[]} coordinateArray - the array of cartesian3 coordinates of the polygon
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
 * Create a polygon primitive.
 * @param {Cesium.PolygonGeometry} polygonGeometryInstance - The polygon geometry instance.
 * @param {Cesium.Color} color - The color of the polygon.
 * @param {Cesium.Primitive} Primitive - The Cesium primitive.
 * @returns {Cesium.Primitive} - The polygon primitive.
 */
export function createPolygonPrimitive(polygonGeometryInstance, color = Cesium.Color.GREEN.withAlpha(0.8), Primitive) {
    const material = new Cesium.Material.fromType('Color', { color: color });
    const appearance = new Cesium.EllipsoidSurfaceAppearance({ material: material });

    return new Primitive({
        geometryInstances: polygonGeometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: false
    });
}
/**
 * Create a polygon outline geometry instance.
 * @param {Cesium.Cartsian3[]} coordinateArray - the array of cartesian3 coordinates of the polygon
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
        id: `${generateId(coordinateArray, mode)}-outline`,
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
        }
    });
}
/**
 * Create a polygon outline primitive.
 * @param {Cesium.OutlineGeometryInstance} outlineGeometryInstance - the outline geometry instance
 * @param {Cesium.Primitive} Primitive - the cesium primitive
 * @returns {Cesium.Primitive} - the polygon outline primitive
 */
export function createPolygonOutlinePrimitive(outlineGeometryInstance, Primitive) {
    const appearance = new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false });

    return new Primitive({
        geometryInstances: outlineGeometryInstance,
        appearance: appearance,
        depthFailAppearance: appearance,
        asynchronous: false,
        releaseGeometryInstances: false
    });
}

/**
 * change a line primitive color and clone the original color if not already stored
 * @param {Cesium.Primitive} linePrimitive - the line geometry primitive
 * @param {Cesium.Color} color - the color to change
 * @returns {Cesium.Primitive} - the line primitive with the new color
 */
export function changeLineColor(linePrimitive, color = Cesium.Color.YELLOW) {
    // Store the original color if not already stored
    if (linePrimitive) {
        // line primitives don't have the originalColor property by default so we need to create it
        linePrimitive.originalColor = linePrimitive.appearance.material.uniforms.color.clone();

        if (linePrimitive.depthFailAppearance) {
            linePrimitive.originalColor = linePrimitive.depthFailAppearance.material.uniforms.color.clone();
        }
    }
    // Change the color
    linePrimitive.appearance.material.uniforms.color = color;
    // if linePrimitive has depthFailAppearance, change the color as well
    if (linePrimitive.depthFailAppearance) {
        linePrimitive.depthFailAppearance.material.uniforms.color = color;
    }
    return linePrimitive;
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
    // handler.removeInputAction(Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
    return handler;
}

/**
 * get the type of the Cesium picked object
 * @param {*} pickedObject - viewer.scene.pick
 * @param {string} modeString - the mode string to filter the picked object. e.g. "multi_distance"
 * @returns {string} - the type of the picked object
 */
export function getPickedObjectType(pickedObject, modeString) {
    const searchString = "annotate_" + modeString;
    if (Cesium.defined(pickedObject) &&
        pickedObject.id &&
        pickedObject.id.startsWith(searchString) &&
        !pickedObject.id.includes("moving")) {
        if (pickedObject.id.startsWith(`${searchString}_point`)) {
            return "point"
        } else if (pickedObject.id.startsWith(`${searchString}_line`)) {
            return "line"
        } else if (pickedObject.id.startsWith(`${searchString}_label`)) {
            return "label"
        } else {
            return "other"
        }
    }
    return null;
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
    // repick the position by convert back to window position to repick the carteisan, drawbacks is the current camera must see the whole target. 
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
 * @param {Scene} scene - viwer.scene
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
        p.geometryInstances &&
        p.geometryInstances.id &&
        p.geometryInstances.id.includes(startsWithMeasureMode) &&
        !p.geometryInstances.id.includes("moving") &&
        p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, position))
    );

    // get label primitives by lines positions
    // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
    const linePositions = linePrimitives.map(p => p.geometryInstances.geometry._positions);
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
            updatePositionCallback(newTop, newLeft, containerRect);
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
                updatePositionCallback(adjustedTop, adjustedLeft, containerRect);
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



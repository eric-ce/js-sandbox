import * as Cesium from "cesium";
import { convertToCartesian3, formatDistance } from "./cesiumHelper.js";

// Cesium entity
/**
 * Create a point entity setting at the given Cartesian coordinates with the specified color.
 * @param {Cesium.Cartesian3 | Cesium.Cartographic} coordinate - The coordinate of point entity
 * @param {Cesium.Color} color - The color of the point entity.
 * @return {Object} the property for point entity that can be added to the viewer. use viewer.entities.add()
 */
export function createPointEntity(coordinate, color = Cesium.Color.RED) {
    if (!coordinate) {
        return; // Exit early if coordinate is not defined
    }

    //check if coordinate is cartographic degrees or radians or cartesian
    const cartesian = convertToCartesian3(coordinate);

    // Create a point entity with the given position and color
    return {
        // id: formatEntityId(cartesian), // Use a unique id for the point entity
        position: cartesian,
        point: {
            pixelSize: 8,
            color: color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    };
}

/**
 * Creates a line entity between two or more points using a mix of Cartesian3 and Cartographic coordinates.
 *
 * @param {(Cesium.Cartesian3|Cesium.Cartographic)[]} coordinateArray - An array of Cartesian3 or Cartographic coordinates representing the points of the line. The function will convert Cartographic points to Cartesian3 internally.
 * @param {Cesium.Color} [cesiumColor=Cesium.Color.RED] - The color of the line entity.
 * @returns {Object} the property for line entity that can be added to the viewer. use viewer.entities.add()
 */
export function createLineEntity(
    coordinateArray,
    cesiumColor = Cesium.Color.RED,
    isClamped = false,
) {
    // Check if the input is valid (an array of Cartesian3 points with at least two points)
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }
    // convert unexpect coordinate to cartesian3
    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    // unstable color fix using ColorMaterialProperty
    const color = new Cesium.ColorMaterialProperty(cesiumColor);

    return {
        polyline: {
            positions: convertedCoordinates,
            width: 2,
            material: color,
            depthFailMaterial: color,
            clampToGround: isClamped,
        },
    };
}

/**
 * Create a label entity for displaying the distance or area.
 * @param {Cesium.Cartesian3} startPoint - The Cartesian coordinates of the starting point.
 * @param {Cesium.Cartesian3} endPoint - The Cartesian coordinates of the ending point.
 * @param {number} distance - The distance between startPoint and endPoint.
 * @param {boolean} isTotal - state to determine if it is for total measurement.
 * @returns {object} the property for label entity that can be added to the viewer. use viewer.entities.add()
 */
export function createDistanceLabel(
    startPoint,
    endPoint,
    distance,
) {
    const midpoint = Cesium.Cartesian3.lerp(
        startPoint,
        endPoint,
        0.5,
        new Cesium.Cartesian3()
    );

    // Define the offset from the midpoint position
    const labelOffset = new Cesium.Cartesian2(0, -20);

    let labelString = formatDistance(distance);

    // Create a label entity with the fixed position
    return {
        position: new Cesium.CallbackProperty(() => midpoint, false),
        label: {
            text: labelString,
            font: "14px Roboto, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
            pixelOffset: labelOffset,
            scale: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // Make the label always visible
        },
    };
}

/**
 * Create a polygon entity between three or more points.
 * @param {(Cesium.Cartesian3|Cesium.Cartographic)[]} coordinateArray - An array of Cartesian coordinates representing the points of the line.
 * @returns {Object} polygonEntity - The polygon entity created.
 */
export function createPolygonEntity(coordinateArray) {
    if (!Array.isArray(coordinateArray)) {
        return; // Exit early if cartesianArray is not defined or contains less than 3 points
    }
    const cartesian3Array = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    return {
        name: "measure tool polygon",
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cartesian3Array),
            perPositionHeight: true,
            material: new Cesium.ColorMaterialProperty(Cesium.Color.GREEN.withAlpha(0.8)),
            outline: true,
            outlineColor: Cesium.Color.YELLOW,
            outlineWidth: 4,
        },
    };
}
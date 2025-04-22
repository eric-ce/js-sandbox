// This is the cesium measure web component that will be used in the MapCesium component.
import {
    BlendOption,
} from "cesium";

import { createPointPrimitive, createPolylinePrimitive, createPolylinePrimitivesFromArray, createPointPrimitivesFromArray, createLabelPrimitive, createLabelPrimitivesFromArray, createPolygonPrimitive, convertToCartographicRadians, convertToCartographicDegrees } from "../lib/helper/cesiumHelper.js";
// import { toolIcon, pickerIcon, pointsIcon, distanceIcon, curveIcon, heightIcon, multiDImage, multiDClampedIcon, polygonIcon, profileIcon, profileDistancesIcon, clearIcon, helpBoxIcon, logBoxIcon } from '../assets/icons.js';
// import { LogTable } from './shared/LogTable.js';
// import { HelpTable } from './shared/HelpTable.js';
import { MeasureComponentBase } from "./MeasureComponentBase.js";
// import dataPool from "../lib/data/DataPool.js";

/**
 * CesiumMeasure class to provide measurement functionalities in Cesium.
 * Overrides methods from MeasureComponentBase to implement Cesium-specific features.
 */
export default class CesiumMeasure extends MeasureComponentBase {
    constructor() {
        super();

        this.pointCollection = null;
        this.labelCollection = null;
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
     * @returns {{pointCollection: Cesium.PointPrimitiveCollection, labelCollection: Cesium.LabelCollection}}
     */
    _initializeCesiumCollections() {
        if (!this._cesiumPkg || !this.map || this.mapName !== "cesium") return;
        // Create new collections using the provided Cesium package
        const pointCollection = new this._cesiumPkg.PointPrimitiveCollection();
        const labelCollection = new this._cesiumPkg.LabelCollection();
        pointCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        labelCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        pointCollection.id = "annotate_point_collection";
        labelCollection.id = "annotate_label_collection";
        this.pointCollection = this.map.scene.primitives.add(pointCollection);
        this.labelCollection = this.map.scene.primitives.add(labelCollection);
        return { pointCollection, labelCollection };
    }

    /**
     * Setup the moving yellow dot to show the mouse pointer position
     */
    _setupPointerOverlay() {
        const pointer = document.createElement("div");
        pointer.className = "backdrop";
        pointer.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.map.container.appendChild(pointer);
        this.stateManager.setOverlayState("pointer", pointer);
    }

    /**
     * Adds a point marker to the map at the specified position.
     * @param {import('cesium').Cartesian3} position - The position where the marker will be added
     * @param {object} options - Options for the point primitive
     * @returns {import('cesium').PointPrimitive} The created point primitive or null if an error occurs.
     */
    _addPointMarker(position, options = {}) {
        // Get the point position, use clamp position if height is 0 
        const noHeight = position.height === 0;
        const pointPosition = noHeight ? this._getClampedPositions([position])[0] : position;

        // Create the point primitive
        const point = createPointPrimitive(pointPosition, options);
        if (!point) return null;
        const pointPrimitive = this.pointCollection.add(point);
        return pointPrimitive;
    }

    /**
     * Adds multiple point markers to the map at the specified positions.
     * @param {import('cesium').Cartesian3[]} positions - Array of positions where the markers will be added
     * @param {object} options - Options for the point primitives 
     * @returns {import('cesium').PointPrimitive[]} The created point primitives or null if an error occurs.
     */
    _addPointMarkersFromArray(positions, options = {}) {
        // Get the point positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const pointPositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the point primitives
        const pointsArray = createPointPrimitivesFromArray(pointPositions, options);
        if (!Array.isArray(pointsArray)) return null;
        const pointPrimitives = pointsArray.map(point => this.pointCollection.add(point));
        return pointPrimitives;
    }

    /**
     * Adds a polyline to the map at the specified positions.
     * @param {import('cesium').Cartesian3[]} positions 
     * @param {object} options - Options for the polyline primitive
     * @returns {import('cesium').PolylinePrimitive} The created polyline primitive or null if an error occurs.
     */
    _addPolyline(positions, options = {}) {
        // Get the line positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const linePositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the polyline primitive
        const polyline = createPolylinePrimitive(this.cesiumPkg.Primitive, linePositions, options);
        const polylinePrimitive = this.map.scene.primitives.add(polyline);
        return polylinePrimitive;
    }

    /**
     * Adds multiple polylines to the map at the specified positions.
     * @param {import('cesium').Cartesian3[]} positions - Array of positions where the polyline will be added
     * @param {object} options - Options for the polyline primitives
     * @returns {import('cesium').PolylinePrimitive[]} The created polyline primitives or null if an error occurs.
     */
    _addPolylinesFromArray(positions, options = {}) {
        // Get the line positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const linePositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the polyline primitives
        const polylinesArray = createPolylinePrimitivesFromArray(
            this.cesiumPkg.Primitive,
            linePositions,
            {
                color: this.stateManager.getColorState("line"),
                ...options
            }
        );
        if (!Array.isArray(polylinesArray)) return null;
        const polylinePrimitives = polylinesArray.map(polyline => this.map.scene.primitives.add(polyline));
        return polylinePrimitives;
    }

    /**
     * Adds a label marker to the map at the specified position.
     * @param {import('cesium').Cartesian3[]} positions 
     * @param {string|number} value - The value to display on the label marker
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} options - Options for the label primitive
     * @returns {import('cesium').LabelPrimitive} The created label primitive or null if an error occurs.
     */
    _addLabel(positions, value, unit, options = {}) {
        // Get the label positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const labelPositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the label primitive
        const label = createLabelPrimitive(labelPositions, value, unit, options);
        if (!label) return null;
        const labelPrimitive = this.labelCollection.add(label);
        return labelPrimitive;
    }

    /**
     * Adds multiple label markers to the map at the specified positions.
     * @param {import('cesium').Cartesian3[]} positions 
     * @param {string[]|number[]} valueArray 
     * @param {"meter"|"squareMeter"} unit - The unit of measurement (default is "meter")
     * @param {object} options - Options for the label primitives
     * @returns {import('cesium').LabelPrimitive[]} The created label primitives or null if an error occurs.
     */
    _addLabelsFromArray(positions, valueArray, unit, options = {}) {
        // Get the label positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const labelPositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the label primitives
        const labelsArray = createLabelPrimitivesFromArray(labelPositions, valueArray, unit, options);
        if (!Array.isArray(labelsArray)) return null;
        const labelPrimitives = labelsArray.map(label => this.labelCollection.add(label));
        if (!Array.isArray(labelPrimitives)) return null;
        return labelPrimitives;
    }

    /**
     * Adds a polygon to the map at the specified positions.
     * @param {import('cesium').Cartesian3[]} positions - Array of positions where the polygon will be added
     * @param {object} options - Options for the polygon primitive 
     * @returns {import('cesium').PolygonPrimitive} The created polygon primitive or null if an error occurs.
     */
    _addPolygon(positions, options = {}) {
        // Get the polygon positions, use clamp position if height is 0 
        const noHeight = positions.some(pos => pos.height === 0);
        const polygonPositions = noHeight ? this._getClampedPositions(positions) : positions;

        // Create the polygon primitive
        const polygon = createPolygonPrimitive(this.cesiumPkg.Primitive, polygonPositions, options);
        const polygonPrimitive = this.map.scene.primitives.add(polygon);
        return polygonPrimitive;
    }

    /**
     * Removes a point marker from its point collection.
     * @param {import('cesium').PointPrimitive} pointPrimitive - The point primitive to remove
     */
    _removePointMarker(pointPrimitive) {
        this.pointCollection.remove(pointPrimitive);
    }

    /**
     * Removes a label from its label collection.
     * @param {import('cesium').LabelPrimitive} labelPrimitive - The label primitive to remove
     */
    _removeLabel(labelPrimitive) {
        this.labelCollection.remove(labelPrimitive);
    }
    /**
     * Removes a polyline from the map.
     * @param {import('cesium').Primitive} polyline 
     */
    _removePolyline(polyline) {
        this._removePrimitive(polyline);
    }
    /**
     * Removes a polygon from the map.
     * @param {import('cesium').PolygonPrimitive} polygon - The polygon primitive to remove
     */
    _removePolygon(polygon) {
        this._removePrimitive(polygon);
    }

    /**
     * Removes a primitive from the map.
     * @param {import('cesium').Primitive| import('cesium').PolygonPrimitive} primitive 
     */
    _removePrimitive(primitive) {
        this.map.scene.primitives.remove(primitive);
    }

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
    }
}

customElements.define("cesium-measure", CesiumMeasure);
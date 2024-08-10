import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createGeometryInstance,
    createLinePrimitive,
    createPointPrimitive,
    generateId
} from "../helper/helper.js";

/**
 * Represents a three-point curve measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class ThreePointsCurveP {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        // cesium entities
        this.labelEntities = new Cesium.EntityCollection();

        // cesium primitives
        this.pointPrimitive = new Cesium.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointPrimitive);

        this.coordinate = new Cesium.Cartesian3();

        this._curveRecords = [];

        // flags
        this.isCurveStarted = false;

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleCurveLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleCurveMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate curves.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleCurveLeftClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (!this.isCurveStarted) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }

            // Set flag that the measurement has started
            this.isCurveStarted = true;
        }

        // use mouse move position to control only one pickPosition is used
        const cartesian = this.coordinate;
        this.coordinateDataCache.push(cartesian);

        // Check if the position is defined
        if (!Cesium.defined(cartesian)) return;

        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "curve_point");
        this.pointPrimitive.add(point);

        // Check if it had collected 3 points, then measure the curve distance
        if (this.coordinateDataCache.length === 3) {
            this.groupCoords.push([...this.coordinateDataCache]);
            // const [start, middle, end] = this.pointEntities.values.map((p) =>
            //     p.position.getValue(Cesium.JulianDate.now())
            // );
            const [start, middle, end] = this.coordinateDataCache;

            // create curve points
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(start, middle) +
                    Cesium.Cartesian3.distance(middle, end)
                ) * 50,
                50
            );

            const curvePoints = this.createCurvePoints(
                start,
                middle,
                end,
                numInterpolationPoints
            );

            // create curve line primitive
            const lineGeometryInstance = createGeometryInstance(curvePoints, "curve_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW);
            this.viewer.scene.primitives.add(linePrimitive);

            // // create curve line entity
            // const curveLineEntity = this.viewer.entities.add(
            //     createLineEntity(curvePoints, Cesium.Color.YELLOW)
            // );
            // curveLineEntity.polyline.positions = new Cesium.CallbackProperty(() => curvePoints, false);
            // this.lineEntities.add(curveLineEntity);

            // create label
            const totalDistance = this.measureCurveDistance(curvePoints);
            const labelEntity = this.viewer.entities.add(
                createDistanceLabel(start, end, totalDistance)
            );
            this.labelEntities.add(labelEntity);

            // log the curve record
            this._curveRecords.push(totalDistance);
            this.logRecordsCallback(totalDistance);

            // set flag that the measurement has ended
            this.isCurveStarted = false;
            // reset the coordinate data cache
            this.coordinateDataCache.length = 0;
        }

        // }
    }

    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleCurveMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

    }

    /**
     * Creates curve points between three specified points.
     * @param {Cesium.Cartesian3} startPoint - The starting point of the curve.
     * @param {Cesium.Cartesian3} middlePoint - The middle point of the curve.
     * @param {Cesium.Cartesian3} endPoint - The ending point of the curve.
     * @param {number} numInterpolationPoints - The number of interpolation points to create.
     * @returns {Cesium.Cartesian3[]} An array of points representing the curve.
     */
    createCurvePoints(
        startPoint,
        middlePoint,
        endPoint,
        numInterpolationPoints
    ) {
        const spline = new Cesium.CatmullRomSpline({
            times: [0, 0.5, 1],
            points: [startPoint, middlePoint, endPoint],
        });

        return Array.from({ length: numInterpolationPoints }, (_, i) =>
            spline.evaluate(i / numInterpolationPoints)
        );
    }

    /**
     * Measures the distance along a curve.
     *
     * @param {Cesium.Cartesian3[]} curvePoints - The points along the curve.
     * @returns {number} The total distance of the curve.
     */
    measureCurveDistance(curvePoints) {
        return curvePoints.reduce(
            (acc, point, i, arr) =>
                i > 0
                    ? acc + Cesium.Cartesian3.distance(arr[i - 1], point)
                    : acc,
            0
        );
    }

    resetvalue() {
        this.labelEntities.removeAll();

        this.coordinate = null;
    }
}

export { ThreePointsCurveP };

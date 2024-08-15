import * as Cesium from "cesium";
import {
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createGeometryInstance,
    createLinePrimitive,
    createPointPrimitive,
    generateId,
    createLabelPrimitive,
    formatDistance
} from "../helper/helper.js";

/**
 * Represents a three-point curve measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class ThreePointsCurve {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        // cesium primitives
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);

        this.draggingPrimitive = null;
        this.movingPolylinePrimitive = null;

        // flags
        this.isCurveStarted = false;
        this.isDragMode = false;

        // coordinates data
        this.coordinate = new Cesium.Cartesian3();
        this.beforeDragPosition = new Cesium.Cartesian3();
        this.beforeDragPositionSet = [];
        this.dragUpdatedPosition = [];
        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];

        this._curveRecords = [];
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

        this.handler.setInputAction((movement) => {
            this.handleCurveDragStart(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleCurveDragEnd(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
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
        // Check if the measurement has started
        // if pick the label primitive, make the label primitive editable
        if (!this.isCurveStarted) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label primitive, make it editable
            if (
                Cesium.defined(pickedObject) &&
                pickedObject?.id?.startsWith("annotate") &&
                pickedObject.id.includes("label")
            ) {
                editableLabel(this.viewer.container, pickedObject.primitive);
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
        this.pointCollection.add(point);

        // Check if it had collected 3 points, then measure the curve distance
        if (this.coordinateDataCache.length === 3) {
            this.groupCoords.push([...this.coordinateDataCache]);

            const [start, middle, end] = this.coordinateDataCache;

            // create curve points
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(start, middle) +
                    Cesium.Cartesian3.distance(middle, end)
                ) * 30,
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
            lineGeometryInstance.id = generateId([start, middle, end], "curve_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const totalDistance = this.measureCurveDistance(curvePoints);
            const label = createLabelPrimitive(start, end, totalDistance);
            label.id = generateId(start, "curve_label");
            this.labelCollection.add(label);

            // log the curve record
            this._curveRecords.push(totalDistance);
            this.logRecordsCallback(totalDistance);

            // set flag that the measurement has ended
            this.isCurveStarted = false;
            // reset the coordinate data cache
            this.coordinateDataCache.length = 0;
        }
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
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)
    }

    handleCurveDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.groupCoords.length === 0) return;

        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
        const pointPrimitive = pickedObjects.find(p => p.primitive && p.primitive?.id?.startsWith("annotate_curve_point"));

        // error handling: if no point primitives found then early exit
        if (!Cesium.defined(pointPrimitive)) {
            console.error("No point primitives found");
            return;
        }

        // disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;
        this.isDragMode = true;

        this.draggingPrimitive = pointPrimitive.primitive;
        this.beforeDragPosition = pointPrimitive.primitive.position.clone();
        this.beforeDragPositionSet = this.groupCoords.find(group => group.some(coord => Cesium.Cartesian3.equals(coord, this.beforeDragPosition)));

        // find the relative line primitive to the dragging point
        const lookupId = generateId(this.beforeDragPosition, "curve_line").split("_").pop();
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_curve_line"));
        const linePrimitive = linePrimitives.find(p => p.geometryInstances.id.includes(lookupId));

        // set the relative line primitive to no show
        linePrimitive ? linePrimitive.show = false : console.error("No specific line primitives found");

        // find the relative label primitive to the dragging point

        const [start, , end] = this.beforeDragPositionSet;
        const midPoint = Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3());

        const labelCollections = this.viewer.scene.primitives._primitives.filter(p => p._labels);
        const labelPrimitive = labelCollections
            .flatMap(collection => collection._labels)
            .find(label =>
                label?.id?.startsWith("annotate_curve_label") &&
                Cesium.Cartesian3.equals(label.position, midPoint)
            );

        // set the relative label primitive to no show
        labelPrimitive ? labelPrimitive.show = false : console.error("No specific label primitives found");

        // initialize an moving label primitive, and update it in handleCurveDrag()
        this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(start, end, 0));
        this.movingLabelPrimitive.id = generateId([start, end], "curve_drag_moving_label");
        this.movingLabelPrimitive.show = false;

        // find the index in the group from this.groupCoords, so that it can know which position to update
        const groupIndexForDragPoint = this.beforeDragPositionSet.findIndex(coord => Cesium.Cartesian3.equals(coord, this.beforeDragPosition));

        // set move event for dragging
        this.handler.setInputAction((movement) => {
            this.handleCurveDrag(movement, this.draggingPrimitive, groupIndexForDragPoint);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


    /**
     * 
     * @param {{endPosition: Cesium.Cartesian2}} movement 
     * @param {Cesium.Primitive} pointPrimitive - The dragging point primitive
     * @param {Number} groupIndexForDragPoint - The index of before drag position in the group from this.groupCoords
     * @returns 
     */
    handleCurveDrag(movement, pointPrimitive, groupIndexForDragPoint) {
        // error handling: if not in drag mode then early exit
        if (!this.isDragMode) return;

        this.pointerOverlay.style.display = "none";

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update point primitive to dragging position
        pointPrimitive.position = cartesian;

        // update position: clone the before drag position set and update the dragging point position
        const newSetPosition = [...this.beforeDragPositionSet];
        newSetPosition[groupIndexForDragPoint] = cartesian;
        this.dragUpdatedPosition = newSetPosition;

        // create curve points for the drag updated position
        const [start, middle, end] = newSetPosition;
        const numInterpolationPoints = Math.max(
            Math.round(
                Cesium.Cartesian3.distance(start, middle) +
                Cesium.Cartesian3.distance(middle, end)
            ) * 30,
            50
        );
        const curvePoints = this.createCurvePoints(start, middle, end, numInterpolationPoints);

        // update moving line primitive by remove the old one and create a new one
        if (this.movingPolylinePrimitive) {
            this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
        }
        const movingLineGeometryInstance = createGeometryInstance(curvePoints, "curve_drag_moving_line");
        const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

        this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

        // update moving label primitive
        const midPoint = Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3());
        if (this.movingLabelPrimitive) this.movingLabelPrimitive.show = true;
        this.movingLabelPrimitive.position = midPoint;
        this.movingLabelPrimitive.text = formatDistance(this.measureCurveDistance(curvePoints));
    }

    handleCurveDragEnd(movement) {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {
            const lookupId = generateId(this.beforeDragPosition, "curve_line").split("_").pop();

            // calculate curvePoints for the drag updated position
            const [start, middle, end] = this.dragUpdatedPosition;
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(start, middle) +
                    Cesium.Cartesian3.distance(middle, end)
                ) * 30,
                50
            );
            const curvePoints = this.createCurvePoints(start, middle, end, numInterpolationPoints);

            // remove the moving line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }

            // update the curve line primitive
            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_curve_line"));
            const linePrimitive = linePrimitives.find(p => p.geometryInstances.id.includes(lookupId));
            if (linePrimitive) {
                this.viewer.scene.primitives.remove(linePrimitive);

                // create new line primitive
                const lineGeometryInstance = createGeometryInstance(curvePoints, "cruve_line");
                lineGeometryInstance.id = generateId([start, middle, end], "curve_line");
                const newLinePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(newLinePrimitive);
            } else {
                console.error("No line primitives found");
                return;
            }

            // update the curve label primitive
            // find the relative label primitive to the dragging point
            if (this.movingLabelPrimitive) this.movingLabelPrimitive.show = false;

            const labelCollections = this.viewer.scene.primitives._primitives.filter(p => p._labels);

            if (labelCollections.length > 0) {
                const [oldStart, , oldEnd] = this.beforeDragPositionSet;
                const oldMidPoint = Cesium.Cartesian3.midpoint(oldStart, oldEnd, new Cesium.Cartesian3());

                const midPoint = Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3());
                const totalDistance = this.measureCurveDistance(curvePoints);

                let labelPrimitive = null;

                labelCollections.forEach(collection => {
                    labelPrimitive = collection._labels.find(
                        label => label?.id?.startsWith("annotate_curve_label") &&
                            Cesium.Cartesian3.equals(label.position, oldMidPoint)
                    )
                    // update label primitive and set it to show
                    if (labelPrimitive) {
                        labelPrimitive.show = true;
                        labelPrimitive.position = midPoint;
                        labelPrimitive.text = formatDistance(totalDistance);
                    } else {
                        console.error("No specific label primitives found");
                    }
                });

                // log the curve
                this.logRecordsCallback(totalDistance);
            } else {
                console.error("No label primitives found");
                return;
            }

            // update the this.groupCoords with the new drag end positions
            const groupIndex = this.groupCoords.findIndex(group => group.find(coord => Cesium.Cartesian3.equals(coord, this.beforeDragPosition)));
            if (groupIndex !== -1) {
                this.groupCoords[groupIndex] = this.dragUpdatedPosition;
            }
        }

        this.handler.setInputAction((movement) => {
            this.handleCurveMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.draggingPrimitive = null;
        this.isDragMode = false;
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
        // this.labelEntities.removeAll();

        this.coordinate = null;
    }
}

export { ThreePointsCurve };

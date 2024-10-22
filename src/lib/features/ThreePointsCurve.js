import * as Cesium from "cesium";
import {
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLineGeometryInstance,
    createLinePrimitive,
    createPointPrimitive,
    generateId,
    createLabelPrimitive,
    formatDistance,
    getPickedObjectType,
} from "../helper/helper.js";

class ThreePointsCurve {
    /**
     * Creates a new Three Points Curve instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            dragStart: null,    // Stores the initial position before a drag begins
        };

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolyline: null,  // Line that visualizes dragging or moving
            movingLabel: null,     // Label that updates during moving or dragging
            dragPoint: null,                // Currently dragged point primitive
            dragPolyline: null,                 // Line that connects the dragged point to the curve
            dragLabel: null,                 // Label that updates during dragging
            hoveredPoint: null,             // Point that is currently hovered over
            hoveredLabel: null,             // Label that is currently hovered over
        };
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


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, draw and calculate curves.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleCurveLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "curve");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMeasurementComplete) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                break;
            case "line":
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode) {
                    this.startMeasure();
                }
                break;
        }
    }

    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            // Set flag that the measurement has started
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = [];
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup;
        }

        // create point primitive
        // check if the current position is very close to coordinate in groups, if yes then don't create new point
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
        if (!isNearPoint) {
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "curve_point_pending");
            this.pointCollection.add(point);
            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }

        // Check if it had 3 points, then measure the curve distance
        if (this.coords.cache.length === 3) {
            const [start, middle, end] = this.coords.cache;

            // update pending point id 
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            if (pendingPoints && pendingPoints.length > 0) {
                pendingPoints.forEach(p => p.id = p.id.replace("_pending", ""));
            }

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
            if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            this.interactivePrimitives.movingPolyline = null;
            const lineGeometryInstance = createLineGeometryInstance(curvePoints, "curve_line");
            lineGeometryInstance.id = generateId([start, middle, end], "curve_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            if (this.interactivePrimitives.movingLabel) this.interactivePrimitives.movingLabel.show = false;
            const totalDistance = this.measureCurveDistance(curvePoints);
            const label = createLabelPrimitive(start, end, totalDistance);
            const midPoint = Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3());
            label.id = generateId(midPoint, "curve_label");
            this.labelCollection.add(label);

            // log the curve record
            this.logRecordsCallback(totalDistance.toFixed(2));

            // set flag that the measurement has ended
            this.flags.isMeasurementComplete = true;

            // reset the coordinate data cache
            this.coords.cache = [];
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleCurveMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        pickedObjects && updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        if (this.coords.cache.length > 1 && !this.flags.isMeasurementComplete) {
            // create curve line for the points
            const [start, middle] = this.coords.cache;
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(start, middle) +
                    Cesium.Cartesian3.distance(middle, this.coordinate)
                ) * 5,
                20
            );

            const curvePoints = this.createCurvePoints(
                start,
                middle,
                this.coordinate,
                numInterpolationPoints
            );

            // recreate line primitive
            if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            // create new moving line primitive
            const movingLineGeometryInstance = createLineGeometryInstance(curvePoints, "curve_line_moving");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            movingLineGeometryInstance.id = generateId([start, middle, this.coordinate], "curve_line_moving");
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create moving label primitive
            const distance = this.measureCurveDistance(curvePoints);
            const midPoint = Cesium.Cartesian3.midpoint(start, this.coordinate, new Cesium.Cartesian3());
            if (this.interactivePrimitives.movingLabel) {
                this.interactivePrimitives.movingLabel.show = true;
                this.interactivePrimitives.movingLabel.showBackground = false;
                this.interactivePrimitives.movingLabel.position = midPoint;
                this.interactivePrimitives.movingLabel.text = formatDistance(distance);
                this.interactivePrimitives.movingLabel.id = generateId(midPoint, "curve_label_moving");
            } else {
                const label = createLabelPrimitive(start, this.coordinate, distance);
                label.id = generateId(midPoint, "curve_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
            }
        }
        // handle hover highlighting
        if (this.coords.cache.length === 0) {
            this.handleHoverHighlighting(pickedObjects[0])
        }

    }

    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "curve");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        }
        resetHighlighting();
        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = Cesium.Color.YELLOW;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = Cesium.Color.YELLOW;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleCurveDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_curve_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set drag point position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleCurveDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    }


    /**
     * 
     * @param {{endPosition: Cesium.Cartesian2}} movement 
     * @param {Cesium.Primitive} pointPrimitive - The dragging point primitive
     * @param {Number} groupIndexForDragPoint - The index of before drag position in the group from this.coords.groups
     * @returns 
     */
    handleCurveDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove
            selectedPoint.primitive.show = false;
            const groupIndex = this.coords.groups.findIndex(group => group.some(coord => Cesium.Cartesian3.equals(coord, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];
            const oldMidPoint = Cesium.Cartesian3.midpoint(group[0], group[2], new Cesium.Cartesian3());
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.includes("curve_label") &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, oldMidPoint)
            );
            if (existedLabel) existedLabel.show = false;
            const existedLine = this.viewer.scene.primitives._primitives.find(p =>
                p.geometryInstances &&
                p.geometryInstances.id &&
                p.geometryInstances.id.includes("curve_line") &&
                !p.geometryInstances.id.includes("moving") &&
                p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (existedLine) this.viewer.scene.primitives.remove(existedLine);

            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "curve_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "curve_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // set moving position
            const positionIndex = this.coords.groups[groupIndex].findIndex(coord => Cesium.Cartesian3.equals(coord, this.coords.dragStart));
            const newDragPositions = [...this.coords.groups[groupIndex]];
            newDragPositions[positionIndex] = cartesian;
            const [start, middle, end] = newDragPositions;

            // create curve points
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(start, middle) +
                    Cesium.Cartesian3.distance(middle, end)
                ) * 5,
                20
            );
            const curvePoints = this.createCurvePoints(start, middle, end, numInterpolationPoints);

            // recreate line primitive
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            const lineGeometryInstance = createLineGeometryInstance(curvePoints, "curve_line_moving");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            lineGeometryInstance.id = generateId([start, middle, end], "curve_line_moving");
            this.interactivePrimitives.dragPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // update label primitive
            const distance = this.measureCurveDistance(curvePoints);
            const midPoint = Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3());
            if (this.interactivePrimitives.dragLabel) {
                this.interactivePrimitives.dragLabel.show = true;
                this.interactivePrimitives.dragLabel.showBackground = false;
                this.interactivePrimitives.dragLabel.position = midPoint;
                this.interactivePrimitives.dragLabel.id = generateId([start, middle, end], "curve_label_moving");
                this.interactivePrimitives.dragLabel.text = formatDistance(distance);
            } else {
                const label = createLabelPrimitive(start, end, distance);
                label.id = generateId([start, middle, end], "curve_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label);
            }
        }
    }

    handleCurveDragEnd() {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            const groupIndex = this.coords.groups.findIndex(group => group.find(coord => Cesium.Cartesian3.equals(coord, this.coords.dragStart)));
            const group = this.coords.groups[groupIndex];
            const positionIndex = this.coords.groups[groupIndex].findIndex(coord => Cesium.Cartesian3.equals(coord, this.coords.dragStart));

            // remove dragging temporary moving primitives
            this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            this.interactivePrimitives.dragPolyline = null;
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.includes("curve_point") &&
                !p.id.includes("moving") &&
                Cesium.Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.id = generateId(this.coordinate, "curve_point");
                existedPoint.position = this.coordinate;
                existedPoint.show = true;
            }

            // lookup existed line and label primitive
            const oldMidPoint = Cesium.Cartesian3.midpoint(group[0], group[2], new Cesium.Cartesian3());
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.includes("curve_label") &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, oldMidPoint)
            );

            // update the this.coords.groups
            this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update existed label primitive, recreate new line primitive
            const newMidPoint = Cesium.Cartesian3.midpoint(group[0], group[2], new Cesium.Cartesian3());
            if (existedLabel) {
                existedLabel.show = true;
                existedLabel.showBackground = true;
                existedLabel.position = newMidPoint;
                existedLabel.text = formatDistance(this.measureCurveDistance(group));
                existedLabel.id = generateId([group[0], group[2]], "curve_label");
            }

            // recreate new line primitive
            const numInterpolationPoints = Math.max(
                Math.round(
                    Cesium.Cartesian3.distance(group[0], group[1]) +
                    Cesium.Cartesian3.distance(group[1], group[2])
                ) * 5,
                20
            );
            const curvePoints = this.createCurvePoints(group[0], group[1], group[2], numInterpolationPoints);
            const lineGeometryInstance = createLineGeometryInstance(curvePoints, "curve_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            lineGeometryInstance.id = generateId(group, "curve_line");
            this.viewer.scene.primitives.add(linePrimitive);

            // log the curve record
            this.logRecordsCallback(this.measureCurveDistance(group).toFixed(2));

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        this.handler.setInputAction((movement) => {
            this.handleCurveMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
    * Creates curve points between three specified points.
    * @param {Cesium.Cartesian3} startPoint - The starting point of the curve.
    * @param {Cesium.Cartesian3} middlePoint - The middle point of the curve.
    * @param {Cesium.Cartesian3} endPoint - The ending point of the curve.
    * @param {number} numInterpolationPoints - The number of interpolation points to create.
    * @returns {Cesium.Cartesian3[]} An array of points representing the curve.
    */
    createCurvePoints(startPoint, middlePoint, endPoint, numInterpolationPoints) {
        if (!startPoint || !middlePoint || !endPoint) return;
        const spline = new Cesium.CatmullRomSpline({
            times: [0, 0.5, 1],
            points: [startPoint, middlePoint, endPoint],
        });

        const interpolatedPoints = Array.from({ length: numInterpolationPoints }, (_, i) =>
            spline.evaluate(i / (numInterpolationPoints - 1))
        );

        // Ensure the start, middle, and end points are included
        if (!Cesium.Cartesian3.equals(interpolatedPoints[0], startPoint)) {
            interpolatedPoints.unshift(startPoint);
        }
        if (!Cesium.Cartesian3.equals(interpolatedPoints[Math.floor(numInterpolationPoints / 2)], middlePoint)) {
            interpolatedPoints.splice(Math.floor(numInterpolationPoints / 2), 0, middlePoint);
        }
        if (!Cesium.Cartesian3.equals(interpolatedPoints[interpolatedPoints.length - 1], endPoint)) {
            interpolatedPoints.push(endPoint);
        }

        return interpolatedPoints;
    }

    /**
     * Measures the distance along a curve.
     * @param {Cesium.Cartesian3[]} curvePoints - The points along the curve.
     * @returns {Number} The total distance of the curve.
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

    resetValue() {
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState('pointer')
        pointer && (pointer.style.display = 'none');

        // reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        // reset coords
        this.coords.cache = [];
        this.coords.dragStart = null;
        // reset primitives
        this.interactivePrimitives.movingPolyline = null;
        this.interactivePrimitives.movingLabel = null;
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolyline = null;
        this.interactivePrimitives.dragLabel = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}

export { ThreePointsCurve };

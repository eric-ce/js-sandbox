import {
    Cartesian2,
    Cartesian3,
    defined,
    CatmullRomSpline,
    ScreenSpaceEventType,
    ScreenSpaceEventHandler,
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    generateId,
    createLabelPrimitive,
    formatDistance,
    getPickedObjectType,
    createPolylinePrimitive,
    generateIdByTimestamp,
    getPrimitiveByPointPosition,
    changeLineColor,
} from "../lib/helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";
import dataPool from "../lib/data/DataPool.js";

class ThreePointsCurve extends MeasureModeBase {
    /**
     * Creates a new ThreePointsCurve instance.
     * @param {Viewer} viewer - The Cesium Viewer instance.
     * @param {ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {Object} stateManager - The state manager instance.
     * @param {Object} cesiumPkg - The Cesium package object.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(viewer, handler, stateManager, cesiumPkg, emitter) {
        super(viewer, handler, stateManager, cesiumPkg);

        this.mode = "curve";

        // Set the event emitter
        this.emitter = emitter;

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            measureCounter: 0,    // Counter for the number of groups
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
        };

        // Measurement data
        this.measure = super._createDefaultMeasure();

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],      // Array of moving polylines
            movingLabels: [],         // Array of moving labels

            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels                

            hoveredPoint: null,             // Point that is currently hovered over
            hoveredLabel: null,             // Label that is currently hovered over
            hoveredLine: null,              // Line that is currently hovered over
        };
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, draw curves, and calculate distances.
     * @param {{position: Cartesian2}} movement - The mouse movement event.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "curve");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.coords.cache.length === 0) { // only when it is not during measuring can edit the label. 
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
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

    /**
     * Initiates the measurement process by creating a new group or adding a point.
     */
    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = super._createDefaultMeasure();

            // Set values for the new measure
            this.measure.id = generateIdByTimestamp()
            this.measure.mode = this.mode;
            this.measure.labelNumberIndex = this.coords.measureCounter;
            this.measure.status = "pending";

            // Establish data relation
            this.coords.groups.push(this.measure);
            this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
            this.coords.measureCounter++;
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "curve_point_pending");
        this.pointCollection.add(point);

        // Update the coordinate cache
        this.coords.cache.push(this.coordinate);

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Check if it had 3 points, then measure the curve distance
        if (this.coords.cache.length === 3) {
            const [start, middle, end] = this.coords.cache;

            // update pending point id 
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            if (pendingPoints && pendingPoints.length > 0) {
                pendingPoints.forEach(p => p.id = p.id.replace("_pending", ""));
            }

            // Remove moving primitives
            super.removeMovingPrimitives();

            // Create curve line primitive
            const { linePrimitive: line, curvePoints } = this.createCurveLinePrimitive(start, middle, end, "curve_line", 3, this.stateManager.getColorState("line"));
            const linePrimitive = this.viewer.scene.primitives.add(line);
            this.interactivePrimitives.movingPolylines.push(linePrimitive);

            // create label primitive
            // if (this.interactivePrimitives.movingLabel) this.interactivePrimitives.movingLabel.show = false;
            const totalDistance = this.measureCurveDistance(curvePoints);
            const label = createLabelPrimitive(start, end, totalDistance);
            const midPoint = Cartesian3.midpoint(start, end, new Cartesian3());
            label.position = midPoint;
            label.id = generateId(this.coords.cache, "curve_label");
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = [start, end];    // store positions data in label primitive

            // Update this.measure
            this.measure._records.push(totalDistance);
            this.measure.status = "completed";

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });

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
     * Handles mouse move events to update the current coordinate and display pointer overlay.
     * @param {{endPosition: Cartesian2}} movement - The mouse movement event.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;

        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length > 1 && this.coords.cache.length < 3) {
                    // Remove existing moving primitives
                    super.removeMovingPrimitives();

                    // Compute the curve points
                    const [start, middle] = this.coords.cache;

                    // Create current line primitive
                    const { linePrimitive: movingLine, curvePoints } = this.createCurveLinePrimitive(start, middle, this.coordinate, "curve_line_moving", 3, this.stateManager.getColorState("move"));
                    const movingLinePrimitive = this.viewer.scene.primitives.add(movingLine);
                    this.interactivePrimitives.movingPolylines.push(movingLinePrimitive);

                    // Create label primitive
                    const distance = this.measureCurveDistance(curvePoints);
                    const midPoint = Cartesian3.midpoint(start, this.coordinate, new Cartesian3());
                    const label = createLabelPrimitive(start, this.coordinate, distance);
                    label.id = generateId(midPoint, "curve_label_moving");
                    label.showBackground = false;
                    label.position = midPoint;
                    const labelPrimitive = this.labelCollection.add(label);
                    labelPrimitive.positions = [start, middle, this.coordinate]; // store positions data in label primitive
                    this.interactivePrimitives.movingLabels.push(labelPrimitive);
                }
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    /**
     * Highlights primitives when hovering with the mouse.
     * @param {*} pickedObject - The object from the scene pick.
     */
    handleHoverHighlighting(pickedObject) {
        super.handleHoverHighlighting(pickedObject, "curve");
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates the drag action for curve measurement.
     * @param {*} movement - The movement event triggering drag start.
     */
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) { // when the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_curve_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!defined(isPoint)) return;

            // Disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // Set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (!group) return;

            // Set status to pending 
            group.status = "pending";
            // Update to data pool
            dataPool.updateOrAddMeasure({ ...group });

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, isPoint);
            }, ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    /**
     * Processes drag movement by updating the dragged point and curve primitive.
     * @param {{endPosition: Cartesian2}} movement - The mouse movement event during drag.
     * @param {PointPrimitive} selectedPoint - The point primitive being dragged.
     */
    handleDragMove(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, line primitive to remove
            const { linePrimitives } = getPrimitiveByPointPosition(
                this.coords.dragStart,
                `annotate_curve`,
                this.viewer.scene,
                this.pointCollection,
                this.labelCollection
            );
            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)));
            if (!group) return;

            // find and set existed label to no show
            const oldMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[2], new Cartesian3());
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.includes("curve_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, oldMidPoint)
            );
            if (existedLabel) existedLabel.show = false;

            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("move");
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "curve_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), this.stateManager.getColorState("pointColor"), "curve_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // For line primitive
            // Remove existing moving lines 
            super.removeDragMovingPrimitives({ removeLines: true, removeLabels: false });

            // Update drag moving position, DO NOT update the group coordinates during moving.
            const positionIndex = group.coordinates.findIndex(cart => Cartesian3.equals(cart, this.coords.dragStart));
            const newDragPositions = [...group.coordinates];
            newDragPositions[positionIndex] = cartesian;
            const [start, middle, end] = newDragPositions;

            // Create moving line primitive
            const { linePrimitive: movingLine, curvePoints } = this.createCurveLinePrimitive(start, middle, end, "curve_line_moving", 3, this.stateManager.getColorState("move"));
            const movingLinePrimitive = this.viewer.scene.primitives.add(movingLine);
            this.interactivePrimitives.dragPolylines.push(movingLinePrimitive);

            // For label primitive
            // Update or create the label primitive
            const distance = this.measureCurveDistance(curvePoints);
            const midPoint = Cartesian3.midpoint(start, end, new Cartesian3());
            const labelPrimitive = this.interactivePrimitives.dragLabels[0];

            if (labelPrimitive) {
                this.interactivePrimitives.dragLabels[0].id = generateId(midPoint, `curve_label_moving`);
                this.interactivePrimitives.dragLabels[0].position = midPoint;
                this.interactivePrimitives.dragLabels[0].text = `${formatDistance(distance)}`;
                this.interactivePrimitives.dragLabels[0].showBackground = false;
                this.interactivePrimitives.dragLabels[0].positions = [start, middle, end];  // store positions data in label primitive
            } else {
                const labelPrimitive = createLabelPrimitive(start, end, distance);
                labelPrimitive.id = generateId(midPoint, `curve_label_moving`);
                labelPrimitive.showBackground = false;
                const addedLabelPrimitive = this.labelCollection.add(labelPrimitive);
                addedLabelPrimitive.positions = [start, middle, end];   // store positions data in label primitive
                this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
            }
        }
    }

    /**
     * Concludes the drag action, finalizing the position and updating the curve primitive.
     */
    handleDragEnd() {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const groupIndex = this.coords.groups.findIndex(group => group.coordinates.some(coord => Cartesian3.equals(coord, this.coords.dragStart)));
            if (groupIndex === -1) return; // Error handling: no group found
            const group = this.coords.groups[groupIndex];
            const positionIndex = group.coordinates.findIndex(coord => Cartesian3.equals(coord, this.coords.dragStart));

            // Remove dragging point, dragging lines and dragging labels
            super.removeDragMovingPrimitives({ removePoint: true, removeLines: true, removeLabels: true });

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.includes(`curve_point`) &&
                Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, `curve_point`);
            }

            // Find and update the existing label primitive
            const oldMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[2], new Cartesian3());
            const labelPrimitive = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.startsWith(`annotate_curve_label`) &&
                    Cartesian3.equals(label.position, oldMidPoint)
            );

            // Update the coordinate data
            group.coordinates[positionIndex] = this.coordinate;

            const [start, middle, end] = group.coordinates;

            // Create new line primitive
            const { linePrimitive, curvePoints } = this.createCurveLinePrimitive(start, middle, end, "curve_line", 3, this.stateManager.getColorState("line"));
            this.viewer.scene.primitives.add(linePrimitive);

            // update existed label primitive
            const newMidPoint = Cartesian3.midpoint(start, end, new Cartesian3());
            const distance = this.measureCurveDistance(curvePoints);
            if (labelPrimitive) {
                labelPrimitive.text = formatDistance(distance);
                labelPrimitive.id = generateId([start, end], "curve_label");
                labelPrimitive.position = newMidPoint;
                labelPrimitive.show = true;
                labelPrimitive.showBackground = true;
            }

            // update _records and status of the group
            group.status = "completed";
            group._records = [distance];

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...group });

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, ScreenSpaceEventType.MOUSE_MOVE);

    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Creates an array of interpolated curve points between three specified points.
     * @param {Cartesian3} startPoint - The starting point of the curve.
     * @param {Cartesian3} middlePoint - The middle point of the curve.
     * @param {Cartesian3} endPoint - The ending point of the curve.
     * @param {number} numInterpolationPoints - The number of interpolation points to generate.
     * @returns {Cartesian3[]} An array of Cartesian3 points representing the curve.
     */
    createCurvePoints(startPoint, middlePoint, endPoint, numInterpolationPoints) {
        if (!startPoint || !middlePoint || !endPoint) return;
        const spline = new CatmullRomSpline({
            times: [0, 0.5, 1],
            points: [startPoint, middlePoint, endPoint],
        });

        const interpolatedPoints = Array.from({ length: numInterpolationPoints }, (_, i) =>
            spline.evaluate(i / (numInterpolationPoints - 1))
        );

        // Ensure the start, middle, and end points are included
        if (!Cartesian3.equals(interpolatedPoints[0], startPoint)) {
            interpolatedPoints.unshift(startPoint);
        }
        if (!Cartesian3.equals(interpolatedPoints[Math.floor(numInterpolationPoints / 2)], middlePoint)) {
            interpolatedPoints.splice(Math.floor(numInterpolationPoints / 2), 0, middlePoint);
        }
        if (!Cartesian3.equals(interpolatedPoints[interpolatedPoints.length - 1], endPoint)) {
            interpolatedPoints.push(endPoint);
        }

        return interpolatedPoints;
    }

    /**
     * Calculates the total distance along a curve defined by an array of points.
     * @param {Cartesian3[]} curvePoints - The points along the curve.
     * @returns {number} The total distance of the curve.
     */
    measureCurveDistance(curvePoints) {
        if (!Array.isArray(curvePoints) && curvePoints.length === 0) return;
        const distance = curvePoints.reduce(
            (acc, point, i, arr) =>
                i > 0
                    ? acc + Cartesian3.distance(arr[i - 1], point)
                    : acc,
            0
        );
        return distance;
    }

    /**
     * Creates a curve line primitive and returns the resulting primitive along with the interpolated curve points.
     * @param {Cartesian3} start - The starting point of the curve.
     * @param {Cartesian3} middle - The middle point of the curve.
     * @param {Cartesian3} end - The ending point of the curve.
     * @param {string} modeString - Mode identifier for the curve primitive.
     * @param {number} width - The width of the curve line.
     * @param {*} color - The color of the curve line.
     * @param {number} numInterpolationPoints - The number of interpolation points to create.
     * @returns {{ linePrimitive: Primitive, curvePoints: Cartesian3[] }} An object containing the curve line primitive and the interpolated points.
     */
    createCurveLinePrimitive(start, middle, end, modeString, width, color, numInterpolationPoints) {
        if (!numInterpolationPoints) {
            numInterpolationPoints = Math.max(
                Math.round(
                    Cartesian3.distance(start, middle) +
                    Cartesian3.distance(middle, end)
                ) * 5,
                20
            );
        }
        const curvePoints = this.createCurvePoints(start, middle, end, numInterpolationPoints);
        const linePrimitive = createPolylinePrimitive(
            curvePoints,
            modeString,
            width,
            color,
            this.cesiumPkg.Primitive
        );

        linePrimitive.id = generateId([start, middle, end], modeString);

        return { linePrimitive, curvePoints };
    }

    resetValue() {
        super.resetValue();
    }
}

export { ThreePointsCurve };

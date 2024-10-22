import * as Cesium from "cesium";
import {
    calculateDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    createLinePrimitive,
    createLineGeometryInstance,
    generateId,
    createLabelPrimitive,
    getPickedObjectType,
    formatDistance,
    getPrimitiveByPointPosition,
} from "../helper/helper.js";

class TwoPointsDistance {
    /**
     * Creates a new Two Points Distance instance.
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
            isDragMode: false
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],              // Stores temporary coordinates during operations
            groups: [],             // Tracks all coordinates involved in operations
            dragStart: null,        // Stores the initial position before a drag begins
            dragStartToCanvas: null // Stores the initial position in canvas coordinates before a drag begins
        };

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolyline: null,   // Line that visualizes dragging or moving
            movingLabel: null,      // Label that updates during moving or dragging
            dragPoint: null,        // Currently dragged point primitive
            dragPolyline: null,     // Line that visualizes dragging
            dragLabel: null,        // Label that updates during dragging
            hoveredPoint: null,     // Point that is currently hovered
            hoveredLabel: null      // Label that is currently hovered
        };
    }

    /**
     * Sets up input actions for two points distance mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleDistanceDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleDistanceDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleDistanceLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

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

        // check if the current position is very close to coordinate in groups, if yes then don't create new point
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
        if (!isNearPoint) {
            // create the first point
            this.coords.cache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point_pending");
            this.pointCollection.add(point);
        }

        // create line and label
        if (this.coords.cache.length === 2) {
            // update pending point id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });
            // create line primitive
            if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            const lineGeometryInstance = createLineGeometryInstance(this.coords.cache, "distance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            this.interactivePrimitives.movingLabel = null;
            const distance = calculateDistance(this.coords.cache[0], this.coords.cache[1]);
            const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance)
            label.id = generateId(this.coords.cache, "distance_label");
            this.labelCollection.add(label);

            // log distance
            this.logRecordsCallback(distance.toFixed(2));

            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete

        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length > 0 && this.coords.cache.length < 2) {
                    // create line primitive
                    if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
                    const movingLineGeometryInstance = createLineGeometryInstance([this.coords.cache[0], this.coordinate], "distance_line_moving");
                    const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
                    this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

                    // Create or update label primitive
                    const distance = calculateDistance(this.coords.cache[0], cartesian);
                    const midPoint = Cesium.Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cesium.Cartesian3());
                    if (this.interactivePrimitives.movingLabel) {   // if label exists, update existing label
                        this.interactivePrimitives.movingLabel.text = formatDistance(distance);
                        this.interactivePrimitives.movingLabel.position = midPoint
                        this.interactivePrimitives.movingLabel.show = true;
                        this.interactivePrimitives.movingLabel.showBackground = false;
                        this.interactivePrimitives.movingLabel.id = generateId(midPoint, "distance_label_moving");
                    } else {   // if label doesn't exist, create a new label
                        const label = createLabelPrimitive(this.coords.cache[0], cartesian, distance);
                        label.id = generateId(midPoint, "distance_label_moving");
                        label.showBackground = false;
                        this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
                    }
                }
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

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
    handleDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_distance_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDistanceDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    };

    handleDistanceDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove 
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_distance", this.viewer.scene, this.pointCollection, this.labelCollection);
            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update point primitive to dragging position
            if (this.interactivePrimitives.dragPoint) {
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "distance_point_moving");
            } else {
                const pointPrimitive = createPointPrimitive(cartesian, Cesium.Color.RED);
                pointPrimitive.id = generateId(cartesian, "distance_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // identify the group of coordinates that contains the dragging position
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));

            // update moving line primitive by remove the old one and create a new one
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            const movingLineGeometryInstance = createLineGeometryInstance([otherPointCoords, this.coordinate], "distance_line_moving");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.dragPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create or update moving label primitive
            const distance = calculateDistance(otherPointCoords, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());

            if (this.interactivePrimitives.dragLabel) {
                this.interactivePrimitives.dragLabel.position = midPoint;
                this.interactivePrimitives.dragLabel.text = formatDistance(distance);
                this.interactivePrimitives.dragLabel.showBackground = false;
                this.interactivePrimitives.dragLabel.id = generateId([otherPointCoords, this.coordinate], "distance_label_moving");
            } else {
                const label = createLabelPrimitive(otherPointCoords, this.coordinate, distance);
                label.id = generateId([otherPointCoords, this.coordinate], "distance_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label);
            }
        }
    }

    handleDistanceDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // update the this.coords.groups with the new drag end positions, 2 points coordinates
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const groupIndex = this.coords.groups.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex.length === -1) return;
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));
            this.coords.groups[groupIndex] = [otherPointCoords, this.coordinate];

            // remove dragging point, line and label
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            this.interactivePrimitives.dragPolyline = null;
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith("annotate_distance_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            existedPoint.show = true;
            existedPoint.position = this.coordinate;
            existedPoint.id = generateId(this.coordinate, "distance_point");

            // create new line primitive
            const lineGeometryInstance = createLineGeometryInstance([otherPointCoords, this.coordinate], "distance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // Find and update the existing label primitive
            const oldMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coords.dragStart, new Cesium.Cartesian3());
            const newMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
            const distance = calculateDistance(otherPointCoords, this.coordinate);
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_distance_label") &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, oldMidPoint)
            );
            if (existedLabel) {
                existedLabel.text = formatDistance(distance);
                existedLabel.id = generateId(newMidPoint, "distance_label");
                existedLabel.position = newMidPoint;
                existedLabel.show = true;
            }

            // log distance
            this.logRecordsCallback(distance.toFixed(2));

            // reset dragging flags
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };

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
        this.coords.dragStartToCanvas = null;

        // reset interactive primitives
        this.interactivePrimitives.movingPolyline = null;
        this.interactivePrimitives.movingLabel = null;
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolyline = null;
        this.interactivePrimitives.dragLabel = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}

export { TwoPointsDistance };
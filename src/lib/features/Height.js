import {
    convertToCartesian3,
    removeInputActions,
    editableLabel,
    createPointPrimitive,
    generateId,
    createLinePrimitive,
    createLineGeometryInstance,
    createLabelPrimitive,
    formatDistance,
    getPickedObjectType,
} from "../helper/helper.js";
import * as Cesium from "cesium";

/**
 * Represents a height measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class Height {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.flags = {
            isDragMode: false,
        }

        // coordinates data
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            dragStartTop: null, // Stores the initial position before a drag begins
            dragStartBottom: null,      // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Store the drag start position to canvas in Cartesian2
            dragStart: null,    // Stores the initial position before a drag begins
        };

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.movingPointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.movingPointCollection);
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPoints: [],
            movingPointTop: null,
            movingPointBottom: null,
            draggingPoints: [],
            draggingTop: null,
            draggingBottom: null,
            movingLabel: null,
            movingPolyline: null,
            hoveredPoint: null,
        };

        this.movingTopPointPrimitive = null;
        this.movingBottomPointPrimitive = null;
        this.draggingTopPrimitive = null;
        this.draggingBottomPrimitive = null;
        this.movingLabelPrimitive = null;
        this.movingPolylinePrimitive = null;
    }

    /**
     * Sets up input actions for height mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleHeightLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleHeightDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        // this.handler.setInputAction((movement) => {
        //     this.handleHeightDragEnd(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place top and ground points, draw line in between.
     */
    handleHeightLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "height");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                editableLabel(this.viewer.container, pickedObject.primitive);
                break;
            default:
                if (!this.flags.isDragMode) {
                    if (this.coords.cache.length === 2) {
                        const [topCartesian, bottomCartesian] = this.coords.cache;
                        // update this.coords.groups to store all click coordinates
                        this.coords.groups.push([topCartesian, bottomCartesian]);

                        // create top and bottom points primitiives
                        const topPointPrimitive = createPointPrimitive(topCartesian, Cesium.Color.RED);
                        topPointPrimitive.id = generateId(topCartesian, "height_top_point");
                        this.pointCollection.add(topPointPrimitive);

                        const bottomPointPrimitive = createPointPrimitive(bottomCartesian, Cesium.Color.RED);
                        bottomPointPrimitive.id = generateId(bottomCartesian, "height_bottom_point");
                        this.pointCollection.add(bottomPointPrimitive);

                        // create line primitive
                        const lineGeometryInstance = createLineGeometryInstance([topCartesian, bottomCartesian], "height_line");
                        const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                        this.viewer.scene.primitives.add(linePrimitive);

                        // create label primitive
                        const distance = Cesium.Cartesian3.distance(topCartesian, bottomCartesian);
                        const midPoint = Cesium.Cartesian3.midpoint(topCartesian, bottomCartesian, new Cesium.Cartesian3());
                        const label = createLabelPrimitive(topCartesian, bottomCartesian, distance);
                        label.id = generateId(midPoint, "height_label");
                        this.labelCollection.add(label);

                        this.coords.groups.push([...this.coords.cache]);
                        this.coords.cache = [];
                        // log the height result
                        // this._heightRecords.push(distance);
                        this.logRecordsCallback(distance.toFixed(2));
                    }
                }
                break;
        }
    }

    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleHeightMouseMove(movement) {
        // update pointerOverlay: the moving dot with mouse
        // const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        // pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, this.coordinate, pickedObjects)

        const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);
        if (Cesium.defined(pickedObject) && !pickedObject?.id?.startsWith("annotate_height")) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            // Check if the position is defined
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);
            const groundHeight = this.viewer.scene.globe.getHeight(cartographic);
            const groundCartographic = new Cesium.Cartographic(
                cartographic.longitude,
                cartographic.latitude,
                groundHeight
            );
            if (!groundCartographic) return;

            // ground position relevant to movement position
            const groundCartesian = convertToCartesian3(groundCartographic);

            this.coords.cache = [this.coordinate, groundCartesian];

            // create top and bottom points primitiives
            this.interactivePrimitives.movingPoints.forEach(p => {
                this.movingPointCollection.remove(p);
            });

            this.coords.cache.forEach((cart, index) => {
                const pointPrimitive = createPointPrimitive(cart, Cesium.Color.RED);
                pointPrimitive.id = generateId(cart, `height_moving_${index === 0 ? "top" : "bottom"}_point`);
                const point = this.movingPointCollection.add(pointPrimitive);
                this.interactivePrimitives.movingPoints.push(point);
            });

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const lineGeometryInstance = createLineGeometryInstance(this.coords.cache, "height_moving_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const distance = Cesium.Cartesian3.distance(this.coords.cache[0], this.coords.cache[1]);
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance);
            this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
            const midPoint = Cesium.Cartesian3.midpoint(this.coords.cache[0], this.coords.cache[1], new Cesium.Cartesian3());
            this.interactivePrimitives.movingLabel.id = generateId(midPoint, "height_moving_label");
        }
    };

    handleHeightDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_height") &&
                    primitiveId.includes("point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set the dragging point
            // this.interactivePrimitives.draggingPoint = isPoint.primitive;
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            const groupIndex = this.coords.groups.findIndex(group => group.some(p => Cesium.Cartesian3.equals(p, this.coords.dragStart)));
            const positionIndex = this.coords.groups[groupIndex].findIndex(p => Cesium.Cartesian3.equals(p, this.coords.dragStart));
            const otherPositionIndex = positionIndex === 0 ? 1 : 0;
            const otherPoint = this.pointCollection._pointPrimitives.find(p => Cesium.Cartesian3.equals(p.position, this.coords.groups[groupIndex][otherPositionIndex]));
            this.interactivePrimitives.draggingPoints = [isPoint.primitive, otherPoint];
            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleHeightDrag(movement, this.interactivePrimitives.draggingPoints);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    handleHeightDrag(movement, pointPrimitives) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // highlight the dragging points
            pointPrimitives.forEach(p => {
                p.outlineColor = Cesium.Color.YELLOW;
                p.outlineWidth = 2;
            })

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);
            const groundHeight = this.viewer.scene.globe.getHeight(cartographic);

            // ground position relevant to movement position
            const groundCartesian = convertToCartesian3(
                new Cesium.Cartographic(
                    cartographic.longitude,
                    cartographic.latitude,
                    groundHeight
                )
            );
            const draggingPosition = [this.coordinate, groundCartesian];

            // update the point
            pointPrimitives[0].position = this.coordinate;
            pointPrimitives[1].position = groundCartesian;

            // remove existed line and labels
            const { linePrimitives, labelPrimitives } = this.getPrimitiveByPointPosition(this.coords.dragStart, "annotate_height")
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(p => this.labelCollection.remove(p));
            // remove moving point
            this.interactivePrimitives.movingPoints.forEach(p => this.movingPointCollection.remove(p));
            // remove and recreate moving line
            if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            const lineGeometryInstance = createLineGeometryInstance(draggingPosition, "height_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // update moving label
            if (this.interactivePrimitives.movingLabel) {
                const distance = Cesium.Cartesian3.distance(draggingPosition[0], draggingPosition[1]);
                const midPoint = Cesium.Cartesian3.midpoint(draggingPosition[0], draggingPosition[1], new Cesium.Cartesian3());
                this.interactivePrimitives.movingLabel.position = midPoint;
                this.interactivePrimitives.movingLabel.text = formatDistance(distance);
                this.interactivePrimitives.movingLabel.id = generateId(midPoint, "height_label");
            }
            // // update moving point primitive to dragging position
            // this.movingTopPointPrimitive.show = true;
            // this.movingTopPointPrimitive.position = draggingPosition[0];
            // this.movingTopPointPrimitive.id = generateId(draggingPosition[0], "height_moving_top_point");

            // this.movingBottomPointPrimitive.show = true;
            // this.movingBottomPointPrimitive.position = draggingPosition[1];
            // this.movingBottomPointPrimitive.id = generateId(draggingPosition[1], "height_moving_bottom_point");

            // // update line primitive to dragging position
            // if (this.movingPolylinePrimitive) this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            // const movingLineGeometryInstance = createLineGeometryInstance(draggingPosition, "height_moving_line");
            // const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            // this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // // update label primitive to dragging position
            // if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            // const distance = Cesium.Cartesian3.distance(draggingPosition[0], draggingPosition[1]);
            // this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(draggingPosition[0], draggingPosition[1], distance));
            // const midPoint = Cesium.Cartesian3.midpoint(draggingPosition[0], draggingPosition[1], new Cesium.Cartesian3());
            // this.movingLabelPrimitive.id = generateId(midPoint, "height_moving_label");

        }
    }

    handleHeightDragEnd(movement) {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingTopPrimitive && this.isDragMode) {

            const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);

            const groundCartographic = new Cesium.Cartographic(
                cartographic.longitude,
                cartographic.latitude,
                this.viewer.scene.globe.getHeight(cartographic)
            );
            if (!groundCartographic) return;


            // ground position relevant to movement position
            const groundCartesian = convertToCartesian3(groundCartographic);

            const draggingPosition = [this.coordinate, groundCartesian];

            // update the point
            if (this.movingTopPointPrimitive) this.movingTopPointPrimitive.show = false;
            if (this.draggingTopPrimitive) {
                this.draggingTopPrimitive.show = true;
                this.draggingTopPrimitive.position = draggingPosition[0];
            }

            if (this.movingBottomPointPrimitive) this.movingBottomPointPrimitive.show = false;
            if (this.draggingBottomPrimitive) {
                this.draggingBottomPrimitive.show = true;
                this.draggingBottomPrimitive.position = draggingPosition[1];
            }
            // update the line
            if (this.movingPolylinePrimitive) this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);

            const lineGeometryInstance = createLineGeometryInstance(draggingPosition, "height_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // update the label
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            const existedMidPoint = Cesium.Cartesian3.midpoint(this.coords.dragStartTop, this.coords.dragStartBottom, new Cesium.Cartesian3());
            const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, existedMidPoint) && label?.id && label?.id?.startsWith("annotate_height_label"));

            const newMidPoint = Cesium.Cartesian3.midpoint(draggingPosition[0], draggingPosition[1], new Cesium.Cartesian3());
            const distance = Cesium.Cartesian3.distance(draggingPosition[0], draggingPosition[1]);
            if (targetLabelPrimitive) {
                targetLabelPrimitive.show = true;
                targetLabelPrimitive.position = newMidPoint;
                targetLabelPrimitive.text = formatDistance(distance);
                targetLabelPrimitive.id = generateId(newMidPoint, "height_label");
            }

            // update the groupCoords
            const topPositionIndex = this.coords.groups.findIndex(p => Cesium.Cartesian3.equals(p[0], this.coords.dragStartTop));
            const bottomPositionIndex = this.coords.groups.findIndex(p => Cesium.Cartesian3.equals(p[1], this.coords.dragStartBottom));
            if (topPositionIndex !== -1) {
                this.coords.groups[topPositionIndex] = draggingPosition;
            }
            if (bottomPositionIndex !== -1) {
                this.coords.groups[bottomPositionIndex] = draggingPosition;
            }

            // log the height result
            this.logRecordsCallback(distance.toFixed(2));

        }

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.isDragMode = false;
    }

    /**
     * Get relevant point primitive, line primitive, and label primitive filtered by the position
     * @param {Cesium.Cartesian3} position 
     * @param {String} startsWithMeasureMode - the string of the id starts with, example "annotation_multi_distance"
     */
    getPrimitiveByPointPosition(position, startsWithMeasureMode) {
        // get point primitive by position
        const pointPrimitive = this.pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith(startsWithMeasureMode) &&
            !p.id.includes("moving") &&
            Cesium.Cartesian3.equals(p.position, position)
        );
        // get line primitives by position
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
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
            this.labelCollection._labels.find(l => l.id && l.id.startsWith(startsWithMeasureMode) &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, midPoint)
            )
        ).filter(label => label !== undefined);

        return { pointPrimitive, linePrimitives, labelPrimitives };
    }

    resetValue() {
        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        this.isDragMode = false;

        this.coords.dragStartTop = null;
        this.coords.dragStartBottom = null;

        this.draggingBottomPrimitive = null;
        this.draggingTopPrimitive = null;

        this.coords.cache = [];

        // remove moving primitives
        if (this.movingTopPointPrimitive) {
            this.movingPointCollection.remove(this.movingTopPointPrimitive);
        }
        if (this.movingBottomPointPrimitive) {
            this.movingPointCollection.remove(this.movingBottomPointPrimitive);
        }
        if (this.movingPolylinePrimitive) {
            this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
        }
        if (this.movingLabelPrimitive) {
            this.labelCollection.remove(this.movingLabelPrimitive);
        }
    }
}

export { Height }
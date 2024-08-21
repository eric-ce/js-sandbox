import {
    convertToCartesian3,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    generateId,
    createLinePrimitive,
    createLineGeometryInstance,
    createLabelPrimitive,
    formatDistance
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

        //log
        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        // flags
        this.isDragMode = false;

        // cesium primitives
        // point primitives: as recommended by Cesium, seperate use for dynamic and static points to improve performance
        this.movingPointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.movingPointCollection);

        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);

        this.movingTopPointPrimitive = null;
        this.movingBottomPointPrimitive = null;

        this.draggingTopPrimitive = null;
        this.draggingBottomPrimitive = null;

        // set relative bottom point not show
        // label primitives
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);

        const movingLabel = createLabelPrimitive(Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO, 0);
        this.movingLabelPrimitive = this.labelCollection.add(movingLabel);
        this.movingLabelPrimitive.show = false;

        // line primitives
        this.movingPolylinePrimitive = null;

        // coordinates data
        this.coordinate = new Cesium.Cartesian3();
        this.beforeDragTopPosition = new Cesium.Cartesian3();
        this.beforeDragBottomPosition = new Cesium.Cartesian3();
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
            this.handleHeightLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleHeightDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleHeightDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place top and ground points, draw line in between.
     */
    handleHeightLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        // If picked object is a label primitive, make it editable
        if (
            Cesium.defined(pickedObject) &&
            pickedObject?.id?.startsWith("annotate") &&
            pickedObject.id.includes("label") &&
            !pickedObject.id.includes("moving")
        ) {
            editableLabel(this.viewer.container, pickedObject.primitive);
            return; // Exit the function after making the label editable
        }

        if (this.coordinateDataCache.length === 2) {
            const [topCartesian, bottomCartesian] = this.coordinateDataCache;
            // update this.groupCoords to store all click coordinates
            this.groupCoords.push([topCartesian, bottomCartesian]);

            // create top and bottom points primitiives
            const topPointPrimitive = createPointPrimitive(topCartesian, Cesium.Color.RED);
            topPointPrimitive.id = generateId(topCartesian, "height_top_point");
            this.pointCollection.add(topPointPrimitive);

            const bottomPointPrimitive = createPointPrimitive(bottomCartesian, Cesium.Color.RED);
            bottomPointPrimitive.id = generateId(bottomCartesian, "height_bottom_point");
            this.pointCollection.add(bottomPointPrimitive);

            // create line primitive
            const lineGeometryInstance = createLineGeometryInstance([topCartesian, bottomCartesian], "height_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const distance = Cesium.Cartesian3.distance(topCartesian, bottomCartesian);
            const midPoint = Cesium.Cartesian3.midpoint(topCartesian, bottomCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(topCartesian, bottomCartesian, distance);
            label.id = generateId(midPoint, "height_label");
            this.labelCollection.add(label);

            // log the height result
            //     this._heightRecords.push(distance);
            this.logRecordsCallback(distance.toFixed(2));
        }
    }

    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    async handleHeightMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        // Check if the position is defined
        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, this.coordinate, pickedObjects)

        const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);

        const groundCartographicArray = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [cartographic]);

        if (groundCartographicArray && groundCartographicArray.length > 0) {
            // ground position relevant to movement position
            const groundCartesian = convertToCartesian3(groundCartographicArray[0]);

            this.coordinateDataCache = [this.coordinate, groundCartesian];

            // create top and bottom points primitiives
            // top point primitive
            if (this.movingTopPointPrimitive) {
                this.movingPointCollection.remove(this.movingTopPointPrimitive);
            }
            // error handling: use this.coordinateDataCache to create top and bottom points to make sure top point and bottom point are created at the same time.
            const topPointPrimitive = createPointPrimitive(this.coordinateDataCache[0], Cesium.Color.RED);
            this.movingTopPointPrimitive = this.movingPointCollection.add(topPointPrimitive);
            this.movingTopPointPrimitive.id = generateId(this.coordinate, "height_moving_top_point");

            // bottom point primitive
            if (this.movingBottomPointPrimitive) {
                this.movingPointCollection.remove(this.movingBottomPointPrimitive);
            }
            const bottomPointPrimitive = createPointPrimitive(this.coordinateDataCache[1], Cesium.Color.RED);
            this.movingBottomPointPrimitive = this.movingPointCollection.add(bottomPointPrimitive);
            this.movingBottomPointPrimitive.id = generateId(groundCartesian, "height_moving_bottom_point");

            // create line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const movingLineGeometryInstance = createLineGeometryInstance(this.coordinateDataCache, "height_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = Cesium.Cartesian3.distance(this.coordinateDataCache[0], this.coordinateDataCache[1]);
            const midPoint = Cesium.Cartesian3.midpoint(this.coordinateDataCache[0], this.coordinateDataCache[1], new Cesium.Cartesian3());
            this.movingLabelPrimitive.show = true;
            this.movingLabelPrimitive.position = midPoint;
            this.movingLabelPrimitive.text = formatDistance(distance);
        };
    };

    handleHeightDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.groupCoords.length === 0) return;

        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

        const pointPrimitive = pickedObjects.find(p => {
            if (typeof p.primitive?.id !== 'string') {
                return false;
            }
            return p.primitive.id.startsWith("annotate_height") &&
                p.primitive.id.includes("point") &&
                !p.primitive.id.includes("moving");
        });

        // error handling: if no point primitives found then early exit
        if (!Cesium.defined(pointPrimitive)) {
            console.error("No point primitives found");
            return;
        }

        // disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;
        this.isDragMode = true;

        this.pointerOverlay.style.display = "none";

        // drag point primitive
        // draggingPoint could be either the top point or the bottom point
        const draggingPoint = pointPrimitive.primitive;
        const draggingPointPosition = draggingPoint.position.clone();

        // use draggingPointPosition to find whether it is top point or bottom point
        const topPositionIndex = this.groupCoords.findIndex(p => Cesium.Cartesian3.equals(p[0], draggingPointPosition));
        const bottomPositionIndex = this.groupCoords.findIndex(p => Cesium.Cartesian3.equals(p[1], draggingPointPosition));

        let topPosition = null;
        let bottomPosition = null;

        // if draggingPoint is top point, find the bottom point
        if (topPositionIndex !== -1) {
            topPosition = draggingPointPosition;
            this.draggingTopPrimitive = draggingPoint;

            this.draggingTopPrimitive.show = false;
            this.beforeDragTopPosition = this.draggingTopPrimitive.position.clone();

            bottomPosition = this.groupCoords[topPositionIndex][1];
            this.draggingBottomPrimitive = this.pointCollection._pointPrimitives.find(p => Cesium.Cartesian3.equals(p.position, bottomPosition));

            this.draggingBottomPrimitive.show = false;
            this.beforeDragBottomPosition = this.draggingBottomPrimitive.position.clone();
        } else if (bottomPositionIndex !== -1) {
            // if draggingPoint is bottom point, find the top point
            bottomPosition = draggingPointPosition;
            this.draggingBottomPrimitive = draggingPoint;
            this.draggingBottomPrimitive.show = false;
            this.beforeDragBottomPosition = this.draggingBottomPrimitive.position.clone();

            topPosition = this.groupCoords[bottomPositionIndex][0];
            this.draggingTopPrimitive = this.pointCollection._pointPrimitives.find(p => Cesium.Cartesian3.equals(p.position, topPosition));
            this.draggingTopPrimitive.show = false;
            this.beforeDragTopPosition = this.draggingTopPrimitive.position.clone();
        }

        // set moving top and bottom point not show
        if (this.movingBottomPointPrimitive && this.movingTopPointPrimitive) {
            this.movingBottomPointPrimitive.show = false;
            this.movingTopPointPrimitive.show = false;
        }

        // set relative line and label not show
        if (topPosition && bottomPosition) {
            // set relative line not show
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_height_line"));
            let linePrimitive = null;
            if (linePrimitives.length > 0) {
                linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, topPosition)));

                // set the relative line primitive to no show
                linePrimitive ? linePrimitive.show = false : console.error("No specific line primitives found");
            } else {
                console.error("No line primitives found");
                return;
            }
            // set relative label not show
            if (this.movingLabelPrimitive) {
                this.movingLabelPrimitive.show = false;
            }
            const midpoint = Cesium.Cartesian3.midpoint(topPosition, bottomPosition, new Cesium.Cartesian3());
            const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, midpoint) && label.id && label.id.startsWith("annotate_height_label"));
            targetLabelPrimitive.show = false;
        }

        // set move event for dragging
        this.handler.setInputAction((movement) => {
            this.handleHeightDrag(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    handleHeightDrag(movement) {
        // error handling: if not in drag mode then early exit
        if (!this.isDragMode) return;

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);

        Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [
            cartographic,
        ]).then((groundPositions) => {
            const groundHeight = groundPositions[0].height;
            // ground position relevant to movement position
            const groundCartesian = convertToCartesian3(
                new Cesium.Cartographic(
                    cartographic.longitude,
                    cartographic.latitude,
                    groundHeight
                )
            );
            const draggingPosition = [this.coordinate, groundCartesian];

            // update moving point primitive to dragging position
            this.movingTopPointPrimitive.show = true;
            this.movingTopPointPrimitive.position = draggingPosition[0];
            this.movingTopPointPrimitive.id = generateId(draggingPosition[0], "height_moving_top_point");

            this.movingBottomPointPrimitive.show = true;
            this.movingBottomPointPrimitive.position = draggingPosition[1];
            this.movingBottomPointPrimitive.id = generateId(draggingPosition[1], "height_moving_bottom_point");

            // update line primitive to dragging position
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const movingLineGeometryInstance = createLineGeometryInstance(draggingPosition, "height_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // update label primitive to dragging position
            const distance = Cesium.Cartesian3.distance(draggingPosition[0], draggingPosition[1]);
            const midPoint = Cesium.Cartesian3.midpoint(draggingPosition[0], draggingPosition[1], new Cesium.Cartesian3());
            this.movingLabelPrimitive.show = true;
            this.movingLabelPrimitive.position = midPoint;
            this.movingLabelPrimitive.text = formatDistance(distance);
            this.movingLabelPrimitive.id = generateId(midPoint, "height_moving_label");
        });


    }

    async handleHeightDragEnd(movement) {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingTopPrimitive && this.isDragMode) {

            const cartographic = Cesium.Cartographic.fromCartesian(this.coordinate);
            console.log(this.draggingBottomPrimitive,
                this.draggingTopPrimitive)

            const groundCartographicArray = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [
                cartographic,
            ])

            if (groundCartographicArray && groundCartographicArray.length > 0) {
                // ground position relevant to movement position
                const groundCartesian = convertToCartesian3(
                    groundCartographicArray[0]
                );

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
                if (this.movingLabelPrimitive) this.movingLabelPrimitive.show = false;
                const existedMidPoint = Cesium.Cartesian3.midpoint(this.beforeDragTopPosition, this.beforeDragBottomPosition, new Cesium.Cartesian3());
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
                const topPositionIndex = this.groupCoords.findIndex(p => Cesium.Cartesian3.equals(p[0], this.beforeDragTopPosition));
                const bottomPositionIndex = this.groupCoords.findIndex(p => Cesium.Cartesian3.equals(p[1], this.beforeDragBottomPosition));
                if (topPositionIndex !== -1) {
                    this.groupCoords[topPositionIndex] = draggingPosition;
                }
                if (bottomPositionIndex !== -1) {
                    this.groupCoords[bottomPositionIndex] = draggingPosition;
                }

                // log the height result
                this.logRecordsCallback(distance.toFixed(2));
            }
        }

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.isDragMode = false;
    }

    resetValue() {
        this.coordinate = null;
        this.beforeDragTopPosition = null;
        this.beforeDragBottomPosition = null;

        this.draggingBottomPrimitive = null;
        this.draggingTopPrimitive = null;
    }
}

export { Height }
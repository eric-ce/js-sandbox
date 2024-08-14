import {
    convertToCartesian3,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    generateId,
    createLinePrimitive,
    createGeometryInstance,
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
class HeightP {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        //log
        this.logRecordsCallback = logRecordsCallback;


        // flags
        this.isDragMode = false;

        // cesium primitives
        // point primitives: as recommended by Cesium, seperate use for dynamic and static points to improve performance
        this.movingPointCollection = new Cesium.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.movingPointCollection);

        this.pointCollection = new Cesium.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);

        this.movingTopPointPrimitive = null;
        this.movingBottomPointPrimitive = null;

        this.draggingTopPrimitive = null;
        this.draggingBottomPrimitive = null;

        // set relative bottom point not show
        // label primitives
        this.labelCollection = new Cesium.LabelCollection();
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
            pickedObject.id.includes("label")
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
            const lineGeometryInstance = createGeometryInstance([topCartesian, bottomCartesian], "height_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const distance = Cesium.Cartesian3.distance(topCartesian, bottomCartesian);
            const midPoint = Cesium.Cartesian3.midpoint(topCartesian, bottomCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(topCartesian, bottomCartesian, distance);
            label.id = generateId(midPoint, "height_label");
            this.labelCollection.add(label);

            // log the height result
            //     this._heightRecords.push(distance);
            this.logRecordsCallback(distance);
        }
    }

    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleHeightMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        // Check if the position is defined
        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, this.coordinate, pickedObjects)

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

            this.coordinateDataCache = [this.coordinate, groundCartesian];

            // create top and bottom points primitiives
            if (this.movingTopPointPrimitive) {
                this.movingPointCollection.remove(this.movingTopPointPrimitive);
            }
            // error handling: use this.coordinateDataCache to create top and bottom points to make sure top point and bottom point are created at the same time.
            const topPointPrimitive = createPointPrimitive(this.coordinateDataCache[0], Cesium.Color.RED);
            this.movingTopPointPrimitive = this.movingPointCollection.add(topPointPrimitive);
            this.movingTopPointPrimitive.id = generateId(this.coordinate, "height_moving_top_point");

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
            const movingLineGeometryInstance = createGeometryInstance(this.coordinateDataCache, "height_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = Cesium.Cartesian3.distance(this.coordinateDataCache[0], this.coordinateDataCache[1]);
            const midPoint = Cesium.Cartesian3.midpoint(this.coordinateDataCache[0], this.coordinateDataCache[1], new Cesium.Cartesian3());
            this.movingLabelPrimitive.show = true;
            this.movingLabelPrimitive.position = midPoint;
            this.movingLabelPrimitive.text = formatDistance(distance);
        });
    };

    handleHeightDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coordinateDataCache.length !== 2) return;

        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
        const pointPrimitive = pickedObjects.find(p => p.primitive &&
            p.primitive?.id?.startsWith("annotate_height") &&
            p.primitive?.id?.includes("point") &&
            !p.primitive?.id?.includes("moving")
        );

        // error handling: if no point primitives found then early exit
        if (!Cesium.defined(pointPrimitive)) {
            console.error("No point primitives found");
            return;
        }

        // disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;
        this.isDragMode = true;

        this.draggingTopPrimitive = pointPrimitive.primitive;
        this.beforeDragTopPosition = this.draggingTopPrimitive.position;

        // use this.beforeDragTopPosition to find from this.groupCoords for the corresponding bottom point position
        const topIndex = this.groupCoords.findIndex(p => Cesium.Cartesian3.equals(p[0], this.beforeDragTopPosition));
        const bottomPosition = this.groupCoords[topIndex].find(p => !Cesium.Cartesian3.equals(p, this.beforeDragTopPosition));
        // use the bottom posistion to find the corresponding bottom point primitive
        this.draggingBottomPrimitive = this.pointCollection._pointPrimitives.find(p => Cesium.Cartesian3.equals(p.position, bottomPosition));
        this.beforeDragBottomPosition = this.draggingBottomPrimitive.position;

        // set relative line not show
        // set relative label not show

        // set move event for dragging
        this.handler.setInputAction((movement) => {
            this.handleHeightDrag(movement, this.draggingTopPrimitive, this.draggingBottomPrimitive);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    handleHeightDrag(movement, topPointPrimitive, bottomPointPrimitive, topPointPosition, bottomPointPosition) {
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

            // update point primitive to dragging position
            topPointPrimitive.position = draggingPosition[0];
            bottomPointPrimitive.position = draggingPosition[1];

        });

    }

    handleHeightDragEnd(movement) {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingTopPrimitive && this.isDragMode) {

        }

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.draggingTopPrimitive = null;
        this.isDragMode = false;
    }

    resetValue() {
        this.coordinate = null;
    }
}

export { HeightP }
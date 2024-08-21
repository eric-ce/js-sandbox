import * as Cesium from "cesium";
import {
    removeInputActions,
    cartesian3ToCartographicDegrees,
    updatePointerOverlay,
    generateId,
    createPointPrimitive,
} from "../helper/helper.js";

/**
 * Represents points bookmark tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 * @param {Function} logRecordsCallback - The callback function to log records.
 */
class Points {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;
        this.coordinateInfoOverlay = this.createCoordinateInfoOverlay();

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();
        // primitive
        this.pointPrimitives = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointPrimitives);

        this.draggingPrimitive = null;
        this.isDragMode = false;
    }

    /**
     * Sets up input actions for points mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handlePointsLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePointsMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handlePointsDragStart(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction(() => {
            this.handlePointsDragEnd();
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }


    /**
     * Handles left-click events to place points, if selected point existed remove the point
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handlePointsLeftClick(movement) {
        // this.viewer.selectedEntity = undefined;
        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

        if (pickedObject && pickedObject.id && typeof pickedObject.id === 'string' && pickedObject.id.startsWith("annotate_bookmark")) {
            const primitiveToRemoveId = pickedObject.id;
            const primtiveToRemove = this.pointPrimitives._pointPrimitives.find(primitive => primitive.id === primitiveToRemoveId);
            if (primtiveToRemove) {
                const position = Cesium.Cartesian3.clone(primtiveToRemove.position);
                this.pointPrimitives.remove(primtiveToRemove);

                // log the points records
                const cartographicDegrees = cartesian3ToCartographicDegrees(position);
                const formattedCartographicDegrees = this.formatCartographicDegrees(cartographicDegrees)
                this.logRecordsCallback({ "remove": formattedCartographicDegrees });
            }
        } else {
            // if no point entity is picked, create a new point entity
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            // primitive way to add point
            if (Cesium.defined(cartesian)) {
                const point = createPointPrimitive(cartesian, Cesium.Color.RED);
                point.id = generateId(cartesian, "bookmark");
                this.pointPrimitives.add(point);

                // log the points records
                const cartographicDegrees = cartesian3ToCartographicDegrees(cartesian);
                const formattedCartographicDegrees = this.formatCartographicDegrees(cartographicDegrees)
                this.logRecordsCallback({ "add": formattedCartographicDegrees });
            }
        }
    }

    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handlePointsMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        // update coordinateInfoOverlay
        this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
    }

    handlePointsDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        // pick the point primitive
        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
        const pointPrimitive = pickedObjects.find(pickedObject => pickedObject.id && typeof pickedObject.id === 'string' && pickedObject.id.startsWith("annotate_bookmark"));
        if (Cesium.defined(pointPrimitive)) {
            this.isDragMode = true;

            // set point overlay no show
            this.pointerOverlay.style.display = 'none';

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            this.draggingPrimitive = this.pointPrimitives._pointPrimitives.find(primitive => primitive.id === pointPrimitive.id);

            this.draggingPrimitive.show = false;
            // setting for drag mouse moving action
            this.handler.setInputAction((movement) => {
                this.handlePointsDrag(movement);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }

    };

    handlePointsDrag(movement) {
        // update the coordinate
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // moving point primitive 
        if (this.movingPointPrimitive) {
            this.pointPrimitives.remove(this.movingPointPrimitive)
        }
        const movingPoint = createPointPrimitive(cartesian, Cesium.Color.RED);
        movingPoint.id = generateId(cartesian, "moving_bookmark");
        this.movingPointPrimitive = this.pointPrimitives.add(movingPoint);

        // update coordinateInfoOverlay
        this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
    };

    handlePointsDragEnd() {
        // update the drag primitive to the finish position;
        if (this.isDragMode) {
            this.pointPrimitives.remove(this.movingPointPrimitive);

            this.draggingPrimitive.position = this.coordinate;
            this.draggingPrimitive.show = true;

            // log the points records
            const cartographicDegrees = cartesian3ToCartographicDegrees(this.coordinate);
            const formattedCartographicDegrees = this.formatCartographicDegrees(cartographicDegrees)
            this.logRecordsCallback({ "update": formattedCartographicDegrees });

            this.isDragMode = false;
        }

        // reset default mouse moving action
        this.handler.setInputAction((movement) => {
            this.handlePointsMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    };

    createCoordinateInfoOverlay() {
        this.coordinateInfoOverlay = document.createElement("div");
        this.coordinateInfoOverlay.className = "coordinate-info-overlay";
        this.viewer.container.appendChild(this.coordinateInfoOverlay);
        this.coordinateInfoOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        return this.coordinateInfoOverlay;
    }

    updateCoordinateInfoOverlay(cartesian) {
        const cartographicDegress = cartesian3ToCartographicDegrees(cartesian);
        const displayInfo = `Lat: ${cartographicDegress.latitude.toFixed(6)}<br>Lon: ${cartographicDegress.longitude.toFixed(6)} <br>Alt: ${cartographicDegress.height.toFixed(2)}`;
        this.coordinateInfoOverlay.innerHTML = displayInfo;

        const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, cartesian);
        this.coordinateInfoOverlay.style.display = 'block';
        this.coordinateInfoOverlay.style.left = `${screenPosition.x + 20}px`;
        this.coordinateInfoOverlay.style.top = `${screenPosition.y - 20}px`;
        this.coordinateInfoOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.coordinateInfoOverlay.style.color = 'white';
        this.coordinateInfoOverlay.style.borderRadius = '4px';
        this.coordinateInfoOverlay.style.padding = '8px';
        this.coordinateInfoOverlay.style.fontFamily = 'Roboto, sans-serif';
    }

    formatCartographicDegrees(cartographicDegrees) {
        const { longitude, latitude } = cartographicDegrees;
        if (!longitude || !latitude) return;
        return {
            "lat, lon": `${latitude.toFixed(6)},${longitude.toFixed(6)} `,
        }
    }

    // /**
    //  * Gets the points records.
    //  * @returns {Array} The points records.
    //  */
    // get pointsRecords() {
    //     return this._pointsRecords.map(cartesian3ToCartographicDegrees);
    // }

    resetValue() {
        // this.pointPrimitives.removeAll();
        this.coordinate = null;

        this.coordinateInfoOverlay.style.display = 'none';
        this.pointerOverlay.style.display = 'none';
    }
}

export { Points };
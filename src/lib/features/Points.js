import * as Cesium from "cesium";
import { createPointEntity, removeInputActions, cartesian3ToCartographicDegrees } from "../helper/helper.js";

/**
 * Represents points bookmark tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
 */
class Points {
    constructor(viewer, handler, nameOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.pointEntities = new Cesium.EntityCollection();

        this.coordinate = new Cesium.Cartesian3();

        this._pointsRecords = [];
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

        // initialize pointEntities
        this.pointEntities.removeAll();


        if (pickedObject && pickedObject.id && pickedObject.collection) {
            // if picked point entity exists, remove it
            const entityToRemove = this.viewer.entities.getById(pickedObject.id.id);

            if (entityToRemove && entityToRemove.id.startsWith("point-bookmark")) {
                // log the removed point records
                const position = Cesium.Cartesian3.clone(entityToRemove.position.getValue(Cesium.JulianDate.now()));
                this._pointsRecords = this._pointsRecords.filter(point => !Cesium.Cartesian3.equals(point, position));
                this.logRecordsCallback(this.pointsRecords);

                // remove from viewer and pointEntities collection
                this.viewer.entities.remove(entityToRemove);
                this.pointEntities.remove(entityToRemove);

            }
        } else {
            // if no point entity is picked, create a new point entity
            // const cartesian = this.viewer.scene.pickPosition(movement.position);
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (Cesium.defined(cartesian)) {
                const point = createPointEntity(cartesian, Cesium.Color.RED);
                point.id = `point-bookmark-${this.coordinate.x}-${this.coordinate.y}-${this.coordinate.z}`;

                const pointEntity = this.viewer.entities.add(point)

                this.pointEntities.add(pointEntity);

                // log the points records
                this._pointsRecords.push(cartesian);
                this.logRecordsCallback(this.pointsRecords);
            }
        }


    }

    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handlePointsMouseMove(movement) {
        // const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);
        // if (Cesium.defined(pickedObject)) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;
        // update nameOverlay: the moving dot with mouse
        this.updateMovingDot(cartesian);

        // } else {
        //     this.nameOverlay.style.display = "none";
        // }
    }

    /**
     * update the moving dot with mouse
     * @param {Cesium.Cartesian3} cartesian
     */
    updateMovingDot(cartesian) {
        const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, cartesian);
        this.nameOverlay.style.display = 'block';
        this.nameOverlay.style.left = `${screenPosition.x - 5}px`;
        this.nameOverlay.style.top = `${screenPosition.y - 5}px`;
        this.nameOverlay.style.backgroundColor = "yellow";
        this.nameOverlay.style.borderRadius = "50%"
        this.nameOverlay.style.width = "1px";
        this.nameOverlay.style.height = "1px";
    }

    /**
     * Gets the points records.
     * @returns {Array} The points records.
     */
    get pointsRecords() {
        return this._pointsRecords.map(cartesian3ToCartographicDegrees);
    }

    resetValue() {
        this.pointEntities.removeAll();
        this.coordinate = null;
    }
}

export { Points };
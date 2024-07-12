import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel, removeInputActions } from "../helper/helper.js";


/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
 */
class TwoPointsDistance {
    constructor(viewer, handler, nameOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();

        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this._distanceRecords = [];
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleDistanceLeftClick(movement) {
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

        // if (Cesium.defined(pickedObject)) {
        // const cartesian = this.viewer.scene.pickPosition(movement.position);

        // use mouse move position to control only one pickPosition is used
        const cartesian = this.coordinate;
        // early exit if not cartesian
        if (!Cesium.defined(cartesian)) return;

        if (this.pointEntities.values.length === 0) {
            // if there is no point entity, create the first point
            const firstPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(firstPointEntity);
        } else if (this.pointEntities.values.length % 2 !== 0) {
            // if there is one point entity, create the second point
            const secondPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.BLUE)
            );
            this.pointEntities.add(secondPointEntity);

            if (this.pointEntities.values.length === 2) {
                // create line entity between the first and second point
                this.removeEntities(this.lineEntities);
                this.removeEntities(this.movingLineEntity);
                const line = createLineEntity(
                    [
                        this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                        this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now()),
                    ],
                    Cesium.Color.ORANGE
                );
                const lineEntity = this.viewer.entities.add(line);
                this.lineEntities.add(lineEntity);

                // create distance label
                this.removeEntities(this.labelEntities);
                this.removeEntity(this.movingLabelEntity);
                const distance = calculateDistance(
                    this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                    this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now())
                );
                const label = createDistanceLabel(
                    this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                    this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now()),
                    distance
                );
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);

                // log distance
                this._distanceRecords.push(distance);
                this.logRecordsCallback(this._distanceRecords);
            }

        } else {
            // if there are more than 2 point entities, reset the measurement
            this.pointEntities.removeAll();
            this.lineEntities.removeAll();
            this.labelEntities.removeAll();

            // Remove all entities from the viewer
            // this.viewer.entities.removeAll();

            // create the first point, so it won't interupt to restart the measurement
            // without this could cause click twice to restart the measurement
            const firstPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(firstPointEntity);
        }
        // }
    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        // const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);
        // if (Cesium.defined(pickedObject)) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update nameOverlay: the moving dot with mouse
        this.updateMovingDot(cartesian)

        if (this.pointEntities.values.length > 0 && this.pointEntities.values.length < 2) {
            const firstPointCartesian = this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now())

            // create moving line entity
            this.removeEntity(this.movingLineEntity);
            const movingLine = createLineEntity(
                [firstPointCartesian, cartesian],
                Cesium.Color.YELLOW
            );
            movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                return [firstPointCartesian, cartesian];
            }, false);
            this.movingLineEntity = this.viewer.entities.add(movingLine);

            // create distance label
            this.removeEntity(this.movingLabelEntity);
            const distance = calculateDistance(
                firstPointCartesian,
                cartesian
            );
            const label = createDistanceLabel(
                firstPointCartesian,
                cartesian,
                distance
            );
            this.movingLabelEntity = this.viewer.entities.add(label);

        }
        // } else {
        //     this.nameOverlay.style.display = "none";
        // }
    }

    /**
     * Removes entities that has been added to entity collection
     * @param {Cesium.EntityCollection} entityOrCollection - The entity or entity collection to remove
     */
    removeEntities(entityCollection) {
        // if it is entitiy collection, remove all entities and reset the collection
        if (entityCollection instanceof Cesium.EntityCollection) {

            entityCollection.values.forEach((entity) => {
                this.viewer.entities.remove(entity);
            });
            entityCollection.removeAll();
        }
    }

    /**
     * Removes single entity
     * @param {Cesium.Entity} entityOrCollection - The entity or entity collection to remove
     */
    removeEntity(entity) {
        this.viewer.entities.remove(entity);
        entity = null;
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

    resetValue() {
        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();
        this.removeEntity(this.movingLineEntity);
        this.removeEntity(this.movingLabelEntity);
        this.coordinate = null;

    }
}

export { TwoPointsDistance };
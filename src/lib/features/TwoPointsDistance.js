import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    calculateDistance,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    throttle
} from "../helper/helper.js";


/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class TwoPointsDistance {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();

        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this._distanceRecords = [];

        this.isDistanceStarted = false;
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

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (!this.isDistanceStarted) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }

            // Set flag that the measurement has started
            this.isDistanceStarted = true;
        }

        // if it is not label entity, then start to draw the measurement
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
                this.logRecordsCallback(distance);

                // set flag that the measurement has ended
                this.isDistanceStarted = false;
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
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)


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

    resetValue() {
        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();

        this.removeEntity(this.movingLineEntity);
        this.removeEntity(this.movingLabelEntity);
        this.coordinate = null;

        this.isDistanceStarted = false;
    }
}

export { TwoPointsDistance };
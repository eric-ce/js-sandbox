import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel, formatDistance, removeInputActions } from "./helper.js";

class MultiDistance {
    /**
     * Creates a new MultiDistance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
     */
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.isMultiDistanceEnd = false;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();
        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.distanceCollection = [];
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }


    handleMultiDistanceLeftClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const pickedObject = this.viewer.scene.pick(movement.position);

        if (Cesium.defined(pickedObject)) {

            const cartesian = this.viewer.scene.pickPosition(movement.position);

            if (!Cesium.defined(cartesian)) return;

            // initialize the measurement, clear all previous measure records
            if (this.isMultiDistanceEnd) {
                this.pointEntities.removeAll();
                this.lineEntities.removeAll();
                this.labelEntities.removeAll();

                this.movingLineEntity = new Cesium.Entity();
                this.movingLabelEntity = new Cesium.Entity();

                this.distanceCollection.length = 0;

                this.isMultiDistanceEnd = false;
                const continuePoint = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED));
                this.pointEntities.add(continuePoint);
                return;
            }

            // create point entity
            const pointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(pointEntity);

            if (this.pointEntities.values.length > 1) {
                const prevIndex = this.pointEntities.values.length - 2;
                const currIndex = this.pointEntities.values.length - 1;
                const prevPointCartesian = this.pointEntities.values[prevIndex].position.getValue(Cesium.JulianDate.now());
                const currPointCartesian = this.pointEntities.values[currIndex].position.getValue(Cesium.JulianDate.now());

                // create line entities
                const lineEntity = this.viewer.entities.add(
                    createLineEntity([prevPointCartesian, currPointCartesian], Cesium.Color.ORANGE)
                );
                this.lineEntities.add(lineEntity);

                // create label entities
                const distance = calculateDistance(prevPointCartesian, currPointCartesian);
                this.distanceCollection.push(distance);
                const label = createDistanceLabel(prevPointCartesian, currPointCartesian, distance)
                label.label.text = formatDistance(distance);
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);
            }
        }
    }

    handleMultiDistanceMouseMove(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) return;

            this.updateMovingDot(cartesian);

            if (this.isMultiDistanceEnd) return;

            if (this.pointEntities.values.length > 0) {
                // Calculate the distance between the last selected point and the current cartesian position
                const lastPointIndex = this.pointEntities.values.length - 1;
                const lastPointCartesian = this.pointEntities.values[lastPointIndex].position.getValue(Cesium.JulianDate.now());

                // create labels
                this.movingLabelEntity && this.removeEntities(this.movingLabelEntity);

                const movingDistance = calculateDistance(
                    lastPointCartesian,
                    cartesian
                );
                const totalDistance =
                    this.distanceCollection.reduce((a, b) => a + b, 0) + movingDistance;

                const movingLabel = createDistanceLabel(
                    cartesian,
                    cartesian,
                    totalDistance,
                );
                movingLabel.label.showBackground = false;
                movingLabel.label.pixelOffset = new Cesium.Cartesian2(
                    80,
                    10
                );
                this.movingLabelEntity = this.viewer.entities.add(movingLabel)

                // create moving line entity
                this.movingLineEntity && this.removeEntities(this.movingLineEntity);

                const movingLine = createLineEntity([lastPointCartesian, cartesian], Cesium.Color.YELLOW)

                movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                    return [lastPointCartesian, cartesian];
                }, false);
                this.movingLineEntity = this.viewer.entities.add(
                    movingLine
                );
            }
        } else {
            this.nameOverlay.style.display = "none";
        }
    }

    handleMultiDistanceRightClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // place last point and place last line
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && !this.isMultiDistanceEnd) {
            const cartesian = this.viewer.scene.pickPosition(movement.position);
            if (!Cesium.defined(cartesian)) return;

            // create last point 
            const lastPoint = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED))
            this.pointEntities.add(lastPoint);

            // create last line
            const lastLine = this.viewer.entities.add(createLineEntity(
                [this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()), cartesian],
                Cesium.Color.ORANGE
            ));
            this.lineEntities.add(lastLine);

            // create last label 
            const lastDistance = calculateDistance(
                this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()),
                cartesian
            );
            this.distanceCollection.push(lastDistance);

            const lastLabel = this.viewer.entities.add(
                createDistanceLabel(
                    this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()),
                    cartesian,
                    lastDistance
                )
            );
            lastLabel.label.text = formatDistance(lastDistance);
            this.labelEntities.add(lastLabel);

            // remove moving line and moving label
            if (this.movingLineEntity) {
                this.viewer.entities.remove(this.movingLineEntity);
                this.movingLineEntity = new Cesium.Entity();
            }
            // place total distance label
            const totalDistance = this.distanceCollection.reduce((a, b) => a + b, 0);
            this.viewer.entities.remove(this.movingLabelEntity);
            this.movingLabelEntity = this.viewer.entities.add(createDistanceLabel(cartesian, cartesian, 0));
            this.movingLabelEntity.label.text = `Total: ${formatDistance(totalDistance)}`;
            this.movingLabelEntity.label.pixelOffset = new Cesium.Cartesian2(
                80,
                10
            );
        }

        this.isMultiDistanceEnd = true;
    }

    /**
     * Removes entities from entity collection or a single entity
     * @param {Cesium.Entity | Cesium.EntityCollection} entityOrCollection - The entity or entity collection to remove
     */
    removeEntities(entityOrCollection) {
        // if it is entitiy collection, remove all entities and reset the collection
        if (entityOrCollection instanceof Cesium.EntityCollection) {

            entityOrCollection.values.forEach((entity) => {
                this.viewer.entities.remove(entity);
            });
            entityOrCollection.removeAll();
        }
        // if it is single entity, remove the entity
        if (entityOrCollection instanceof Cesium.Entity) {
            this.viewer.entities.remove(entityOrCollection);
            entityOrCollection = null
        }
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

}
export { MultiDistance }
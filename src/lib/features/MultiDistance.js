import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    calculateDistance,
    createDistanceLabel,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay
} from "../helper/helper.js";

class MultiDistance {
    /**
     * Creates a new MultiDistance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     */
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.isMultiDistanceEnd = false;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();
        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this._distanceCollection = [];
        this._distanceRecords = [];
        this._labelIndex = 0;
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

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (this.isMultiDistanceEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }
        }


        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // initialize the measurement, clear all previous measure records
        if (this.isMultiDistanceEnd) {
            this.pointEntities.removeAll();
            this.lineEntities.removeAll();
            this.labelEntities.removeAll();

            this.movingLineEntity = new Cesium.Entity();
            this.movingLabelEntity = new Cesium.Entity();

            this._distanceCollection.length = 0;

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
            this._distanceCollection.push(distance);
            const label = createDistanceLabel(prevPointCartesian, currPointCartesian, distance)
            label.label.text = `${String.fromCharCode(97 + this._labelIndex)}: ${formatDistance(distance)}`;
            this._labelIndex++;
            const labelEntity = this.viewer.entities.add(label);
            this.labelEntities.add(labelEntity);
        }
    }

    handleMultiDistanceMouseMove(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.isMultiDistanceEnd) return;

        if (this.pointEntities.values.length > 0) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointIndex = this.pointEntities.values.length - 1;
            const lastPointCartesian = this.pointEntities.values[lastPointIndex].position.getValue(Cesium.JulianDate.now());

            // create labels
            this.movingLabelEntity && this.removeEntity(this.movingLabelEntity);

            const movingDistance = calculateDistance(
                lastPointCartesian,
                cartesian
            );
            const totalDistance =
                this._distanceCollection.reduce((a, b) => a + b, 0) + movingDistance;

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
            this.movingLineEntity && this.removeEntity(this.movingLineEntity);

            const movingLine = createLineEntity([lastPointCartesian, cartesian], Cesium.Color.YELLOW)

            movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                return [lastPointCartesian, cartesian];
            }, false);
            this.movingLineEntity = this.viewer.entities.add(
                movingLine
            );
        }
    }

    handleMultiDistanceRightClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // place last point and place last line
        // const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        // if (Cesium.defined(pickedObject) && !this.isMultiDistanceEnd) {
        if (!this.isMultiDistanceEnd) {
            // const cartesian = this.viewer.scene.pickPosition(movement.position);

            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

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
            this._distanceCollection.push(lastDistance);

            const lastLabel = this.viewer.entities.add(
                createDistanceLabel(
                    this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()),
                    cartesian,
                    lastDistance
                )
            );
            lastLabel.label.text = `${String.fromCharCode(97 + this._labelIndex)}: ${formatDistance(lastDistance)}`;
            this._labelIndex++;
            this.labelEntities.add(lastLabel);

            // remove moving line and moving label
            if (this.movingLineEntity) {
                this.removeEntity(this.movingLabelEntity)
            }
            // place total distance label
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            this.viewer.entities.remove(this.movingLabelEntity);
            this.movingLabelEntity = this.viewer.entities.add(createDistanceLabel(cartesian, cartesian, 0));
            this.movingLabelEntity.label.text = `Total: ${formatDistance(totalDistance)}`;
            this.movingLabelEntity.label.pixelOffset = new Cesium.Cartesian2(
                80,
                10
            );

            // log distance result
            const distances = []
            distances.push(...this._distanceCollection);
            const distanceRecord = {
                distances: distances,
                totalDistance: totalDistance
            };
            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);
        }


        this.isMultiDistanceEnd = true;
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
        this.movingLabelEntity = null;
        this.movingLineEntity = null;

        this.coordinate = new Cesium.Cartesian3();

        // this._labelIndex = 0;
    }
}
export { MultiDistance }
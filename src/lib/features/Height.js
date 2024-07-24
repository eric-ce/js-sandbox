import {
    createPointEntity,
    createLineEntity,
    convertToCartesian3,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay
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
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cartesian = new Cesium.Cartesian3();

        this.pointEntities = new Cesium.EntityCollection();

        this.lineEntity = new Cesium.Entity();
        this.labelEntity = new Cesium.Entity();

        this._heightRecords = [];
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
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // if pick the label entity, make the label entity editable
        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

        if (pickedObjects && pickedObjects.length > 0) {
            pickedObjects.forEach((pickedObject) => {
                if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                    editableLabel(this.viewer.container, pickedObject.id.label);
                    // to reset that moving action left height measure
                    this.resetValue()
                }
            })
        }

        // use mouse move position to control only one pickPosition is used
        if (!Cesium.defined(this.cartesian)) return;

        // create top and bottom points from mouse move picked position
        if (this.pointEntities.values.length > 1) {

            const [topPointEntity, bottomPointEntity] = this.pointEntities.values
            const topCartesianClone = topPointEntity.position.getValue(Cesium.JulianDate.now());
            const bottomCartesianClone = bottomPointEntity.position.getValue(Cesium.JulianDate.now());

            this.pointEntities.removeAll();

            // leave the line entity
            const lineEntityClone = this.lineEntity;
            this.lineEntity = null;


            // leave the label entity
            const labelEntityClone = this.labelEntity;
            this.labelEntity = null;

            // log the height result
            const distance = Cesium.Cartesian3.distance(topCartesianClone, bottomCartesianClone);
            this._heightRecords.push(distance);
            this.logRecordsCallback(distance);
        }
    }


    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleHeightMouseMove(movement) {
        // const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);

        // // make sure it is picking object and not picking mesure tools entities collection
        // if (Cesium.defined(pickedObject) && !pickedObject.collection) {
        this.cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (Cesium.defined(this.cartesian)) {

            // update pointerOverlay: the moving dot with mouse
            const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
            updatePointerOverlay(this.viewer, this.pointerOverlay, this.cartesian, pickedObjects)

            const cartographic = Cesium.Cartographic.fromCartesian(this.cartesian);

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

                // create top and bottom points
                this.removeEntities(this.pointEntities);
                const topPointEntity = this.viewer.entities.add(
                    createPointEntity(this.cartesian, Cesium.Color.RED)
                );
                this.pointEntities.add(topPointEntity);

                const bottomPointEntity = this.viewer.entities.add(
                    createPointEntity(groundCartesian, Cesium.Color.RED)
                )
                this.pointEntities.add(bottomPointEntity);

                // create line between top point and bottom point
                this.removeEntity(this.lineEntity);
                this.lineEntity = this.viewer.entities.add(createLineEntity([groundCartesian, this.cartesian], Cesium.Color.YELLOW));

                // create label entity
                // remove previous label entities
                this.removeEntity(this.labelEntity);
                const distance = Cesium.Cartesian3.distance(this.cartesian, groundCartesian);
                const label = createDistanceLabel(
                    this.cartesian, groundCartesian, distance
                )
                label.label.text = `${distance.toFixed(2)} m`;
                label.label.pixelOffset = new Cesium.Cartesian2(-50, 0);
                this.labelEntity = this.viewer.entities.add(label);

                // reset to keep pointEntities only have top and bottom points
                if (this.pointEntities.values.length > 2) {
                    this.pointEntities.removeAll()
                };
            })
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
        this.removeEntities(this.pointEntities);
        this.removeEntity(this.lineEntity);
        this.removeEntity(this.labelEntity);

        this.cartesian = null;
    }
}

export { Height }
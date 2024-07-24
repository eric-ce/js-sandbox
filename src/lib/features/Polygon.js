import * as Cesium from "cesium";
import {
    createPointEntity,
    createDistanceLabel,
    createPolygonEntity,
    removeInputActions,
    editableLabel,
    updateMovingDot
} from "../helper/helper.js";

class Polygon {
    constructor(viewer, handler, nameOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.isPolygonEnd = false; // flag to check if the polygon is finished

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();

        // initialize polygon entity so that it can show drawn polygon quickly
        this.polygonEntity = this.viewer.entities.add(createPolygonEntity([Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO]))

        this.coordiante = new Cesium.Cartesian3();

        this._areaRecords = [];
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handlePolygonLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handlePolygonRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handlePolygonLeftClick(movement) {
        // remove track entity and select entity from default
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // Check if the measurement has ended
        // if pick the label entity, make the label entity editable
        if (this.isPolygonEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }
        }


        if (this.isPolygonEnd) {
            this.isPolygonEnd = false;
            // remove entities collection will keep added entities in the scene but remove from the collection, if need to keep the log please add here
            this.pointEntities.removeAll();
            this.lineEntities.removeAll();
            this.labelEntities.removeAll();
            this.polygonEntity = null;
        }

        // const pickedObject = this.viewer.scene.pick(movement.position);
        // if (Cesium.defined(pickedObject) && !this.isPolygonEnd) {
        if (!this.isPolygonEnd) {
            // const cartesian = this.viewer.scene.pickPosition(movement.position);

            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordiante;

            if (!Cesium.defined(cartesian)) return;

            // create point entity
            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const pointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, color)
            );
            this.pointEntities.add(pointEntity);

            // If three points have been selected, create/update the polygon entity
            if (this.pointEntities.values.length > 2) {
                const pointsPosition = this.pointEntities.values.map(
                    (pointEntity) =>
                        pointEntity.position.getValue(Cesium.JulianDate.now())
                );

                // create polygon entity
                if (this.polygonEntity) {
                    this.removeEntity(this.polygonEntity);
                }
                this.polygonEntity = this.viewer.entities.add(
                    createPolygonEntity(pointsPosition)
                );

                //create label entity
                const polygonArea = this.computePolygonArea(pointsPosition);

                if (this.labelEntities.values.length > 0) {
                    this.removeEntities(this.labelEntities);
                }
                const polygonLabel = createDistanceLabel(
                    pointsPosition[0],
                    pointsPosition[pointsPosition.length - 1],
                    polygonArea
                );
                polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
                const polygonLabelEntity =
                    this.viewer.entities.add(polygonLabel);
                this.labelEntities.add(polygonLabelEntity);


            }
        }
    }

    handlePolygonMouseMove(movement) {
        this.viewer.selectedEntity = undefined;

        // const pickedObject = this.viewer.scene.pick(movement.endPosition);
        // if (Cesium.defined(pickedObject)) {
        const cartesian = this.viewer.scene.pickPosition(
            movement.endPosition
        );

        if (!Cesium.defined(cartesian)) return;

        this.coordiante = cartesian;

        updateMovingDot(movement.endPosition, this.nameOverlay);

        if (this.pointEntities.values.length > 2 && !this.isPolygonEnd) {
            const pointsPosition = this.pointEntities.values.map(
                (pointEntity) =>
                    pointEntity.position.getValue(Cesium.JulianDate.now())
            );

            // Update the polygon entity
            const dynamicPosition = new Cesium.CallbackProperty(() => {
                return new Cesium.PolygonHierarchy([
                    ...pointsPosition,
                    cartesian,
                ]);
            }, false);

            this.polygonEntity.polygon.hierarchy = dynamicPosition

            // Update the polygon label
            const polygonArea = this.computePolygonArea([...pointsPosition, cartesian]);
            if (this.labelEntities.values.length > 0) {
                this.removeEntities(this.labelEntities);
            }
            const polygonLabel = createDistanceLabel(
                pointsPosition[0],
                pointsPosition[pointsPosition.length - 1],
                polygonArea
            );
            polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
            polygonLabel.label.text = `Total:${polygonArea.toFixed(2)} m²`;
            const polygonLabelEntity =
                this.viewer.entities.add(polygonLabel);
            this.labelEntities.add(polygonLabelEntity);
        }
        // } else {
        //     this.nameOverlay.style.display = "none";
        // }
    }

    handlePolygonRightClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // const pickedObject = this.viewer.scene.pick(movement.position);
        // if (Cesium.defined(pickedObject) && !this.isPolygonEnd) {
        if (!this.isPolygonEnd) {
            // const cartesian = this.viewer.scene.pickPosition(movement.position);

            const cartesian = this.coordiante;

            if (!Cesium.defined(cartesian)) return;

            const pointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(pointEntity);

            // update the last point for the middle click
            const pointsPosition = this.pointEntities.values.map(
                (pointEntity) =>
                    pointEntity.position.getValue(Cesium.JulianDate.now())
            );

            // create polygon entity
            this.removeEntity(this.polygonEntity)
            this.polygonEntity = this.viewer.entities.add(
                createPolygonEntity(pointsPosition)
            );

            // create label entity
            if (this.labelEntities.values.length > 0) {
                this.removeEntities(this.labelEntities);
            }
            const polygonArea = this.computePolygonArea(pointsPosition);
            const polygonLabel = createDistanceLabel(
                pointsPosition[0],
                pointsPosition[pointsPosition.length - 1],
                polygonArea
            );
            polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
            polygonLabel.label.text = `Total:${polygonArea.toFixed(2)} m²`;
            const polygonLabelEntity = this.viewer.entities.add(polygonLabel);
            this.labelEntities.add(polygonLabelEntity);

            // log area records
            this._areaRecords.push(polygonArea);
            this.logRecordsCallback(polygonArea);

            //set flag to the end drawing of polygon
            this.isPolygonEnd = true;
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
        this.isPolygonEnd = false;
        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();
        this.polygonEntity = null;
        this.coordiante = new Cesium.Cartesian3();
    }

    computePolygonArea(cartesianArray) {
        let hierarchy = new Cesium.PolygonHierarchy(cartesianArray);

        // let hierarchy = polygon.polygon.hierarchy._value;
        let indices = Cesium.PolygonPipeline.triangulate(hierarchy.positions, hierarchy.holes);

        let area = 0;
        for (let i = 0; i < indices.length; i += 3) {
            let vector1 = hierarchy.positions[indices[i]];
            let vector2 = hierarchy.positions[indices[i + 1]];
            let vector3 = hierarchy.positions[indices[i + 2]];
            let vectorC = Cesium.Cartesian3.subtract(vector2, vector1, new Cesium.Cartesian3());
            let vectorD = Cesium.Cartesian3.subtract(vector3, vector1, new Cesium.Cartesian3());
            let areaVector = Cesium.Cartesian3.cross(vectorC, vectorD, new Cesium.Cartesian3());
            area += Cesium.Cartesian3.magnitude(areaVector) / 2.0;
        }
        return area;
    }
}

export { Polygon };

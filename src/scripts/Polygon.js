import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateArea, createDistanceLabel, createPolygonEntity } from "./helper.js";

class Polygon {
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.button = null;
        this.isPolygonEnd = false; // flag to check if the polygon is finished

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();
        this.polygonEntities = new Cesium.EntityCollection();
    }

    /**
     * Initializes the measurement tool, creating UI elements and setting up event listeners.
     */
    initializeMeasurement() {
        // create distance button
        this.button = document.createElement("button");
        this.button.className = "polygon cesium-button"
        this.button.innerHTML = "Polygon";
        document.body
            .querySelector("measure-toolbox")
            .shadowRoot.querySelector(".toolbar")
            .appendChild(this.button);
        // add event listener to distance button
        this.button.addEventListener("click", () => {
            this.setupInputAction();
        })
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputAction() {
        this.handler.setInputAction((movement) => {
            this.handlePolygonLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handlePolygonMiddleClick(movement);
        }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
    }

    handlePolygonLeftClick(movement) {
        // remove track entity and select entity from default
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        if (this.isPolygonEnd) {
            this.isPolygonEnd = false;
            this.pointEntities.removeAll();
        }

        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && !this.isPolygonEnd) {
            const cartesian = this.viewer.scene.pickPosition(movement.position);

            if (!Cesium.defined(cartesian)) return;

            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const pointEntity = this.viewer.entities.add(createPointEntity(cartesian, color));
            this.pointEntities.add(pointEntity);

            // If three points have been selected, create/update the polygon entity
            if (this.pointEntities.values.length > 2) {
                const pointsPosition = this.pointEntities.values.map((pointEntity) => pointEntity.position.getValue(Cesium.JulianDate.now()));
                const polygonArea = calculateArea(pointsPosition);

                //create label entity
                if (this.labelEntities.values.length > 0) {
                    this.removeEntities(this.labelEntities);
                }
                const polygonLabel = createDistanceLabel(
                    pointsPosition[0],
                    pointsPosition[pointsPosition.length - 1],
                    polygonArea
                );
                polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
                const polygonLabelEntity = this.viewer.entities.add(polygonLabel);
                this.labelEntities.add(polygonLabelEntity);

                //create polygon entity
                // if (!this.polygonEntity) {
                //     const newPolygonEntity = this.viewer.entities.add(createPolygonEntity(pointsPosition));
                //     this.polygonEntity = newPolygonEntity;
                // } else {
                //     // Update the existing polygon entity's positions
                //     this.polygonEntity.polygon.hierarchy = pointsPosition;
                // }
                if (this.polygonEntities.values.length > 0) {
                    this.removeEntities(this.polygonEntities);
                }
                const newPolygonEntity = this.viewer.entities.add(createPolygonEntity(pointsPosition));
                this.polygonEntities.add(newPolygonEntity);
            }
        }
    }

    handlePolygonMouseMove(movement) {
        this.viewer.selectedEntity = undefined;

        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            console.log("🚀  cartesian:", cartesian);


            if (!Cesium.defined(cartesian)) return;

            this.updateMovingDot(cartesian);

            if (this.pointEntities.values.length > 2) {
                const pointsPosition = this.pointEntities.values.map((pointEntity) => pointEntity.position.getValue(Cesium.JulianDate.now()));

                // Update the polygon entity
                const dynamicPosition = new Cesium.CallbackProperty(() => {
                    return new Cesium.PolygonHierarchy([...pointsPosition, cartesian]);
                }, false);
                this.polygonEntities.values[0].polygon.hierarchy = dynamicPosition;

                // Update the polygon label
                const polygonArea = calculateArea([...pointsPosition, cartesian]);
                if (this.labelEntities.values.length > 0) {
                    this.removeEntities(this.labelEntities);
                }
                const polygonLabel = createDistanceLabel(
                    pointsPosition[0],
                    pointsPosition[pointsPosition.length - 1],
                    polygonArea
                );
                polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
                const polygonLabelEntity = this.viewer.entities.add(polygonLabel);
                this.labelEntities.add(polygonLabelEntity);
            }
        } else {
            this.nameOverlay.style.display = 'none';
        }
    }

    handlePolygonMiddleClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();
        this.polygonEntities.removeAll();
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.position);

            if (!Cesium.defined(cartesian)) return;

            const pointEntity = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED));
            this.pointEntities.add(pointEntity);
        }
        this.isPolygonEnd = true;
    }

    removeEntities(entityCollection) {
        entityCollection.values.forEach(entity => {
            this.viewer.entities.remove(entity);
        });
        entityCollection.removeAll();
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

export { Polygon }
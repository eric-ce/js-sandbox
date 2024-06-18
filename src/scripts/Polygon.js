import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateArea, createDistanceLabel } from "./helper.js";

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
    }

    handlePolygonLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.position);

            if (!Cesium.defined(cartesian)) return;

            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const pointEntity = this.viewer.entities.add(createPointEntity(cartesian, color));
            this.pointEntities.add(pointEntity);

            // If three points have been selected, create/update the polygon entity
            if (this.pointEntities.values.length > 2) {
                const pointsPosition = this.pointEntities.values.map((pointEntity) => pointEntity.position.getValue(Cesium.JulianDate.now()));
                const polygonArea = calculateArea(pointsPosition);

            }
        }
    }

    handlePolygonMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) return;

            this.updateMovingDot(cartesian);
        } else {
            this.nameOverlay.style.display = 'none';
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

export { Polygon }
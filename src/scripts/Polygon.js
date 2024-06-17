import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel } from "./helper.js";

class Polygon {
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.pointEntities = [];
        this.lineEntities = [];
        this.labelEntities = [];
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
}

export { Polygon }
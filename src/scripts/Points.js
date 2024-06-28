import * as Cesium from "cesium";
import { createPointEntity, removeInputActions } from "./helper.js";

/**
 * Represents points bookmark tool in Cesium.
 * @class   
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
*/
class Points {
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this._button = null;

        this.pointEntities = new Cesium.EntityCollection();

        this.active = false;
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
        this.viewer.selectedEntity = undefined;
        const pickedObject = this.viewer.scene.pick(movement.position);

        if (pickedObject && pickedObject.id) {
            // if picked point entity exists, remove it
            const entityToRemove = this.viewer.entities.getById(pickedObject.id.id);

            if (entityToRemove) {
                this.viewer.entities.remove(entityToRemove);
                this.pointEntities.remove(entityToRemove);
            }
        } else {
            // if no point entity is picked, create a new point entity
            const cartesian = this.viewer.scene.pickPosition(movement.position);
            if (Cesium.defined(cartesian)) {
                const pointEntity = this.viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.add(pointEntity);
            }
        }
    }

    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handlePointsMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) return;

            // update nameOverlay: the moving dot with mouse
            this.updateMovingDot(cartesian);

        } else {
            this.nameOverlay.style.display = "none";
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

    /**
     * Getter for the button element.
     */
    get button() {
        return this._button;
    }

    /**
     * Setter for the button element.
     */
    set button(value) {
        this._button = value;
        this._button.addEventListener("click", () => {
            if (this.active) {
                this.removeInputAction();
                this._button.classList.remove("active");
                this.nameOverlay.style.display = "none";
            } else {
                this.setupInputActions();
                this._button.classList.add("active");
            }
            this.active = !this.active;
        });
    }
}

export { Points };
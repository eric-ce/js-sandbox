import * as Cesium from "cesium/Cesium";
import { createPointEntity } from "./helper.js";

export class Points {
    constructor() {
        this.pointEntities = [];
        this.entitiesCollection = [];

        this.viewerPromise = new Promise((resolve) => {
            this.viewerResolve = resolve;
        });
        this.viewerPromise.then((viewer) => {
            this.viewer = viewer;
            this.initializeMeasurement(this.viewer, this.handler, this.nameOverlay);
        })
    }

    initializeMeasurement(viewer, handler, nameOverlay) {
        // create distance button
        this.button = document.createElement("button");
        this.button.className = "points cesium-button"
        this.button.innerHTML = "Points";

        document.body.getElementsByTagName("measure-toolbox")[0].shadowRoot.querySelector(".toolbar").appendChild(this.button);
        // add event listener to distance button
        this.button.addEventListener("click", () => {
            this.setupInputAction(viewer, handler, nameOverlay);
        })
    }

    setupInputAction(viewer, handler, nameOverlay) {
        // left click event
        handler.setInputAction((movement) => {
            this.handleDistanceLeftClick(movement, viewer);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        // right click event
        handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement, nameOverlay, viewer);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    handleDistanceLeftClick(movement, viewer) {
        viewer.selectedEntity = undefined;
        const pickedObject = viewer.scene.pick(movement.position);

        if (pickedObject && pickedObject.id) {
            // if picked point entity exists, remove it
            const entityToRemove = viewer.entities.getById(pickedObject.id.id);

            if (entityToRemove) {
                viewer.entities.remove(entityToRemove);
                const filteredPointEntities = this.pointEntities.filter(
                    (entity) => entity.id !== entityToRemove.id
                );
                this.pointEntities = filteredPointEntities;
            }
        } else {
            // if no point entity is picked, create a new point entity
            const cartesian = viewer.scene.pickPosition(movement.position);
            if (Cesium.defined(cartesian)) {
                const pointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(pointEntity);
            }
        }
    }

    handleDistanceMouseMove(movement, nameOverlay, viewer) {
        const pickedObject = viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) {
                return;
            }
            // update nameOverlay: the moving dot with mouse
            const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
            nameOverlay.style.display = 'block';
            nameOverlay.style.left = `${screenPosition.x - 5}px`;
            nameOverlay.style.top = `${screenPosition.y - 5}px`;
            nameOverlay.style.backgroundColor = "yellow";
            nameOverlay.style.borderRadius = "50%"
            nameOverlay.style.width = "1px";
            nameOverlay.style.height = "1px";
        } else {
            nameOverlay.style.display = "none";
        }
    }

    setValues(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.viewerResolve(viewer);

        this.handler = handler;
        this.nameOverlay = nameOverlay;
    }
}
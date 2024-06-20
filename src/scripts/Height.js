import { createPointEntity, createLineEntity, convertToCartesian3, createDistanceLabel } from "./helper.js";
import * as Cesium from "cesium";

/**
 * Represents a height measurement tool in Cesium.
 * @class   
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
*/
class Height {
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.cartesian = null;
        this.button = null;

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
        this.button.className = "height cesium-button"
        this.button.innerHTML = "Height";
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
        this.handler.setInputAction(() => {
            this.handleHeightLeftClick();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleHeightMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Handles left-click events to place top and ground points, draw line in between.
     */
    handleHeightLeftClick() {
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        if (!Cesium.defined(this.cartesian)) return;

        // create top and bottom points from mouse move picked position
        const [topPointEntity, bottomPointEntity] = this.pointEntities.values
        const topCartesian = topPointEntity.position.getValue(Cesium.JulianDate.now());
        const bottomCartesian = bottomPointEntity.position.getValue(Cesium.JulianDate.now());

        this.pointEntities.removeAll();

        const topPointEntityClone = this.viewer.entities.add(createPointEntity(topCartesian, Cesium.Color.RED));
        const bottomPointEntityClone = this.viewer.entities.add(createPointEntity(bottomCartesian, Cesium.Color.RED));
        this.pointEntities.add(topPointEntityClone);
        this.pointEntities.add(bottomPointEntityClone);

        // create line between top point and bottom point
        this.viewer.entities.add(
            createLineEntity([topCartesian, bottomCartesian], Cesium.Color.ORANGE)
        )

        // create label 
        const distance = Cesium.Cartesian3.distance(topCartesian, bottomCartesian);
        const labelEntity = this.viewer.entities.add(
            createDistanceLabel(topCartesian, bottomCartesian, distance)
        )
        labelEntity.label.pixelOffset = new Cesium.Cartesian2(-50, 0);
    }


    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleHeightMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition);

        if (Cesium.defined(pickedObject)) {
            this.cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(this.cartesian)) return;
            this.updateMovingDot(this.cartesian);

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
                // remove previous point entities
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
                // remove previous line entities
                this.removeEntities(this.lineEntities)
                const line = this.viewer.entities.add(
                    createLineEntity(
                        [this.cartesian, groundCartesian], Cesium.Color.YELLOW
                    )
                )
                this.lineEntities.add(line);

                // create label entity
                // remove previous label entities
                this.removeEntities(this.labelEntities);
                const distance = Cesium.Cartesian3.distance(this.cartesian, groundCartesian);
                const label = createDistanceLabel(
                    this.cartesian, groundCartesian, distance
                )
                label.label.pixelOffset = new Cesium.Cartesian2(-50, 0);
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);
            })
        }
    }

    /**
     * remove entities from entity collection
     * @param {Cesium.Entity[]} entitiesCollection 
     */
    removeEntities(entitiesCollection) {
        entitiesCollection.values.forEach((entity) => {
            this.viewer.entities.remove(entity);
        });
        entitiesCollection.removeAll();
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

export { Height }
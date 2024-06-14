import * as Cesium from "cesium";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel } from "./helper.js";


/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class   
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} nameOverlay - The HTML element for displaying names.
*/
class TwoPointsDistance {
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
        this.button.className = "distance cesium-button"
        this.button.innerHTML = "Distance";
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
            this.handleDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleDistanceLeftClick(movement) {
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const pickedObject = this.viewer.scene.pick(movement.position);

        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.position);

            // early exit if not cartesian
            if (!Cesium.defined(cartesian)) return;

            if (this.pointEntities.length === 0) {
                // if there is no point entity, create the first point
                const firstPointEntity = this.viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(firstPointEntity);
            } else if (this.pointEntities.length % 2 !== 0) {
                // if there is one point entity, create the second point
                const secondPointEntity = this.viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.BLUE)
                );
                this.pointEntities.push(secondPointEntity);

                if (this.pointEntities.length === 2) {
                    // create line entity between the first and second point
                    this.removeEntities(this.lineEntities);
                    const line = createLineEntity(
                        [
                            this.pointEntities[0].position.getValue(Cesium.JulianDate.now()),
                            this.pointEntities[1].position.getValue(Cesium.JulianDate.now()),
                        ],
                        Cesium.Color.ORANGE
                    );
                    const lineEntity = this.viewer.entities.add(line);
                    this.lineEntities.push(lineEntity);

                    // create distance label
                    this.removeEntities(this.labelEntities);
                    const distance = calculateDistance(
                        this.pointEntities[0].position.getValue(Cesium.JulianDate.now()),
                        this.pointEntities[1].position.getValue(Cesium.JulianDate.now())
                    );
                    const label = createDistanceLabel(
                        this.pointEntities[0].position.getValue(Cesium.JulianDate.now()),
                        this.pointEntities[1].position.getValue(Cesium.JulianDate.now()),
                        distance
                    );
                    const labelEntity = this.viewer.entities.add(label);
                    this.labelEntities.push(labelEntity);
                }

            } else {
                // if there are more than 2 point entities, reset the measurement
                this.pointEntities.length = 0;
                this.lineEntities.length = 0;
                this.labelEntities.length = 0;

                // Remove all entities from the viewer
                // this.viewer.entities.removeAll();

                // create the first point, so it won't interupt to restart the measurement
                // without this could cause click twice to restart the measurement
                const firstPointEntity = this.viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(firstPointEntity);
            }
        }
    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject)) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) {
                return;
            }

            // update nameOverlay: the moving dot with mouse
            this.updateMovingDot(cartesian)

            if (this.pointEntities.length > 0 && this.pointEntities.length < 2) {
                const firstPointCartesian = this.pointEntities[0].position.getValue(Cesium.JulianDate.now())

                // create moving line entity
                this.removeEntities(this.lineEntities);
                const movingLine = createLineEntity(
                    [firstPointCartesian, cartesian],
                    Cesium.Color.YELLOW
                );
                movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                    return [firstPointCartesian, cartesian];
                }, false);
                const movingLineEntity = this.viewer.entities.add(movingLine);
                this.lineEntities.push(movingLineEntity);

                // create distance label
                this.removeEntities(this.labelEntities);
                const distance = calculateDistance(
                    firstPointCartesian,
                    cartesian
                );
                const label = createDistanceLabel(
                    firstPointCartesian,
                    cartesian,
                    distance
                );
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.push(labelEntity);
            }
        } else {
            this.nameOverlay.style.display = "none";
        }
    }

    /**
     * remove entities from entity collection
     * @param {Cesium.Entity[]} entitiesCollection 
     */
    removeEntities(entities) {
        entities.forEach((entity) => {
            this.viewer.entities.remove(entity);
        });
        entities.length = 0;
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

export { TwoPointsDistance };
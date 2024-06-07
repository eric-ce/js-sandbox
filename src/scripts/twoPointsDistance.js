import * as Cesium from "cesium/Cesium";
// import { MeasureToolbox } from "./measurementTools.js";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel } from "./helper.js";
export class TwoPointsDistance {
    constructor() {
        this.pointEntities = [];
        this.lineEntities = [];
        this.labelEntities = [];
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
        this.button.className = "distance cesium-button"
        this.button.innerHTML = "Distance";
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
        // Clear any previously selected entity
        viewer.selectedEntity = undefined;
        viewer.trackedEntity = undefined;

        const pickedObject = viewer.scene.pick(movement.position);

        if (Cesium.defined(pickedObject)) {
            const cartesian = viewer.scene.pickPosition(movement.position);

            // early exit if not cartesian
            if (!Cesium.defined(cartesian)) {
                return;
            }

            if (this.pointEntities.length === 0) {
                // if there is no point entity, create the first point
                const firstPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(firstPointEntity);
            } else if (this.pointEntities.length % 2 !== 0) {
                // if there is one point entity, create the second point
                const secondPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.BLUE)
                );
                this.pointEntities.push(secondPointEntity);

                if (this.pointEntities.length === 2) {
                    // create line entity between the first and second point
                    this.removeEntities(this.lineEntities, viewer);
                    const line = createLineEntity(
                        [
                            this.pointEntities[0].position._value,
                            this.pointEntities[1].position._value,
                        ],
                        Cesium.Color.ORANGE
                    );
                    const lineEntity = viewer.entities.add(line);
                    this.lineEntities.push(lineEntity);

                    // create distance label
                    this.removeEntities(this.labelEntities, viewer);
                    const distance = calculateDistance(
                        this.pointEntities[0].position._value,
                        this.pointEntities[1].position._value
                    );
                    const label = createDistanceLabel(
                        this.pointEntities[0].position._value,
                        this.pointEntities[1].position._value,
                        distance
                    );
                    const labelEntity = viewer.entities.add(label);
                    this.labelEntities.push(labelEntity);
                }

            } else {
                // if there are more than 2 point entities, reset the measurement
                this.pointEntities = [];
                this.lineEntities = [];
                this.labelEntities = [];

                // Remove all entities from the viewer
                viewer.entities.removeAll();

                // create the first point, so it won't interupt to restart the measurement
                // without this could cause click twice to restart the measurement
                const firstPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(firstPointEntity);
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

            if (this.pointEntities.length > 0 && this.pointEntities.length < 2) {
                const firstPointEntity = this.pointEntities[0];

                // create moving line entity
                this.removeEntities(this.lineEntities, viewer);
                const movingLine = createLineEntity(
                    [firstPointEntity.position._value, cartesian],
                    Cesium.Color.YELLOW
                );
                movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                    return [firstPointEntity.position._value, cartesian];
                }, false);
                const movingLineEntity = viewer.entities.add(movingLine);
                this.lineEntities.push(movingLineEntity);

                // create distance label
                this.removeEntities(this.labelEntities, viewer);
                const distance = calculateDistance(
                    firstPointEntity.position._value,
                    cartesian
                );
                const label = createDistanceLabel(
                    firstPointEntity.position._value,
                    cartesian,
                    distance
                );
                const labelEntity = viewer.entities.add(label);
                this.labelEntities.push(labelEntity);
            }
        } else {
            nameOverlay.style.display = "none";
        }
    }

    removeEntities(entitiesCollection, viewer) {
        if (entitiesCollection.length > 0) {
            entitiesCollection.forEach((entity) => {
                viewer.entities.remove(entity);
            });
            entitiesCollection = [];
        }
    }
    setViewer(viewer) {
        this.viewer = viewer;
        this.viewerResolve(viewer);
        console.log("Viewer set in TwoPointsDistance:", this.viewer);
    }

    setHandler(handler) {
        this.handler = handler
    }

    setNameOverlay(nameOverlay) {
        this.nameOverlay = nameOverlay;
    }
}

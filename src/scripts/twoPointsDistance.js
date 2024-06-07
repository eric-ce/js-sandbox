import * as Cesium from "cesium/Cesium";
// import { MeasureToolbox } from "./measurementTools.js";
import { createPointEntity, createLineEntity, calculateDistance, createDistanceLabel } from "./helper.js";
export class TwoPointsDistance {
    constructor() {
        this.firstPoint = null;
        this.secondPoint = null;
        this.pointEntities = [];
        this.lineEntities = [];
        this.labelEntities = [];
        this.entitiesCollection = [];

        this.viewerPromise = new Promise((resolve) => {
            this.viewerResolve = resolve;
        });
        this.viewerPromise.then((viewer) => {
            this.viewer = viewer;
            this.initializeMeasurement(this.viewer, this.handler);
        })


    }

    initializeMeasurement(viewer, handler) {
        this.button = document.createElement("button");
        this.button.className = "distance cesium-button"
        this.button.innerHTML = "Distance";
        document.body.getElementsByTagName("measure-toolbox")[0].shadowRoot.querySelector(".toolbar").appendChild(this.button);
        this.button.addEventListener("click", () => {
            this.setupInputAction(viewer, handler);
        })
    }

    setupInputAction(viewer, handler) {
        handler.setInputAction((movement) => {
            this.handleDistanceLeftClick(movement, viewer);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement, viewer);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    }

    handleDistanceLeftClick(movement, viewer) {
        // Clear any previously selected entity
        viewer.selectedEntity = undefined;
        viewer.trackedEntity = undefined;


        const pickedObject = viewer.scene.pick(movement.position);
        console.log("🚀  pickedObject:", pickedObject);

        if (Cesium.defined(pickedObject)) {
            const cartesian = viewer.scene.pickPosition(movement.position);

            // early exit if not cartesian
            if (!Cesium.defined(cartesian)) {
                return;
            }

            if (this.pointEntities.length === 0) {
                const firstPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );

                this.firstPointEnitty = firstPointEntity;
                this.pointEntities.push(firstPointEntity);

            } else if (this.pointEntities.length % 2 !== 0) {
                const secondPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.BLUE)
                );

                this.secondPointEntity = secondPointEntity;
                this.pointEntities.push(secondPointEntity);


                if (this.pointEntities.length === 2) {
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
                this.pointEntities = [];
                this.lineEntities = [];
                this.labelEntities = [];

                viewer.entities.removeAll();

                const firstPointEntity = viewer.entities.add(
                    createPointEntity(cartesian, Cesium.Color.RED)
                );
                this.pointEntities.push(firstPointEntity);
            }
        }
    }

    handleDistanceMouseMove(movement, viewer) {

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

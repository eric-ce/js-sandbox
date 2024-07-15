import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntityClamped,
    calculateDistance,
    createDistanceLabel,
    removeInputActions,
} from "../helper/helper.js";
import Chart from "chart.js/auto";

class Profile {
    constructor(viewer, handler, nameOverlay) {
        this.viewer = viewer;
        this.handler = handler;
        this.nameOverlay = nameOverlay;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();

        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this.chart = null;
        this.chartDiv = null;

        this.setupChart();
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleProfileLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleProfileMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    async handleProfileLeftClick(movement) {
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

        // if (Cesium.defined(pickedObject)) {
        // const cartesian = this.viewer.scene.pickPosition(movement.position);

        // use mouse move position to control only one pickPosition is used
        const cartesian = this.coordinate;
        // early exit if not cartesian
        if (!Cesium.defined(cartesian)) return;

        if (this.pointEntities.values.length === 0) {
            // if there is no point entity, create the first point
            const firstPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(firstPointEntity);
        } else if (this.pointEntities.values.length % 2 !== 0) {
            // if there is one point entity, create the second point
            const secondPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.BLUE)
            );
            this.pointEntities.add(secondPointEntity);

            if (this.pointEntities.values.length === 2) {
                // create line entity between the first and second point
                this.removeEntities(this.lineEntities);
                this.removeEntities(this.movingLineEntity);
                const line = createLineEntityClamped(
                    [
                        this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                        this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now()),
                    ],
                    Cesium.Color.ORANGE
                );
                const lineEntity = this.viewer.entities.add(line);
                this.lineEntities.add(lineEntity);

                // create distance label
                this.removeEntities(this.labelEntities);
                this.removeEntity(this.movingLabelEntity);
                const distance = calculateDistance(
                    this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                    this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now())
                );
                const label = createDistanceLabel(
                    this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                    this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now()),
                    distance
                );
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);

                // show the chart, if no chart then create the chart set it to show
                if (this.chartDiv) {
                    this.chartDiv.style.display = "block";
                } else {
                    this.setupChart();
                    this.chartDiv.style.display = "block";
                }

                // interpolate points between the first and second point
                const interpolatedPoints = this.interpolatePoints(
                    this.pointEntities.values[0].position.getValue(Cesium.JulianDate.now()),
                    this.pointEntities.values[1].position.getValue(Cesium.JulianDate.now()),
                    5
                );
                // get the ground height of the interpolated points
                const interpolatedCartographics = interpolatedPoints.map((point) =>
                    Cesium.Cartographic.fromCartesian(point)
                );

                Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, interpolatedCartographics).then(
                    (groundPositions) => {
                        // the height of the surface
                        // const surfaceHeight = groundPositions.map((cartographic) => this.viewer.scene.globe.getHeight(cartographic));

                        const groundCartesianArray = groundPositions.map((cartograhpic) => {
                            return Cesium.Cartesian3.fromRadians(
                                cartograhpic.longitude,
                                cartograhpic.latitude,
                                cartograhpic.height
                            )
                        });

                        // line chart x-axis label
                        // always start from 0 meters
                        const labelDistance = [0];

                        for (let i = 0; i < groundCartesianArray.length - 1; i++) {
                            const distance = Cesium.Cartesian3.distance(
                                groundCartesianArray[i],
                                groundCartesianArray[i + 1]
                            );
                            labelDistance.push(labelDistance[i] + Math.round(distance));
                        }

                        // line chart y-axis data
                        // get the height difference: for both the object and terrain
                        const diffHeight = groundCartesianArray.map((groundCartesian) => {
                            const windowPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, groundCartesian);
                            const pickedCartesian = this.viewer.scene.pickPosition(windowPosition);
                            const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                            return pickedCartographic.height
                        })

                        // update the chart
                        this.updateChart(diffHeight, labelDistance);
                    }
                );
            }
        } else {
            // if there are more than 2 point entities, reset the measurement
            this.pointEntities.removeAll();
            this.lineEntities.removeAll();
            this.labelEntities.removeAll();

            // Remove all entities from the viewer
            // this.viewer.entities.removeAll();

            // create the first point, so it won't interupt to restart the measurement
            // without this could cause click twice to restart the measurement
            const firstPointEntity = this.viewer.entities.add(
                createPointEntity(cartesian, Cesium.Color.RED)
            );
            this.pointEntities.add(firstPointEntity);
        }
        // }
    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleProfileMouseMove(movement) {
        // const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);
        // if (Cesium.defined(pickedObject)) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update nameOverlay: the moving dot with mouse
        this.updateMovingDot(cartesian);

        if (this.pointEntities.values.length > 0 && this.pointEntities.values.length < 2) {
            const firstPointCartesian = this.pointEntities.values[0].position.getValue(
                Cesium.JulianDate.now()
            );

            // create moving line entity
            this.removeEntity(this.movingLineEntity);
            const movingLine = createLineEntityClamped(
                [firstPointCartesian, cartesian],
                Cesium.Color.YELLOW
            );
            movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                return [firstPointCartesian, cartesian];
            }, false);
            this.movingLineEntity = this.viewer.entities.add(movingLine);

            // create distance label
            this.removeEntity(this.movingLabelEntity);
            const distance = calculateDistance(firstPointCartesian, cartesian);
            const label = createDistanceLabel(firstPointCartesian, cartesian, distance);
            this.movingLabelEntity = this.viewer.entities.add(label);
        }
        // } else {
        //     this.nameOverlay.style.display = "none";
        // }
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

    /**
     * update the moving dot with mouse
     * @param {Cesium.Cartesian3} cartesian
     */
    updateMovingDot(cartesian) {
        const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
            this.viewer.scene,
            cartesian
        );
        this.nameOverlay.style.display = "block";
        this.nameOverlay.style.left = `${screenPosition.x - 5}px`;
        this.nameOverlay.style.top = `${screenPosition.y - 5}px`;
        this.nameOverlay.style.backgroundColor = "yellow";
        this.nameOverlay.style.borderRadius = "50%";
        this.nameOverlay.style.width = "1px";
        this.nameOverlay.style.height = "1px";
    }

    /**
     * Interpolates points between two points based on the interval.
     * @param {Cesium.Cartesian3} pointA 
     * @param {Cesium.Cartesian3} pointB 
     * @param {Number} interval 
     * @returns {Cesium.Cartesian3[]}
     */
    interpolatePoints(pointA, pointB, interval = 5) {
        const points = [];

        // Calculate the distance between the two points
        const distance = Cesium.Cartesian3.distance(pointA, pointB);

        // Determine the number of interpolation points based on the interval
        let numberOfPoints = Math.floor(distance / interval);
        // error handling: prevent numberOfPoints to be 0
        if (numberOfPoints === 0) {
            numberOfPoints = 1;
        }

        for (let i = 0; i <= numberOfPoints; i++) {
            const t = i / numberOfPoints;
            const interpolatedPoint = Cesium.Cartesian3.lerp(
                pointA,
                pointB,
                t,
                new Cesium.Cartesian3()
            );
            points.push(interpolatedPoint);
        }

        return points;
    }

    setupChart() {
        this.chartDiv = document.createElement("div");
        this.chartDiv.className = "chart";
        this.viewer.container.appendChild(this.chartDiv);

        const canvas = document.createElement("canvas");
        canvas.id = "profileTerrainChart";
        canvas.style.width = "400px";
        canvas.style.height = "200px";
        this.chartDiv.appendChild(canvas);

        this.chartDiv.style.cssText =
            "position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; width: 400px; height: 200px;";
        this.chartDiv.style.display = "none";
        const ctx = document.getElementById("profileTerrainChart").getContext("2d");
        this.chart = new Chart(ctx, {
            type: "line",
            data: {
                labels: [], // Empty initially
                datasets: [
                    {
                        label: "Profile of Terrain",
                        data: [],
                        borderColor: "rgba(75, 192, 192, 1)",
                        borderWidth: 2,
                        fill: true,
                    },
                ],
            },
            options: {
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Distance (meters)",
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Height (meters)",
                        },
                    },
                },
            },
        });
    }

    updateChart(data, labels) {
        if (!this.chart) return;
        this.chart.data.labels = labels
        this.chart.data.datasets[0].data = data;
        this.chart.update();
    }

    removeChart() {
        if (this.chartDiv) {
            this.chartDiv.remove();
            this.chart = null;
            this.chartDiv = null;
        }
    }

    resetValue() {
        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();
        this.removeEntity(this.movingLineEntity);
        this.removeEntity(this.movingLabelEntity);

        this.removeChart();

        this.coordinate = null;
    }
}

export { Profile };

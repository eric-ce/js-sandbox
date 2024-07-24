import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntityClamped,
    calculateDistance,
    createDistanceLabel,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay
} from "../helper/helper.js";
import Chart from "chart.js/auto";

class ProfileDistances {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.isMultiDistanceEnd = false;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();
        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this._distanceCollection = [];
        this._distanceRecords = [];
        this._labelIndex = 0;

        this.chart = null;
        this.chartDiv = null;
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    async handleMultiDistanceLeftClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (this.isMultiDistanceEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }
        }


        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // initialize the measurement, clear all previous measure records
        if (this.isMultiDistanceEnd) {
            this.pointEntities.removeAll();
            this.lineEntities.removeAll();
            this.labelEntities.removeAll();

            this.movingLineEntity = new Cesium.Entity();
            this.movingLabelEntity = new Cesium.Entity();

            this._distanceCollection.length = 0;

            this.isMultiDistanceEnd = false;
            const continuePoint = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED));
            this.pointEntities.add(continuePoint);
            return;
        }

        // create point entity
        const pointEntity = this.viewer.entities.add(
            createPointEntity(cartesian, Cesium.Color.RED)
        );
        this.pointEntities.add(pointEntity);

        if (this.pointEntities.values.length > 1) {
            const prevIndex = this.pointEntities.values.length - 2;
            const currIndex = this.pointEntities.values.length - 1;
            const prevPointCartesian = this.pointEntities.values[prevIndex].position.getValue(Cesium.JulianDate.now());
            const currPointCartesian = this.pointEntities.values[currIndex].position.getValue(Cesium.JulianDate.now());

            // create line entities
            const lineEntity = this.viewer.entities.add(
                createLineEntityClamped([prevPointCartesian, currPointCartesian], Cesium.Color.ORANGE)
            );
            this.lineEntities.add(lineEntity);

            // create label entities
            const distance = calculateDistance(prevPointCartesian, currPointCartesian);
            this._distanceCollection.push(distance);
            const label = createDistanceLabel(prevPointCartesian, currPointCartesian, distance)
            label.label.text = `${String.fromCharCode(97 + this._labelIndex)}: ${formatDistance(distance)}`;
            this._labelIndex++;
            const labelEntity = this.viewer.entities.add(label);
            this.labelEntities.add(labelEntity);

            // profile terrain for distances
            // show the chart, if no chart then create the chart set it to show
            if (this.chartDiv) {
                this.chartDiv.style.display = "block";
            } else {
                this.setupChart();
                this.chartDiv.style.display = "block";
            }

            const { diffHeight, labelDistance } = await this._computeAndUpdateProfileTerrain();

            // update the chart
            this.chart && this.updateChart(diffHeight, labelDistance);
        }
    }

    handleMultiDistanceMouseMove(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObject);

        if (this.isMultiDistanceEnd) return;

        if (this.pointEntities.values.length > 0) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointIndex = this.pointEntities.values.length - 1;
            const lastPointCartesian = this.pointEntities.values[lastPointIndex].position.getValue(Cesium.JulianDate.now());

            // create labels
            this.movingLabelEntity && this.removeEntity(this.movingLabelEntity);

            const movingDistance = calculateDistance(
                lastPointCartesian,
                cartesian
            );
            const totalDistance =
                this._distanceCollection.reduce((a, b) => a + b, 0) + movingDistance;

            const movingLabel = createDistanceLabel(
                cartesian,
                cartesian,
                totalDistance,
            );
            movingLabel.label.showBackground = false;
            movingLabel.label.pixelOffset = new Cesium.Cartesian2(
                80,
                10
            );
            this.movingLabelEntity = this.viewer.entities.add(movingLabel)

            // create moving line entity
            this.movingLineEntity && this.removeEntity(this.movingLineEntity);

            const movingLine = createLineEntityClamped([lastPointCartesian, cartesian], Cesium.Color.YELLOW)

            movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                return [lastPointCartesian, cartesian];
            }, false);
            this.movingLineEntity = this.viewer.entities.add(
                movingLine
            );
        }
    }

    async handleMultiDistanceRightClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // place last point and place last line
        // const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        // if (Cesium.defined(pickedObject) && !this.isMultiDistanceEnd) {
        if (!this.isMultiDistanceEnd) {
            // const cartesian = this.viewer.scene.pickPosition(movement.position);

            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // create last point
            const lastPoint = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED))
            this.pointEntities.add(lastPoint);

            // create last line
            const lastLine = this.viewer.entities.add(createLineEntityClamped(
                [this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()), cartesian],
                Cesium.Color.ORANGE
            ));
            this.lineEntities.add(lastLine);

            // create last label
            const lastDistance = calculateDistance(
                this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()),
                cartesian
            );
            this._distanceCollection.push(lastDistance);

            const lastLabel = this.viewer.entities.add(
                createDistanceLabel(
                    this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now()),
                    cartesian,
                    lastDistance
                )
            );
            lastLabel.label.text = `${String.fromCharCode(97 + this._labelIndex)}: ${formatDistance(lastDistance)}`;
            this._labelIndex++;
            this.labelEntities.add(lastLabel);

            // remove moving line and moving label
            if (this.movingLineEntity) {
                this.removeEntity(this.movingLabelEntity)
            }
            // place total distance label
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            this.viewer.entities.remove(this.movingLabelEntity);
            this.movingLabelEntity = this.viewer.entities.add(createDistanceLabel(cartesian, cartesian, 0));
            this.movingLabelEntity.label.text = `Total: ${formatDistance(totalDistance)}`;
            this.movingLabelEntity.label.pixelOffset = new Cesium.Cartesian2(
                80,
                10
            );

            // log distance result
            const distances = []
            distances.push(...this._distanceCollection);
            const distanceRecord = {
                distances: distances,
                totalDistance: totalDistance
            };
            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(this._distanceRecords);

            // profile terrain for last distances
            const { diffHeight, labelDistance } = await this._computeAndUpdateProfileTerrain();
            // update the chart
            this.chart && this.updateChart(diffHeight, labelDistance);
        }
        this.isMultiDistanceEnd = true;
    }

    /**
     * Compute and update the profile terrain for the distances
     * @returns {Promise<{diffHeight: number[], labelDistance: number[]}>}
     */
    async _computeAndUpdateProfileTerrain() {
        const cartesianPoints = this.pointEntities.values.map(
            (entity) => entity.position.getValue(Cesium.JulianDate.now())
        );

        // interpolation points between the points
        const interpolatedPoints = cartesianPoints.flatMap((point, index) => {
            if (index < cartesianPoints.length - 1) {
                const interpolatedPoints = this.interpolatePoints(point, cartesianPoints[index + 1], 2);
                return interpolatedPoints;
            }
        }).filter((point, index, self) => {
            return index === self.findIndex((t) => Cesium.Cartesian3.equals(t, point)) && point !== undefined
        }
        );

        // get the height of the interpolated points
        const interpolatedCartographics = interpolatedPoints.map((point) =>
            Cesium.Cartographic.fromCartesian(point)
        );

        const groundPositions = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, interpolatedCartographics);
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
        return { diffHeight, labelDistance }
    }

    /**
     * Interpolates points between two points based on the interval.
     * @param {Cesium.Cartesian3} pointA 
     * @param {Cesium.Cartesian3} pointB 
     * @param {Number} interval 
     * @returns {Cesium.Cartesian3[]}
     */
    interpolatePoints(pointA, pointB, interval = 2) {
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
        canvas.id = "profileTerrainDistancesChart";
        canvas.style.width = "400px";
        canvas.style.height = "200px";
        this.chartDiv.appendChild(canvas);

        this.chartDiv.style.cssText =
            "position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; width: 400px; height: 200px;";
        this.chartDiv.style.display = "none";
        const ctx = document.getElementById("profileTerrainDistancesChart").getContext("2d");
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

    resetValue() {
        this.pointEntities.removeAll();
        this.lineEntities.removeAll();
        this.labelEntities.removeAll();
        this.removeEntity(this.movingLineEntity);
        this.removeEntity(this.movingLabelEntity);

        this.removeChart();

        this.coordinate = null;

        // this._labelIndex = 0;
    }
}

export { ProfileDistances }
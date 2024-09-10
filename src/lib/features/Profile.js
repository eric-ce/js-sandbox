import * as Cesium from "cesium";
import {
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createClampedLinePrimitive,
    generateId,
    createPointPrimitive,
    formatDistance,
    createClampedLineGeometryInstance,
    makeDraggable,
} from "../helper/helper.js";
import Chart from "chart.js/auto";

class Profile {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.isDistanceStarted = false;

        // cesium primitives
        // point primitives
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.draggingPrimitive = null;
        this.hoverPoint = null;
        // line primitives
        this.movingPolylinePrimitive = null;
        // label primitives
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);
        this.movingLabelPrimitive = null

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];
        this.interpolatedPointsGroup = [];
        // log
        this._distanceRecords = [];

        // chat
        this.chart = null;
        this.chartDiv = null;
        this.selectedGroupIndex = null;
    }

    /**
     * Sets up input actions for profile mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleProfileLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleProfileMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleProfileDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleProfileDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for profile mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleProfileLeftClick(movement) {
        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (!this.isDistanceStarted) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label primitive, make it editable
            if (
                Cesium.defined(pickedObject) &&
                pickedObject?.id?.startsWith("annotate") &&
                pickedObject.id.includes("label")
            ) {
                editableLabel(this.viewer.container, pickedObject.primitive);
                return; // Exit the function after making the label editable
            }

        }

        // Set flag that the measurement has started
        this.isDistanceStarted = true;

        // use cache to store only two coordinates, if more than two, reset the cache
        if (this.coordinateDataCache.length === 0) {
            // create the first point
            this.coordinateDataCache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "profile_point");
            this.pointCollection.add(point);
        } else if (this.coordinateDataCache.length % 2 !== 0) {
            // create the second point
            this.coordinateDataCache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "profile_point");
            this.pointCollection.add(point);

            // create line and label
            if (this.coordinateDataCache.length === 2) {
                const pickedCartesianArray = this._computeDetailedPickPositions(this.coordinateDataCache[0], this.coordinateDataCache[1]);
                // update the interpolated points group
                this.interpolatedPointsGroup.push([...pickedCartesianArray]);
                this.selectedGroupIndex = this.interpolatedPointsGroup.length - 1;

                // line chart x-axis label
                // always start from 0 meters
                const labelDistance = [0];

                let totalDistance = null;
                for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                    const distance = Cesium.Cartesian3.distance(
                        pickedCartesianArray[i],
                        pickedCartesianArray[i + 1]
                    );

                    totalDistance += distance;
                    // line chart x-axis label
                    labelDistance.push(labelDistance[i] + Math.round(distance));
                }

                // create label primitive
                // set moving label primitive to not show
                if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);

                const midPoint = Cesium.Cartesian3.midpoint(this.coordinateDataCache[0], this.coordinateDataCache[1], new Cesium.Cartesian3());
                const label = createLabelPrimitive(this.coordinateDataCache[0], this.coordinateDataCache[1], totalDistance);
                label.id = generateId(midPoint, "profile_label");
                this.labelCollection.add(label);

                // create line primitive
                if (this.movingPolylinePrimitive) this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);

                const lineGeometryInstance = createClampedLineGeometryInstance(this.coordinateDataCache, "profile_line",);
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // show the chart, if no chart then create the chart set it to show
                if (this.chartDiv) {
                    this.chartDiv.style.display = "block";
                } else {
                    this.setupChart();
                    this.chartDiv.style.display = "block";
                }

                // line chart y-axis data
                const diffHeight = pickedCartesianArray.map((pickedCartesian) => {
                    const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                    return pickedCartographic.height
                })

                // update the chart
                this.updateChart(diffHeight, labelDistance);
                // records cache to track all coords, use shallow copy the cache
                this.groupCoords.push([...this.coordinateDataCache]);
                // log distance
                this._distanceRecords.push(totalDistance);
                this.logRecordsCallback(totalDistance.toFixed(2));

                // set flag that the measurement has ended
                this.isDistanceStarted = false;
            }
        } else {
            // reset the cache
            this.coordinateDataCache.length = 0;

            // add a continue point to the cache so it doesn't need to click twice to start again
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "profile_point");
            this.pointCollection.add(point);

            this.coordinateDataCache.push(this.coordinate);
        }
    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleProfileMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        // Check if the position is defined
        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coordinateDataCache.length > 0 && this.coordinateDataCache.length < 2) {
            // create line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const firstCoordsCartesian = this.coordinateDataCache[0];

            const movingLineGeometryInstance = createClampedLineGeometryInstance([firstCoordsCartesian, this.coordinate], "profile_moving_line");
            const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);


            // update moving label primitive and set it to show
            const pickedCartesianArray = this._computeDetailedPickPositions(firstCoordsCartesian, this.coordinate);

            let totalDistance = null;

            for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                const distance = Cesium.Cartesian3.distance(
                    pickedCartesianArray[i],
                    pickedCartesianArray[i + 1]
                );
                totalDistance += distance;
            }

            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(firstCoordsCartesian, cartesian, totalDistance));
            const midPoint = Cesium.Cartesian3.midpoint(firstCoordsCartesian, cartesian, new Cesium.Cartesian3());
            this.movingLabelPrimitive.id = generateId(midPoint, "profile_moving_label");
        }

        // move along the line to show the tooltip for corresponding point
        const pickedLine = pickedObjects.find(p => p.id && p.id.startsWith("annotate_profile_line"));
        if (pickedLine && this.chart) {
            const pickPosition = this.viewer.scene.pickPosition(movement.endPosition);
            const cartographic = Cesium.Cartographic.fromCartesian(pickPosition);
            const groundHeight = this.viewer.scene.sampleHeight(cartographic);

            const pickCartesian = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, groundHeight);

            if (!Cesium.defined(pickCartesian)) return;

            const closestCoord = this.interpolatedPointsGroup[this.selectedGroupIndex].map(cart => {
                // get the closest point to the pickPosition by comparing the distance
                const distance = Cesium.Cartesian3.distance(cart, pickCartesian);
                if (distance < 0.5) {
                    return cart;
                }
            }).filter(cart => cart !== undefined);

            // create point for the first corrds of closestCoord
            if (closestCoord.length > 0) this.createPointForChartHoverPoint(closestCoord[0]);

            // find the index of pickPosition from this.interpolatedPointsGroup
            const index = this.interpolatedPointsGroup[this.selectedGroupIndex].findIndex(cart => Cesium.Cartesian3.equals(cart, closestCoord[0]));

            if (this.chart && index !== -1) this.showTooltipAtIndex(this.chart, index);
        }
    }

    handleProfileDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.groupCoords.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_profile_point") &&
                    !p.primitive.id.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(pointPrimitive)) {
                console.error("No point primitives found");
                return;
            }

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            this.isDragMode = true;
            this.draggingPrimitive = pointPrimitive.primitive;
            this.beforeDragPosition = pointPrimitive.primitive.position.clone();

            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_profile_line"));
            let linePrimitive = null;
            if (linePrimitives.length > 0) {
                linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                // set the relative line primitive to no show
                linePrimitive ? linePrimitive.show = false : console.error("No specific line primitives found");
            } else {
                console.error("No line primitives found");
                return;
            }

            // find the relative label primitive to the dragging point 
            const linePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]
            const midpoint = Cesium.Cartesian3.midpoint(linePrimitivePosition[0], linePrimitivePosition[1], new Cesium.Cartesian3());
            const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, midpoint) && label.id && label.id.startsWith("annotate_profile_label"));
            targetLabelPrimitive.show = false;

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleProfileDrag(movement, this.draggingPrimitive, this.beforeDragPosition);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    };

    handleProfileDrag(movement, pointPrimitive, pointPrimitivePosition) {
        if (this.isDragMode) {
            this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // update point primitive to dragging position
            pointPrimitive.position = cartesian;
            // remove the hover point
            if (this.hoverPoint) this.pointCollection.remove(this.hoverPoint);

            // identify the group of coordinates that contains the dragging position
            const group = this.groupCoords.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, pointPrimitivePosition)));

            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, pointPrimitivePosition));

            // update moving line primitive by remove the old one and create a new one
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const movingLineGeometryInstance = createClampedLineGeometryInstance([otherPointCoords, this.coordinate], "profile_drag_moving_line");
            const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // update moving label primitive
            const pickedCartesianArray = this._computeDetailedPickPositions(otherPointCoords, this.coordinate);

            let totalDistance = null;
            for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                const distance = Cesium.Cartesian3.distance(
                    pickedCartesianArray[i],
                    pickedCartesianArray[i + 1]
                );
                totalDistance += distance;
            }

            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(otherPointCoords, this.coordinate, totalDistance));
            const midPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
            this.movingLabelPrimitive.id = generateId(midPoint, "profile_drag_moving_label");
        }
    }

    handleProfileDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {
            // update the group coordinates by replace the new set of coordinates
            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_profile_line"));

            if (linePrimitives.length > 0) {
                const linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                const targetLinePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]

                // update the this.groupCoords with the new drag end positions, 2 points coordinates
                const group = this.groupCoords.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.beforeDragPosition));

                const newCoords = [otherPointCoords, this.coordinate];
                const index = this.groupCoords.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                this.groupCoords[index] = newCoords;
                // update the interpolated points group
                this.selectedGroupIndex = index;


                // update the line primitive by remove the old one and create a new one
                if (this.movingPolylinePrimitive) {
                    this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
                }
                if (linePrimitive) {
                    this.viewer.scene.primitives.remove(linePrimitive);
                }
                // create new line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance(newCoords, "profile_line");
                const newlinePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(newlinePrimitive);

                // update the distance label
                if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);

                const existedMidPoint = Cesium.Cartesian3.midpoint(targetLinePrimitivePosition[0], targetLinePrimitivePosition[1], new Cesium.Cartesian3());
                const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, existedMidPoint) && label.id && label.id.startsWith("annotate_profile_label"));

                const pickedCartesianArray = this._computeDetailedPickPositions(newCoords[1], newCoords[0]);
                // update the interpolated points group
                this.interpolatedPointsGroup[index] = [...pickedCartesianArray];

                // line chart x-axis label
                // always start from 0 meters
                const labelDistance = [0];

                let totalDistance = null;

                for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                    const distance = Cesium.Cartesian3.distance(
                        pickedCartesianArray[i],
                        pickedCartesianArray[i + 1]
                    );
                    totalDistance += distance;
                    // line chart x-axis label
                    labelDistance.push(labelDistance[i] + Math.round(distance));
                }

                const newMidPoint = Cesium.Cartesian3.midpoint(newCoords[0], newCoords[1], new Cesium.Cartesian3());
                targetLabelPrimitive.position = newMidPoint;
                targetLabelPrimitive.text = formatDistance(totalDistance);
                targetLabelPrimitive.show = true;
                targetLabelPrimitive.id = generateId(newMidPoint, "profile_label");

                // line chart y-axis data
                const diffHeight = pickedCartesianArray.map((pickedCartesian) => {
                    const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                    return pickedCartographic.height
                })

                // update the chart
                if (this.chartDiv) {
                    this.updateChart(diffHeight, labelDistance);
                } else {
                    this.setupChart();
                    this.chartDiv.style.display = "block";
                    this.updateChart(diffHeight, labelDistance);
                }


                // log distance
                this.logRecordsCallback(totalDistance.toFixed(2));
            } else {
                console.error("No line primitives found");
                return;
            }

        }

        // reset to default profile mouse movement action
        this.handler.setInputAction((movement) => {
            this.handleProfileMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.draggingPrimitive = null;
        this.isDragMode = false;
    };

    /**
     * Interpolates points between two points based on the interval.
     * @param {Cesium.Cartesian3} pointA - the cartesian coordinate of the first point
     * @param {Cesium.Cartesian3} pointB - the cartesian coordinate of the second point
     * @param {Number} interval  - the interval between the two points
     * @returns {Cesium.Cartesian3[]} - the interpolated points
     */
    interpolatePoints(pointA, pointB, interval = 0.9) {
        const points = [];

        // Calculate the distance between the two points
        const distance = Cesium.Cartesian3.distance(pointA, pointB);

        // Determine the number of interpolation points based on the interval
        let numberOfPoints = Math.floor(distance / interval);
        // error handling: prevent numberOfPoints to be 0
        if (numberOfPoints === 0) numberOfPoints = 1;

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

    _computeDetailedPickPositions(startPosition, endPosition) {
        // interpolate points between the first and second point
        const interpolatedPoints = this.interpolatePoints(
            startPosition,
            endPosition,
        );

        // get the ground height of the interpolated points
        const interpolatedCartographics = interpolatedPoints.map(point => Cesium.Cartographic.fromCartesian(point));

        // sample height 
        if (this.viewer.scene.sampleHeightSupported) { // sampleHeight() only supports in 3d mode
            const clampedPositions = interpolatedCartographics.map((cartographic) => {
                const height = this.viewer.scene.sampleHeight(cartographic);
                return Cesium.Cartesian3.fromRadians(
                    cartographic.longitude,
                    cartographic.latitude,
                    height
                )
            });
            return clampedPositions;
        }
        return [];

        // getHeight() approach
        // the height of the surface
        // const groundCartesianArray = interpolatedCartographics.map((cartographic) => {
        //     const height = this.viewer.scene.globe.getHeight(cartographic);
        //     return Cesium.Cartesian3.fromRadians(
        //         cartographic.longitude,
        //         cartographic.latitude,
        //         height
        //     )
        // });

        // sampleTerrainMostDetailed() approach
        // const groundPositions = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, interpolatedCartographics);

        // const groundCartesianArray = interpolatedCartographics.map((cartograhpic) => {
        //     return Cesium.Cartesian3.fromRadians(
        //         cartograhpic.longitude,
        //         cartograhpic.latitude,
        //         surfaceHeight
        //     )
        // });

        // repick the position by convert back to window position to repick the carteisan, drawbacks is the current camera must see the whole target. 
        // const pickedCartesianArray = groundCartesianArray.map((groundCartesian) => {
        //     const windowPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, groundCartesian);
        //     if (windowPosition) {
        //         const cartesian = this.viewer.scene.pickPosition(windowPosition);
        //         if (Cesium.defined(cartesian)) {
        //             return cartesian;
        //         }
        //     }
        // }).filter(cart => cart !== undefined);
        // TODO: use another angle from the camera to get points cover by the object and use Set to create a unique array of picked coordinates

        // return groundCartesianArray;
    }

    showTooltipAtIndex(chart, index) {
        if (chart.data.datasets.length > 0 && chart.data.datasets[0].data.length > 1) {
            chart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], chart.getDatasetMeta(0).data[1].element);
            chart.update();
        } else {
            console.error('Data is not sufficient to trigger tooltip at index 1');
        }
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
        const ctx = canvas.getContext("2d");
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
                onHover: (_, chartElement) => {
                    if (chartElement.length) {
                        const point = chartElement[0];
                        // const label = this.chart.data.labels[point.index];
                        // const dataPoint = this.chart.data.datasets[0].data[point.index];
                        // handle cesium to update the point primitive to the hover point
                        if (this.interpolatedPointsGroup.length > 0) {
                            const lastGroup = this.interpolatedPointsGroup[this.selectedGroupIndex];
                            this.createPointForChartHoverPoint(lastGroup[point.index]);
                        }
                    }
                },
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

        makeDraggable(this.chartDiv, this.viewer.container);
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

    createPointForChartHoverPoint(cartesian) {
        if (!Cesium.defined(cartesian)) return;
        if (this.hoverPoint) this.pointCollection.remove(this.hoverPoint);
        const point = createPointPrimitive(cartesian, Cesium.Color.BLUE);
        point.id = generateId(cartesian, "profile_chart_hover_point");
        this.hoverPoint = this.pointCollection.add(point);
    }

    resetValue() {
        this.removeChart();

        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        this.isDistanceStarted = false;
        this.isDragMode = false;

        this.coordinateDataCache = [];

        this.draggingPrimitive = null;
        this.beforeDragPosition = null;

        // remove moving primitives
        if (this.movingPolylinePrimitive) this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
        if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
    }
}

export { Profile };

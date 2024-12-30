import * as Cesium from "cesium";
import Chart from "chart.js/auto";
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
    getPickedObjectType,
    getPrimitiveByPointPosition,
    calculateClampedDistance,
    createGroundPolylinePrimitive,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Profile extends MeasureModeBase {
    /**
     * Creates a new Profile instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],              // Stores temporary coordinates during operations
            groups: [],             // Tracks all coordinates involved in operations
            interpolatedPointsGroup: [],    // Tracks all interpolated points
            selectedGroupIndex: null,       // Tracks the index of the selected group
            dragStart: null,            // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
            _distanceRecords: []        // Stores the distance records
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolyline: null,   // Line that visualizes dragging or moving
            movingLabel: null,      // Label that updates during moving or dragging
            dragPoint: null,        // Currently dragged point primitive
            dragPolyline: null,     // Line that visualizes dragging
            dragLabel: null,        // Label that updates during dragging
            hoveredPoint: null,       // Point that is currently hovered
            hoveredLabel: null,     // Label that is currently hovered
            chartHoveredPoint: null,
        };

        // chart
        this.chart = null;
        this.chartDiv = null;
    }

    /**
     * Sets up input actions for profile mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "profile");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.coords.cache.length === 0) { // only when it is not during measuring can edit the label. 
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                break;
            case "line":
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode) {
                    this.startMeasure();
                }
                break;
        }
    }

    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = [];
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup;
        }

        // check if the current position is very close to coordinate in groups, if yes then don't create new point
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
        if (!isNearPoint) {
            this.coords.cache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED, "profile_point_pending");
            this.pointCollection.add(point);
        }

        // create line and label
        if (this.coords.cache.length === 2) {
            // update pending point id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"))
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline)
                this.interactivePrimitives.movingPolyline = null;
            }
            const linePrimitive = createGroundPolylinePrimitive(this.coords.cache, "profile_line", Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const { distance, pickedCartesianGroup } = calculateClampedDistance(this.coords.cache[0], this.coords.cache[1], this.viewer.scene, 2);
            if (this.interactivePrimitives.movingLabel) {
                this.labelCollection.remove(this.interactivePrimitives.movingLabel);
                this.interactivePrimitives.movingLabel = null;
            }
            const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance);
            label.id = generateId(this.coords.cache, "profile_label");
            this.labelCollection.add(label);

            // update the interpolated points group
            this.coords.interpolatedPointsGroup.push([...pickedCartesianGroup]);
            this.coords.selectedGroupIndex = this.coords.interpolatedPointsGroup.length - 1;

            // set chart to show or update the chart
            if (this.chartDiv) {    // if chart already exist then update the chart
                this.chartDiv.style.display = "block";
            } else {    // if chart doesn't exist then create a new chart
                this.setupChart();
                this.chartDiv.style.display = "block";
            }

            // line chart x-axis label
            const labelDistance = [0];  // always start from 0 meters
            for (let i = 0; i < pickedCartesianGroup.length - 1; i++) {
                const distance = Cesium.Cartesian3.distance(pickedCartesianGroup[i], pickedCartesianGroup[i + 1]);
                // line chart x-axis label
                labelDistance.push(labelDistance[i] + Math.round(distance));
            };
            // line chart y-axis data
            const diffHeight = pickedCartesianGroup.map((pickedCartesian) => {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                return pickedCartographic.height
            });
            // update the chart
            this.updateChart(diffHeight, labelDistance);

            // log distance
            this.coords._distanceRecords.push(distance);
            this.logRecordsCallback(distance.toFixed(2));

            // set flag that the measurement has ended
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        pickedObjects && updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete
        const pickedLine = pickedObjects.find(p => p.id && p.id.startsWith("annotate_profile_line"));
        const isPickedLine = pickedLine && this.coords.groups.length > 0;
        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length > 0 && this.coords.cache.length < 2) {
                    // create line primitive
                    if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
                    const movingLinePrimitive = createGroundPolylinePrimitive([this.coords.cache[0], this.coordinate], "profile_line_moving", Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
                    this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

                    // Create or update label primitive
                    const midPoint = Cesium.Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cesium.Cartesian3());
                    const { distance } = calculateClampedDistance(this.coords.cache[0], this.coordinate, this.viewer.scene, 2);
                    if (this.interactivePrimitives.movingLabel) {   // if label exists, update existing label
                        this.interactivePrimitives.movingLabel.position = midPoint;
                        this.interactivePrimitives.movingLabel.show = true;
                        this.interactivePrimitives.movingLabel.showBackground = true;
                        this.interactivePrimitives.movingLabel.text = formatDistance(distance);
                        this.interactivePrimitives.movingLabel.id = generateId([this.coords.cache[0], cartesian], "profile_label_moving");
                    } else {  // if label doesn't exist, create a new label
                        const label = createLabelPrimitive(this.coords.cache[0], cartesian, distance);
                        label.id = generateId(midPoint, "profile_label_moving");
                        label.showBackground = false
                        this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
                    }
                }
                break;
            case isPickedLine:
                const pointer = this.stateManager.getOverlayState("pointer");
                pointer.style.display = "none";
                // move along the line to show the tooltip for corresponding point
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const groundHeight = this.viewer.scene.sampleHeight(cartographic);

                const pickCartesian = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, groundHeight);

                if (!Cesium.defined(pickCartesian)) return;

                const closestCoord = this.coords.interpolatedPointsGroup[this.coords.selectedGroupIndex].map(cart => {
                    // get the closest point to the pickPosition by comparing the distance
                    const distance = Cesium.Cartesian3.distance(cart, pickCartesian);
                    if (distance < 0.5) {
                        return cart;
                    }
                }).filter(cart => cart !== undefined);

                // create point for the first coords of closestCoord
                if (closestCoord.length > 0) this.createPointForChartHoverPoint(closestCoord[0]);

                // find the index of pickPosition from this.coords.interpolatedPointsGroup
                const index = this.coords.interpolatedPointsGroup[this.coords.selectedGroupIndex].findIndex(cart => Cesium.Cartesian3.equals(cart, closestCoord[0]));
                if (index === -1) return;
                if (this.chart) this.showTooltipAtIndex(this.chart, index);

                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "profile");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        }
        resetHighlighting();
        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = Cesium.Color.YELLOW;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = Cesium.Color.YELLOW;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_profile_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    };

    handleDragMove(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove 
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_profile", this.viewer.scene, this.pointCollection, this.labelCollection);
            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            // remove the hover point
            if (this.interactivePrimitives.chartHoveredPoint) this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint);

            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update point primitive to dragging position
            if (this.interactivePrimitives.dragPoint) {
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "profile_point_moving");
            } else {
                const pointPrimitive = createPointPrimitive(cartesian, Cesium.Color.RED, "profile_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // identify the group of coordinates that contains the dragging position
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));

            // update moving line primitive by remove the old one and create a new one
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            const movingLinePrimitive = createGroundPolylinePrimitive([otherPointCoords, this.coordinate], "profile_line_moving", Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
            this.interactivePrimitives.dragPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // update moving label primitive
            const { distance } = calculateClampedDistance(otherPointCoords, this.coordinate, this.viewer.scene, 2);
            const midPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
            if (this.interactivePrimitives.dragLabel) {
                this.interactivePrimitives.dragLabel.position = midPoint;
                this.interactivePrimitives.dragLabel.text = formatDistance(distance);
                this.interactivePrimitives.dragLabel.showBackground = false;
                this.interactivePrimitives.dragLabel.id = generateId([otherPointCoords, this.coordinate], "profile_label_moving");
            } else {
                const label = createLabelPrimitive(otherPointCoords, this.coordinate, distance);
                label.id = generateId([otherPointCoords, this.coordinate], "profile_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label);
            }
        }
    }

    handleDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // update the this.coords.groups with the new drag end positions, 2 points coordinates
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const groupIndex = this.coords.groups.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex.length === -1) return;
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));
            this.coords.groups[groupIndex] = [otherPointCoords, this.coordinate];


            // remove dragging point, line and label
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            this.interactivePrimitives.dragPolyline = null;
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith("annotate_profile_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            existedPoint.show = true;
            existedPoint.position = this.coordinate;
            existedPoint.id = generateId(this.coordinate, "profile_point");

            // create new line primitive
            const linePrimitive = createGroundPolylinePrimitive([otherPointCoords, this.coordinate], "profile_line", Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // Find and update the existing label primitive
            const oldMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coords.dragStart, new Cesium.Cartesian3());
            const newMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
            const { distance, pickedCartesianGroup } = calculateClampedDistance(otherPointCoords, this.coordinate, this.viewer.scene, 2);
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_profile_label") &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, oldMidPoint)
            );
            if (existedLabel) {
                existedLabel.text = formatDistance(distance);
                existedLabel.id = generateId(newMidPoint, "profile_label");
                existedLabel.position = newMidPoint;
                existedLabel.show = true;
            }

            // update the interpolated points group
            this.coords.interpolatedPointsGroup[groupIndex] = pickedCartesianGroup;
            this.coords.selectedGroupIndex = groupIndex;    // update the selected group index

            // line chart x-axis label
            // always start from 0 meters
            const labelDistance = [0];
            for (let i = 0; i < pickedCartesianGroup.length - 1; i++) {
                const distance = Cesium.Cartesian3.distance(pickedCartesianGroup[i], pickedCartesianGroup[i + 1]);
                // line chart x-axis label
                labelDistance.push(labelDistance[i] + Math.round(distance));
            }
            // line chart y-axis data
            const diffHeight = pickedCartesianGroup.map((cartesian) => {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(cartesian);
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
            this.logRecordsCallback(distance.toFixed(2));

            // reset dragging flags
            this.flags.isDragMode = false;
        }
        // reset to default profile mouse movement action
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };


    /******************
     * OTHER FEATURES *
     ******************/
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
                        if (this.coords.interpolatedPointsGroup.length > 0) {
                            const lastGroup = this.coords.interpolatedPointsGroup[this.coords.selectedGroupIndex];
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

    createPointForChartHoverPoint(cartesian, color = Cesium.Color.ALICEBLUE) {
        if (!Cesium.defined(cartesian)) return;
        if (this.interactivePrimitives.chartHoveredPoint) {
            this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint)
            this.interactivePrimitives.chartHoveredPoint = null;
        };
        const point = createPointPrimitive(cartesian, color, "profile_point_chart_moving");
        this.interactivePrimitives.chartHoveredPoint = this.pointCollection.add(point);
    }

    /********************
     * HELPER FUNCTIONS *
     ********************/
    resetValue() {
        this.removeChart();

        super.resetValue();
    }
}

export { Profile };

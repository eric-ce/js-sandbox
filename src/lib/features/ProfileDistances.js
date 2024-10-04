import * as Cesium from "cesium";
import {
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    generateId,
    makeDraggable,
    getPickedObjectType,
    calculateClampedDistance,
    calculateClampedDistanceFromArray,
    getPrimitiveByPointPosition,
    changeLineColor,
    resetLineColor,
} from "../helper/helper.js";
import Chart from "chart.js/auto";

class ProfileDistances {
    /**
     * Creates a new Profile Distance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isAddMode: false,
            countMeasure: 0,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],                  // Stores temporary coordinates during operations
            groups: [],                 // Tracks all coordinates involved in operations
            dragStart: null,            // Stores the initial position before a drag begins
            pickedCartesianCache: [],   // Stores the picked positions for the current operation
            pickedCartesianGroups: [],  // Stores the picked positions for all groups
            _distanceCollection: [],    // Stores the distances between points
            _distanceRecords: [],       // Stores the records of distances
            selectedGroupIndex: null    // Tracks the index of the selected group
        };

        // Label properties
        this.label = {
            _labelIndex: 0,
            _labelNumberIndex: 0
        }

        // chart
        this.chart = null;
        this.chartDiv = null;

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],        // Array of moving polylines
            movingLabels: [],           // Array of moving labels
            dragPoint: null,            // Currently dragged point primitive
            dragPolylines: [],          // Array of dragging polylines
            dragLabels: [],             // Array of dragging labels
            hoveredLine: null,          // Hovered line primitive
            selectedLine: null,         // Selected line primitive
            hoveredPoint: null,         // Hovered point primitive
            hoveredLabel: null,         // Hovered label primitive
            chartHoveredPoint: null,    // Hovered point for chart
        };
    }

    /**
     * Sets up input actions for profile distances mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for profile distances mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /********************
     * LEFT CLICK EVENT *
     ********************/
    /**
     * The method to handle left-click Cesium handler events 
     *
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement data.
     * @returns 
     */
    handleProfileDistancesLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "profile_distances");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                this.removeActionByPoint(pointPrimitive);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.setAddModeByLine(linePrimitive);
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode && !this.flags.isAddMode) {
                    this.startMeasure();
                }
                if (this.flags.isAddMode) {
                    this.addAction(this.interactivePrimitives.selectedLine);
                }
                break;
        }
    }

    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = [];
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup;
        }

        // create point primitive
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
        if (!isNearPoint) {
            // create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "profile_distances_point_pending");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }

        if (this.coords.cache.length > 1) {
            const positionIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate)); // find the index of the current position
            if (positionIndex === -1) return;   // early exit to prevent duplication creation of the line

            // remove the moving line and label primitives
            this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // get the repicked positions by windows positions from its ground positions
            // const pickedCartesianArray = this._computeDetailedPickPositions(prevPointCartesian, currPointCartesian);


            // create line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "profile_distances_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const { distance, pickedCartesianGroup } = calculateClampedDistance(prevPointCartesian, currPointCartesian, this.viewer.scene, 4);
            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(this.coordinate, this.coords.cache, this.coords.groups);
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "profile_distances_label_pending");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);

            // set chart to show or update the chart
            if (this.chartDiv) {    // if chart already exist then update the chart
                this.chartDiv.style.display = "block";
            } else {    // if chart doesn't exist then create a new chart
                this.setupChart();
                this.chartDiv.style.display = "block";
            }
            const { diffHeight, labelDistance } = this._computeChartMetrics(pickedCartesianGroup);
            // update the chart
            this.updateChart(diffHeight, labelDistance);

            // update picked positions
            this.coords.pickedCartesianCache = [...pickedCartesianGroup];

            // log distance result
            this.coords._distanceCollection.push(distance);

        }
    }

    removeActionByPoint(pointPrimitive) {
        const pointPosition = pointPrimitive.position.clone();

        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(pointPosition, "annotate_profile_distances", this.viewer.scene, this.pointCollection, this.labelCollection);

        // Remove point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove moving line and label primitives
        this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
        this.interactivePrimitives.movingLabels.length = 0;

        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {     // when it is during the measure
            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, this.coords.cache);

            this._createReconnectPrimitives(neighbourPositions, this.coords.cache, true);

            // Update coords cache
            const pointIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
            if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = this.coords.cache.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(followingPositions, followingIndex, this.coords.cache);

            if (this.coords.cache.length === 0) {
                this.flags.isMeasurementComplete = true; // when remove the only point it is considered as that measure is ended
            }
        } else if (this.coords.groups.length > 0) {     // when the measure is ended
            const groupsIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, pointPosition)));
            const group = this.coords.groups[groupsIndex];

            // remove total label
            const lastPoint = group[group.length - 1];
            const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("profile_distances_label_total") && Cesium.Cartesian3.equals(label.position, lastPoint));

            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

            this._createReconnectPrimitives(neighbourPositions, group);

            // Update coords cache
            const pointIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
            if (pointIndex !== -1) group.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = group.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

            const { distances, totalDistance, pickedCartesianGroups } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);

            // update total distance label
            if (targetTotalLabel) {
                targetTotalLabel.id = generateId(group[group.length - 1], "profile_distances_label_total");
                targetTotalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                targetTotalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
                targetTotalLabel.position = group[group.length - 1];
            }

            // set chart to show or update the chart
            if (this.chartDiv) {    // if chart already exist then update the chart
                this.chartDiv.style.display = "block";
            } else {    // if chart doesn't exist then create a new chart
                this.setupChart();
                this.chartDiv.style.display = "block";
            }

            // update chart
            const { diffHeight, labelDistance } = this._computeChartMetrics(pickedCartesianGroups);
            this.updateChart(diffHeight, labelDistance);

            // update chart tooltip
            this._updateChartTooltip(pickedCartesianGroups);

            // log distance result
            this.updateDistancesLogRecords(distances, totalDistance, group);

            // remove point and total label when there is only one point left in the group
            if (group.length === 1) {
                // remove the point and the total label
                const targetPoint = this.pointCollection._pointPrimitives.find(p => p && Cesium.Cartesian3.equals(p.position, group[0]));
                if (targetPoint) this.pointCollection.remove(targetPoint);
                const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("profile_distances_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
                // remove the group
                group.splice(0, 1);

                // log distance result
                this.updateDistancesLogRecords(distances, totalDistance, this.coords.groups[groupsIndex]);
            }
        } else {
            return;
        }
    }

    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // create reconnect line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([neighbourPositions[0], neighbourPositions[2]], isPending ? "profile_distances_line_pending" : "profile_distances_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const { distance } = calculateClampedDistance(neighbourPositions[0], neighbourPositions[2], this.viewer.scene, 4);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, isPending ? "profile_distances_label_pending" : "profile_distances_label");
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[1], group, this.coords.groups);
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        };
    }

    _updateFollowingLabelPrimitives(followingPositions, followingIndex, group) {
        // Get mid points from following positions
        const midPoints = followingPositions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, followingPositions[i + 1], new Cesium.Cartesian3())
        );

        // find the relative label primitives by midpoint
        const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.includes("profile_distances_label"));
        // update label text 
        midPoints.forEach((midPoint, index) => {
            const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
            const currentLetter = String.fromCharCode(97 + followingIndex + index % 26);
            const { labelNumberIndex } = this._getLabelProperties(followingPositions[index], group, this.coords.groups);
            // const labelNumberIndex = this.coords.groups.length;
            const { distance } = calculateClampedDistance(followingPositions[index], followingPositions[index + 1], this.viewer.scene, 4);
            relativeLabelPrimitives.forEach(l => {
                l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            });
        });
    }

    setAddModeByLine(linePrimitive) {
        // Reset previous hovered line if any
        if (this.interactivePrimitives.hoveredLine && this.interactivePrimitives.hoveredLine !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.hoveredLine);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset previous selected line if different
        if (this.interactivePrimitives.selectedLine && this.interactivePrimitives.selectedLine !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.selectedLine);
        }

        // Change line color to indicate selection
        changeLineColor(linePrimitive, Cesium.Color.YELLOW);
        this.interactivePrimitives.selectedLine = linePrimitive;

        // Set flag to indicate add mode
        if (this.interactivePrimitives.selectedLine) {
            this.flags.isAddMode = true;
        }
    }

    addAction(linePrimitive) {
        const linePositions = linePrimitive.geometryInstances.geometry._positions;
        const group = this.coords.groups.find(group => group.some(cart => Cesium.Cartesian3.equals(cart, linePositions[0])));
        if (!group || group.length === 0) return;

        // Find the smallest index of the line positions in the group
        const linePositionIndex1 = group.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[0]));
        const linePositionIndex2 = group.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[1]));
        const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);


        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (!isNearPoint) {
            // to create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "profile_distances_point");
            this.pointCollection.add(point);
            // update cache
            group.splice(positionIndex + 1, 0, this.coordinate);
        }

        // create line and label primitives
        const neighbourPositions = this.findNeighbourPosition(group[positionIndex + 1], group); // find neighbour positions by the new added point

        // remove selected line and its label
        this.viewer.scene.primitives.remove(linePrimitive);
        const midPoint = Cesium.Cartesian3.midpoint(linePositions[0], linePositions[1], new Cesium.Cartesian3());
        const existedLabel = this.labelCollection._labels.find(l => l.id && l.id.includes("profile_distances_label") && Cesium.Cartesian3.equals(l.position, midPoint));
        if (existedLabel) this.labelCollection.remove(existedLabel);

        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // create line primtives
                if (i < neighbourPositions.length - 1) {
                    const lineGeometryInstance = createClampedLineGeometryInstance([pos, neighbourPositions[i + 1]], "profile_distances_line");
                    const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitives
                    const { distance } = calculateClampedDistance(pos, neighbourPositions[i + 1], this.viewer.scene, 4);
                    const midPoint = Cesium.Cartesian3.midpoint(pos, neighbourPositions[i + 1], new Cesium.Cartesian3());
                    const label = createLabelPrimitive(pos, neighbourPositions[i + 1], distance);
                    label.id = generateId(midPoint, "profile_distances_label");
                    const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[i + 1], group, this.coords.groups);
                    label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                    this.labelCollection.add(label);
                }
            });
        }

        // update following label primitives
        const followingIndex = positionIndex + 1;
        const followingPositions = group.slice(positionIndex + 1);
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);
        const { distances, totalDistance, pickedCartesianGroups } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);

        // update total distance label
        const totalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("profile_distances_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
        if (totalLabel) {
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        }

        // set chart to show or update the chart
        if (this.chartDiv) {    // if chart already exist then update the chart
            this.chartDiv.style.display = "block";
        } else {    // if chart doesn't exist then create a new chart
            this.setupChart();
            this.chartDiv.style.display = "block";
        }

        // update chart
        const { diffHeight, labelDistance } = this._computeChartMetrics(pickedCartesianGroups);
        this.updateChart(diffHeight, labelDistance);

        // update chart tooltip
        this._updateChartTooltip(pickedCartesianGroups);

        // update log records
        this.updateDistancesLogRecords(distances, totalDistance, group);

        // reset flags
        this.flags.isAddMode = false;
        this.interactivePrimitives.selectedLine = null;
    }

    handleProfileDistancesMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;
        const pickedLine = pickedObjects.find(p => p.id && p.id.startsWith("annotate_profile_distances_line"));
        const isPickedLine = pickedLine && this.flags.isMeasurementComplete && !this.flags.isDragMode && !this.flags.isAddMode;
        switch (true) {
            case isMeasuring:
                this.handleActiveMeasure(cartesian);
                break;
            case isPickedLine:
                if (this.chart) {
                    const pickPosition = this.viewer.scene.pickPosition(movement.endPosition);
                    const cartographic = Cesium.Cartographic.fromCartesian(pickPosition);

                    const pickCartesian = Cesium.Cartesian3.fromRadians(
                        cartographic.longitude,
                        cartographic.latitude,
                        this.viewer.scene.sampleHeight(cartographic) // ground height
                    );
                    if (!Cesium.defined(pickCartesian)) return;

                    const closestCoord = this.coords.pickedCartesianGroups[this.coords.selectedGroupIndex].map(cart => {
                        const distance = Cesium.Cartesian3.distance(cart, pickCartesian);
                        if (distance < 0.5) {
                            return cart;
                        }
                    }).filter(cart => cart !== undefined);


                    // create point for the first corrds of closestCoord
                    if (closestCoord.length > 0) this.createPointForChartHoverPoint(closestCoord[0]);

                    // find the index of pickPosition from this.interpolatedPointsGroup
                    const index = this.coords.pickedCartesianGroups[this.coords.selectedGroupIndex].findIndex(cart => Cesium.Cartesian3.equals(cart, closestCoord[0]));

                    if (this.chart && index !== -1) this.showTooltipAtIndex(this.chart, index);
                }
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);  // highlight the line when hovering
                break;
        }
    }

    handleActiveMeasure(cartesian) {
        // Calculate the distance between the last selected point and the current cartesian position
        const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

        // create line primitive
        this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
        this.interactivePrimitives.movingPolylines.length = 0;

        const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, cartesian], "profile_distances_line_moving");
        const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
        const movingLine = this.viewer.scene.primitives.add(movingLinePrimitive);
        this.interactivePrimitives.movingPolylines.push(movingLine);

        // create label primitive
        this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
        this.interactivePrimitives.movingLabels.length = 0;
        const { distance } = calculateClampedDistance(lastPointCartesian, cartesian, this.viewer.scene, 4);
        const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, cartesian, new Cesium.Cartesian3());
        const label = createLabelPrimitive(lastPointCartesian, cartesian, distance);
        label.showBackground = false;
        label.id = generateId(midPoint, "profile_distances_label_moving");
        const movingLabel = this.labelCollection.add(label);
        this.interactivePrimitives.movingLabels.push(movingLabel);
    }

    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "profile_distances");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredLine && this.interactivePrimitives.hoveredLine !== this.interactivePrimitives.selectedLine) {
                resetLineColor(this.interactivePrimitives.hoveredLine);
                this.interactivePrimitives.hoveredLine = null;
            }
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();

        switch (pickedObjectType) {
            case "line": // highlight the line when hovering
                const linePrimitive = pickedObject.primitive;

                if (linePrimitive && linePrimitive !== this.interactivePrimitives.selectedLine) {
                    // Highlight the line
                    changeLineColor(linePrimitive, Cesium.Color.BLUE);
                    this.interactivePrimitives.hoveredLine = linePrimitive;
                }
                break;
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

    handleProfileDistancesRightClick(movement) {
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) {

            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

            // update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });
            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending"));
            pendingLines.forEach(p => {
                const position = p.geometryInstances.geometry._positions;
                this.viewer.scene.primitives.remove(p);
                const lineGeometryInstance = createClampedLineGeometryInstance(position, "profile_distances_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);
            });
            // update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l => l.id && l.id.includes("pending"));
            pendingLabels.forEach(l => { l.id = l.id.replace("_pending", "") });

            // remove moving line primitives and moving label primitives
            this.interactivePrimitives.movingPolylines.forEach(p => this.viewer.scene.primitives.remove(p));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_profile_distances_point") &&
                    !primitiveId.includes("moving");
            });

            if (!isPoint) {
                // create last point
                const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
                lastPoint.id = generateId(this.coordinate, "profile_distances_point");
                this.pointCollection.add(lastPoint);

                // create last line
                // first point for last line
                const firstPoint = this.coords.cache[this.coords.cache.length - 1];
                const lineGeometryInstance = createClampedLineGeometryInstance([firstPoint, this.coordinate], "profile_distances_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // update coordinate data cache
                this.coords.cache.push(this.coordinate);

                // create last label
                const { distance, pickedCartesianGroup } = calculateClampedDistance(firstPoint, this.coordinate, this.viewer.scene, 4);
                const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
                const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
                const { currentLetter, labelNumberIndex } = this._getLabelProperties(this.coordinate, this.coords.cache, this.coords.groups);
                label.id = generateId(midPoint, "profile_distances_label");
                label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`
                this.labelCollection.add(label);

                // update picked positions
                this.coords.pickedCartesianCache.push(...pickedCartesianGroup);
                this.coords.pickedCartesianGroups.push(this.coords.pickedCartesianCache);
                this.coords.selectedGroupIndex = this.coords.pickedCartesianGroups.length - 1;
            }

            // update total measure count
            this.flags.countMeasure++;

            // total distance label
            const { distances, totalDistance, pickedCartesianGroups } = calculateClampedDistanceFromArray(this.coords.cache, this.viewer.scene, 4);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "profile_distances_label_total");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            totalLabel.position = this.coords.cache[this.coords.cache.length - 1];
            this.labelCollection.add(totalLabel);

            // log distance result
            this.updateDistancesLogRecords(distances, totalDistance, [...this.coords.cache]);

            const { diffHeight, labelDistance } = this._computeChartMetrics(pickedCartesianGroups);

            // update the chart
            if (this.chart) this.updateChart(diffHeight, labelDistance);

            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
            this.coords.pickedCartesianCache = [];
        }
    }


    /***********************
     * DRAG FEATURES EVENT *
     ***********************/
    handleProfileDistancesDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) { // when the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_profile_distances_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set drag point position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleProfileDistancesDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleProfileDistancesDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove 
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_profile_distances", this.viewer.scene, this.pointCollection, this.labelCollection);
            selectedPoint.primitive.show = false;

            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);
            // remove the chart hovered point primitive
            if (this.interactivePrimitives.chartHoveredPoint) this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint);
            this.interactivePrimitives.chartHoveredPoint = null;

            this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "profile_distances_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "profile_distances_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // create moving line primitives
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return

            // Remove existing moving lines
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;

            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([pos, cartesian], "profile_distances_line_moving");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);

                // Create or update label primitive
                const { distance } = calculateClampedDistance(pos, cartesian, this.viewer.scene, 4);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                const labelPrimitive = this.interactivePrimitives.dragLabels[idx];
                if (labelPrimitive) {
                    this.interactivePrimitives.dragLabels[idx].id = generateId(midPoint, "profile_distances_label_moving");
                    this.interactivePrimitives.dragLabels[idx].position = midPoint;
                    this.interactivePrimitives.dragLabels[idx].text = `${formatDistance(distance)}`;
                    this.interactivePrimitives.dragLabels[idx].showBackground = false;
                } else {
                    const labelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    labelPrimitive.id = generateId(midPoint, "profile_distances_label_moving");
                    labelPrimitive.showBackground = false;
                    const addedLabelPrimitive = this.labelCollection.add(labelPrimitive);
                    this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
                }
            });
        }
    }

    handleProfileDistancesDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);

            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            // remove dragging point, line and label
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;
            this.interactivePrimitives.dragLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.dragLabels.length = 0;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.includes("profile_distances_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "profile_distances_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            otherPositions.forEach(pos => {
                // Create new line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([this.coordinate, pos], "profile_distances_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                const { distance } = calculateClampedDistance(pos, this.coordinate, this.viewer.scene, 4);
                const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());

                // Find and update the existing label primitive
                const labelPrimitive = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.startsWith("annotate_profile_distances_label") &&
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                )
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "profile_distances_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            });

            // find total distance label by the last point in group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("profile_distances_label_total") &&
                Cesium.Cartesian3.equals(label.position, group[group.length - 1])
            );

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update total distance label
            const { distances, totalDistance, pickedCartesianGroups } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "profile_distances_label_total");
            }

            // set chart to show or update the chart
            if (this.chartDiv) {    // if chart already exist then update the chart
                this.chartDiv.style.display = "block";
            } else {    // if chart doesn't exist then create a new chart
                this.setupChart();
                this.chartDiv.style.display = "block";
            }

            // update chart
            const { diffHeight, labelDistance } = this._computeChartMetrics(pickedCartesianGroups);
            if (this.chart) this.updateChart(diffHeight, labelDistance);

            // update chart tooltip
            this._updateChartTooltip(pickedCartesianGroups);

            // update log records
            this.updateDistancesLogRecords(distances, totalDistance, group);

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
            this.coords.pickedCartesianCache = [];
        }
        // set back to default profile distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }



    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * found the next index and previous index position from group of positions
     * @param {Cesium.Cartesian3} position - the Cartesian3 coordinate
     * @param {Cesium.Cartesian3[]} group - the group of Cartesian3 coordinates
     * @returns {Cesium.Cartesian3[]} - the previous position, current position, and next position
     */
    findNeighbourPosition(position, group) {
        const pointIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, position));

        if (pointIndex === -1) return;

        const prevPosition = pointIndex > 0 ? group[pointIndex - 1] : null;
        const nextPosition = pointIndex < group.length - 1 ? group[pointIndex + 1] : null;

        return [prevPosition, position, nextPosition].filter(pos => pos !== null);
    }

    /**
     * get the label text properties based on the position and the positions array
     * @param {Cesium.Cartesian3} position 
     * @param {Cesium.Cartesian3[]} positionsArray 
     * @returns {currentLetter: String, labelNumberIndex: Number} - the label text properties
     */
    _getLabelProperties(position, positionArray, groups) {
        const positionIndexInCache = positionArray.findIndex(cart => Cesium.Cartesian3.equals(cart, position));

        // cache length - 1 is the index
        const labelIndex = positionIndexInCache - 1;
        // index 0 means alphabet 'a' 
        const currentLetter = String.fromCharCode(97 + labelIndex % 26);
        // label number index
        const groupIndex = groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, position)));
        const labelNumberIndex = groupIndex !== -1 ? groupIndex : this.flags.countMeasure;

        return { currentLetter, labelNumberIndex }
    }

    /**
     * Compute the chart metrics based on the picked cartesian input
     * @param {Cesium.Cartesian3[[]]| Cesium.Cartesian3[]} pickedCartesianInput 
     * @returns {{labelDistance: Number[], diffHeight: Number[]}} - the chart metrics object:
     * labelDistance: x label metrics - the distance between each point
     * diffHeight: y label metrics - the height difference between each point
     */
    _computeChartMetrics(pickedCartesianInput) {
        // Validate input
        if (!Array.isArray(pickedCartesianInput)) {
            throw new TypeError("pickedCartesianInput must be an array or an array of arrays of Cesium.Cartesian3.");
        }

        // Determine if the input is nested (array of arrays) or flat
        const isNested = Array.isArray(pickedCartesianInput[0]);

        // Flatten the input into a single array of Cartesian3 coordinates
        const flatCartesian = isNested ? pickedCartesianInput.flat() : pickedCartesianInput;

        // Initialize labelDistance with the starting distance
        const labelDistance = [0];

        // Compute cumulative distances
        for (let i = 0; i < flatCartesian.length - 1; i++) {
            const currentPoint = flatCartesian[i];
            const nextPoint = flatCartesian[i + 1];

            // Calculate the distance between currentPoint and nextPoint
            const distance = Cesium.Cartesian3.distance(currentPoint, nextPoint);

            // Accumulate the distance, rounding to the nearest integer
            const cumulativeDistance = labelDistance[labelDistance.length - 1] + Math.round(distance);
            labelDistance.push(cumulativeDistance);
        }

        // Extract heights from each Cartesian3 coordinate
        const diffHeight = flatCartesian.map(cartesian => {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            return cartographic.height;
        });

        return { labelDistance, diffHeight };
    }

    /**
     * update the log records with the distances and the total distance
     * @param {Number[]} distances - the distances between each point
     * @param {Number} totalDistance - the total distance
     * @returns {Object} - the distance record object 
     */
    updateDistancesLogRecords(distances, totalDistance, positions) {
        const distanceRecord = {
            distances: distances.map(d => d.toFixed(2)),
            totalDistance: totalDistance.toFixed(2)
        };
        this.coords._distanceRecords.push(distanceRecord);
        this.logRecordsCallback(distanceRecord);

        if (positions) {
            console.table(positions); // this will interact with the server for updated positions
        }
        return distanceRecord;
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
                        if (this.coords.pickedCartesianGroups.length > 0) {
                            const lastGroup = this.coords.pickedCartesianGroups[this.coords.selectedGroupIndex];
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
        return this.chart;
    }

    _updateChartTooltip(pickedCartesianGroups) {
        // Update picked cartesian groups
        const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coordinate)));
        this.coords.pickedCartesianGroups[groupIndex] = [...pickedCartesianGroups.flat(1)];

        // Update selected group index
        this.coords.selectedGroupIndex = groupIndex;

        // Update chart tooltip
        const index = this.coords.pickedCartesianGroups[this.coords.selectedGroupIndex].findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate));
        if (this.interactivePrimitives.chartHoveredPoint) {
            this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint);
        }
        this.interactivePrimitives.chartHoveredPoint = null;
        if (index !== -1) {
            this.showTooltipAtIndex(this.chart, index);
        }
    }

    updateChart(data, labels) {
        if (!this.chart) return;
        this.chart.data.labels = labels
        this.chart.data.datasets[0].data = data;
        this.chart.update();
        return this.chart;
    }

    removeChart() {
        if (this.chartDiv) {
            this.chartDiv.remove();
            this.chart = null;
            this.chartDiv = null;
        }
        return this.chart;
    }

    showTooltipAtIndex(chart, index) {
        if (chart.data.datasets.length > 0 && chart.data.datasets[0].data.length > 1) {
            chart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], chart.getDatasetMeta(0).data[1].element);
            chart.update();
        } else {
            console.error('Data is not sufficient to trigger tooltip at index 1');
        }
        return chart;
    }

    createPointForChartHoverPoint(cartesian, color = Cesium.Color.ALICEBLUE) {
        if (!Cesium.defined(cartesian)) return;
        if (this.interactivePrimitives.chartHoveredPoint) {
            this.interactivePrimitives.chartHoveredPoint.show = true;
            this.interactivePrimitives.chartHoveredPoint.position = cartesian;
            this.interactivePrimitives.chartHoveredPoint.id = generateId(cartesian, "profile_distances_point_chart_moving");
        } else {
            const point = createPointPrimitive(cartesian, color);
            point.id = generateId(cartesian, "profile_distances_point_chart_moving");
            this.interactivePrimitives.chartHoveredPoint = this.pointCollection.add(point);
        }
        return this.interactivePrimitives.chartHoveredPoint;
    }

    resetValue() {
        this.removeChart();

        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        // reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        this.flags.isAddMode = false;
        this.flags.countMeasure = 0;
        // reset coords
        this.coords.cache = [];
        this.coords.dragStart = null;
        this.coords.dragStartToCanvas = null;
        this.coords._distanceRecords = [];

        // reset interactive primitives
        this.interactivePrimitives.movingPolylines = [];
        this.interactivePrimitives.movingLabels = [];
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolylines = [];
        this.interactivePrimitives.dragLabels = [];
        this.interactivePrimitives.hoveredLine = null;
        this.interactivePrimitives.selectedLine = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
        this.interactivePrimitives.chartHoveredPoint = null;
    }
}

export { ProfileDistances }
import * as Cesium from "cesium";
import {
    calculateDistance,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    generateId,
    makeDraggable
} from "../helper/helper.js";
import Chart from "chart.js/auto";

class ProfileDistances {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.isProfileDistancesEnd = false;
        this.isDragMode = false;

        // Cesium Primitives
        // point primitive
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.hoverPoint = null;
        // polyline primitive
        this.movingPolylinePrimitive = null;
        this.movingPolylinePrimitive2 = null;
        // label primitive
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);
        this.movingLabelPrimitive = null;
        this.movingLabelPrimitive1 = null;
        this.movingLabelPrimitive2 = null;

        // dragging feature variables
        this.draggingPrimitive = null;
        this.beforeDragPosition = null;

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];
        // all picked position
        this.pickedCartesianArrayCache = [];
        this.allPickedCartesianArray = [];
        // distance
        this._distanceCollection = [];
        this._distanceRecords = [];

        // label text
        this._labelIndex = 0;
        this._labelNumberIndex = 0;

        // chart
        this.chart = null;
        this.chartDiv = null;
        this.selectedGroupIndex = null;
    }

    /**
     * Sets up input actions for three points curve mode.
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
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleProfileDistancesLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (this.isProfileDistancesEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label primitive, make it editable
            if (
                Cesium.defined(pickedObject) &&
                pickedObject?.id?.startsWith("annotate") &&
                pickedObject?.id?.includes("label")
            ) {
                editableLabel(this.viewer.container, pickedObject.primitive);
                return; // Exit the function after making the label editable
            }

            this._distanceCollection.length = 0;
            this._labelIndex = 0;
            this.isProfileDistancesEnd = false;

            // continue point 
            const continuePoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            continuePoint.id = generateId(cartesian, "profile_distances_point");
            this.pointCollection.add(continuePoint);

            // update coordinate data cache
            this.coordinateDataCache.push(cartesian);
            return;
        }

        // create point entity
        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "profile_distances_point");
        this.pointCollection.add(point);

        // update coordinate data cache
        this.coordinateDataCache.push(this.coordinate);

        if (this.coordinateDataCache.length > 1) {
            const prevIndex = this.coordinateDataCache.length - 2;
            const currIndex = this.coordinateDataCache.length - 1;
            const prevPointCartesian = this.coordinateDataCache[prevIndex];
            const currPointCartesian = this.coordinateDataCache[currIndex];

            // get the repicked positions by windows positions from its ground positions
            const pickedCartesianArray = this._computeDetailedPickPositions(prevPointCartesian, currPointCartesian);
            // update all picked positions
            this.pickedCartesianArrayCache.push(...pickedCartesianArray);

            // distance for clamped positions between two points
            let distance = null;
            for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    pickedCartesianArray[i],
                    pickedCartesianArray[i + 1]
                );
                distance += fragmentDistance;
            }

            // update distance collection
            this._distanceCollection.push(distance);

            // create label primitive
            // set moving label primitive to not show
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);

            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "profile_distances_label");
            // label text
            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(distance)}`;
            this._labelIndex++;
            this.labelCollection.add(label);

            // create line primitive
            if (this.movingPolylinePrimitive) this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);

            const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "profile_distances_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // profile terrain for distances
            // show the chart, if no chart then create the chart set it to show
            if (this.chartDiv) {
                this.chartDiv.style.display = "block";
            } else {
                this.setupChart();
                this.chartDiv.style.display = "block";
            }

            // line chart x-axis label
            const labelDistance = [0];
            for (let i = 0; i < this.pickedCartesianArrayCache.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    this.pickedCartesianArrayCache[i],
                    this.pickedCartesianArrayCache[i + 1]
                );
                // line chart x-axis label
                labelDistance.push(labelDistance[i] + Math.round(fragmentDistance));
            }
            // line chart y-axis data
            const diffHeight = this.pickedCartesianArrayCache.map((pickedCartesian) => {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                return pickedCartographic.height
            })

            // update the chart
            this.chart && this.updateChart(diffHeight, labelDistance);
        }
    }

    handleProfileDistancesMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coordinateDataCache.length > 0 && !this.isProfileDistancesEnd) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointCartesian = this.coordinateDataCache[this.coordinateDataCache.length - 1]

            // create line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, this.coordinate], "profile_distances_moving_line");
            const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const pickedCartesianArray = this._computeDetailedPickPositions(lastPointCartesian, this.coordinate);

            let distance = null;
            for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    pickedCartesianArray[i],
                    pickedCartesianArray[i + 1]
                );
                distance += fragmentDistance;
            };
            // const distance = calculateDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            // const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0) + distance;
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(lastPointCartesian, this.coordinate, distance));
            this.movingLabelPrimitive.id = generateId(midPoint, "profile_distances_moving_label");
        }

        // move along the line to show the tooltip for corresponding point
        if (this.isProfileDistancesEnd) {
            const pickedLine = pickedObjects.find(p => p.id && p.id.startsWith("annotate_profile_distances_line"));

            if (pickedLine) {
                const pickPosition = this.viewer.scene.pickPosition(movement.endPosition);
                const cartographic = Cesium.Cartographic.fromCartesian(pickPosition);
                const groundHeight = this.viewer.scene.globe.getHeight(cartographic);

                const pickCartesian = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, groundHeight);

                if (!Cesium.defined(pickCartesian)) return;

                const closestCoord = this.allPickedCartesianArray[this.selectedGroupIndex].map(cart => {
                    const distance = Cesium.Cartesian3.distance(cart, pickCartesian);
                    if (distance < 2) {
                        return cart;
                    }
                }).filter(cart => cart !== undefined);

                // create point for the first corrds of closestCoord
                if (closestCoord.length > 0) this.createPointForChartHoverPoint(closestCoord[0]);

                // find the index of pickPosition from this.interpolatedPointsGroup
                const index = this.allPickedCartesianArray[this.selectedGroupIndex].findIndex(cart => Cesium.Cartesian3.equals(cart, closestCoord[0]));

                if (this.chart && index !== -1) this.showTooltipAtIndex(this.chart, index);
            }
        }
    }

    handleProfileDistancesRightClick(movement) {
        if (!this.isProfileDistancesEnd) {
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // update coordinate data cache
            this.coordinateDataCache.push(this.coordinate);
            this.groupCoords.push([...this.coordinateDataCache]);

            // create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "profile_distances_point");
            this.pointCollection.add(lastPoint);

            // create last line
            // remove this.moving line entity
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            // first point for last line
            const firstPoint = this.coordinateDataCache[this.coordinateDataCache.length - 2];
            const lineGeometryInstance = createClampedLineGeometryInstance([firstPoint, this.coordinate], "profile_distances_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);

            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            const pickedCartesianArray = this._computeDetailedPickPositions(firstPoint, this.coordinate);
            this.pickedCartesianArrayCache.push(...pickedCartesianArray);
            this.allPickedCartesianArray.push([...this.pickedCartesianArrayCache]);
            this.selectedGroupIndex = this.allPickedCartesianArray.length - 1;

            let distance = null;
            for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    pickedCartesianArray[i],
                    pickedCartesianArray[i + 1]
                );
                distance += fragmentDistance;
            };
            const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
            label.id = generateId(midPoint, "profile_distances_label");
            // label text
            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(distance)}`
            this._labelIndex++;
            this._labelNumberIndex++;

            this.labelCollection.add(label);
            const lastDistance = calculateDistance(firstPoint, cartesian);
            this._distanceCollection.push(lastDistance);

            // total distance label
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "profile_distances_total_label");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(80, 10);
            this.labelCollection.add(totalLabel);

            // log distance result
            const distances = []

            distances.push(...this._distanceCollection);
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);

            // line chart x-axis label
            const labelDistance = [0];

            for (let i = 0; i < this.pickedCartesianArrayCache.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    this.pickedCartesianArrayCache[i],
                    this.pickedCartesianArrayCache[i + 1]
                );
                // line chart x-axis label
                labelDistance.push(labelDistance[i] + Math.round(fragmentDistance));
            }

            // line chart y-axis data
            const diffHeight = this.pickedCartesianArrayCache.map((pickedCartesian) => {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                return pickedCartographic.height
            })

            // update the chart
            this.chart && this.updateChart(diffHeight, labelDistance);

        }

        this.isProfileDistancesEnd = true;
        this.coordinateDataCache.length = 0;
        this.pickedCartesianArrayCache.length = 0;
    }

    handleProfileDistancesDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.groupCoords.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_profile_distances_point") &&
                    !p.primitive.id.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(pointPrimitive)) {
                console.error("No point primitives found");
                return;
            }

            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            this.isDragMode = true;

            this.draggingPrimitive = pointPrimitive.primitive;

            this.beforeDragPosition = pointPrimitive.primitive.position.clone();

            // remove relative line primitives
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
                p.geometryInstances &&
                p.geometryInstances.id &&
                p.geometryInstances.id.startsWith("annotate_profile_distances_line")
            );

            // error handling: if no annotation line primitives found in the scene then early exit
            if (linePrimitives.length === 0) {
                console.error("No line primitives found");
                return;
            }

            linePrimitives.forEach(p => {
                if (p.geometryInstances.geometry._positions.some(cart =>
                    Cesium.Cartesian3.equals(cart, this.beforeDragPosition)
                )) {
                    this.viewer.scene.primitives.remove(p);
                }
            });

            // set relative label primitives to no show by dragging point
            const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.groupCoords[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.beforeDragPosition, group);

            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) {
                console.error("No neighbour positions found");
                return;
            }
            // find the relative mid point from neighbourPositions
            const relativeMidPoint = [];
            for (let i = 0; i < neighbourPositions.length - 1; i++) {
                const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[i], neighbourPositions[i + 1], new Cesium.Cartesian3());
                relativeMidPoint.push(midPoint);
            }

            // Find and hide the relative label primitives by midpoint
            this.labelCollection._labels.forEach(label => {
                if (
                    label.position &&
                    relativeMidPoint.some(cart => Cesium.Cartesian3.equals(cart, label.position)) &&
                    label.id && label.id.startsWith("annotate_profile_distances_label")
                ) {
                    label.show = false;
                }
            });

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleProfileDistancesDrag(movement, this.draggingPrimitive);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleProfileDistancesDrag(movement, pointEntity) {
        this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update point entity to dragging position
        pointEntity.position = cartesian;

        // create moving line primitives
        const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
        if (groupIndex === -1) {
            console.error("No group coordinates found");
            return;
        }
        const group = this.groupCoords[groupIndex];

        const neighbourPositions = this.findNeighbourPosition(this.beforeDragPosition, group);

        // error handling: if no neighbour positions found then early exit
        if (!neighbourPositions || neighbourPositions.length === 0) {
            console.error("No neighbour positions found");
            return;
        }

        // Create new moving line primitives
        [this.movingPolylinePrimitive, this.movingPolylinePrimitive2].forEach(primitive => {
            if (primitive) {
                this.viewer.scene.primitives.remove(primitive);
            }
        });

        if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
            const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
            const lineGeometryInstance = createClampedLineGeometryInstance([otherPosition, cartesian], "profile_distances_moving_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
            const pickedCartesianArrayCache = this._computeDetailedPickPositions(otherPosition, cartesian);
            let distance = null;
            pickedCartesianArrayCache.forEach((_, i) => {
                if (i < pickedCartesianArrayCache.length - 1) {
                    const fragmentDistance = Cesium.Cartesian3.distance(
                        pickedCartesianArrayCache[i],
                        pickedCartesianArrayCache[i + 1]
                    );
                    distance += fragmentDistance;
                }
            });
            if (this.movingLabelPrimitive1) this.labelCollection.remove(this.movingLabelPrimitive1);
            this.movingLabelPrimitive1 = this.labelCollection.add(createLabelPrimitive(otherPosition, cartesian, distance));
            const midPoint = Cesium.Cartesian3.midpoint(otherPosition, cartesian, new Cesium.Cartesian3());
            this.movingLabelPrimitive1.id = generateId(midPoint, "profile_distances_moving_label");
        }
        if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));

            otherPositions.map((pos, index) => {
                const lineGeometryInstance = createClampedLineGeometryInstance([pos, cartesian], "profile_distances_moving_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
                if (index === 0) this.movingPolylinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                if (index === 1) this.movingPolylinePrimitive2 = this.viewer.scene.primitives.add(linePrimitive);

                // const distance = calculateDistance(pos, cartesian);
                const pickedCartesianArray = this._computeDetailedPickPositions(pos, cartesian);

                let distance = null;
                for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                    distance += Cesium.Cartesian3.distance(pickedCartesianArray[i], pickedCartesianArray[i + 1]);
                }

                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                if (index === 0) {
                    if (this.movingLabelPrimitive1) this.labelCollection.remove(this.movingLabelPrimitive1);
                    this.movingLabelPrimitive1 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.movingLabelPrimitive1.id = generateId(midPoint, "profile_distances_moving_label");
                }
                if (index === 1) {
                    if (this.movingLabelPrimitive2) this.labelCollection.remove(this.movingLabelPrimitive2);
                    this.movingLabelPrimitive2 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.movingLabelPrimitive2.id = generateId(midPoint, "profile_distances_moving_label");
                }
            })
        }
    }

    handleProfileDistancesDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {
            const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.groupCoords[groupIndex];
            this.selectedGroupIndex = groupIndex;
            // create and update line and label primitives
            const neighbourPositions = this.findNeighbourPosition(this.beforeDragPosition, group);

            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) {
                console.error("No neighbour positions found");
                return;
            }

            // remove moving line primitives
            [this.movingPolylinePrimitive, this.movingPolylinePrimitive2].forEach(primitive => {
                if (primitive) this.viewer.scene.primitives.remove(primitive);
            });

            // set moving label primitives not show
            [this.movingLabelPrimitive1, this.movingLabelPrimitive2, this.movingLabelPrimitive].forEach(primitive => {
                if (primitive) this.labelCollection.remove(primitive);
            });

            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.startsWith("annotate_profile_distances_label"));

            // Create new moving line primitives
            if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
                const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
                // create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([this.coordinate, otherPosition], "profile_distances_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label primitive
                const pickedCartesianArray = this._computeDetailedPickPositions(otherPosition, this.coordinate);
                let distance = null;
                for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                    distance += calculateDistance(pickedCartesianArray[i], pickedCartesianArray[i + 1]);
                }
                // const distance1 = calculateDistance(otherPosition, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.beforeDragPosition, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.coordinate, new Cesium.Cartesian3());
                const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = oldLabelText + ": " + formatDistance(distance);
                    labelPrimitive.id = generateId(newMidPoint, "profile_distances_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            }
            if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
                const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
                otherPositions.map((pos) => {
                    // create line primitive
                    const lineGeometryInstance = createClampedLineGeometryInstance([pos, this.coordinate], "profile_distances_line");
                    const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitive
                    const pickedCartesianArray = this._computeDetailedPickPositions(pos, this.coordinate);
                    let distance = null;
                    for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
                        distance += calculateDistance(pickedCartesianArray[i], pickedCartesianArray[i + 1]);
                    }
                    const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.beforeDragPosition, new Cesium.Cartesian3());
                    const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());
                    const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                    if (labelPrimitive) {
                        const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                        labelPrimitive.text = oldLabelText + ": " + formatDistance(distance);
                        labelPrimitive.id = generateId(newMidPoint, "profile_distances_label");
                        labelPrimitive.position = newMidPoint;
                        labelPrimitive.show = true;
                    }
                });
            }

            // find total distance label by the last point in group (not updated)
            const totalLabel = this.labelCollection._labels.find(label => label.id && label.id.startsWith("annotate_profile_distances_total_label") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
            if (positionIndex !== -1) this.groupCoords[groupIndex][positionIndex] = this.coordinate;

            // recompute the interpolation points and update this.allPickedCartesianArray
            const groupCoordinates = this.groupCoords[groupIndex];
            let interpolatedPoints = [];
            for (let i = 0; i < groupCoordinates.length - 1; i++) {
                const detailedPickPositions = this._computeDetailedPickPositions(groupCoordinates[i], groupCoordinates[i + 1]);
                interpolatedPoints.push(...detailedPickPositions);
            }
            this.allPickedCartesianArray[groupIndex] = interpolatedPoints;

            // update distance collection
            const distances = [];
            for (let i = 0; i < group.length - 1; i++) {
                const distance = calculateDistance(group[i], group[i + 1]);
                distances.push(distance);
            }
            this._distanceCollection = distances;
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);

            // update total distance label
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "profile_distances_total_label");
            }

            // update log records
            const distanceRecord = {
                distances: this._distanceCollection.map(d => d.toFixed(2)),
                totalDistance: this._distanceCollection.reduce((a, b) => a + b, 0).toFixed(2)
            };

            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);

            // update chart
            let pickedPosition = [];

            for (let i = 0; i < group.length - 1; i++) {
                const pickedCartesianArray = this._computeDetailedPickPositions(group[i], group[i + 1]);
                pickedPosition.push(...pickedCartesianArray);
            }

            let labelDistance = [0];
            for (let i = 0; i < pickedPosition.length - 1; i++) {
                const fragmentDistance = Cesium.Cartesian3.distance(
                    pickedPosition[i],
                    pickedPosition[i + 1]
                );
                // line chart x-axis label
                labelDistance.push(labelDistance[i] + Math.round(fragmentDistance));
            }

            // line chart y-axis data
            const diffHeight = pickedPosition.map((pickedCartesian) => {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(pickedCartesian);
                return pickedCartographic.height
            });

            // update the chart
            if (this.chartDiv) {
                this.updateChart(diffHeight, labelDistance);
            } else {
                this.setupChart();
                this.chartDiv.style.display = "block";
                this.updateChart(diffHeight, labelDistance);
            }

            // reset dragging primitive and flags
            this.draggingPrimitive = null;
            this.isDragMode = false;
        }
        // set back to default profile distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleProfileDistancesMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Interpolates points between two points based on the interval.
     * @param {Cesium.Cartesian3} pointA - the cartesian coordinate of the first point
     * @param {Cesium.Cartesian3} pointB - the cartesian coordinate of the second point
     * @param {Number} interval  - the interval between the two points
     * @returns {Cesium.Cartesian3[]} - the interpolated points
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

    _computeDetailedPickPositions(startPosition, endPosition) {
        // interpolate points between the first and second point
        const interpolatedPoints = this.interpolatePoints(
            startPosition,
            endPosition,
        );

        // get the ground height of the interpolated points
        const interpolatedCartographics = interpolatedPoints.map((point) =>
            Cesium.Cartographic.fromCartesian(point)
        );


        // the height of the surface
        const groundCartesianArray = interpolatedCartographics.map((cartographic) => {
            const height = this.viewer.scene.globe.getHeight(cartographic);
            return Cesium.Cartesian3.fromRadians(
                cartographic.longitude,
                cartographic.latitude,
                height
            )
        });

        // const groundPositions = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, interpolatedCartographics);

        // const groundCartesianArray = groundPositions.map((cartograhpic) => {
        //     return Cesium.Cartesian3.fromRadians(
        //         cartograhpic.longitude,
        //         cartograhpic.latitude,
        //         cartograhpic.height
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

        return groundCartesianArray;
    }

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
                        if (this.allPickedCartesianArray.length > 0) {
                            const lastGroup = this.allPickedCartesianArray[this.selectedGroupIndex];
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
    showTooltipAtIndex(chart, index) {
        if (chart.data.datasets.length > 0 && chart.data.datasets[0].data.length > 1) {
            chart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], chart.getDatasetMeta(0).data[1].element);
            chart.update();
        } else {
            console.error('Data is not sufficient to trigger tooltip at index 1');
        }
    }

    createPointForChartHoverPoint(cartesian) {
        if (!Cesium.defined(cartesian)) return;
        if (this.hoverPoint) this.pointCollection.remove(this.hoverPoint);
        const point = createPointPrimitive(cartesian, Cesium.Color.BLUE);
        point.id = generateId(cartesian, "profile_distances_chart_hover_point");
        this.hoverPoint = this.pointCollection.add(point);
    }

    resetValue() {
        this.removeChart();

        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        this.isProfileDistancesEnd = false;
        this.isDragMode = false;

        this._labelIndex = 0;
        this._labelNumberIndex = 0;

        this.draggingPrimitive = null;
        this.beforeDragPosition = null;
    }
}

export { ProfileDistances }
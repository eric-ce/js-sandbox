import * as Cesium from "cesium";
import {
    calculateDistance,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
} from "../helper/helper.js";

class MultiDistanceClamped {
    /**
     * Creates a new MultiDistance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
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
            isMultiDistanceClampedEnd: false,
            isDragMode: false,
            countMeasure: 0,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            _distanceRecords: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
        };

        // Label properties
        // this.label = {
        //     _labelIndex: 0,
        //     _labelNumberIndex: 0
        // }

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            draggingPoint: null,    // Currently dragged point primitive
        }
    }

    /**
     * Sets up input actions for multi-distance clamped mode.
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

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for multi-distance clamped mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleMultiDistanceLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = this.getPickedObjectType(pickedObject);

        // due to complex feature associated with left click, switch case is used to handle different scenarios
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMultiDistanceClampedEnd) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                this.removeActionByPoint(pointPrimitive);
            case "line":
                break;
            case "other":
                break;
            default:
                if (this.flags.isMultiDistanceClampedEnd) {
                    this.flags.isMultiDistanceClampedEnd = false;
                }
                this.startMeasure();
                break;
        }
    }

    startMeasure() {
        // create point primitive
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (!isNearPoint) {
            // to create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "multidistance_clamped_point_pending");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }

        if (this.coords.cache.length > 1) {
            const positionIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate)); // find the index of the current position

            // if no index means the current position has been removed from the cache by toggle point
            if (positionIndex === -1) return;   // early exit to prevent duplication creation of the line

            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // create line primitive
            this.interactivePrimitives.movingPolylines.forEach(primitive => {
                this.viewer.scene.primitives.remove(primitive);
            });
            this.interactivePrimitives.movingPolylines.length = 0;
            const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_clamped_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label entities
            this.interactivePrimitives.movingLabels.forEach(label => {
                this.labelCollection.remove(label);
            });
            this.interactivePrimitives.movingLabels.length = 0;
            const distance = this.calculateClampedDistance(prevPointCartesian, currPointCartesian);
            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "multidistance_clamped_label_pending");

            // label text
            const { currentLetter, labelNumberIndex } = this.getLabelProperties(this.coordinate, this.coords.cache);
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            // this.label._labelIndex++;
            this.labelCollection.add(label);
        }

    }

    removeActionByPoint(pointPrimitive) {
        const pointPosition = pointPrimitive.position.clone();

        const { linePrimitives, labelPrimitives } = this.getPrimitiveByPointPosition(pointPosition, "annotate_multidistance_clamped");

        // Remove point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        if (this.coords.cache.length > 0) {     // when the measure is starting
            // Update cache
            this._updatePrimitivesAndCache(pointPosition, this.coords.cache);
        } else if (this.coords.groups.length > 0) {     // when the measure is ended
            const groupsIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, pointPosition)));
            const group = this.coords.groups[groupsIndex];

            // remove total label
            const lastPoint = group[group.length - 1];
            const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_clamped_total_label") && Cesium.Cartesian3.equals(label.position, lastPoint));
            if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

            this._updatePrimitivesAndCache(pointPosition, group);

            //TODO: handle when there is only one point left in the group

            // update total distance label
            const { distances, totalDistance } = this.calculateClampedDistanceFromArray(group);
            const totalLabel = createLabelPrimitive(group[group.length - 1], group[group.length - 1], totalDistance);
            totalLabel.id = generateId(group[group.length - 1], "multidistance_clamped_total_label");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            this.labelCollection.add(totalLabel);

            // log distance result
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            this.coords._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);
        } else {
            return;
        }
    }

    _updatePrimitivesAndCache(pointPosition, cache) {
        // Create reconnect primitives
        const neighbourPositions = this.findNeighbourPosition(pointPosition, cache);
        this._createReconnectPrimitives(neighbourPositions, cache);

        // Update coords cache
        const pointIndex = cache.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
        if (pointIndex !== -1) cache.splice(pointIndex, 1);

        // Update following label primitives
        const followingPositions = cache.slice(pointIndex);
        const followingIndex = pointIndex;
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, cache);
    }

    _createReconnectPrimitives(neighbourPositions, group) {
        if (neighbourPositions.length === 3) {
            // create reconnect line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([neighbourPositions[0], neighbourPositions[2]], "multidistance_clamped_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const distance = this.calculateClampedDistance(neighbourPositions[0], neighbourPositions[2]);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, "multidistance_clamped_label_pending");
            const { currentLetter, labelNumberIndex } = this.getLabelProperties(neighbourPositions[1], group);
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
        const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.includes("multidistance_clamped_label"));
        // update label text 
        midPoints.forEach((midPoint, index) => {
            const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
            const currentLetter = String.fromCharCode(97 + followingIndex + index % 26);
            const { labelNumberIndex } = this.getLabelProperties(followingPositions[index], group);
            // const labelNumberIndex = this.coords.groups.length;
            const distance = this.calculateClampedDistance(followingPositions[index], followingPositions[index + 1]);
            relativeLabelPrimitives.forEach(l => {
                l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            });
        });
    }

    handleMultiDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coords.cache.length > 0 && !this.flags.isMultiDistanceClampedEnd) {    // when the measure is starting
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

            // create line primitive
            this.interactivePrimitives.movingPolylines.forEach(primitive => {
                this.viewer.scene.primitives.remove(primitive);
            });
            this.interactivePrimitives.movingPolylines.length = 0;

            const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, this.coordinate], "multidistance_clamped_moving_line");
            const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
            const movingLine = this.viewer.scene.primitives.add(movingLinePrimitive);
            this.interactivePrimitives.movingPolylines.push(movingLine);

            // create label primitive
            this.interactivePrimitives.movingLabels.forEach(label => {
                this.labelCollection.remove(label);
            });
            this.interactivePrimitives.movingLabels.length = 0;
            const distance = this.calculateClampedDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            const movingLabel = this.labelCollection.add(createLabelPrimitive(lastPointCartesian, this.coordinate, distance));
            movingLabel.id = generateId(midPoint, "multidistance_clamped_moving_label");
            this.interactivePrimitives.movingLabels.push(movingLabel);
        }
    }

    handleMultiDistanceRightClick(movement) {
        // place last point and place last line
        if (!this.isMultiDistanceEnd && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

            // update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });
            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending"));
            pendingLines.forEach(p => { p.geometryInstances.id = p.geometryInstances.id.replace("_pending", "") });
            // update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l => l.id && l.id.includes("pending"));
            pendingLabels.forEach(l => { l.id = l.id.replace("_pending", "") });

            // create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "multidistance_clamped_point");
            this.pointCollection.add(lastPoint);

            // create last line
            // remove this.moving line entity
            this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.movingPolylines.length = 0;

            // first point for last line
            const firstPoint = this.coords.cache[this.coords.cache.length - 1];
            const lineGeometryInstance = createClampedLineGeometryInstance([firstPoint, this.coordinate], "multidistance_clamped_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);

            // create last label
            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const distance = this.calculateClampedDistance(firstPoint, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
            const { currentLetter, labelNumberIndex } = this.getLabelProperties(this.coordinate, this.coords.cache);
            label.id = generateId(midPoint, "multidistance_clamped_label");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`
            this.labelCollection.add(label);

            // update groups
            this.coords.groups.push([...this.coords.cache]);
            // update total measure count
            this.flags.countMeasure++;

            // total distance label
            const { distances, totalDistance } = this.calculateClampedDistanceFromArray(this.coords.cache);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "multidistance_clamped_total_label");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            this.labelCollection.add(totalLabel);

            // log distance result
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            this.coords._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);
        }

        this.flags.isMultiDistanceClampedEnd = true;
        this.coords.cache.length = 0;
    }

    handleMultiDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.flags.isMultiDistanceClampedEnd) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isClampedPoint = pickedObjects.find(p =>
                p.primitive.id &&
                p.primitive.id.startsWith("annotate_multidistance_clamped_point") &&
                !p.primitive.id.includes("moving")
            );

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isClampedPoint)) return;

            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            // this.flags.isDragMode = true;

            // set the dragging point
            this.interactivePrimitives.draggingPoint = isClampedPoint.primitive;
            this.coords.dragStart = isClampedPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);


            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleMultiDistanceDrag(movement, this.interactivePrimitives.draggingPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleMultiDistanceDrag(movement, pointEntity) {
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            const { linePrimitives, labelPrimitives } = this.getPrimitiveByPointPosition(this.coords.dragStart, "annotate_multidistance_clamped");

            // set relative line and label primitives to no show
            linePrimitives.forEach(p => p.show = false);
            labelPrimitives.forEach(l => l.show = false);

            this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // update point entity to dragging position
            pointEntity.position = cartesian;

            // create moving line primitives
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) {
                console.error("No neighbour positions found");
                return;
            }

            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));

            otherPositions.forEach(pos => {
                // Create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([pos, cartesian], "multidistance_clamped_moving_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                this.interactivePrimitives.movingPolylines.push(addedLinePrimitive);

                // Create label
                const distance = this.calculateClampedDistance(pos, cartesian);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                const labelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                labelPrimitive.id = generateId(midPoint, "multidistance_clamped_moving_label");
                const addedLabelPrimitive = this.labelCollection.add(labelPrimitive);
                this.interactivePrimitives.movingLabels.push(addedLabelPrimitive);
            });
        }
    }

    handleMultiDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.draggingPoint && this.flags.isDragMode) {
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.coords.groups[groupIndex];

            // create and update line and label primitives
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);

            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) {
                console.error("No neighbour positions found");
                return;
            }

            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.startsWith("annotate_multidistance_clamped_label"));

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart =>
                !Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );

            otherPositions.forEach(pos => {
                // Create new line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    [this.coordinate, pos],
                    "multidistance_clamped_line"
                );
                const linePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                const distance = this.calculateClampedDistance(pos, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());

                // Find and update the existing label primitive
                const labelPrimitive = labelPrimitives.find(label =>
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                );
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_clamped_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            });

            // find total distance label by the last point in group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("multidistance_clamped_total_label") &&
                Cesium.Cartesian3.equals(label.position, group[group.length - 1])
            );

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update total distance label
            const { distances, totalDistance } = this.calculateClampedDistanceFromArray(group);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "multidistance_clamped_total_label");
            }

            // update log records
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            this.coords._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);

            // reset dragging primitive and flags
            this.interactivePrimitives.draggingPoint = null;
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Get relevant point primitive, line primitive, and label primitive filtered by the position
     * @param {Cesium.Cartesian3} position 
     * @param {String} startsWithMeasureMode - the string of the id starts with, example "annotation_multi_distance"
     */
    getPrimitiveByPointPosition(position, startsWithMeasureMode) {
        // get point primitive by position
        const pointPrimitive = this.pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith(startsWithMeasureMode) &&
            !p.id.includes("moving") &&
            Cesium.Cartesian3.equals(p.position, position)
        );
        // get line primitives by position
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.geometryInstances &&
            p.geometryInstances.id &&
            p.geometryInstances.id.includes(startsWithMeasureMode) &&
            !p.geometryInstances.id.includes("moving") &&
            p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, position))
        );
        // get label primitives by lines positions
        // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
        const linePositions = linePrimitives.map(p => p.geometryInstances.geometry._positions);
        const midPoints = linePositions.map((positions) => Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3()));
        const labelPrimitives = midPoints.map(midPoint =>
            this.labelCollection._labels.find(l => l.id && l.id.startsWith(startsWithMeasureMode) &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, midPoint)
            )
        ).filter(label => label !== undefined);

        return { pointPrimitive, linePrimitives, labelPrimitives };
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

    /**
     * Interpolates points between two points based on the interval.
     * @param {Cesium.Cartesian3} pointA - the cartesian coordinate of the first point
     * @param {Cesium.Cartesian3} pointB - the cartesian coordinate of the second point
     * @param {Number} interval  - the interval between the two points
     * @returns {Cesium.Cartesian3[]} - the interpolated points
     */
    interpolatePoints(pointA, pointB, interval = 4) {
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

        // return groundCartesianArray;
    }

    /**
     * get the label text properties based on the position and the positions array
     * @param {Cesium.Cartesian3} position 
     * @param {Cesium.Cartesian3[]} positionsArray 
     * @returns {currentLetter: String, labelNumberIndex: Number} - the label text properties
     */
    getLabelProperties(position, positionsArray) {
        const positionIndexInCache = positionsArray.findIndex(cart => Cesium.Cartesian3.equals(cart, position));

        // cache length - 1 is the index
        const labelIndex = positionIndexInCache - 1;
        // index 0 means alphabet 'a' 
        const currentLetter = String.fromCharCode(97 + labelIndex % 26);
        // label number index
        const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, position)));
        const labelNumberIndex = groupIndex !== -1 ? groupIndex : this.flags.countMeasure;

        return {
            currentLetter,
            labelNumberIndex
        }
    }

    /**
     * calculate the clamped distance between two points
     * @param {Cesium.Cartesian3} pointA 
     * @param {Cesium.Cartesian3} pointB 
     * @returns {Number} - the clamped distance between two points
     */
    calculateClampedDistance(pointA, pointB) {
        const pickedCartesianArray = this._computeDetailedPickPositions(pointA, pointB);
        let distance = null;
        for (let i = 0; i < pickedCartesianArray.length - 1; i++) {
            distance += calculateDistance(pickedCartesianArray[i], pickedCartesianArray[i + 1]);
        }
        return distance
    }

    /**
     * calculate the distances between each point in the cartesianArray and the total distance
     * @param {Cesium.Cartesian3[]} cartesianArray 
     * @returns {distances: Number[], totalDistance: Number} - the distances between each point and the total distance
     */
    calculateClampedDistanceFromArray(cartesianArray) {
        let distances = [];
        for (let i = 0; i < cartesianArray.length - 1; i++) {
            const distance = this.calculateClampedDistance(cartesianArray[i], cartesianArray[i + 1]);
            distances.push(distance);
        }
        const totalDistance = distances.reduce((a, b) => a + b, 0);
        return { distances, totalDistance }
    }

    /**
     * get the type of the Cesium picked object
     * @param {*} pickedObject - viewer.scene.pick
     * @returns {String} - the type of the picked object
     */
    getPickedObjectType(pickedObject) {
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.startsWith("annotate") && !pickedObject.id.includes("moving")) {
            if (pickedObject.id.includes("point")) {
                return "point"
            } else if (pickedObject.id.includes("line")) {
                return "line"
            } else if (pickedObject.id.includes("label")) {
                return "label"
            } else {
                return "other"
            }
        }
    }

    resetValue() {
        this.coordinate = new Cesium.Cartesian3();

        this.pointerOverlay.style.display = 'none';

        this.coords._distanceRecords = [];
        // this.label._labelNumberIndex = 0;
        // this.label._labelIndex = 0;

        this.coords.cache = [];

        this.flags.isMultiDistanceClampedEnd = false;
        this.flags.isDragMode = false;

        this.interactivePrimitives.draggingPoint = null;
        this.coords.dragStart = null;

        // remove moving primitives
        this.interactivePrimitives.movingPolylines.forEach(p => this.viewer.scene.primitives.remove(p));
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(l => this.labelCollection.remove(l));
        this.interactivePrimitives.movingLabels.length = 0;

        // remove pending primitives 
        this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending")).forEach(p => { this.pointCollection.remove(p) });
        this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending")).forEach(p => { this.viewer.scene.primitives.remove(p) });
        this.labelCollection._labels.filter(l => l.id && l.id.includes("pending")).forEach(l => { this.labelCollection.remove(l) });
    }
}
export { MultiDistanceClamped }
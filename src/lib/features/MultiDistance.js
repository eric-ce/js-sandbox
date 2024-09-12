import * as Cesium from "cesium";
import {
    calculateDistance,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLineGeometryInstance,
    createLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId
} from "../helper/helper.js";

class MultiDistance {
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
            isMultiDistanceEnd: false,
            isDragMode: false
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            _distanceCollection: [],
            _distanceRecords: [],
            dragStart: null     // Stores the initial position before a drag begins
        }

        // Label properties
        this.label = {
            _labelIndex: 0,
            _labelNumberIndex: 0
        }

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingLabel: null,      // Label that updates during moving or dragging
            movingLabel1: null,
            movingLabel2: null,
            movingPolyline: null,   // Line that visualizes dragging or moving
            movingPolyline2: null,
            draggingPoint: null,    // Currently dragged point primitive
        };
    }

    /**
     * Sets up input actions for the multi-distance mode.
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
     * Removes input actions for multi-distance mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleMultiDistanceLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // editable label features
        if (this.flags.isMultiDistanceEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label primitive, make it editable
            const isAnnotateLabel = pickedObject?.id?.startsWith("annotate") && pickedObject?.id?.includes("label");
            if (isAnnotateLabel) {
                editableLabel(this.viewer.container, pickedObject.primitive);
                return; // Exit the function after making the label editable
            }

            // reset the value
            this.coords._distanceCollection.length = 0;
            this.label._labelIndex = 0;

            this.flags.isMultiDistanceEnd = false;

            // continue point 
            const continuePoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            continuePoint.id = generateId(cartesian, "multidistance_point_pending");
            this.pointCollection.add(continuePoint);

            // update coordinate data cache
            this.coords.cache.push(cartesian);
            return;
        }

        // create point primitive
        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "multidistance_point_pending");
        this.pointCollection.add(point);

        // update coordinate data cache
        this.coords.cache.push(this.coordinate);

        if (this.coords.cache.length > 1) {
            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const lineGeometryInstance = createLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_line_pending");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label entities
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const distance = calculateDistance(prevPointCartesian, currPointCartesian);
            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "multidistance_label_pending");
            // label text
            const currentLetter = String.fromCharCode(97 + this.label._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this.label._labelNumberIndex}: ${formatDistance(distance)}`;
            this.label._labelIndex++;
            this.labelCollection.add(label);

            // update distance collection
            this.coords._distanceCollection.push(distance);
        }
    }

    handleMultiDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.flags.isMultiDistanceEnd) return;

        if (this.coords.cache.length > 0) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const movingLineGeometryInstance = createLineGeometryInstance([lastPointCartesian, this.coordinate], "multidistance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = calculateDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            this.interactivePrimitives.movingLabel = this.labelCollection.add(createLabelPrimitive(lastPointCartesian, this.coordinate, distance));
            this.interactivePrimitives.movingLabel.id = generateId(midPoint, "multidistance_moving_label");
        }
    }

    handleMultiDistanceRightClick(movement) {
        // place last point and place last line
        if (!this.flags.isMultiDistanceEnd && this.coords.cache.length > 0) {
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
            this.coords.groups.push([...this.coords.cache]);

            // update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("pending", "") });
            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending"));
            pendingLines.forEach(p => { p.geometryInstances.id = p.geometryInstances.id.replace("pending", "") });
            // update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l => l.id && l.id.includes("pending"));
            pendingLabels.forEach(l => { l.id = l.id.replace("pending", "") });

            // create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "multidistance_point");
            this.pointCollection.add(lastPoint);

            // create last line
            // remove this.moving line entity
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            // first point for last line
            const firstPoint = this.coords.cache[this.coords.cache.length - 2];
            const lineGeometryInstance = createLineGeometryInstance([firstPoint, this.coordinate], "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);

            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const distance = calculateDistance(firstPoint, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
            label.id = generateId(midPoint, "multidistance_label");
            // label text
            const currentLetter = String.fromCharCode(97 + this.label._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this.label._labelNumberIndex}: ${formatDistance(distance)}`
            this.label._labelIndex++;
            this.label._labelNumberIndex++;

            this.labelCollection.add(label);
            // add last distance to distance collection
            this.coords._distanceCollection.push(distance);

            // total distance label
            const totalDistance = this.coords._distanceCollection.reduce((a, b) => a + b, 0);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "multidistance_total_label");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(80, 10);
            this.labelCollection.add(totalLabel);

            // log distance result
            const distances = []
            distances.push(...this.coords._distanceCollection);
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            this.coords._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);
        }

        this.flags.isMultiDistanceEnd = true;
        this.coords.cache.length = 0;
    }

    handleMultiDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.coords.groups.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_multidistance_point") &&
                    !p.primitive.id.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(pointPrimitive)) {
                console.error("No point primitives found");
                return;
            }

            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            this.flags.isDragMode = true;

            this.interactivePrimitives.draggingPoint = pointPrimitive.primitive;
            this.coords.dragStart = pointPrimitive.primitive.position.clone();

            // remove relative line primitives
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
                p.geometryInstances &&
                p.geometryInstances.id &&
                p.geometryInstances.id.startsWith("annotate_multidistance_line")
            );

            // error handling: if no annotation line primitives found in the scene then early exit
            if (linePrimitives.length === 0) {
                console.error("No line primitives found");
                return;
            }

            linePrimitives.forEach(p => {
                if (p.geometryInstances.geometry._positions.some(cart =>
                    Cesium.Cartesian3.equals(cart, this.coords.dragStart)
                )) {
                    this.viewer.scene.primitives.remove(p);
                }
            });

            // set relative label primitives to no show by dragging point
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);

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
                    label.id && label.id.startsWith("annotate_multidistance_label")
                ) {
                    label.show = false;
                }
            });

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleMultiDistanceDrag(movement, this.interactivePrimitives.draggingPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleMultiDistanceDrag(movement, pointEntity) {
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

        // Create new moving line primitives
        [this.interactivePrimitives.movingPolyline, this.interactivePrimitives.movingPolyline2].forEach(primitive => {
            if (primitive) {
                this.viewer.scene.primitives.remove(primitive);
            }
        });

        if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
            const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            const lineGeometryInstance = createLineGeometryInstance([otherPosition, cartesian], "multidistance_moving_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);

            if (this.interactivePrimitives.movingLabel1) this.labelCollection.remove(this.interactivePrimitives.movingLabel1);
            const distance = calculateDistance(otherPosition, cartesian);
            const midPoint = Cesium.Cartesian3.midpoint(otherPosition, cartesian, new Cesium.Cartesian3());
            this.interactivePrimitives.movingLabel1 = this.labelCollection.add(createLabelPrimitive(otherPosition, cartesian, distance));
            this.interactivePrimitives.movingLabel1.id = generateId(midPoint, "multidistance_moving_label");
        }
        if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            otherPositions.forEach((pos, index) => {
                const lineGeometryInstance = createLineGeometryInstance([pos, cartesian], "multidistance_moving_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
                if (index === 0) this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);
                if (index === 1) this.interactivePrimitives.movingPolyline2 = this.viewer.scene.primitives.add(linePrimitive);

                const distance = calculateDistance(pos, cartesian);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                if (index === 0) {
                    if (this.interactivePrimitives.movingLabel1) this.labelCollection.remove(this.interactivePrimitives.movingLabel1);
                    this.interactivePrimitives.movingLabel1 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.interactivePrimitives.movingLabel1.id = generateId(midPoint, "multidistance_moving_label");
                }
                if (index === 1) {
                    if (this.interactivePrimitives.movingLabel2) this.labelCollection.remove(this.interactivePrimitives.movingLabel2);
                    this.interactivePrimitives.movingLabel2 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.interactivePrimitives.movingLabel2.id = generateId(midPoint, "multidistance_moving_label");
                }
            })
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

            // remove moving line primitives
            [this.interactivePrimitives.movingPolyline, this.interactivePrimitives.movingPolyline2].forEach(primitive => {
                if (primitive) this.viewer.scene.primitives.remove(primitive);
            });

            // set moving label primitives not show
            [this.interactivePrimitives.movingLabel1, this.interactivePrimitives.movingLabel2].forEach(primitive => {
                if (primitive) this.labelCollection.remove(primitive);
            });

            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.startsWith("annotate_multidistance_label"));

            // Create new moving line primitives
            if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
                const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
                // create line primitive
                const lineGeometryInstance = createLineGeometryInstance([this.coordinate, otherPosition], "multidistance_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label primitive
                const distance1 = calculateDistance(otherPosition, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.coordinate, new Cesium.Cartesian3());
                const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = oldLabelText + ": " + formatDistance(distance1);
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            }
            if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
                const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
                otherPositions.forEach((pos) => {
                    // create line primitive
                    const lineGeometryInstance = createLineGeometryInstance([pos, this.coordinate], "multidistance_line");
                    const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitive
                    const distance = calculateDistance(pos, this.coordinate);
                    const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                    const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());
                    const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                    if (labelPrimitive) {
                        const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                        labelPrimitive.text = oldLabelText + ": " + formatDistance(distance);
                        labelPrimitive.id = generateId(newMidPoint, "multidistance_label");
                        labelPrimitive.position = newMidPoint;
                        labelPrimitive.show = true;
                    }
                });
            }

            // find total distance label by the last point in group (not updated)
            const totalLabel = this.labelCollection._labels.find(label => label.id && label.id.startsWith("annotate_multidistance_total_label") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update distance collection
            const distances = [];
            for (let i = 0; i < group.length - 1; i++) {
                const distance = calculateDistance(group[i], group[i + 1]);
                distances.push(distance);
            }
            this.coords._distanceCollection = distances;
            const totalDistance = this.coords._distanceCollection.reduce((a, b) => a + b, 0);

            // update total distance label
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "multidistance_total_label");
            }

            // update log records
            const distanceRecord = {
                distances: this.coords._distanceCollection.map(d => d.toFixed(2)),
                totalDistance: this.coords._distanceCollection.reduce((a, b) => a + b, 0).toFixed(2)
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

    resetValue() {
        this.coordinate = new Cesium.Cartesian3();

        this.pointerOverlay.style.display = 'none';

        this.coords._distanceCollection = [];
        this.coords._distanceRecords = [];
        // this.label._labelNumberIndex = 0;
        this.label._labelIndex = 0;

        this.coords.cache = [];

        this.flags.isMultiDistanceEnd = false;
        this.flags.isDragMode = false;

        this.interactivePrimitives.draggingPoint = null;
        this.coords.dragStart = null;

        // remove moving primitives
        if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
        if (this.interactivePrimitives.movingPolyline2) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline2);
        if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
        if (this.interactivePrimitives.movingLabel1) this.labelCollection.remove(this.interactivePrimitives.movingLabel1);
        if (this.interactivePrimitives.movingLabel2) this.labelCollection.remove(this.interactivePrimitives.movingLabel2);

        // remove pending primitives 
        this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending")).forEach(p => { this.pointCollection.remove(p) });
        this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending")).forEach(p => { this.viewer.scene.primitives.remove(p) });
        this.labelCollection._labels.filter(l => l.id && l.id.includes("pending")).forEach(l => { this.labelCollection.remove(l) });

    }
}
export { MultiDistance }
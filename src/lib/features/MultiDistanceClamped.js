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
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            _distanceRecords: [],
            dragStart: null     // Stores the initial position before a drag begins
        };

        // // Label properties
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
            movingLabel: null,      // Label that updates during moving or dragging
            movingLabel1: null,
            movingLabel2: null,
            movingPolyline: null,   // Line that visualizes dragging or moving
            movingPolyline2: null,
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

        if (this.flags.isMultiDistanceClampedEnd) {
            // editable label features
            // If picked object is a label primitive, make it editable
            const isAnnotateLabel = pickedObject?.id?.startsWith("annotate") && pickedObject?.id?.includes("label");
            if (isAnnotateLabel) {
                editableLabel(this.viewer.container, pickedObject.primitive);
                return; // Exit the function after making the label editable
            }

            // reset the value
            this.flags.isMultiDistanceClampedEnd = false;

            // continue point 
            const continuePoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            continuePoint.id = generateId(cartesian, "multidistance_clamped_point_pending");
            this.pointCollection.add(continuePoint);

            // update coordinate data cache
            this.coords.cache.push(cartesian);
            return;
        }

        // create point primitive
        this.handlePointPrimitiveCreate(pickedObject);

        if (this.coords.cache.length > 1) {
            const positionIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate)); // find the index of the current position

            // if no index means the current position has been removed from the cache by toggle point
            if (positionIndex === -1) return;   // early exit to prevent duplication creation of the line

            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_clamped_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label entities
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
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

    /**
     * handle for the first point primitive creation, if clicked point is existed one then trigger the remove action, otherwise create a new point primitive
     * @param {*} pickedObject - the picked object from the scene
     */
    handlePointPrimitiveCreate(pickedObject) {
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.includes("multidistance_clamped_point")) {
            const pointPrimitive = pickedObject.primitive;
            // remove picked point, and relevant line and labels
            this.removeActionByTogglePoint(pointPrimitive);
        } else {
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "multidistance_clamped_point_pending");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }
    }


    removeActionByTogglePoint(pointPrimitive) {
        const pointPosition = pointPrimitive.position.clone();

        // remove point primitive
        this.pointCollection.remove(pointPrimitive);

        // remove line primitive
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("multidistance_clamped_line"));
        const relativeLinePrimitives = linePrimitives.filter(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, pointPosition)));
        relativeLinePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));

        // remove label primitive
        const labelPrimitives = this.labelCollection._labels.filter(l => l.id && l.id.includes("multidistance_clamped_label"));
        const neighbourPositions = this.findNeighbourPosition(pointPosition, this.coords.cache);
        let midPoints = [];
        if (neighbourPositions.length === 2) {
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[1], new Cesium.Cartesian3());
            midPoints = [midPoint];
        };
        if (neighbourPositions.length === 3) {
            const midPoint1 = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[1], new Cesium.Cartesian3());
            const midPoint2 = Cesium.Cartesian3.midpoint(neighbourPositions[1], neighbourPositions[2], new Cesium.Cartesian3());
            midPoints = [midPoint1, midPoint2];

            // create reconnect line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([neighbourPositions[0], neighbourPositions[2]], "multidistance_clamped_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const distance = this.calculateClampedDistance(neighbourPositions[0], neighbourPositions[2]);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, "multidistance_clamped_label_pending");
            const { currentLetter, labelNumberIndex } = this.getLabelProperties(neighbourPositions[1], this.coords.cache);
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        };

        midPoints.forEach(midPoint => {
            const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
            relativeLabelPrimitives.forEach(l => this.labelCollection.remove(l));
        });

        // update coords cache
        const pointIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
        if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

        // get the point index and the rest value in this.coords.cache
        const followingPositions = this.coords.cache.slice(pointIndex);
        const followingIndex = pointIndex;

        if (followingPositions.length > 0) {
            // get mid points from following positions
            let midPoints = [];
            for (let i = 0; i < followingPositions.length - 1; i++) {
                const midPoint = Cesium.Cartesian3.midpoint(followingPositions[i], followingPositions[i + 1], new Cesium.Cartesian3());
                midPoints.push(midPoint);
            }
            // find the relative label primitives by midpoint
            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.includes("multidistance_clamped_label"));
            // update label text 
            midPoints.forEach((midPoint, index) => {
                const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
                const currentLetter = String.fromCharCode(97 + followingIndex + index % 26);
                const labelNumberIndex = this.coords.groups.length;
                relativeLabelPrimitives.forEach(l => {
                    l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(this.calculateClampedDistance(followingPositions[0], followingPositions[1]))}`;
                });
            });
        }
    }

    handleMultiDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.isMultiDistanceEnd) return;

        if (this.coords.cache.length > 0) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, this.coordinate], "multidistance_clamped_moving_line");
            const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = this.calculateClampedDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            this.interactivePrimitives.movingLabel = this.labelCollection.add(createLabelPrimitive(lastPointCartesian, this.coordinate, distance));
            this.interactivePrimitives.movingLabel.id = generateId(midPoint, "multidistance_clamped_moving_label");
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
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            // first point for last line
            const firstPoint = this.coords.cache[this.coords.cache.length - 1];
            const lineGeometryInstance = createClampedLineGeometryInstance([firstPoint, this.coordinate], "multidistance_clamped_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);

            // create last label
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const distance = this.calculateClampedDistance(firstPoint, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
            const { currentLetter, labelNumberIndex } = this.getLabelProperties(this.coordinate, this.coords.cache);
            label.id = generateId(midPoint, "multidistance_clamped_label");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`
            this.labelCollection.add(label);

            // update groups
            this.coords.groups.push([...this.coords.cache]);

            // total distance label
            const { distances, totalDistance } = this.calculateDistanceFromArray(this.coords.cache);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "multidistance_total_label");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(80, 10);
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
        if (this.coords.groups.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_multidistance_clamped_point") &&
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
                p.geometryInstances.id.startsWith("annotate_multidistance_clamped_line")
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
                    label.id && label.id.startsWith("annotate_multidistance_clamped_label")
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
            // for line
            const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            const lineGeometryInstance = createClampedLineGeometryInstance([otherPosition, cartesian], "multidistance_clamped_moving_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // for label
            const distance = this.calculateClampedDistance(otherPosition, cartesian);
            const midPoint = Cesium.Cartesian3.midpoint(otherPosition, cartesian, new Cesium.Cartesian3());
            if (this.interactivePrimitives.movingLabel1) this.labelCollection.remove(this.interactivePrimitives.movingLabel1);
            this.interactivePrimitives.movingLabel1 = this.labelCollection.add(createLabelPrimitive(otherPosition, cartesian, distance));
            this.interactivePrimitives.movingLabel1.id = generateId(midPoint, "multidistance_clamped_moving_label");
        }
        if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            otherPositions.map((pos, index) => {
                // for line
                const lineGeometryInstance = createClampedLineGeometryInstance([pos, cartesian], "multidistance_clamped_moving_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
                if (index === 0) this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);
                if (index === 1) this.interactivePrimitives.movingPolyline2 = this.viewer.scene.primitives.add(linePrimitive);

                // for label
                const distance = this.calculateClampedDistance(pos, cartesian);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                if (index === 0) {
                    if (this.interactivePrimitives.movingLabel1) this.labelCollection.remove(this.interactivePrimitives.movingLabel1);
                    this.interactivePrimitives.movingLabel1 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.interactivePrimitives.movingLabel1.id = generateId(midPoint, "multidistance_clamped_moving_label");
                }
                if (index === 1) {
                    if (this.interactivePrimitives.movingLabel2) this.labelCollection.remove(this.interactivePrimitives.movingLabel2);
                    this.interactivePrimitives.movingLabel2 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.interactivePrimitives.movingLabel2.id = generateId(midPoint, "multidistance_clamped_moving_label");
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

            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.startsWith("annotate_multidistance_clamped_label"));

            // Create new moving line primitives
            if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
                const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
                // create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([this.coordinate, otherPosition], "multidistance_clamped_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label primitive
                const distance = this.calculateClampedDistance(otherPosition, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.coordinate, new Cesium.Cartesian3());
                const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = oldLabelText + ": " + formatDistance(distance);
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_clamped_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            }
            if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
                const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
                otherPositions.map((pos) => {
                    // create line primitive
                    const lineGeometryInstance = createClampedLineGeometryInstance([pos, this.coordinate], "multidistance_clamped_line");
                    const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitive
                    const distance = this.calculateClampedDistance(pos, this.coordinate);
                    const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                    const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());
                    const labelPrimitive = labelPrimitives.find(label => Cesium.Cartesian3.equals(label.position, oldMidPoint));
                    if (labelPrimitive) {
                        const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                        labelPrimitive.text = oldLabelText + ": " + formatDistance(distance);
                        labelPrimitive.id = generateId(newMidPoint, "multidistance_clamped_label");
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

            // update total distance label
            const { distances, totalDistance } = this.calculateDistanceFromArray(group);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "multidistance_total_label");
            }

            // update log records
            const distanceRecord = {
                distances: distances.map(d => d.toFixed(2)),
                totalDistance: totalDistance.toFixed(2)
            };
            // this.coords._distanceRecords.push(distanceRecord);
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
        // TODO: use another angle from the camera to get points cover by the object and use Set to create a unique array of picked coordinates

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

        // cache length - 2 is the last point index
        const labelIndex = positionIndexInCache - 1;
        // index 0 means alphabet 'a' 
        const currentLetter = String.fromCharCode(97 + labelIndex % 26);
        // label number index
        const labelNumberIndex = this.coords.groups.length;
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
    calculateDistanceFromArray(cartesianArray) {
        let distances = [];
        for (let i = 0; i < cartesianArray.length - 1; i++) {
            const distance = this.calculateClampedDistance(cartesianArray[i], cartesianArray[i + 1]);
            distances.push(distance);
        }
        const totalDistance = distances.reduce((a, b) => a + b, 0);
        return { distances, totalDistance }
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
export { MultiDistanceClamped }
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

        // flags
        this.isMultiDistanceEnd = false;
        this.isDragMode = false;


        // Cesium Primitives
        // point primitive
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        // label primitive
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);
        this.movingLabelPrimitive = null;
        this.movingLabelPrimitive1 = null;
        this.movingLabelPrimitive2 = null;
        // polyline primitive
        this.movingPolylinePrimitive = null;
        this.movingPolylinePrimitive2 = null;

        // dragging feature variables
        this.draggingPrimitive = null;
        this.beforeDragPosition = null;

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];
        // distance
        this._distanceCollection = [];
        this._distanceRecords = [];

        // label text
        this._labelIndex = 0;
        this._labelNumberIndex = 0;
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

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleMultiDistanceLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // editable label features
        if (this.isMultiDistanceEnd) {
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

            this.isMultiDistanceEnd = false;

            this._labelIndex = 0;

            // continue point 
            const continuePoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            continuePoint.id = generateId(cartesian, "multidistance_point");
            this.pointCollection.add(continuePoint);

            // update coordinate data cache
            this.coordinateDataCache.push(cartesian);
            return;
        }

        // create point primitive
        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "multidistance_point");
        this.pointCollection.add(point);

        // update coordinate data cache
        this.coordinateDataCache.push(this.coordinate);

        if (this.coordinateDataCache.length > 1) {
            const prevIndex = this.coordinateDataCache.length - 2;
            const currIndex = this.coordinateDataCache.length - 1;
            const prevPointCartesian = this.coordinateDataCache[prevIndex];
            const currPointCartesian = this.coordinateDataCache[currIndex];

            // create line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const lineGeometryInstance = createLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label entities
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            const distance = calculateDistance(prevPointCartesian, currPointCartesian);
            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "multidistance_label");
            // label text
            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(distance)}`;
            this._labelIndex++;
            this.labelCollection.add(label);

            // update distance collection
            this._distanceCollection.push(distance);
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

        if (this.coordinateDataCache.length > 0) {
            // Calculate the distance between the last selected point and the current cartesian position
            const lastPointCartesian = this.coordinateDataCache[this.coordinateDataCache.length - 1]

            // create line primitive
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const movingLineGeometryInstance = createLineGeometryInstance([lastPointCartesian, this.coordinate], "multidistance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = calculateDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(lastPointCartesian, this.coordinate, distance));
            this.movingLabelPrimitive.id = generateId(midPoint, "multidistance_moving_label");
        }
    }

    handleMultiDistanceRightClick(movement) {
        // place last point and place last line
        if (!this.isMultiDistanceEnd) {
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // update coordinate data cache
            this.coordinateDataCache.push(this.coordinate);
            this.groupCoords.push([...this.coordinateDataCache]);

            // create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "multidistance_point");
            this.pointCollection.add(lastPoint);

            // create last line
            // remove this.moving line entity
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            // first point for last line
            const firstPoint = this.coordinateDataCache[this.coordinateDataCache.length - 2];
            const lineGeometryInstance = createLineGeometryInstance([firstPoint, this.coordinate], "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);

            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            const distance = calculateDistance(firstPoint, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
            label.id = generateId(midPoint, "multidistance_label");
            // label text
            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(distance)}`
            this._labelIndex++;
            this._labelNumberIndex++;

            this.labelCollection.add(label);
            // add last distance to distance collection
            this._distanceCollection.push(distance);

            // total distance label
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "multidistance_total_label");
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
        }

        this.isMultiDistanceEnd = true;
        this.coordinateDataCache.length = 0;
    }

    handleMultiDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.groupCoords.length > 0) {
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
            this.isDragMode = true;

            this.draggingPrimitive = pointPrimitive.primitive;
            this.beforeDragPosition = pointPrimitive.primitive.position.clone();

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
                    label.id && label.id.startsWith("annotate_multidistance_label")
                ) {
                    label.show = false;
                }
            });

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleMultiDistanceDrag(movement, this.draggingPrimitive);
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
        const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
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
            const lineGeometryInstance = createLineGeometryInstance([otherPosition, cartesian], "multidistance_moving_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(linePrimitive);

            if (this.movingLabelPrimitive1) this.labelCollection.remove(this.movingLabelPrimitive1);
            const distance = calculateDistance(otherPosition, cartesian);
            const midPoint = Cesium.Cartesian3.midpoint(otherPosition, cartesian, new Cesium.Cartesian3());
            this.movingLabelPrimitive1 = this.labelCollection.add(createLabelPrimitive(otherPosition, cartesian, distance));
            this.movingLabelPrimitive1.id = generateId(midPoint, "multidistance_moving_label");
        }
        if (neighbourPositions.length === 3) { // [prevPosition, current, nextPosition]
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
            otherPositions.forEach((pos, index) => {
                const lineGeometryInstance = createLineGeometryInstance([pos, cartesian], "multidistance_moving_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
                if (index === 0) this.movingPolylinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                if (index === 1) this.movingPolylinePrimitive2 = this.viewer.scene.primitives.add(linePrimitive);

                const distance = calculateDistance(pos, cartesian);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                if (index === 0) {
                    if (this.movingLabelPrimitive1) this.labelCollection.remove(this.movingLabelPrimitive1);
                    this.movingLabelPrimitive1 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.movingLabelPrimitive1.id = generateId(midPoint, "multidistance_moving_label");
                }
                if (index === 1) {
                    if (this.movingLabelPrimitive2) this.labelCollection.remove(this.movingLabelPrimitive2);
                    this.movingLabelPrimitive2 = this.labelCollection.add(createLabelPrimitive(pos, cartesian, distance));
                    this.movingLabelPrimitive2.id = generateId(midPoint, "multidistance_moving_label");
                }
            })
        }
    }

    handleMultiDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {
            const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.groupCoords[groupIndex];

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
            [this.movingLabelPrimitive1, this.movingLabelPrimitive2].forEach(primitive => {
                if (primitive) this.labelCollection.remove(primitive);
            });

            const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.startsWith("annotate_multidistance_label"));

            // Create new moving line primitives
            if (neighbourPositions.length === 2) { // [prevPosition, current] || [current, nextPosition]
                const otherPosition = neighbourPositions.find(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
                // create line primitive
                const lineGeometryInstance = createLineGeometryInstance([this.coordinate, otherPosition], "multidistance_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label primitive
                const distance1 = calculateDistance(otherPosition, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(otherPosition, this.beforeDragPosition, new Cesium.Cartesian3());
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
                const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
                otherPositions.forEach((pos) => {
                    // create line primitive
                    const lineGeometryInstance = createLineGeometryInstance([pos, this.coordinate], "multidistance_line");
                    const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitive
                    const distance = calculateDistance(pos, this.coordinate);
                    const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.beforeDragPosition, new Cesium.Cartesian3());
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
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition));
            if (positionIndex !== -1) this.groupCoords[groupIndex][positionIndex] = this.coordinate;

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
                totalLabel.id = generateId(group[group.length - 1], "multidistance_total_label");
            }

            // update log records
            const distanceRecord = {
                distances: this._distanceCollection.map(d => d.toFixed(2)),
                totalDistance: this._distanceCollection.reduce((a, b) => a + b, 0).toFixed(2)
            };

            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);

            // reset dragging primitive and flags
            this.draggingPrimitive = null;
            this.isDragMode = false;
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

        this._distanceCollection = [];
        this._distanceRecords = [];
        // this._labelNumberIndex = 0;
        this._labelIndex = 0;

        this.coordinateDataCache = [];

        this.isMultiDistanceEnd = false;
        this.isDragMode = false;

        this.draggingPrimitive = null;
        this.beforeDragPosition = null;
    }
}
export { MultiDistance }
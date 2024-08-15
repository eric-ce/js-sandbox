import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    calculateDistance,
    createDistanceLabel,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createGeometryInstance,
    createLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId
} from "../helper/helper.js";

class MultiDistanceP {
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

        this.movingLabelPrimitive = this.labelCollection.add(
            createLabelPrimitive(Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO, 0)
        );
        this.movingLabelPrimitive.show = false;

        // polyline primitive
        this.movingPolylinePrimitive = null;


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

        // this.handler.setInputAction((movement) => {
        //     this.handleMultiDistanceDragStart(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        // this.handler.setInputAction((movement) => {
        //     this.handleMultiDistanceDragEnd(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleMultiDistanceLeftClick(movement) {
        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (this.isMultiDistanceEnd) {
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

        // use move position for the position
        const cartesian = this.coordinate

        if (!Cesium.defined(cartesian)) return;

        // initialize the measurement, clear all previous measure records
        if (this.isMultiDistanceEnd) {
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
            const lineGeometryInstance = createGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label entities
            if (this.movingLabelPrimitive) {
                this.movingLabelPrimitive.show = false;
            }
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
        // this.viewer.selectedEntity = undefined;
        // this.viewer.trackedEntity = undefined;

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
            const movingLineGeometryInstance = createGeometryInstance([lastPointCartesian, this.coordinate], "multidistance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create label primitive
            const distance = calculateDistance(lastPointCartesian, this.coordinate);
            const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, this.coordinate, new Cesium.Cartesian3());
            const totalDistance =
                this._distanceCollection.reduce((a, b) => a + b, 0) + distance;
            this.movingLabelPrimitive.show = true;
            this.movingLabelPrimitive.position = midPoint;
            this.movingLabelPrimitive.text = `Total: ${formatDistance(totalDistance)}`;
            this.movingLabelPrimitive.id = generateId(midPoint, "multidistance_moving_label");
            this.movingLabelPrimitive.pixelOffset = new Cesium.Cartesian2(80, 10);
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
            this.pointCollection.add(lastPoint);

            // create last line
            // remove this.moving line entity
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            // first point for last line
            const firstPoint = this.coordinateDataCache[this.coordinateDataCache.length - 2];
            const lineGeometryInstance = createGeometryInstance([firstPoint, this.coordinate], "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);

            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            if (this.movingLabelPrimitive) {
                this.movingLabelPrimitive.show = false;
            }
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
            const lastDistance = calculateDistance(firstPoint, cartesian);
            this._distanceCollection.push(lastDistance);

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
                distances: distances,
                totalDistance: totalDistance
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
        if (this.pointEntities.values.length > 1) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const pointObject = pickedObjects.find(p => p.id && p.id.point);

            // If it has picked object, and picked object is point entity
            if (Cesium.defined(pointObject)) {
                this.isDragMode = true;
                // Disable camera movement
                this.viewer.scene.screenSpaceCameraController.enableInputs = false;

                this.draggingEntity = this.viewer.entities.getById(pointObject.id.id);
                this.draggingEntityPosition = this.draggingEntity.position.getValue(Cesium.JulianDate.now());

                // Get the group that contains the dragging entity
                const group = this.groupsEntities.find(pair => pair.includes(this.draggingEntity));

                // Get connected lines
                const dragEntityPosition = this.draggingEntity.position.getValue(Cesium.JulianDate.now());
                const connectedLines = group
                    .filter(entity => entity.polyline)
                    .filter(line => {
                        const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                        return Cesium.Cartesian3.equals(positions[0], dragEntityPosition) || Cesium.Cartesian3.equals(positions[1], dragEntityPosition);
                    });

                // Get connected labels
                const connectedMidpoints = connectedLines.map(line => {
                    const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                    return Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3());
                });

                const connectedLabels = group
                    .filter(entity => entity.label)
                    .filter(label => {
                        const position = label.position.getValue(Cesium.JulianDate.now());
                        return connectedMidpoints.some(midpoint => Cesium.Cartesian3.equals(position, midpoint));
                    });

                // Set move event for dragging
                this.handler.setInputAction((movement) => {
                    this.handleMultiDistanceDrag(movement, this.draggingEntity, dragEntityPosition, connectedLines, connectedLabels);
                }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            }
        };
    }

    handleMultiDistanceDrag(movement, pointEntity, pointEntityPosition, connectedLines, connectedLabels) {

        this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update point entity to dragging position
        pointEntity.position = cartesian;

        // update connected lines and labels
        connectedLines.forEach((line, index) => {
            const positions = line.polyline.positions.getValue(Cesium.JulianDate.now()); // [cartesian, cartesian]
            const filteredPositions = positions.filter(position => !Cesium.Cartesian3.equals(position, pointEntityPosition));
            const newPositions = [...filteredPositions, cartesian];

            // Hide the original line
            line.polyline.show = false;

            // Create and add new moving line entity
            const newLine = createLineEntity(newPositions, Cesium.Color.ORANGE);
            newLine.polyline.positions = new Cesium.CallbackProperty(() => newPositions, false);
            if (this.draggingMovingLineEntities[index]) {
                this.removeEntity(this.draggingMovingLineEntities[index]);
            }
            this.draggingMovingLineEntities[index] = this.viewer.entities.add(newLine);

            // Calculate distance and create new label
            const distance = calculateDistance(newPositions[0], newPositions[1]);
            const newLabel = createDistanceLabel(newPositions[0], newPositions[1], distance);

            // Extract the current letter from the original label text
            const currentLabelText = connectedLabels[index].label.text.getValue(Cesium.JulianDate.now());
            const currentLetter = currentLabelText.split(":")[0];

            // Update label text with current letter
            newLabel.label.text = `${currentLetter}: ${formatDistance(distance)}`;

            // Hide the original label
            connectedLabels[index].label.show = false;

            // Remove and add new moving label entity
            if (this.draggingMovingLabelEntities[index]) {
                this.removeEntity(this.draggingMovingLabelEntities[index]);
            }
            this.draggingMovingLabelEntities[index] = this.viewer.entities.add(newLabel);
        });
    }

    handleMultiDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.draggingEntity && this.isDragMode) {
            // Get the group that contains the dragging entity 
            const group = this.groupsEntities.find(pair => pair.includes(this.draggingEntity));

            // Get connected lines
            const dragEntityPosition = this.draggingEntityPosition

            const lines = group.filter(entity => entity.polyline);

            const connectedLines = lines.filter(line => {
                const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());

                return Cesium.Cartesian3.equals(positions[0], dragEntityPosition) || Cesium.Cartesian3.equals(positions[1], dragEntityPosition);
            });

            // Get connected labels
            const connectedMidpoints = connectedLines.map(line => {
                const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                return Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3());
            });

            const connectedLabels = group
                .filter(entity => entity.label)
                .filter(label => {
                    const position = label.position.getValue(Cesium.JulianDate.now());
                    return connectedMidpoints.some(midpoint => Cesium.Cartesian3.equals(position, midpoint));
                });

            // update connected labes with draggingMovingLabelEntities for its positions and text
            connectedLabels.forEach((label, index) => {
                // get the position of the draggingMovingLabelEntities
                label.label.show = true;
                const position = this.draggingMovingLabelEntities[index].position.getValue(Cesium.JulianDate.now());
                label.position = new Cesium.CallbackProperty(() => {
                    return position;
                }, false);
                const text = this.draggingMovingLabelEntities[index].label.text.getValue(Cesium.JulianDate.now());
                label.label.text = text;
            });


            // update connected lines with draggingMovingLineEntities for its positions
            connectedLines.forEach((line, index) => {
                // get the position of the draggingMovingLineEntities
                line.polyline.show = true;
                // update the viewer entities for the connected lines
                const positions = this.draggingMovingLineEntities[index].polyline.positions.getValue(Cesium.JulianDate.now());

                line.polyline.positions = new Cesium.CallbackProperty(() => {
                    return positions;
                }, false);
            });

            // Update the distance collection
            this._distanceCollection = lines.map((line) => {
                const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                return calculateDistance(positions[0], positions[1]);
            });
            // Update the total distance label text
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            const totalLabelEntity = group.find(entity => entity.label && entity.label.text.getValue(Cesium.JulianDate.now()).includes("Total"));
            totalLabelEntity.label.text = `Total: ${formatDistance(totalDistance)}`;
            // Update the total distance label position
            const points = group.filter(entity => entity.point);
            const lastPoint = points[points.length - 1].position.getValue(Cesium.JulianDate.now());
            totalLabelEntity.position = new Cesium.CallbackProperty(() => {
                return lastPoint;
            }, false);

            // update log records
            const distanceRecord = {
                distances: this._distanceCollection,
                totalDistance: totalDistance
            };
            this._distanceRecords.push(distanceRecord);
            this.logRecordsCallback(distanceRecord);

            // reset dragging variables
            this.draggingEntity = null;
            this.draggingEntityPosition = null;
            this.draggingMovingLineEntities.forEach(entity => {
                this.removeEntity(entity);
            });
            this.draggingMovingLabelEntities.forEach(entity => {
                this.removeEntity(entity);
            }
            );
            this.draggingMovingLineEntities = [];
            this.draggingMovingLabelEntities = [];
            // reset dragging mode
            this.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
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
        this.movingLabelEntity = null;
        this.movingLineEntity = null;

        this.coordinate = new Cesium.Cartesian3();

        this._distanceCollection = [];
        this._distanceRecords = [];
        this._labelNumberIndex = 0;

        this.isMultiDistanceEnd = false;
        this.isDragMode = false;

        this.draggingEntity = null;
        this.beforeDragEntity = null;
        this.draggingMovingLineEntities = [];
        this.draggingMovingLabelEntities = [];
        this.entitiesArray = [];
        this.groupsEntities = [];

        // this._labelIndex = 0;
    }
}
export { MultiDistanceP }
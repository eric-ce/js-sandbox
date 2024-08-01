import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    calculateDistance,
    createDistanceLabel,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay
} from "../helper/helper.js";

class MultiDistance {
    /**
     * Creates a new MultiDistance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     */
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.isMultiDistanceEnd = false;
        this.isDragMode = false;

        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();
        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();
        this.draggingEntity = new Cesium.Entity();
        this.draggingMovingLineEntity1 = new Cesium.Entity();
        this.draggingMovingLineEntity2 = new Cesium.Entity();
        this.draggingMovingLabelEntity1 = new Cesium.Entity();
        this.draggingMovingLabelEntity2 = new Cesium.Entity();

        this.entitiesArray = [];
        this.groupsEntities = [];

        this.coordinate = new Cesium.Cartesian3();

        this._distanceCollection = [];
        this._distanceRecords = [];
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

            this._labelIndex = 0;
            this.entitiesArray.length = 0;
            return;
        }

        // create point entity
        const pointEntity = this.viewer.entities.add(
            createPointEntity(cartesian, Cesium.Color.RED)
        );
        this.pointEntities.add(pointEntity);

        this.entitiesArray.push(pointEntity);  // group entities

        if (this.pointEntities.values.length > 1) {
            const prevIndex = this.pointEntities.values.length - 2;
            const currIndex = this.pointEntities.values.length - 1;
            const prevPointCartesian = this.pointEntities.values[prevIndex].position.getValue(Cesium.JulianDate.now());
            const currPointCartesian = this.pointEntities.values[currIndex].position.getValue(Cesium.JulianDate.now());

            // create line entities
            const line = createLineEntity([prevPointCartesian, currPointCartesian], Cesium.Color.ORANGE)
            line.polyline.positions = new Cesium.CallbackProperty(() => {
                return [prevPointCartesian, currPointCartesian];
            }, false);
            const lineEntity = this.viewer.entities.add(line);
            this.lineEntities.add(lineEntity);

            // create label entities
            const distance = calculateDistance(prevPointCartesian, currPointCartesian);
            this._distanceCollection.push(distance);
            const label = createDistanceLabel(prevPointCartesian, currPointCartesian, distance)

            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            label.label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(distance)}`;
            this._labelIndex++;

            const labelEntity = this.viewer.entities.add(label);
            this.labelEntities.add(labelEntity);

            this.entitiesArray.push(lineEntity, labelEntity);  // group entities
        }
    }

    handleMultiDistanceMouseMove(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

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

            const movingLine = createLineEntity([lastPointCartesian, cartesian], Cesium.Color.YELLOW)

            movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
                return [lastPointCartesian, cartesian];
            }, false);
            this.movingLineEntity = this.viewer.entities.add(
                movingLine
            );
        }
    }

    handleMultiDistanceRightClick(movement) {
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // place last point and place last line
        if (!this.isMultiDistanceEnd) {
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // create last point
            const lastPoint = this.viewer.entities.add(createPointEntity(cartesian, Cesium.Color.RED))
            this.pointEntities.add(lastPoint);

            // create last line
            // remove this.moving line entity
            if (this.movingLineEntity) {
                this.removeEntity(this.movingLineEntity);
            }

            // first point for last line
            const firstPoint = this.pointEntities.values[this.pointEntities.values.length - 2].position.getValue(Cesium.JulianDate.now());

            const lastLine = createLineEntity([firstPoint, cartesian], Cesium.Color.ORANGE);
            const lastLinePositions = new Cesium.CallbackProperty(() => {
                return [firstPoint, cartesian];
            }, false);
            lastLine.polyline.positions = lastLinePositions;
            const lastLineEntity = this.viewer.entities.add(lastLine);
            this.lineEntities.add(lastLine);

            // create last label
            const lastDistance = calculateDistance(firstPoint, cartesian);
            this._distanceCollection.push(lastDistance);

            const lastLabel = this.viewer.entities.add(
                createDistanceLabel(firstPoint, cartesian, lastDistance)
            );

            const currentLetter = String.fromCharCode(97 + this._labelIndex % 26); // 97 is ASCII code for 'a'
            lastLabel.label.text = `${currentLetter}${this._labelNumberIndex}: ${formatDistance(lastDistance)}`;
            this._labelIndex++;
            this.labelEntities.add(lastLabel);

            this._labelNumberIndex++;

            // remove moving line and moving label
            if (this.movingLineEntity) {
                this.removeEntity(this.movingLabelEntity)
            }
            // place total distance label
            const totalDistance = this._distanceCollection.reduce((a, b) => a + b, 0);
            this.viewer.entities.remove(this.movingLabelEntity);
            this.movingLabelEntity = this.viewer.entities.add(createDistanceLabel(cartesian, cartesian, 0));
            this.movingLabelEntity.label.text = `Total: ${formatDistance(totalDistance)}`;
            this.movingLabelEntity.label.pixelOffset = new Cesium.Cartesian2(80, 10);
            this.labelEntities.add(this.movingLabelEntity);

            // group entities: record the whole process of the all entities
            this.entitiesArray.push(lastPoint, lastLineEntity, lastLabel);
            this.groupsEntities.push([...this.entitiesArray]);

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
    }

    handleMultiDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.pointEntities.values.length > 1) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // if it has picked object, and picked object is point entity
            if (pickedObject && pickedObject.id && pickedObject.id.point) {
                this.isDragMode = true;
                // disable camera movement
                this.viewer.scene.screenSpaceCameraController.enableInputs = false;

                this.draggingEntity = this.viewer.entities.getById(pickedObject.id.id);

                // update lines
                // get the lines that connected to the dragging point
                const group = this.groupsEntities.find(pair => pair.includes(this.draggingEntity));
                // use shared dragging point entity position to find out connected lines and labels
                // connected lines to the dragging point
                const lineEntities = group.filter(entity => entity.polyline);
                const connectedLines = lineEntities.filter(line => {
                    const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                    const dragEntityPosition = this.draggingEntity.position.getValue(Cesium.JulianDate.now());
                    return Cesium.Cartesian3.equals(positions[0], dragEntityPosition) || Cesium.Cartesian3.equals(positions[1], dragEntityPosition)
                });
                connectedLines[0].polyline.show = false;


                // update labels
                // use connected lines to find out connected midpoints that is aligned with createLabelEntity's position
                const connectedMidpoints = connectedLines.map(line => {
                    const positions = line.polyline.positions.getValue(Cesium.JulianDate.now());
                    return Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3());
                });
                // connected labels to the dragging point
                const labelEntities = group.filter(entity => entity.label);
                const connectedLabels = labelEntities.filter(label => {
                    const position = label.position.getValue(Cesium.JulianDate.now());
                    return Cesium.Cartesian3.equals(position, connectedMidpoints[0]) || Cesium.Cartesian3.equals(position, connectedMidpoints[1]);
                });

                // dragg point entity position
                const dragEntityPosition = this.draggingEntity.position.getValue(Cesium.JulianDate.now());
                // set move event for dragging
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

        // update connected lines
        const filteredConnectedLinePositions = connectedLines.map(line => {
            const positions = line.polyline.positions.getValue(Cesium.JulianDate.now()); // [cartesian, cartesian]
            const filterPosition = positions.filter(position => !Cesium.Cartesian3.equals(position, pointEntityPosition));
            return [...filterPosition, cartesian];
        });

        // set the existed lines show false
        connectedLines.forEach(line => {
            line.polyline.show = false;
        });

        // create dragging moving line entity
        filteredConnectedLinePositions.forEach((positions, index) => {
            const line = createLineEntity(positions, Cesium.Color.ORANGE);
            line.polyline.positions = new Cesium.CallbackProperty(() => {
                return positions;
            }, false);
            if (index === 0) {
                if (this.draggingMovingLineEntity1) {
                    this.removeEntity(this.draggingMovingLineEntity1)
                }
                this.draggingMovingLineEntity1 = this.viewer.entities.add(line);
            } else {
                if (this.draggingMovingLineEntity2) {
                    this.removeEntity(this.draggingMovingLineEntity2)
                }
                this.draggingMovingLineEntity2 = this.viewer.entities.add(line);
            }
        });

        // update connected labels
        connectedLabels.forEach((labelEntity, labelIndex) => {
            labelEntity.label.show = false;

            // Extract the current letter from the original label text
            const getCurrentLabelText = labelEntity.label.text.getValue(Cesium.JulianDate.now());
            const currentLetter = getCurrentLabelText.split(":")[0];

            // Create new moving labels while dragging
            filteredConnectedLinePositions.forEach((positions, index) => {
                const distance = calculateDistance(positions[0], positions[1]);
                const label = createDistanceLabel(positions[0], positions[1], distance);

                // Apply the correct letter to the new label
                label.label.text = `${currentLetter}: ${formatDistance(distance)}`;

                if (index === 0) {
                    if (this.draggingMovingLabelEntity1) {
                        this.removeEntity(this.draggingMovingLabelEntity1);
                    }
                    this.draggingMovingLabelEntity1 = this.viewer.entities.add(label);
                } else {
                    if (this.draggingMovingLabelEntity2) {
                        this.removeEntity(this.draggingMovingLabelEntity2);
                    }
                    this.draggingMovingLabelEntity2 = this.viewer.entities.add(label);
                }
            });
        });

    }

    handleMultiDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.draggingEntity && this.isDragMode) {

        }

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.isDragMode = false;
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

        // this._labelIndex = 0;
    }
}
export { MultiDistance }
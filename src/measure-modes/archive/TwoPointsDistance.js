import * as Cesium from "cesium";
import {
    createPointEntity,
    calculateDistance,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    formatDistance,
    createGeometryInstance,
    createLinePrimitive,
    generateId,
} from "../helper/cesiumHelper.js";


/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class TwoPointsDistance {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        // Cesium Entities
        this.movingLabelEntity = new Cesium.Entity();
        this.draggingEntity = new Cesium.Entity();

        // Cesium Primitives
        this.movingPolylinePrimitive = null;

        // Coordinate Data
        this.coordinate = new Cesium.Cartesian3();
        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];

        // log
        this._distanceRecords = [];

        // flags
        this.isDistanceStarted = false;
        this.isDragMode = false;

        // dragging properties
        this.beforeDragPosition = new Cesium.Cartesian3();
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleDistanceLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleDistanceDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleDistanceDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleDistanceLeftClick(movement) {
        // Clear any previously selected entity
        this.viewer.selectedEntity = undefined;
        this.viewer.trackedEntity = undefined;

        // Check if the measurement has started
        // if pick the label entity, make the label entity editable
        if (!this.isDistanceStarted) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label entity, make it editable
            if (Cesium.defined(pickedObject) && pickedObject.id?.label) {
                editableLabel(this.viewer.container, pickedObject.id.label);
                return; // Exit the function after making the label editable
            }

            // Set flag that the measurement has started
            this.isDistanceStarted = true;
        }

        // if it is not label entity, then start to draw the measurement
        // use mouse move position to control only one pickPosition is used
        const cartesian = this.coordinate;
        // early exit if not cartesian
        if (!Cesium.defined(cartesian)) return;

        if (this.coordinateDataCache.length === 0) {
            // if there is no point entity, create the first point
            this.coordinateDataCache.push(cartesian);

            const firstPoint = createPointEntity(this.coordinate, Cesium.Color.RED);
            firstPoint.id = generateId(this.coordinate, "distance_point");
            this.viewer.entities.add(firstPoint);
        } else if (this.coordinateDataCache.length % 2 !== 0) {
            // if there is one point entity, create the second point
            this.coordinateDataCache.push(cartesian);

            const secondPoint = createPointEntity(this.coordinate, Cesium.Color.RED);
            secondPoint.id = generateId(this.coordinate, "distance_point");
            this.viewer.entities.add(secondPoint);

            if (this.coordinateDataCache.length === 2) {
                // create line for the first and second point
                if (this.movingPolylinePrimitive) {
                    this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
                }

                const lineGeometryInstance = createGeometryInstance(this.coordinateDataCache, "distance_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label
                if (this.movingLabelEntity) {
                    this.removeEntity(this.movingLabelEntity);
                }
                const distance = calculateDistance(this.coordinateDataCache[0], this.coordinateDataCache[1]);
                const label = createDistanceLabel(this.coordinateDataCache[0], this.coordinateDataCache[1], distance);
                const midpoint = Cesium.Cartesian3.midpoint(this.coordinateDataCache[0], this.coordinateDataCache[1], new Cesium.Cartesian3());
                label.id = generateId(midpoint, "distance_label");
                this.viewer.entities.add(label);

                // log distance
                this._distanceRecords.push(distance);
                this.logRecordsCallback(distance);
                this.groupCoords.push([...this.coordinateDataCache]);

                // set flag that the measurement has ended
                this.isDistanceStarted = false;
            }
        } else {
            this.coordinateDataCache.length = 0;

            // create the first point, so it won't interupt to restart the measurement
            // without this could cause click twice to restart the measurement
            const continuePoint = createPointEntity(this.coordinate, Cesium.Color.RED);
            continuePoint.id = generateId(this.coordinate, "distance_point");
            this.viewer.entities.add(continuePoint);

            this.coordinateDataCache.push(this.coordinate);
        }

    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coordinateDataCache.length > 0 && this.coordinateDataCache.length < 2) {

            // create moving line entity
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const firstCoordsCartesian = this.coordinateDataCache[0];

            const movingLineGeometryInstance = createGeometryInstance([firstCoordsCartesian, this.coordinate], "distance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create distance label
            if (this.movingLabelEntity) {
                this.removeEntity(this.movingLabelEntity);
            }
            const distance = calculateDistance(
                firstCoordsCartesian,
                cartesian
            );
            const label = createDistanceLabel(
                firstCoordsCartesian,
                cartesian,
                distance
            );
            const midpoint = Cesium.Cartesian3.midpoint(firstCoordsCartesian, this.coordinate, new Cesium.Cartesian3());
            label.id = generateId(midpoint, "distance_moving_label");
            this.movingLabelEntity = this.viewer.entities.add(label);
        }
    }

    handleDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.coordinateDataCache.length > 1) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pickedPoint = pickedObjects.find(p => p.id && p.id?.id?.startsWith("annotate_distance") && p.id.point);
            if (Cesium.defined(pickedPoint)) {
                // disable camera movement
                this.viewer.scene.screenSpaceCameraController.enableInputs = false;
                // set drag flag
                this.isDragMode = true;

                this.draggingEntity = this.viewer.entities.getById(pickedPoint.id.id);
                // clone the static position for the dragging entity
                const draggingEntityPosition = this.draggingEntity.position.getValue(Cesium.JulianDate.now());
                this.beforeDragPosition = Cesium.Cartesian3.clone(draggingEntityPosition);

                // find the relative line primitive to the dragging point
                const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_distance_line"));
                let linePrimitive = null;
                if (linePrimitives.length > 0) {
                    linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                    // set the relative line primitive to no show
                    linePrimitive ? linePrimitive.show = false : console.error("No specific line primitives found");
                } else {
                    console.error("No line primitives found");
                    return;
                }

                // find the relative label entity to the dragging point 
                const linePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]
                const midpoint = Cesium.Cartesian3.midpoint(linePrimitivePosition[0], linePrimitivePosition[1], new Cesium.Cartesian3());
                const labelEntities = this.viewer.entities.values.filter(e => e.label && e.id && e.id.startsWith("annotate_distance_label"));
                const targetLabelEntity = labelEntities.find(e => e.position && Cesium.Cartesian3.equals(e.position.getValue(Cesium.JulianDate.now()), midpoint));
                targetLabelEntity.label.show = false;

                // set move event for dragging
                this.handler.setInputAction((movement) => {
                    this.handleDistanceDrag(movement, this.draggingEntity, this.beforeDragPosition);
                }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            }
        }
    };

    handleDistanceDrag(movement, pointEntity, pointEntityPosition) {
        this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update point entity to dragging position
        pointEntity.position.setValue(cartesian);

        // identify the group of coordinates that contains the dragging position
        const group = this.groupCoords.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, pointEntityPosition)));
        const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, pointEntityPosition));

        // update moving line primitive by remove the old one and create a new one
        if (this.movingPolylinePrimitive) {
            this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
        }
        const movingLineGeometryInstance = createGeometryInstance([otherPointCoords, this.coordinate], "distance_drag_moving_line");
        const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW);

        this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

        // update moving label entity
        this.movingLabelEntity && this.removeEntity(this.movingLabelEntity);
        const distance = calculateDistance(
            otherPointCoords,
            this.coordinate,
        );
        const label = createDistanceLabel(
            otherPointCoords,
            this.coordinate,
            distance
        );
        const midpoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
        label.id = generateId(midpoint, "distance_moving_label");
        this.movingLabelEntity = this.viewer.entities.add(label);
    }

    handleDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingEntity && this.isDragMode) {
            // update the group coordinates by replace the new set of coordinates
            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_distance_line"));
            if (linePrimitives.length > 0) {
                const linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                const targetLinePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]

                // update the this.groupCoords with the new drag end positions, 2 points coordinates
                const group = this.groupCoords.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.beforeDragPosition));
                const newCoords = [otherPointCoords, this.coordinate];
                const index = this.groupCoords.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
                this.groupCoords[index] = newCoords;

                // update the line primitive by remove the old one and create a new one
                if (this.movingPolylinePrimitive) {
                    this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
                }
                if (linePrimitive) {
                    this.viewer.scene.primitives.remove(linePrimitive);
                }
                // create new line primitive
                const lineGeometryInstance = createGeometryInstance(newCoords, "distance_line");
                const newlinePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN);
                this.viewer.scene.primitives.add(newlinePrimitive);

                // update the distance label
                const labelEntities = this.viewer.entities.values.filter(e => e.label);
                const targetLabelEntity = labelEntities.find(e => e.position && Cesium.Cartesian3.equals(e.position.getValue(Cesium.JulianDate.now()), Cesium.Cartesian3.midpoint(targetLinePrimitivePosition[0], targetLinePrimitivePosition[1], new Cesium.Cartesian3())));

                const distance = calculateDistance(newCoords[0], newCoords[1]);
                const midpoint = Cesium.Cartesian3.midpoint(newCoords[0], newCoords[1], new Cesium.Cartesian3());

                if (this.movingLabelEntity) {
                    this.removeEntity(this.movingLabelEntity);
                }
                targetLabelEntity.label.show = true;
                targetLabelEntity.label.text = "Total: " + formatDistance(distance);
                targetLabelEntity.position = new Cesium.CallbackProperty(() => midpoint, false);

                // log distance
                this.logRecordsCallback(distance);
            } else {
                console.error("No line primitives found");
                return;
            }
        }
        // reset dragging entity
        this.draggingEntity = null;
        this.isDragMode = false;

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };

    /**
     * Removes single entity
     * @param {Cesium.Entity} entityOrCollection - The entity or entity collection to remove
     */
    removeEntity(entity) {
        this.viewer.entities.remove(entity);
        entity = null;
    }

    resetValue() {
        this.removeEntity(this.movingLabelEntity);

        this.coordinate = null;

        this.isDistanceStarted = false;
        this.isDragMode = false;

        this.movingPolylinePrimitive = null;
        this.beforeDragPosition = null;
    }
}

export { TwoPointsDistance };
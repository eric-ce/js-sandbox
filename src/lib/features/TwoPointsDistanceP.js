import * as Cesium from "cesium";
import {
    calculateDistance,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    createLinePrimitive,
    createGeometryInstance,
    generateId,
    formatDistance,
} from "../helper/helper.js";


/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class TwoPointsDistanceP {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        // cesium entities
        this.labelEntities = new Cesium.EntityCollection();
        this.movingLabelEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.isDistanceStarted = false;
        this.isDragMode = false;

        // cesium primitives
        this.pointPrimitive = new Cesium.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointPrimitive);

        this.movingPolylinePrimitive = null;
        this.draggingPrimitive = null;
        this.beforeDragPosition = null;

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];
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

        // use cache to store only two coordinates, if more than two, reset the cache
        if (this.coordinateDataCache.length === 0) {
            // create the first point
            this.coordinateDataCache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point");
            this.pointPrimitive.add(point);
        } else if (this.coordinateDataCache.length % 2 !== 0) {
            // create the second point
            this.coordinateDataCache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point");
            this.pointPrimitive.add(point);

            // create line and label
            if (this.coordinateDataCache.length === 2) {
                // create line
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
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);

                // log distance
                this.logRecordsCallback(distance);
                // records cache to track all coords, use shallow copy the cache
                this.groupCoords.push([...this.coordinateDataCache]);

                // set flag that the measurement has ended
                this.isDistanceStarted = false;
            }

        } else {
            this.coordinateDataCache.length = 0;
            // add a continue point to the cache so it doesn't need to click twice to start again
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point");
            this.pointPrimitive.add(point);

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
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const firstCoordsCartesian = this.coordinateDataCache[0];

            const movingLineGeometryInstance = createGeometryInstance([firstCoordsCartesian, this.coordinate], "distance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create distance label
            this.movingLabelEntity && this.removeEntity(this.movingLabelEntity);
            const distance = calculateDistance(
                firstCoordsCartesian,
                cartesian
            );
            const label = createDistanceLabel(
                firstCoordsCartesian,
                cartesian,
                distance
            );
            this.movingLabelEntity = this.viewer.entities.add(label);
        }

    }

    handleDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.coordinateDataCache.length > 1) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => p.primitive && p.primitive instanceof Cesium.PointPrimitive && p.primitive.id && p.primitive.id.startsWith("annotate_distance_point"));

            if (Cesium.defined(pointPrimitive)) {
                // disable camera movement
                this.viewer.scene.screenSpaceCameraController.enableInputs = false;
                this.isDragMode = true;
                this.draggingPrimitive = pointPrimitive.primitive;
                this.beforeDragPosition = pointPrimitive.primitive.position.clone();

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
                const labelEntities = this.viewer.entities.values.filter(e => e.label);
                const targetLabelEntity = labelEntities.find(e => e.position && Cesium.Cartesian3.equals(e.position.getValue(Cesium.JulianDate.now()), midpoint));
                targetLabelEntity.label.show = false;

                // set move event for dragging
                this.handler.setInputAction((movement) => {
                    this.handleDistanceDrag(movement, this.draggingPrimitive, this.beforeDragPosition);
                }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

            }
        }
    };

    handleDistanceDrag(movement, pointPrimitive, pointPrimitivePosition) {
        this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update point primitive to dragging position
        pointPrimitive.position = cartesian;

        // identify the group of coordinates that contains the dragging position
        const group = this.groupCoords.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, pointPrimitivePosition)));
        const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, pointPrimitivePosition));

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
        this.movingLabelEntity = this.viewer.entities.add(label);
    }

    handleDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {

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

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging entity
        this.draggingPrimitive = null;
        this.isDragMode = false;
    };

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
        this.labelEntities.removeAll();

        this.removeEntity(this.movingLabelEntity);

        this.coordinate = null;

        this.isDistanceStarted = false;
        this.isDragMode = false;

        this.movingPolylinePrimitive = null;
        this.draggingPrimitive = null;
        this.beforeDragPosition = null;
    }
}

export { TwoPointsDistanceP };
import * as Cesium from "cesium";
import {
    createPointEntity,
    createLineEntity,
    calculateDistance,
    createDistanceLabel,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    createLinePrimitive,
    createGeometryInstance,
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

        this.groupsEntities = [];
        this.pointEntities = new Cesium.EntityCollection();
        this.lineEntities = new Cesium.EntityCollection();
        this.labelEntities = new Cesium.EntityCollection();

        this.movingLineEntity = new Cesium.Entity();
        this.movingLabelEntity = new Cesium.Entity();
        this.draggingEntity = new Cesium.Entity();

        this.coordinate = new Cesium.Cartesian3();

        this._distanceRecords = [];

        this.isDistanceStarted = false;
        this.isDragMode = false;

        // primitive
        this.pointPrimitive = new Cesium.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointPrimitive);

        this.movingPolylinePrimitive = null;

        this.coordinateDataCache = [];
        // all the click coordinates here 
        this.groupCoords = []

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

        // this.handler.setInputAction((movement) => {
        //     this.handleDistanceDragStart(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        // this.handler.setInputAction((movement) => {
        //     this.handleDistanceDragEnd(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_UP);
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
            this.pointPrimitive.add(point);
        } else if (this.coordinateDataCache.length % 2 !== 0) {
            // create the second point
            this.coordinateDataCache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            this.pointPrimitive.add(point);

            // create line and label
            if (this.coordinateDataCache.length === 2) {
                // create line
                if (this.movingPolylinePrimitive) {
                    this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
                }
                const lineGeometryInstance = createGeometryInstance(this.coordinateDataCache, "distance");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label
                if (this.movingLabelEntity) {
                    this.viewer.entities.remove(this.movingLabelEntity);
                }
                const distance = calculateDistance(this.coordinateDataCache[0], this.coordinateDataCache[1]);
                const label = createDistanceLabel(this.coordinateDataCache[0], this.coordinateDataCache[1], distance);
                const labelEntity = this.viewer.entities.add(label);
                this.labelEntities.add(labelEntity);

                // log distance
                this.logRecordsCallback(distance);
                // records cache to track all coords
                this.groupCoords.push(this.coordinateDataCache);

                // set flag that the measurement has ended
                this.isDistanceStarted = false;
            }

            // const line = createLinePrimitive(coordinateDataCache, Cesium.Color.RED);
            // this.linePrimitive.add(line);

            // // calculate distance
            // const distance = calculateDistance(coordinateDataCache[0], coordinateDataCache[1]);
            // const midpoint = Cesium.Cartesian3.midpoint(coordinateDataCache[0], coordinateDataCache[1], new Cesium.Cartesian3());
            // const label = editableLabel(midpoint, `Total: ${distance.toFixed(2)} m`, this.viewer, this.handler);
            // this.labelEntities.add(label);

            // // log distance
            // this._distanceRecords.push(distance);
            // this.logRecordsCallback(distance);

        } else {
            this.coordinateDataCache.length = 0;
            // add a continue point to the cache so it doesn't need to click twice to start again
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            this.pointPrimitive.add(point);

            this.coordinateDataCache.push(this.coordinate);
        }

        // const testCoords = [
        //     new Cesium.Cartesian3(
        //         4401708.553479742,
        //         225001.31820719416,
        //         4595424.246055711
        //     ),
        //     new Cesium.Cartesian3(
        //         4401704.962729205,
        //         225016.917551632,
        //         4595426.213245112
        //     )
        // ];
        // const testCoords2 = [
        //     new Cesium.Cartesian3(
        //         4401717.494439208,
        //         225010.99217682309,
        //         4595415.725121301
        //     ),
        //     new Cesium.Cartesian3(
        //         4401704.962729205,
        //         225016.917551632,
        //         4595426.213245112
        //     )
        // ]

    }


    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;


        // test callbackproperty for dynamic position to remove and recreate the polyline geometry
        // const fixCoordinate = new Cesium.Cartesian3(
        //     4401708.553479742,
        //     225001.31820719416,
        //     4595424.246055711
        // )
        // const testCoords = [
        //     fixCoordinate,
        //     cartesian
        // ];


        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coordinateDataCache.length > 0 && this.coordinateDataCache.length < 2) {
            if (this.movingPolylinePrimitive) {
                this.viewer.scene.primitives.remove(this.movingPolylinePrimitive);
            }
            const firstCoordsCartesian = this.coordinateDataCache[0];

            const movingLineGeometryInstance = createGeometryInstance([firstCoordsCartesian, this.coordinate], "distance");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOWGREEN);

            this.movingPolylinePrimitive = this.viewer.scene.primitives.add(movingLinePrimitive);

            // create distance label
            this.removeEntity(this.movingLabelEntity);
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

    // handleDistanceDragStart(movement) {
    //     // initialize camera movement
    //     this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    //     if (this.pointEntities.values.length > 1) {
    //         const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
    //         const pointObject = pickedObjects.find(p => p.id && p.id.point);

    //         // if it has picked object, and picked object is point entity
    //         if (Cesium.defined(pointObject)) {
    //             this.isDragMode = true;
    //             // disable camera movement
    //             this.viewer.scene.screenSpaceCameraController.enableInputs = false;

    //             this.draggingEntity = this.viewer.entities.getById(pointObject.id.id);

    //             // identify the group of entities for line that associate with the dragging point entity
    //             const group = this.groupsEntities.find(pair => pair.includes(this.draggingEntity));
    //             const lineEntity = group.find(e => e.polyline);
    //             // set not to show the line entity when left click down
    //             lineEntity.polyline.show = false;

    //             // set move event for dragging
    //             this.handler.setInputAction((movement) => {
    //                 this.handleDistanceDrag(movement, this.draggingEntity);
    //             }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    //         }
    //     };
    // };

    // handleDistanceDrag(movement, pointEntity) {
    //     this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

    //     const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

    //     if (!Cesium.defined(cartesian)) return;
    //     this.coordinate = cartesian;

    //     // update point entity to dragging position
    //     pointEntity.position = cartesian;

    //     // identify the group of point entities that contains the dragging point entity
    //     const group = this.groupsEntities.find(pair => pair.includes(pointEntity));

    //     // update line entity
    //     // otherPoint is the point entity that is not the dragging point entity
    //     const otherPoint = group.find(p => p.id !== pointEntity.id);
    //     const otherPointPosition = otherPoint.position.getValue(Cesium.JulianDate.now());

    //     // create moving line entity
    //     this.removeEntity(this.movingLineEntity);
    //     const movingLine = createLineEntity(
    //         [otherPointPosition, cartesian],
    //         Cesium.Color.YELLOW
    //     );
    //     movingLine.polyline.positions = new Cesium.CallbackProperty(() => {
    //         return [otherPointPosition, cartesian];
    //     }, false);
    //     this.movingLineEntity = this.viewer.entities.add(movingLine);

    //     // create distance label
    //     const labelEntity = group.find(e => e.label);
    //     labelEntity.label.show = false;
    //     this.removeEntity(this.movingLabelEntity);
    //     const distance = calculateDistance(otherPointPosition, cartesian);
    //     const label = createDistanceLabel(otherPointPosition, cartesian, distance);
    //     this.movingLabelEntity = this.viewer.entities.add(label);
    // }

    // handleDistanceDragEnd(movement) {
    //     this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    //     // this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    //     if (this.draggingEntity && this.isDragMode) {

    //         // identify the group of point entities that contains the dragging point entity
    //         const group = this.groupsEntities.find(pair => pair.includes(this.draggingEntity));

    //         const otherPoint = group.find(p => p.id !== this.draggingEntity.id);
    //         const otherPointPosition = otherPoint.position.getValue(Cesium.JulianDate.now());

    //         const cartesian = this.coordinate;

    //         // update line entity
    //         this.removeEntity(this.movingLineEntity);
    //         // update line entity from the group
    //         const polylineEntity = group.find(e => e.polyline);
    //         polylineEntity.polyline.show = true;
    //         polylineEntity.polyline.positions = new Cesium.CallbackProperty(() => {
    //             return [otherPointPosition, cartesian];
    //         }, false
    //         );

    //         // update distance label from the group
    //         this.removeEntity(this.movingLabelEntity);
    //         const labelEntity = group.find(e => e.label);
    //         labelEntity.label.show = true;
    //         const distance = calculateDistance(otherPointPosition, cartesian);
    //         const midpoint = Cesium.Cartesian3.midpoint(otherPointPosition, cartesian, new Cesium.Cartesian3());
    //         labelEntity.label.text = `Total: ${distance.toFixed(2)} m`;
    //         labelEntity.position.setValue(midpoint);

    //         // log distance
    //         this._distanceRecords.push(distance);
    //         this.logRecordsCallback(distance);
    //     }

    //     this.handler.setInputAction((movement) => {
    //         this.handleDistanceMouseMove(movement);
    //     }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    //     this.isDragMode = false;
    // };

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

        this.removeEntity(this.movingLineEntity);
        this.removeEntity(this.movingLabelEntity);
        this.coordinate = null;

        this.isDistanceStarted = false;
    }
}

export { TwoPointsDistanceP };
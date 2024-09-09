import * as Cesium from "cesium";
import {
    calculateDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    createLinePrimitive,
    createLineGeometryInstance,
    generateId,
    createLabelPrimitive,
} from "../helper/helper.js";

/**
 * Represents a two-point distance measurement tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 */
class TwoPointsDistance {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isDistanceStarted: false,
            isDragMode: false
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],      // Stores temporary coordinates during operations
            groups: [],     // Tracks all coordinates involved in operations
            dragStart: null // Stores the initial position before a drag begins
        };

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolyline: null,  // Line that visualizes dragging or moving
            movingLabel: null,     // Label that updates during moving or dragging
            draggingPoint: null,    // Currently dragged point primitive
            firstPoint: null,
            secondPoint: null,
        };
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
        // Check if the measurement has started
        // if pick the label primitive, make the label primitive editable
        if (!this.flags.isDistanceStarted) {
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

            // Set flag that the measurement has started
            this.flags.isDistanceStarted = true;
        }

        // use cache to store only two coordinates, if more than two, reset the cache
        if (this.coords.cache.length === 0) {
            // create the first point
            this.coords.cache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point_pending");
            this.interactivePrimitives.firstPoint = this.pointCollection.add(point);
        } else if (this.coords.cache.length % 2 !== 0) {
            // create the second point
            this.coords.cache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point");
            this.interactivePrimitives.secondPoint = this.pointCollection.add(point);

            // create line and label
            if (this.coords.cache.length === 2) {
                // update pending point id
                const isPointPending = this.interactivePrimitives.firstPoint.id.includes("pending")
                if (isPointPending) {
                    this.interactivePrimitives.firstPoint.id = generateId(this.interactivePrimitives.firstPoint.position, "distance_point")
                };

                // create line primitive
                if (this.interactivePrimitives.movingPolyline) {
                    this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
                }
                const lineGeometryInstance = createLineGeometryInstance(this.coords.cache, "distance_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // create label primitive
                // set moving label primitive to not show
                if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
                const distance = calculateDistance(this.coords.cache[0], this.coords.cache[1]);
                const midPoint = Cesium.Cartesian3.midpoint(this.coords.cache[0], this.coords.cache[1], new Cesium.Cartesian3());
                const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance)
                label.id = generateId(midPoint, "distance_label");
                this.labelCollection.add(label);

                // log distance
                this.logRecordsCallback(distance.toFixed(2));

                // records cache to track all coords, use shallow copy the cache
                this.coords.groups.push([...this.coords.cache]);

                // set flag that the measure has ended
                this.flags.isDistanceStarted = false;
            }
        } else {
            // reset the cache
            this.coords.cache.length = 0;
            // add a continue point to the cache so it doesn't need to click twice to start again
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point_pending");
            this.interactivePrimitives.firstPoint = this.pointCollection.add(point);

            this.coords.cache.push(this.coordinate);
        }
    }


    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        // Check if the position is defined
        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.coords.cache.length > 0 && this.coords.cache.length < 2) {
            // create line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const firstCoordsCartesian = this.coords.cache[0];

            const movingLineGeometryInstance = createLineGeometryInstance([firstCoordsCartesian, this.coordinate], "distance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);


            // update moving label primitive and set it to show
            const distance = calculateDistance(firstCoordsCartesian, cartesian);
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            this.interactivePrimitives.movingLabel = this.labelCollection.add(createLabelPrimitive(firstCoordsCartesian, cartesian, distance));
            this.interactivePrimitives.movingLabel.id = generateId(cartesian, "distance_moving_label");
        }
    }

    handleDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        if (this.coords.cache.length > 1) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_distance_point") &&
                    !p.primitive.id.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(pointPrimitive)) {
                console.error("No point primitives found");
                return;
            }

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            this.flags.isDragMode = true;
            this.interactivePrimitives.draggingPoint = pointPrimitive.primitive;
            this.coords.dragStart = pointPrimitive.primitive.position.clone();

            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_distance_line"));
            let linePrimitive = null;
            if (linePrimitives.length > 0) {
                linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
                // set the relative line primitive to no show
                linePrimitive ? linePrimitive.show = false : console.error("No specific line primitives found");
            } else {
                console.error("No line primitives found");
                return;
            }

            // find the relative label primitive to the dragging point 
            const linePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]
            const midpoint = Cesium.Cartesian3.midpoint(linePrimitivePosition[0], linePrimitivePosition[1], new Cesium.Cartesian3());
            const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, midpoint) && label.id && label.id.startsWith("annotate_distance_label"));
            targetLabelPrimitive.show = false;

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDistanceDrag(movement, this.interactivePrimitives.draggingPoint, this.coords.dragStart);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);


        }
    };

    handleDistanceDrag(movement, pointPrimitive, pointPrimitivePosition) {
        if (this.flags.isDragMode) {
            this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // update point primitive to dragging position
            pointPrimitive.position = cartesian;

            // identify the group of coordinates that contains the dragging position
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, pointPrimitivePosition)));
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, pointPrimitivePosition));

            // update moving line primitive by remove the old one and create a new one
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const movingLineGeometryInstance = createLineGeometryInstance([otherPointCoords, this.coordinate], "distance_drag_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // update moving label primitive
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const distance = calculateDistance(otherPointCoords, this.coordinate,
            );
            this.interactivePrimitives.movingLabel = this.labelCollection.add(createLabelPrimitive(otherPointCoords, this.coordinate, distance));
            this.interactivePrimitives.movingLabel.id = generateId(this.coordinate, "distance_drag_moving_label");
        }
    }

    handleDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.draggingPoint && this.flags.isDragMode) {

            // update the group coordinates by replace the new set of coordinates
            // find the relative line primitive to the dragging point
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.startsWith("annotate_distance_line"));

            if (linePrimitives.length > 0) {
                const linePrimitive = linePrimitives.find(p => p.geometryInstances.geometry._positions.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
                const targetLinePrimitivePosition = linePrimitive.geometryInstances.geometry._positions; // [cart, cart]

                // update the this.coords.groups with the new drag end positions, 2 points coordinates
                const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
                const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));
                const newCoords = [otherPointCoords, this.coordinate];
                const index = this.coords.groups.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
                this.coords.groups[index] = newCoords;

                // update the line primitive by remove the old one and create a new one
                if (this.interactivePrimitives.movingPolyline) {
                    this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
                }
                if (linePrimitive) {
                    this.viewer.scene.primitives.remove(linePrimitive);
                }
                // create new line primitive
                const lineGeometryInstance = createLineGeometryInstance(newCoords, "distance_line");
                const newlinePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(newlinePrimitive);

                // update the distance label
                if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
                // remove existed label
                const existedMidPoint = Cesium.Cartesian3.midpoint(targetLinePrimitivePosition[0], targetLinePrimitivePosition[1], new Cesium.Cartesian3());
                const targetLabelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, existedMidPoint) && label.id && label.id.startsWith("annotate_distance_label"));
                this.labelCollection.remove(targetLabelPrimitive);

                const distance = calculateDistance(newCoords[0], newCoords[1]);
                const label = createLabelPrimitive(newCoords[0], newCoords[1], distance);
                const newMidPoint = Cesium.Cartesian3.midpoint(newCoords[0], newCoords[1], new Cesium.Cartesian3());
                label.id = generateId(newMidPoint, "distance_label");
                this.labelCollection.add(label);

                // log distance
                this.logRecordsCallback(distance.toFixed(2));
            } else {
                console.error("No line primitives found");
                return;
            }
        }

        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // reset dragging primitive and flags
        this.interactivePrimitives.draggingPoint = null;
        this.flags.isDragMode = false;
    };

    resetValue() {
        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        this.flags.isDistanceStarted = false;
        this.flags.isDragMode = false;

        this.interactivePrimitives.draggingPoint = null;
        this.coords.dragStart = null;

        this.coords.cache = [];

        // remove moving primitives
        if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
        if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
        // remove pending point
        this.pointCollection._pointPrimitives.filter(p => p.id.includes("pending")).forEach(p => this.pointCollection.remove(p));

    }
}

export { TwoPointsDistance };
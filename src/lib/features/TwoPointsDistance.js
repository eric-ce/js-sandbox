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
    getPickedObjectType,
    formatDistance,
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
            isMeasurementComplete: false,
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
            hoveredPoint: null,
            hoveredLabel: null
        };
    }

    /**
     * Sets up input actions for two points distance mode.
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
     * Removes input actions for two points distance mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    /**
     * Handles left-click events to place points, draw and calculate distance.
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handleDistanceLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMeasurementComplete) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                break;
            case "line":
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode) {
                    this.startMeasure();
                }
                break;
        }
    }

    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = [];
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup;
        }

        // check if the current position is very close to coordinate in groups, if yes then don't create new point
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
        if (!isNearPoint) {
            // create the first point
            this.coords.cache.push(this.coordinate);
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "distance_point_pending");
            this.pointCollection.add(point);
        }

        // create line and label
        if (this.coords.cache.length === 2) {
            // update pending point id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            if (pendingPoints && pendingPoints.length > 0) {
                pendingPoints.forEach(p => p.id = p.id.replace("_pending", ""));
            }
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

            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;
        }
    }

    /**
     * Handles mouse move events to drawing moving line, update label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleDistanceMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete

        switch (true) {
            case isMeasuring:
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
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        }
        resetHighlighting();
        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = Cesium.Color.YELLOW;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = Cesium.Color.YELLOW;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }

    handleDistanceDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.flags.isMeasurementComplete) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_distance_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set the dragging point
            this.interactivePrimitives.draggingPoint = isPoint.primitive;
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDistanceDrag(movement, this.interactivePrimitives.draggingPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    };

    handleDistanceDrag(movement, pointPrimitive) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            pointPrimitive.outlineColor = Cesium.Color.YELLOW;
            pointPrimitive.outlineWidth = 2;

            const { linePrimitives, labelPrimitives } = this.getPrimitiveByPointPosition(this.coords.dragStart, "annotate_distance");

            // set relative line and label primitives to no show
            linePrimitives.forEach(p => p.show = false);
            labelPrimitives.forEach(l => l.show = false);

            this.pointerOverlay.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // update point primitive to dragging position
            pointPrimitive.position = cartesian;

            // identify the group of coordinates that contains the dragging position
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));

            // update moving line primitive by remove the old one and create a new one
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const movingLineGeometryInstance = createLineGeometryInstance([otherPointCoords, this.coordinate], "distance_moving_line");
            const movingLinePrimitive = createLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(movingLinePrimitive);

            // update moving label primitive
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            const distance = calculateDistance(otherPointCoords, this.coordinate,
            );
            this.interactivePrimitives.movingLabel = this.labelCollection.add(createLabelPrimitive(otherPointCoords, this.coordinate, distance));
            this.interactivePrimitives.movingLabel.id = generateId(this.coordinate, "distance_moving_label");
            this.interactivePrimitives.movingLabel.showBackground = false;
        }
    }

    handleDistanceDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.draggingPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.draggingPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.draggingPoint.outlineWidth = 0;

            // update the this.coords.groups with the new drag end positions, 2 points coordinates
            const group = this.coords.groups.find(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const groupIndex = this.coords.groups.findIndex(pair => pair.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            const otherPointCoords = group.find(p => !Cesium.Cartesian3.equals(p, this.coords.dragStart));
            this.coords.groups[groupIndex] = [otherPointCoords, this.coordinate];

            // Remove existing moving lines and moving labels 
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            this.interactivePrimitives.movingPolyline = null;
            if (this.interactivePrimitives.movingLabel) {
                this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            }
            this.interactivePrimitives.movingLabel = null;

            // create new line primitive
            const lineGeometryInstance = createLineGeometryInstance([otherPointCoords, this.coordinate], "distance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // Find and update the existing label primitive
            const oldMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coords.dragStart, new Cesium.Cartesian3());
            const newMidPoint = Cesium.Cartesian3.midpoint(otherPointCoords, this.coordinate, new Cesium.Cartesian3());
            const labelPrimitive = this.labelCollection._labels.find(label => label.position && Cesium.Cartesian3.equals(label.position, oldMidPoint) && label.id && label.id.startsWith("annotate_distance_label"));
            const distance = calculateDistance(otherPointCoords, this.coordinate);
            if (labelPrimitive) {
                labelPrimitive.text = formatDistance(distance);
                labelPrimitive.id = generateId(newMidPoint, "distance_label");
                labelPrimitive.position = newMidPoint;
                labelPrimitive.show = true;
            }

            const { linePrimitives, labelPrimitives } = this.getPrimitiveByPointPosition(this.coords.dragStart, "annotate_distance");
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => this.labelCollection.remove(l));
            // log distance
            this.logRecordsCallback(distance.toFixed(2));

            // reset dragging primitive and flags
            this.interactivePrimitives.draggingPoint = null;
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleDistanceMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };

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

    resetValue() {
        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        // reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        // reset coords
        this.coords.cache = [];
        this.coords.dragStart = null;
        this.coords.dragStartToCanvas = null;
        // reset interactive primitives
        this.interactivePrimitives.draggingPoint = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;

        // remove moving primitives
        if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
        this.interactivePrimitives.movingPolyline = null;
        if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
        this.interactivePrimitives.movingLabel = null;

        // remove pending point
        this.pointCollection._pointPrimitives.filter(p => p?.id?.includes("pending")).forEach(p => this.pointCollection.remove(p));
    }
}

export { TwoPointsDistance };
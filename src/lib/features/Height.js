import {
    defined,
    Color,
    Cartesian3,
    Cartographic,
    ScreenSpaceEventType,
} from "cesium";
import {
    convertToCartesian3,
    editableLabel,
    createPointPrimitive,
    generateId,
    createLabelPrimitive,
    formatDistance,
    getPickedObjectType,
    getPrimitiveByPointPosition,
    createPolylinePrimitive,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Height extends MeasureModeBase {
    /**
     * Creates a new Height instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // flags
        this.flags = {
            isDragMode: false,
        }

        // coordinates data
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            dragStartTop: null, // Stores the initial position before a drag begins
            dragStartBottom: null,      // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Store the drag start position to canvas in Cartesian2
            dragStart: null,    // Stores the initial position before a drag begins
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPoints: [],
            movingPolyline: null,
            movingLabel: null,
            dragPoints: [],
            dragPolyline: null,
            dragLabel: null,
            hoveredPoint: null,
            hoveredLabel: null,
        };
    }

    /**
     * Sets up input actions for height mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place top and ground points, draw line in between.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "height");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                editableLabel(this.viewer.container, pickedObject.primitive);
                break;
            default:
                if (!this.flags.isDragMode) {
                    if (this.coords.cache.length === 2) {
                        const [topCartesian, bottomCartesian] = this.coords.cache;
                        // update this.coords.groups to store all click coordinates
                        this.coords.groups.push([...this.coords.cache]);

                        // create top and bottom points primitives
                        const topPointPrimitive = createPointPrimitive(topCartesian, Color.RED, "height_point_top");
                        this.pointCollection.add(topPointPrimitive);

                        const bottomPointPrimitive = createPointPrimitive(bottomCartesian, Color.RED, "height_point_bottom");
                        this.pointCollection.add(bottomPointPrimitive);

                        // create line primitive
                        if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
                        this.interactivePrimitives.movingPolyline = null;
                        const linePrimitive = createPolylinePrimitive([topCartesian, bottomCartesian], "height_line", 3, Color.YELLOWGREEN, this.cesiumPkg.Primitive);

                        this.viewer.scene.primitives.add(linePrimitive);

                        // create label primitive
                        const distance = Cartesian3.distance(topCartesian, bottomCartesian);
                        const midPoint = Cartesian3.midpoint(topCartesian, bottomCartesian, new Cartesian3());
                        const label = createLabelPrimitive(topCartesian, bottomCartesian, distance);
                        label.id = generateId(midPoint, "height_label");
                        this.labelCollection.add(label);

                        // log the height result
                        this.logRecordsCallback(distance.toFixed(2));
                    }
                }
                break;
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to remove and add moving line, moving points, label, and display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handleMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);

        if (defined(pickedObject) && !pickedObject?.id?.startsWith("annotate_height")) {
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

            // Check if the position is defined
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;

            // ground position
            const [_, groundCartesian] = this.getGroundPosition(this.coordinate)
            this.coords.cache = [this.coordinate, groundCartesian];

            // create or update points primitives
            this.coords.cache.forEach((cart, index) => {
                if (this.interactivePrimitives.movingPoints.length === 2) { // update moving point primitive, if existed
                    this.interactivePrimitives.movingPoints[index].show = true;
                    this.interactivePrimitives.movingPoints[index].position = cart;
                    this.interactivePrimitives.movingPoints[index].id = generateId(cart, "height_point_moving");
                } else {   // create moving point primitive, if not existed
                    const pointPrimitive = createPointPrimitive(cart, Color.RED, "height_point_moving");
                    const point = this.pointCollection.add(pointPrimitive);
                    this.interactivePrimitives.movingPoints.push(point);
                }
            });

            // recreate moving line primitive
            if (this.interactivePrimitives.movingPolyline) {
                this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            }
            const linePrimitive = createPolylinePrimitive(this.coords.cache, "height_line_moving", 3, Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // create or update label primitive
            const distance = Cartesian3.distance(this.coords.cache[0], this.coords.cache[1]);
            const midPoint = Cartesian3.midpoint(this.coords.cache[0], this.coords.cache[1], new Cartesian3());
            if (this.interactivePrimitives.movingLabel) {   // if the moving points already existed update them
                this.interactivePrimitives.movingLabel.show = true;
                this.interactivePrimitives.movingLabel.showBackground = false;
                this.interactivePrimitives.movingLabel.position = Cartesian3.midpoint(this.coords.cache[0], this.coords.cache[1], new Cartesian3());
                this.interactivePrimitives.movingLabel.text = formatDistance(distance);
                this.interactivePrimitives.movingLabel.id = generateId(midPoint, "height_label_moving");
            } else {    // if the moving points not existed create them
                const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance);
                label.id = generateId(midPoint, "height_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
            }
        }

        this.handleHoverHighlighting(pickedObject);
    };

    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "height");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = hoverColor;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = hoverColor;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_height") &&
                    primitiveId.includes("point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set the dragging point
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            const groupIndex = this.coords.groups.findIndex(group => group.some(p => Cartesian3.equals(p, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const positionIndex = this.coords.groups[groupIndex].findIndex(p => Cartesian3.equals(p, this.coords.dragStart));
            if (positionIndex === -1) return;
            const otherPositionIndex = positionIndex === 0 ? 1 : 0;
            const otherPoint = this.pointCollection._pointPrimitives.find(p => Cartesian3.equals(p.position, this.coords.groups[groupIndex][otherPositionIndex]));

            const selectedPoints = [isPoint.primitive, otherPoint];

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, selectedPoints);
            }, ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    handleDragMove(movement, selectedPoints) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove
            selectedPoints.forEach(p => p.show = false);
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_height", this.viewer.scene, this.pointCollection, this.labelCollection);

            // set relative line and label primitives to no show
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            // set moving primitives not show or remove, because moving primitives is always on in height mode
            this.interactivePrimitives.movingPoints.forEach(p => p.show = false);
            if (this.interactivePrimitives.movingPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolyline);
            this.interactivePrimitives.movingPolyline = null;
            if (this.interactivePrimitives.movingLabel) this.interactivePrimitives.movingLabel.show = false;

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;

            const [_, groundCartesian] = this.getGroundPosition(cartesian);
            const newDragPositions = [this.coordinate, groundCartesian];

            // create or update point primitive to dragging position
            newDragPositions.forEach((cart, index) => {
                if (this.interactivePrimitives.dragPoints.length === 2) {
                    // highlight the point primitive
                    this.interactivePrimitives.dragPoints[index].outlineColor = Color.YELLOW;
                    this.interactivePrimitives.dragPoints[index].outlineWidth = 2;
                    // update moving point primitive
                    this.interactivePrimitives.dragPoints[index].position = cart;
                    this.interactivePrimitives.dragPoints[index].id = generateId(cart, "height_point_moving");
                } else {
                    const pointPrimitive = createPointPrimitive(cart, Color.RED, "height_point_moving");
                    const point = this.pointCollection.add(pointPrimitive);
                    this.interactivePrimitives.dragPoints.push(point);
                }
            });

            // update moving line primitive by remove the old one and create a new one            
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            const linePrimitive = createPolylinePrimitive(newDragPositions, "height_line_moving", 3, Color.YELLOW, this.cesiumPkg.Primitive);
            this.interactivePrimitives.dragPolyline = this.viewer.scene.primitives.add(linePrimitive);

            // create or update moving label primitive
            const distance = Cartesian3.distance(this.coordinate, groundCartesian);
            const midPoint = Cartesian3.midpoint(this.coordinate, groundCartesian, new Cartesian3());

            if (this.interactivePrimitives.dragLabel) {
                this.interactivePrimitives.dragLabel.position = midPoint;
                this.interactivePrimitives.dragLabel.text = formatDistance(distance);
                this.interactivePrimitives.dragLabel.id = generateId(midPoint, "height_label_moving");
                this.interactivePrimitives.dragLabel.showBackground = false;
            } else {
                const label = createLabelPrimitive(this.coordinate, groundCartesian, distance);
                label.id = generateId(midPoint, "height_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label);
            }
        }
    }

    handleDragEnd() {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoints.length === 2 && this.flags.isDragMode) {
            // reset the highlight of the dragging points
            this.interactivePrimitives.dragPoints.forEach(p => {
                p.outlineColor = Color.RED;
                p.outlineWidth = 0;
            })

            const [cartesian, groundCartesian] = this.getGroundPosition(this.coordinate);
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cartesian3.equals(cart, this.coords.dragStart)))

            // remove dragging point, line and label
            this.interactivePrimitives.dragPoints.forEach(p => this.pointCollection.remove(p));
            this.interactivePrimitives.dragPoints = [];
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;
            if (this.interactivePrimitives.dragPolyline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolyline);
            this.interactivePrimitives.dragPolyline = null;

            // update existed point primitive
            const existedTopPoint = this.pointCollection._pointPrimitives.find(p => Cartesian3.equals(p.position, this.coords.dragStart));
            if (existedTopPoint) {
                existedTopPoint.id = generateId(cartesian, "height_point_top");
                existedTopPoint.show = true;
                existedTopPoint.position = cartesian;
            }
            const positionIndex = this.coords.groups[groupIndex].findIndex(p => Cartesian3.equals(p, this.coords.dragStart));
            const otherPositionIndex = positionIndex === 0 ? 1 : 0;
            const existedBottomPoint = this.pointCollection._pointPrimitives.find(p => Cartesian3.equals(p.position, this.coords.groups[groupIndex][otherPositionIndex]));
            if (existedBottomPoint) {
                existedBottomPoint.id = generateId(groundCartesian, "height_point_bottom");
                existedBottomPoint.show = true;
                existedBottomPoint.position = groundCartesian;
            }

            // create new line primitive
            const linePrimitive = createPolylinePrimitive([cartesian, groundCartesian], "height_line", 3, Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // update label primitive
            const oldMidPoint = Cartesian3.midpoint(this.coords.groups[groupIndex][0], this.coords.groups[groupIndex][1], new Cartesian3());
            const newMidPoint = Cartesian3.midpoint(this.coordinate, groundCartesian, new Cartesian3());
            const distance = Cartesian3.distance(this.coordinate, groundCartesian);
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_height_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, oldMidPoint)
            );
            if (existedLabel) {
                existedLabel.text = formatDistance(distance);
                existedLabel.id = generateId(newMidPoint, "height_label");
                existedLabel.position = newMidPoint;
                existedLabel.show = true;
            }

            // update the log records
            this.logRecordsCallback(distance.toFixed(2));

            // update coords
            this.coords.groups[groupIndex] = [this.coordinate, groundCartesian];

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, ScreenSpaceEventType.MOUSE_MOVE);
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * get the position and its ground position by a position
     * @param {Cesium.Cartesian3} position 
     * @return {Cesium.Cartesian3[]} 
     */
    getGroundPosition(cartesian) {
        const cartographic = Cartographic.fromCartesian(cartesian);
        const groundHeight = this.viewer.scene.globe.getHeight(cartographic);

        // ground position relevant to movement position
        const groundCartesian = convertToCartesian3(
            new Cartographic(
                cartographic.longitude,
                cartographic.latitude,
                groundHeight
            )
        );
        return [cartesian, groundCartesian];
    }

    resetValue() {
        super.resetValue();

        // const pointer = this.stateManager.getOverlayState('pointer')
        // pointer && (pointer.style.display = 'none');

    }
}

export { Height }
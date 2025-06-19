import {
    defined,
    Color,
    Cartesian2,
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
    generateIdByTimestamp,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Height extends MeasureModeBase {
    /**
     * Creates a new Height instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space events.
     * @param {StateManager} stateManager - The state manager for tool states.
     * @param {Function} logRecordsCallback - Callback function to log measurement records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // Flags to control the state of the tool
        this.flags = {
            isDragMode: false,
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],                  // Stores temporary coordinates during operations
            groups: [],                 // Tracks all coordinates involved in operations
            groupCounter: 0,            // Counter for the number of groups
            dragStartTop: null,         // Stores the initial position before a drag begins
            dragStartBottom: null,      // Stores the initial position before a drag begins
            dragStart: null,            // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Store the drag start position to canvas in Cartesian2
            _records: [],               // Stores the measurement records
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPoints: [],        // Array of moving points
            movingPolylines: [],     // Array of moving polylines
            movingLabels: [],        // Array of moving labels
            dragPoints: [],          // Currently dragged point primitive
            dragPolylines: [],       // Array of dragging polylines
            dragLabels: [],          // Array of dragging labels
            hoveredPoint: null,      // Point that is currently hovered
            hoveredLabel: null,      // Label that is currently hovered
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
     * @param {Object} movement - The movement event containing the click position.
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
                    this.startMeasure();
                }
                break;
        }
    }

    /**
     * Finalizes the height measurement by creating point, line, and label primitives,
     * and logs the measured distance.
     */
    startMeasure() {
        if (this.coords.cache.length === 2) {
            const [topCartesian, bottomCartesian] = this.coords.cache;

            const newGroup = {
                id: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter,
            };
            this.coords.groups.push(newGroup);
            this.coords.groupCounter++;

            // update group coordinates 
            newGroup.coordinates = this.coords.cache;

            // create top and bottom points primitives
            const topPointPrimitive = createPointPrimitive(topCartesian, this.stateManager.getColorState("pointColor"), "height_point_top");
            this.pointCollection.add(topPointPrimitive);

            const bottomPointPrimitive = createPointPrimitive(bottomCartesian, this.stateManager.getColorState("pointColor"), "height_point_bottom");
            this.pointCollection.add(bottomPointPrimitive);

            // remove moving points, lines and labels
            super.removeMovingPrimitives({ removePoints: true, removeLabels: true, removeLines: true });

            // create line primitive
            const linePrimitive = createPolylinePrimitive(
                [topCartesian, bottomCartesian],
                "height_line",
                3,
                this.stateManager.getColorState("line"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const distance = Cartesian3.distance(topCartesian, bottomCartesian);
            const midPoint = Cartesian3.midpoint(topCartesian, bottomCartesian, new Cartesian3());
            const label = createLabelPrimitive(topCartesian, bottomCartesian, distance);
            label.id = generateId(midPoint, "height_label");
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = [topCartesian, bottomCartesian]; // store the positions for the label

            // log the height result
            this.updateLogRecords(distance);
        }
    }

    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Processes mouse move events to update dynamic measurement primitives including points, lines, and labels.
     * @param {Object} movement - The mouse movement event with an endPosition property.
     */
    handleMouseMove(movement) {
        const pickedObject = this.viewer.scene.pick(movement.endPosition, 1, 1);

        if (defined(pickedObject) && !pickedObject?.id?.startsWith("annotate_height")) { // if the picked object is not the height primitive
            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            // update coordinate
            this.coordinate = cartesian;

            // ground position
            const groundCartesian = this.getGroundPosition(cartesian);
            this.coords.cache = [cartesian, groundCartesian];

            // create or update points primitives
            this.coords.cache.forEach((cart, index) => {
                const pointPrimitive = this.interactivePrimitives.movingPoints[index];
                if (this.interactivePrimitives.movingPoints.length === 2) { // update moving point primitive, if existed
                    pointPrimitive.show = true;
                    pointPrimitive.position = cart;
                    pointPrimitive.id = generateId(cart, "height_point_moving");
                } else {   // create moving point primitive, if not existed
                    const point = createPointPrimitive(cart, this.stateManager.getColorState("pointColor"), "height_point_moving");
                    const pointPrimitive = this.pointCollection.add(point);
                    this.interactivePrimitives.movingPoints.push(pointPrimitive);
                }
            });

            // remove moving lines and labels
            super.removeMovingPrimitives();

            // create moving line primitive
            const line = createPolylinePrimitive(
                this.coords.cache,
                "height_line_moving",
                3,
                this.stateManager.getColorState("move"),
                this.cesiumPkg.Primitive
            );
            const linePrimitive = this.viewer.scene.primitives.add(line);
            this.interactivePrimitives.movingPolylines.push(linePrimitive);

            // create label primitive
            const distance = Cartesian3.distance(this.coordinate, groundCartesian);
            const midPoint = Cartesian3.midpoint(this.coordinate, groundCartesian, new Cartesian3());
            const label = createLabelPrimitive(this.coordinate, groundCartesian, distance);
            label.id = generateId(midPoint, "height_label_moving");
            label.showBackground = false;
            label.show = true;
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = [this.coordinate, groundCartesian]; // store the positions for the label
            this.interactivePrimitives.movingLabels.push(labelPrimitive);

        }

        this.handleHoverHighlighting(pickedObject);
    };

    /**
     * Highlights measurement primitives when the mouse hovers over them.
     * @param {Object} pickedObject - The object obtained from picking.
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "height");

        // reset highlighting
        // const resetHighlighting = () => {
        //     if (this.interactivePrimitives.hoveredPoint) {
        //         this.interactivePrimitives.hoveredPoint.outlineColor = Color.RED;
        //         this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
        //         this.interactivePrimitives.hoveredPoint = null;
        //     }
        //     if (this.interactivePrimitives.hoveredLabel) {
        //         this.interactivePrimitives.hoveredLabel.fillColor = Color.WHITE;
        //         this.interactivePrimitives.hoveredLabel = null;
        //     }
        // };
        // resetHighlighting();
        super.resetHighlighting();

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const point = pickedObject.primitive;
                if (point) {
                    point.outlineColor = hoverColor;
                    point.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = point;
                }
                break;
            case "label":   // highlight the label when hovering
                const label = pickedObject.primitive;
                if (label) {
                    label.fillColor = hoverColor;
                    this.interactivePrimitives.hoveredLabel = label;
                }
                break;
            default:
                break;
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates a drag action by identifying the measurement point to be dragged.
     * @param {Object} movement - The movement event containing the starting position.
     */
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0) { // if there are points to drag
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_height_point") &&
                    !primitiveId.includes("moving");
            });

            // Error handling: if no point primitives found then early exit
            if (!defined(isPoint)) return;

            // Disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // Set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            const group = this.coords.groups.find(group => group.coordinates.some(p => Cartesian3.equals(p, this.coords.dragStart)));
            if (!group) return;
            // find the point primitive by the positions
            const selectedPoints = group.coordinates.map(pos => this.pointCollection._pointPrimitives.find(p => Cartesian3.equals(p.position, pos)));

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, selectedPoints);
            }, ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    /**
     * Updates the location of measurement primitives during dragging.
     * @param {Object} movement - The movement event containing the updated mouse position.
     * @param {Array} selectedPoints - Array of points selected for dragging.
     */
    handleDragMove(movement, selectedPoints) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed points no show
            selectedPoints.forEach(point => point.show = false);

            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_height", this.viewer.scene, this.pointCollection, this.labelCollection);

            // set relative label primitives to no show, and remove line primitives
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            // remove moving points, line and label
            super.removeMovingPrimitives({ removePoints: true, removeLabels: true, removeLines: true });

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;    // update coordinate

            const groundCartesian = this.getGroundPosition(cartesian);
            const newDragPositions = [this.coordinate, groundCartesian];

            // create or update point primitive to dragging position
            newDragPositions.forEach((cart, index) => {
                const pointPrimitive = this.interactivePrimitives.dragPoints[index];
                if (this.interactivePrimitives.dragPoints.length === 2) {
                    // highlight the point primitive
                    pointPrimitive.outlineColor = this.stateManager.getColorState("move");
                    pointPrimitive.outlineWidth = 2;
                    // update moving point primitive
                    pointPrimitive.position = cart;
                    pointPrimitive.id = generateId(cart, "height_point_moving");
                } else {
                    const point = createPointPrimitive(cart, this.stateManager.getColorState("pointColor"), "height_point_moving");
                    const pointPrimitive = this.pointCollection.add(point);
                    this.interactivePrimitives.dragPoints.push(pointPrimitive);
                }
            });

            // Remove existing drag moving lines
            super.removeDragMovingPrimitives({ removeLines: true, removeLabels: false });

            // Create line primitive
            const line = createPolylinePrimitive(newDragPositions, "height_line_moving", 3, Color.YELLOW, this.cesiumPkg.Primitive);
            const linePrimitive = this.viewer.scene.primitives.add(line);
            this.interactivePrimitives.dragPolylines.push(linePrimitive);

            // Update or create moving label primitive
            const distance = Cartesian3.distance(this.coordinate, groundCartesian);
            const midPoint = Cartesian3.midpoint(this.coordinate, groundCartesian, new Cartesian3());
            const labelPrimitive = this.interactivePrimitives.dragLabels[0];
            if (labelPrimitive) {   // update the existing label primitive
                labelPrimitive.id = generateId(midPoint, "height_label_moving");
                labelPrimitive.position = midPoint;
                labelPrimitive.text = formatDistance(distance);
                labelPrimitive.showBackground = false;
            } else {   // create a new label primitive
                const label = createLabelPrimitive(this.coordinate, groundCartesian, distance);
                label.id = generateId(midPoint, "height_label_moving");
                label.showBackground = false;
                const labelPrimitive = this.labelCollection.add(label);
                this.interactivePrimitives.dragLabels.push(labelPrimitive);
            }
        }
    }

    /**
     * Concludes the drag operation, finalizing positions and re-enabling default navigation.
     */
    handleDragEnd() {
        // set camera movement back to default
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoints.length === 2 && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoints.forEach(p => {
                p.outlineColor = Color.RED;
                p.outlineWidth = 0;
            })

            // Find the group containing the dragged point
            const groundCartesian = this.getGroundPosition(this.coordinate);
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)))

            // Remove dragging point, dragging line and dragging label
            super.removeDragMovingPrimitives({ removePoints: true, removeLabels: true, removeLines: true });

            // Find the positions from the group coordinates, NOTE: the group coordinates here has not been updated yet
            const neighbourPositions = super.findNeighbourPosition(this.coords.dragStart, group);
            // Find the points by existed positions
            const existedPoints = neighbourPositions.map(pos => this.pointCollection._pointPrimitives.find(p => Cartesian3.equals(p.position, pos)));

            // The updated positions 
            const newPositions = [this.coordinate, groundCartesian];   // use this position to update the existed primitive

            // Update the existed points
            existedPoints.forEach((p, index) => {
                if (p) {
                    p.show = true;
                    p.id = generateId(newPositions[index], index === 0 ? "height_point_top" : "height_point_bottom");
                    p.position = newPositions[index];
                }
            });

            // create new line primitive
            const linePrimitive = createPolylinePrimitive(
                [this.coordinate, groundCartesian],
                "height_line",
                3,
                this.stateManager.getColorState("line"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(linePrimitive);

            // Update label primitive
            const oldMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[1], new Cartesian3());
            const newMidPoint = Cartesian3.midpoint(this.coordinate, groundCartesian, new Cartesian3());
            const distance = Cartesian3.distance(this.coordinate, groundCartesian);
            // Find and update the existing label primitive
            const labelPrimitive = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_height_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, oldMidPoint)
            );
            // Update the existing label text and position
            if (labelPrimitive) {
                labelPrimitive.text = formatDistance(distance);
                labelPrimitive.id = generateId(newMidPoint, "height_label");
                labelPrimitive.position = newMidPoint;
                labelPrimitive.show = true;
                labelPrimitive.showBackground = true;
            }

            // Update the log records
            this.updateLogRecords(distance);

            // Update coords
            group.coordinates = newPositions;

            // Set flags
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
     * Calculates and returns the ground position corresponding to a provided cartesian coordinate.
     * @param {Cesium.Cartesian3} cartesian - The input cartesian coordinate.
     * @returns {Cesium.Cartesian3} The computed ground cartesian coordinate.
     */
    getGroundPosition(cartesian) {
        // Convert the cartesian position to cartographic
        const cartographic = Cartographic.fromCartesian(cartesian);
        // Get the height of the ground by the cartographic
        const groundHeight = this.viewer.scene.globe.getHeight(cartographic);
        if (!groundHeight) return;  // Error handling: if the ground height is not defined then early exit

        // Get the ground position by the cartographic
        const groundCartesian = convertToCartesian3(
            new Cartographic(
                cartographic.longitude,
                cartographic.latitude,
                groundHeight
            )
        );

        return groundCartesian;
    }

    /**
     * update the log records with the distance
     * @param {Number} distance - the distance between two points
     * @returns {Number} distance - the distance between two points
     */
    updateLogRecords(distance) {
        // update log records in logBox
        this.logRecordsCallback(distance.toFixed(2));

        // update this.coords._records
        this.coords._records.push(distance);

        return distance;
    }

    resetValue() {
        super.resetValue();
    }
}

export { Height }
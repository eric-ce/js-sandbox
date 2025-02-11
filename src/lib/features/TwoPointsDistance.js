import {
    Cartesian2,
    Cartesian3,
    defined,
} from "cesium";
import {
    calculateDistance,
    editableLabel,
    updatePointerOverlay,
    createPointPrimitive,
    generateId,
    createLabelPrimitive,
    getPickedObjectType,
    createPolylinePrimitive,
    generateIdByTimestamp,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";


/**
 * @typedef {Object} Group
 * @property {string|number} id - Group identifier
 * @property {Cartesian3[]} coordinates - Array of position coordinates
 * @property {number} labelNumber - Label counter for the group
 */


class TwoPointsDistance extends MeasureModeBase {
    /**
     * Creates a new TwoPointsDistance instance.
     * @param {Viewer} viewer - The Cesium Viewer instance.
     * @param {ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {StateManager} stateManager - The state manager instance.
     * @param {Function} logRecordsCallback - Callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, emitter, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // Event emitter
        this.emitter = emitter;

        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isShowLabels: true
        };

        // Coordinate management and related properties
        this.coords = {
            // cache: [],                  // Stores temporary coordinates during operations
            // groups: [],                 // Tracks all coordinates involved in operations
            group: {
                id: generateIdByTimestamp(),
                mode: "two points distance",
                coordinates: [],
                _records: []
            },                      // Stores the current group of coordinates
            // groupCounter: 0,            // Counter for the number of groups
            dragStart: null,            // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
            _records: []                // Stores the distance records
        };

        this.measureData = {
            groups: [],                 // Array of groups
        }

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],      // Array of moving polylines
            movingLabels: [],         // Array of moving labels
            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels
            hoveredPoint: null,       // Point that is currently hovered
            hoveredLine: null,        // Line that is currently hovered
            hoveredLabel: null        // Label that is currently hovered
        };
    }

    /**
     * Sets up input actions for two points distance mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points and initiate distance measurement.
     * @param {{position: Cartesian2}} movement - The mouse movement event.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.coords.group.coordinates.length === 0) { // only when it is not during measuring can edit the label. 
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
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

    /**
     * Initiates the measurement process by creating a new group or adding a point.
     */
    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            // this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.group.coordinates.length === 0 || this.coords.group.coordinates.length === 2) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            // const newGroup = {
            //     id: generateIdByTimestamp(),
            //     coordinates: [],
            //     labelNumberIndex: this.coords.groupCounter,
            // };
            // this.coords.groups.push(newGroup);
            // this.coords.cache = newGroup.coordinates;
            // this.coords.groupCounter++;

            // link group to this.measureData.groups
            // when cache changed groups will be changed due to reference by address
            this.coords.group = {
                id: generateIdByTimestamp(),
                mode: "two points distance",
                coordinates: [],
                _records: []
            };
            this.measureData.groups.push(this.coords.group);
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.measureData.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "distance_point_pending");
        this.pointCollection.add(point);

        // Update the coordinate cache
        this.coords.group.coordinates.push(this.coordinate);

        // create line and label
        if (this.coords.group.coordinates.length === 2) {
            // Update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(
                p => p.id && p.id.includes("pending")
            );
            pendingPoints.forEach(p => {
                p.id = p.id.replace("_pending", "")
            });

            // Remove moving line and label primitives
            super.removeMovingPrimitives();

            // create line primitive
            const linePrimitive = createPolylinePrimitive(
                this.coords.group.coordinates,
                "distance_line",
                3,
                this.stateManager.getColorState("line"),
                this.cesiumPkg.Primitive
            )
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const distance = calculateDistance(this.coords.group.coordinates[0], this.coords.group.coordinates[1]);
            const label = createLabelPrimitive(this.coords.group.coordinates[0], this.coords.group.coordinates[1], distance)
            label.id = generateId(this.coords.group.coordinates, "distance_label");
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = [this.coords.group.coordinates[0], this.coords.group.coordinates[1]]; // store positions data in label primitive

            // log distance
            this.updateLogRecords(this.coords.group, distance);

            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;
            // this.coords.group.coordinates = [];
            this.emitter.emit("dataUpdate", this.coords.group);
            // console.log(this.measureData.groups);
            // console.log(this.coords.group);
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to draw a moving line, update label, and display a moving pointer.
     * @param {{endPosition: Cartesian2}} movement - The mouse movement event.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;

        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coords.group.coordinates.length > 0 && !this.flags.isMeasurementComplete

        switch (true) {
            case isMeasuring:
                if (this.coords.group.coordinates.length > 0 && this.coords.group.coordinates.length < 2) {
                    // Remove existing moving primitives
                    super.removeMovingPrimitives();

                    // Create current line primitive
                    const movingLine = createPolylinePrimitive(
                        [this.coords.group.coordinates[0], this.coordinate],
                        "distance_line_moving",
                        3,
                        this.stateManager.getColorState("move"),
                        this.cesiumPkg.Primitive
                    );
                    const movingLinePrimitive = this.viewer.scene.primitives.add(movingLine);
                    this.interactivePrimitives.movingPolylines.push(movingLinePrimitive);

                    // Create or update label primitive
                    const distance = calculateDistance(this.coords.group.coordinates[0], cartesian);
                    const midPoint = Cartesian3.midpoint(this.coords.group.coordinates[0], cartesian, new Cartesian3());
                    const label = createLabelPrimitive(this.coords.group.coordinates[0], cartesian, distance);
                    label.showBackground = false;
                    label.show = this.flags.isShowLabels;
                    label.id = generateId(midPoint, "distance_label_moving");
                    const labelPrimitive = this.labelCollection.add(label);
                    labelPrimitive.positions = [this.coords.group.coordinates[0], cartesian]; // store positions data in label primitive
                    this.interactivePrimitives.movingLabels.push(labelPrimitive);
                }
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    /**
     * Handles hover highlighting for primitives (point or label) when the mouse hovers over them.
     * @param {*} pickedObject - The object picked from the scene.
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "distance");

        // reset highlighting
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


    // /*****************
    //  * DRAG FEATURES *
    //  *****************/
    // /**
    //  * Initiates the drag action for two points distance measurement.
    //  * @param {{position: Cartesian2}} movement - The mouse movement event at drag start.
    //  */
    // handleDragStart(movement) {
    //     super._initializeDragStart(movement, "distance");
    // };

    // /**
    //  * Processes drag movement by updating the dragged point.
    //  * @param {{endPosition: Cartesian2}} movement - The mouse movement event during drag.
    //  * @param {Object} selectedPoint - The point primitive being dragged.
    //  */
    // handleDragMove(movement, selectedPoint) {
    //     super._initializeDragMove(movement, selectedPoint, "distance");
    // }

    // /**
    //  * Concludes the drag action, finalizing the positions of measurement primitives.
    //  */
    // handleDragEnd() {
    //     super._initializeDragEnd("distance", false, false);
    // };


    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * Updates the log records with the calculated distance.
     * @param {number} distance - The distance between two points.
     * @returns {number} The formatted distance.
     */
    updateLogRecords(group, distance) {
        // update log records in logBox
        this.logRecordsCallback(distance.toFixed(2));

        // update this.coords._records
        group._records.push(distance);

        return distance;
    }

    findGroupByPosition(position) {
        return this.measureData.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(position, cart)));
    }

    resetValue() {
        super.resetValue();
    }
}

export { TwoPointsDistance };
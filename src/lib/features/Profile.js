import {
    Cartesian2,
    Cartesian3,
    defined,
    Cartographic,
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    generateId,
    createPointPrimitive,
    getPickedObjectType,
    calculateClampedDistance,
    createGroundPolylinePrimitive,
    generateIdByTimestamp,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";


/**
 * @typedef {Object} Group
 * @property {string|number} id - Group identifier
 * @property {Cartesian3[]} coordinates - Array of position coordinates
 * @property {number} labelNumber - Label counter for the group
 * @property {Cartesian3[]} interpolatedPoints - Array of interpolated points
 */


class Profile extends MeasureModeBase {
    /**
     * Creates a new Profile instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {Object} stateManager - The state manager instance.
     * @param {Function} logRecordsCallback - Callback function to log distance records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isShowLabels: true,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],              // Stores temporary coordinates during operations
            groups: [],             // Tracks all coordinates involved in operations
            groupCounter: 0,        // Counter for the number of groups
            dragStart: null,            // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
            selectedGroupIndex: null,   // Tracks the index of the selected group
            _records: []                // Stores the distance records
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],      // Array of moving polylines
            movingLabels: [],         // Array of moving labels

            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels

            hoveredLine: null,        // Line that is currently hovered
            hoveredPoint: null,       // Point that is currently hovered
            hoveredLabel: null,       // Label that is currently hovered

            chartHoveredPoint: null,  // Point that is currently hovered in the chart
        };

        // chart
        this.chart = null;
        this.chartDiv = null;
    }

    /**
     * Sets up input actions for profile mode.
     */
    setupInputActions() {
        super.setupInputActions();

        // setup label button
        super.setUpExtraButtons("profile", 3);
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, draw lines, and calculate distances.
     * @param {{position: Cartesian2}} movement - The mouse movement event.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "profile");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.coords.cache.length === 0) { // only when it is not during measuring can edit the label. 
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
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = {
                id: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter,
                interpolatedPoints: [],
            };
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup.coordinates;
            this.coords.groupCounter++;
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "profile_point_pending");
        this.pointCollection.add(point);

        // Update the coordinate cache
        this.coords.cache.push(this.coordinate);

        // create line and label
        if (this.coords.cache.length === 2) {
            // Update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(
                p => p.id && p.id.includes("pending")
            )
            pendingPoints.forEach(p => {
                p.id = p.id.replace("_pending", "")
            });

            // Remove moving line and label primitives
            super.removeMovingPrimitives();

            // create line primitive
            const linePrimitive = createGroundPolylinePrimitive(
                this.coords.cache,
                "profile_line",
                this.stateManager.getColorState("line"),
                this.cesiumPkg.GroundPolylinePrimitive
            );
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const { distance, clampedPositions } = calculateClampedDistance(
                this.coords.cache[0],
                this.coords.cache[1],
                this.viewer.scene,
                2
            );
            const label = createLabelPrimitive(this.coords.cache[0], this.coords.cache[1], distance);
            label.id = generateId(this.coords.cache, "profile_label");
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = [this.coords.cache[0], this.coords.cache[1]]; // store positions data in label primitive

            // update the interpolated points in the group
            const groupIndex = this.coords.groups.findIndex(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.cache[0])));
            const group = this.coords.groups[groupIndex];
            group.interpolatedPoints = clampedPositions;

            // create and or update the chart
            this.handleChartSpecific(group.interpolatedPoints, group.coordinates);

            // log distance result
            this.updateLogRecords(distance)

            // set flag that the measurement has ended
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to draw moving lines, update labels, and display a pointer overlay.
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
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

        // the condition to determine if it is hovering on the line
        const pickedLine = pickedObjects.find(p => p.id && p.id.startsWith("annotate_profile_line"));
        const isPickedLine = pickedLine && this.coords.groups.length > 0;

        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length > 0 && this.coords.cache.length < 2) {
                    // Remove existing moving primitives
                    super.removeMovingPrimitives();

                    // Create current line primitive
                    const movingLine = createGroundPolylinePrimitive(
                        [this.coords.cache[0], this.coordinate],
                        "profile_line_moving",
                        this.stateManager.getColorState("move"),
                        this.cesiumPkg.GroundPolylinePrimitive
                    );
                    const movingLinePrimitive = this.viewer.scene.primitives.add(movingLine);
                    this.interactivePrimitives.movingPolylines.push(movingLinePrimitive);

                    // Create label primitive
                    const { distance } = calculateClampedDistance(this.coords.cache[0], this.coordinate, this.viewer.scene, 2);
                    const midPoint = Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cartesian3());
                    const label = createLabelPrimitive(this.coords.cache[0], cartesian, distance);
                    label.showBackground = false;
                    label.show = this.flags.isShowLabels;
                    label.id = generateId(midPoint, "profile_label_moving");
                    const labelPrimitive = this.labelCollection.add(label);
                    labelPrimitive.positions = [this.coords.cache[0], cartesian]; // store positions data in label primitive
                    this.interactivePrimitives.movingLabels.push(labelPrimitive);
                }
                break;
            case isPickedLine:
                // hide the pointer overlay if picked line
                const pointer = this.stateManager.getOverlayState("pointer");
                pointer.style.display = "none";

                // move along the line to show the tooltip for corresponding point
                const cartographic = Cartographic.fromCartesian(cartesian);
                const groundHeight = this.viewer.scene.sampleHeight(cartographic);

                const clampedCartesian = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, groundHeight);

                if (!defined(clampedCartesian)) return;

                // find the group by the picked line
                const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, pickedLine.primitive.positions[0])));
                if (!group) return;  // Error handling: if the group is not found then return
                // find the interpolated points of the group
                const interpolatedPoints = group.interpolatedPoints;

                // find the closest point to the interpolated points
                const closestCoord = interpolatedPoints.find(cart => Cartesian3.distance(cart, clampedCartesian) < 0.5);
                // Error handling: there is no point close to the line
                if (!defined(closestCoord)) return;

                if (!this.chart) return;    // Error handling: if the chart doesn't exist then return

                // Create point for the closest coordinate
                super.createPointForChartHoverPoint(closestCoord);

                // Find the index of the closest point in the interpolated points
                const index = interpolatedPoints.findIndex(cart => Cartesian3.equals(cart, closestCoord));
                if (index === -1) return;   // Error handling: if the index is not found then return

                // Show the tooltip at the index, because labels array length should be the same as the interpolated points length
                super.showTooltipAtIndex(this.chart, index);
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    /**
     * Handles hover highlighting for profile mode.
     * @param {*} pickedObject - The object picked by the drill pick.
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "profile");

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


    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates drag action for a profile point.
     * @param {{position: Cartesian2}} movement - The mouse movement event at drag start.
     */
    handleDragStart(movement) {
        super._initializeDragStart(movement, "profile");
    };

    /**
     * Processes drag movement by updating the dragged point.
     * @param {{endPosition: Cartesian2}} movement - The mouse movement event during drag.
     * @param {Object} selectedPoint - The point primitive being dragged.
     */
    handleDragMove(movement, selectedPoint) {
        super._initializeDragMove(movement, selectedPoint, "profile", true);
    }

    /**
     * Concludes the drag action, finalizing the dragged point position.
     */
    handleDragEnd() {
        super._initializeDragEnd("profile", false, true);
    };


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Handles chart-specific features by updating chart data based on interpolated positions.
     * @param {Cartesian3[]} clampedPositions - The clamped positions between two points.
     * @param {Cartesian3[]} coordinates - The coordinate array of the current group.
     * @returns {HTMLElement} The chart element.
     */
    handleChartSpecific(clampedPositions, coordinates) {
        // line chart x-axis label
        // always start from 0 meters
        const labelDistance = [0];
        for (let i = 0; i < clampedPositions.length - 1; i++) {
            const distance = Cartesian3.distance(clampedPositions[i], clampedPositions[i + 1]);
            // line chart x-axis label
            labelDistance.push(labelDistance[i] + Math.round(distance));
        }
        // line chart y-axis data
        const diffHeight = clampedPositions.map((cartesian) => {
            const pickedCartographic = Cartographic.fromCartesian(cartesian);
            return pickedCartographic.height
        })

        // Remove chart hover point if exists
        if (this.interactivePrimitives.chartHoveredPoint) {
            this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint);
            this.interactivePrimitives.chartHoveredPoint = null;
        }

        // Update selected group index
        const groupIndex = this.coords.groups.findIndex(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, coordinates[0]))
        );
        this.coords.selectedGroupIndex = groupIndex === -1 ? null : groupIndex;

        // Create Chart if not exist
        if (!this.chartDiv) { // If chart doesn't exist, create a new chart
            super.setupChart("profile_distances", clampedPositions, coordinates);
        }
        // Update the chart
        this.chartDiv.style.display = "block";
        super.updateChart(labelDistance, diffHeight, clampedPositions, coordinates);

        return this.chart;
    }

    /**
     * Updates the log records with the provided distance.
     * @param {number} distance - The distance between two points.
     * @returns {number} The formatted distance.
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

        super.removeChart();
    }
}

export { Profile };

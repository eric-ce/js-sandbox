import {
    Cartesian2,
    Cartesian3,
    Color,
    defined,
    ScreenSpaceEventType
} from 'cesium';
import {
    positionKey,
    removeInputActions,
    calculateDistance,
    formatDistance,
    createLabelPrimitive,
    generateId,
    changeLineColor,
    calculateClampedDistance,
    showCustomNotification,
    getPrimitiveByPointPosition,
    createPointPrimitive,
    createGroundPolylinePrimitive,
    createPolylinePrimitive,
    calculateClampedDistanceFromArray,
    calculateDistanceFromArray,
    makeDraggable
} from '../lib/helper/helper.js';
import Chart from "chart.js/auto";
import dataPool from '../lib/data/DataPool.js';


export default class MeasureModeBase {
    constructor(viewer, handler, stateManager, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;

        this.stateManager = stateManager;

        // this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cartesian3();

        this.flags = {};

        // common used coordinates data
        this.coords = {
            cache: [],                 // Temporary coordinates during operations
            groups: [],                // All measurement groups
            groupCounter: 0,           // Counter for groups (or label numbering)
            dragStartTop: null,        // Top position at drag start
            dragStartBottom: null,     // Bottom position at drag start
            dragStart: null,           // Initial position at drag start
            dragStartToCanvas: null,   // Drag start position in canvas coordinates (Cartesian2)
            selectedGroupIndex: null,  // Index of the selected group
            _records: []               // Measurement records
        };

        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // common used interactive primitives
        this.interactivePrimitives = {
            movingPoint: null,          // Point primitive that updates during moving or dragging
            movingPoints: [],           // Array of moving points
            movingPolylines: [],        // Array of moving polylines
            movingLabels: [],           // Array of moving labels
            movingPolygon: null,        // Polygon primitive that updates during moving
            movingPolygonOutline: null, // Polygon outline primitive that updates during moving

            dragPoint: null,            // Currently dragged point primitive
            dragPoints: [],             // Array of dragged points
            dragPolylines: [],          // Array of dragging polylines
            dragLabels: [],             // Array of dragging labels
            dragPolygon: null,          // Currently dragged polygon primitive
            dragPolygonOutline: null,   // Currently dragged polygon outline primitive

            hoveredLine: null,          // Line that is currently hovered
            hoveredPoint: null,         // Point that is currently hovered
            hoveredLabel: null,         // Label that is currently hovered

            selectedLines: [],          // Array of selected line primitives
            addModeLine: null,          // Selected line primitive in add mode
            chartHoveredPoint: null     // Hovered point on the chart
        };

        this.measure = {
            id: null,
            mode: null,
            coordinates: [],
            labelNumberIndex: null,
            status: "pending",
            _records: [],
            interpolatedPoints: []
        }

        // common used chart
        this.chart = null;
        this.chartDiv = null;
    }

    setupInputActions() {
        removeInputActions(this.handler);
        this.handler.setInputAction((movement) => this.handleLeftClick(movement), ScreenSpaceEventType.LEFT_CLICK);
        this.handler.setInputAction((movement) => this.handleMouseMove(movement), ScreenSpaceEventType.MOUSE_MOVE);
        this.handler.setInputAction((movement) => this.handleDragStart(movement), ScreenSpaceEventType.LEFT_DOWN);
        this.handler.setInputAction(() => this.handleDragEnd(), ScreenSpaceEventType.LEFT_UP);
        this.handler.setInputAction((movement) => this.handleRightClick(movement), ScreenSpaceEventType.RIGHT_CLICK);
        this.handler.setInputAction((movement) => this.handleDoubleClick(movement), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        this.handler.setInputAction((movement) => this.handleMiddleClick(movement), ScreenSpaceEventType.MIDDLE_CLICK);
    }

    handleLeftClick() { /* Default click behavior; override in subclass */ }
    handleMouseMove() { /* Default move behavior; override in subclass */ }
    handleRightClick() { /* Default right click; override in subclass */ }
    handleDragStart() { /* Default drag start; override in subclass */ }
    handleDragMove() { /* Default drag move; override in subclass */ }
    handleDragEnd() { /* Default drag end; override in subclass */ }
    handleDoubleClick() { /* Default double click; override in subclass */ }
    handleMiddleClick() { /* Default middle click; override in subclass */ }

    resetValue() {
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState("pointer");
        pointer && (pointer.style.display = "none");

        // this.flags = {};

        this.coords = {
            cache: [],                              // Reset temporary coordinates
            groups: this.coords.groups,             // Preserve existing measurement groups
            groupCounter: this.coords.groupCounter, // Preserve the current group counter
            dragStart: null,                        // Reset drag start position
            dragStartToCanvas: null,                // Reset drag start canvas coordinates
            dragStartTop: null,                     // Reset drag start top position
            dragStartBottom: null,                  // Reset drag start bottom position
            _records: this.coords._records,         // Preserve existing measurement records
            selectedGroupIndex: this.coords.selectedGroupIndex,     // Preserve the value of this.coords.selectedGroupIndex
        }

        this.measure = this._createDefaultMeasure();   // Reset measurement object

        this.interactivePrimitives = {
            movingPoint: null,                        // Reset moving point primitive
            movingPoints: [],                         // Reset array of moving points
            movingPolylines: [],                      // Reset moving polyline primitives
            movingLabels: [],                         // Reset moving label primitives
            movingPolygon: null,                      // Reset moving polygon primitive
            movingPolygonOutline: null,               // Reset moving polygon outline primitive

            dragPoint: null,                          // Reset currently dragged point primitive
            dragPoints: [],                           // Reset array of dragged points
            dragPolylines: [],                        // Reset dragging polyline primitives
            dragLabels: [],                           // Reset dragging label primitives
            dragPolygon: null,                        // Reset dragged polygon primitive
            dragPolygonOutline: null,                 // Reset dragged polygon outline primitive

            hoveredPoint: null,                       // Reset hovered point
            hoveredLabel: null,                       // Reset hovered label
            hoveredLine: null,                        // Reset hovered line

            selectedLines: this.interactivePrimitives.selectedLines, // Preserve currently selected lines
            addModeLine: null,                        // Reset add mode line primitive
            chartHoveredPoint: null                   // Reset chart hovered point
        };
    }


    /****************************************
     *             DRAG FEATURE             *
     * FOR DISTANCE AND MULTI DISTANCE MODE *
     ****************************************/
    /**
     * Initializes the drag start event for measuring mode.
     *
     * @param {Object} movement - Object containing the movement event position.
     * @param {string} modeString - Measurement mode identifier.
     * @param {boolean} [isMultiDistance=false] - Flag indicating multi-distance mode.
     */
    _initializeDragStart(movement, modeString, isMultiDistance = false) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) { // when the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith(`annotate_${modeString}_point`) &&
                    !primitiveId.includes("moving");
            });

            // Error handling: if no point primitives found then early exit
            if (!defined(isPoint)) return;

            // Disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // Set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (!group) return;

            // Set status to pending 
            group.status = "pending";
            // Update to data pool
            dataPool.updateOrAddMeasure({ ...group });

            if (isMultiDistance) { // if it is multi distance, multi distance clamped or profile distances mode
                // Reset line color 
                const resetLinesColor = (lines) => {
                    lines.forEach(line => {
                        changeLineColor(line, this.stateManager.getColorState("default"));
                    });
                }
                resetLinesColor(this.interactivePrimitives.selectedLines);

                // Highlight the drag lines and set it to the selected lines
                const lines = this.findLinesByPositions(group.coordinates);
                this.interactivePrimitives.selectedLines = lines;
                lines.forEach(line => {
                    this.changeLinePrimitiveColor(line, 'select');
                });

                // Set isAddMode flags to false to prevent its action, with notification
                if (this.flags.isAddMode) {
                    this.flags.isAddMode = false;
                    showCustomNotification("you have exited add line mode", this.viewer.container);
                }
            }

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, isPoint);
            }, ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    /**
     * Initializes and handles drag movement for measuring points.
     *
     * @param {Object} movement - Movement event object with endPosition coordinates.
     * @param {Object} selectedPoint - The selected point object (contains primitive properties).
     * @param {string} modeString - Mode identifier used for primitive creation.
     * @param {boolean} [isClamped=false] - Flag indicating whether to clamp measurements to ground.
     */
    _initializeDragMove(movement, selectedPoint, modeString, isClamped = false) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove 
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
                this.coords.dragStart,
                `annotate_${modeString}`,
                this.viewer.scene,
                this.pointCollection,
                this.labelCollection
            );
            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            // Set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;  // update coordinate

            // Update or create dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("move");
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, `${modeString}_point_moving`);
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), this.stateManager.getColorState("pointColor"), `${modeString}_point_moving`);
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)));
            if (!group) return;

            // Updated call to findNeighbourPosition
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return

            // Remove existing drag moving lines
            this.removeDragMovingPrimitives({ removeLines: true, removeLabels: false });

            // Remove chart hovered point
            if (this.interactivePrimitives.chartHoveredPoint) {
                this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint)
                this.interactivePrimitives.chartHoveredPoint = null;
            };

            const otherPositions = neighbourPositions.filter(cart =>
                !Cartesian3.equals(cart, this.coords.dragStart)
            );

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const linePrimitive = isClamped
                    ? createGroundPolylinePrimitive(
                        [pos, cartesian],
                        `${modeString}_line_moving`,
                        this.stateManager.getColorState("move"),
                        this.cesiumPkg.GroundPolylinePrimitive
                    )
                    : createPolylinePrimitive(
                        [pos, cartesian],
                        `${modeString}_line_moving`,
                        3,
                        this.stateManager.getColorState("move"),
                        this.cesiumPkg.Primitive
                    );
                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);

                // For label primitive
                // Calculate the distance depends on clamped or not
                const distance = isClamped
                    ? calculateClampedDistance(pos, cartesian, this.viewer.scene, 4).distance
                    : calculateDistance(pos, cartesian);

                // Calculate the midpoint for placing the label
                const midPoint = Cartesian3.midpoint(pos, cartesian, new Cartesian3());

                // Update or create the label primitive
                const labelPrimitive = this.interactivePrimitives.dragLabels[idx];
                if (labelPrimitive) { // if label existed, update the label
                    this.interactivePrimitives.dragLabels[idx].id = generateId(midPoint, `${modeString}_label_moving`);
                    this.interactivePrimitives.dragLabels[idx].position = midPoint;
                    this.interactivePrimitives.dragLabels[idx].text = `${formatDistance(distance)}`;
                    this.interactivePrimitives.dragLabels[idx].showBackground = false;
                } else { // if label not existed, create a new label
                    const labelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    labelPrimitive.id = generateId(midPoint, `${modeString}_label_moving`);
                    labelPrimitive.showBackground = false;
                    const addedLabelPrimitive = this.labelCollection.add(labelPrimitive);
                    this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
                }
            });
        }
    }

    /**
     * Handles the end of a drag operation for measurement points.
     *
     * @param {string} modeString - Measurement mode identifier (e.g., 'distance', 'multiDistance').
     * @param {boolean} [isMultiDistance=false] - Flag indicating multi-distance mode.
     * @param {boolean} [isClamped=false] - Flag indicating whether to clamp measurements to terrain.
     */
    _initializeDragEnd(modeString, isMultiDistance = false, isClamped = false) {
        // Enable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)))
            if (!group) return;     // Error handling: no group found

            // Remove dragging point, dragging lines and dragging labels
            this.removeDragMovingPrimitives({ removePoint: true, removeLines: true, removeLabels: true });

            // Update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.includes(`${modeString}_point`) &&
                Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, `${modeString}_point`);
            }

            // Updated call to findNeighbourPosition
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // Error handling: if no neighbour positions found, then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            let distance, clampedPositions;

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart =>
                !Cartesian3.equals(cart, this.coords.dragStart)
            );
            otherPositions.forEach(pos => {
                // Create new line primitive
                const linePrimitive = isClamped
                    ? createGroundPolylinePrimitive(
                        [this.coordinate, pos],
                        `${modeString}_line`,
                        this.stateManager.getColorState("line"),
                        this.cesiumPkg.GroundPolylinePrimitive
                    )
                    : createPolylinePrimitive(
                        [this.coordinate, pos],
                        `${modeString}_line`,
                        3,
                        this.stateManager.getColorState("line"),
                        this.cesiumPkg.Primitive
                    );
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                if (isClamped) {
                    ({ distance, clampedPositions } = calculateClampedDistance(pos, this.coordinate, this.viewer.scene, 4));
                } else {
                    distance = calculateDistance(pos, this.coordinate);
                }

                const oldMidPoint = Cartesian3.midpoint(
                    pos,
                    this.coords.dragStart,
                    new Cartesian3()
                );
                const newMidPoint = Cartesian3.midpoint(
                    pos,
                    this.coordinate,
                    new Cartesian3()
                );

                // Find and update the existing label primitive
                const labelPrimitive = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.startsWith(`annotate_${modeString}_label`) &&
                        Cartesian3.equals(label.position, oldMidPoint)
                );
                if (labelPrimitive) {
                    // update the existing label text and position
                    if (isMultiDistance) {  // if multi distance mode, add the existed label text with the distance
                        const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                        labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    } else {  // if distance mode, update the label text with the distance
                        labelPrimitive.text = formatDistance(distance);
                    }
                    labelPrimitive.id = generateId(newMidPoint, `${modeString}_label`);
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = this.flags.isShowLabels;
                    labelPrimitive.showBackground = this.flags.isShowLabels;

                    // update the positions data stored in the existed label primitive 
                    labelPrimitive.positions = [pos, this.coordinate];
                }
            });

            if (isMultiDistance) { // if multi distance mode
                // Find total distance label by the last point in group
                const lastPosition = group.coordinates[group.coordinates.length - 1];
                const totalLabel = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.includes(`${modeString}_label_total`) &&
                        Cartesian3.equals(label.position, lastPosition)
                );

                // Update the coordinate data
                const positionIndex = group.coordinates.findIndex(cart =>
                    Cartesian3.equals(cart, this.coords.dragStart)
                );
                if (positionIndex !== -1) {
                    group.coordinates[positionIndex] = this.coordinate;
                }

                // Update total distance label
                const { distances, totalDistance, clampedPositions } = isClamped
                    ? calculateClampedDistanceFromArray(group.coordinates, this.viewer.scene, 4)
                    : calculateDistanceFromArray(group.coordinates);
                if (totalLabel) {
                    totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                    totalLabel.position = group.coordinates[group.coordinates.length - 1];
                    totalLabel.id = generateId(lastPosition, `${modeString}_label_total`);
                }

                if (this.handleChartSpecific) {
                    // update the group interpolated points with the clamped positions
                    group.interpolatedPoints = clampedPositions;
                }

                // update log records
                this.updateMultiDistancesLogRecords && this.updateMultiDistancesLogRecords(distances, totalDistance);

                // Update selected line color
                const lines = this.findLinesByPositions(group.coordinates, modeString);
                this.interactivePrimitives.selectedLines = lines;
                this.updateSelectedLineColor(group);
            } else { // if distance mode
                // Update the coordinate data
                const positionIndex = group.coordinates.findIndex(cart =>
                    Cartesian3.equals(cart, this.coords.dragStart)
                );
                if (positionIndex !== -1) {
                    group.coordinates[positionIndex] = this.coordinate;
                }

                if (isClamped) {
                    if (!clampedPositions) return; // Error handling: no clamped positions found

                    if (this.handleChartSpecific) {
                        // update the group interpolated points with the clamped positions
                        group.interpolatedPoints = clampedPositions;
                    }
                }

                // update _records and status of the group
                group.status = "completed";
                group._records = [distance];

                // Update to data pool
                dataPool.updateOrAddMeasure({ ...group });
            }

            // Handle Chart
            if (this.handleChartSpecific) {
                this.handleChartSpecific(group.interpolatedPoints, group.coordinates);
            }

            // Reset flag
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, ScreenSpaceEventType.MOUSE_MOVE);
    }

    /*********************
     *  REMOVE FEATURE   *
     * FOR MULTIDISTANCE *
     *********************/
    /**
     * Removes a point primitive and its associated lines and labels, then updates the measurement.
     *
     * @param {PointPrimitive} pointPrimitive - The point primitive to remove.
     * @param {string} modeString - Measurement mode identifier.
     * @param {boolean} [isClamped=false] - Flag indicating whether measurements are clamped to terrain.
     * @returns {Object|undefined} If successful, returns an object with:
     *   - updatedGroup {Object}: The updated measurement group.
     *   - removedPoint {PointPrimitive}: The removed point primitive.
     *   - removedLinePrimitives {Primitive[]}: Array of removed line primitives.
     *   - removedLabelPrimitives {LabelPrimitive[]}: Array of removed label primitives.
     */
    _removeActionByPoint(pointPrimitive, modeString, isClamped = false) {
        // Prompt the user for confirmation before removing the point
        const confirmRemoval = confirm("Do you want to remove this point?");
        if (!confirmRemoval) {
            return; // User canceled the removal; do nothing
        }

        // Clone the position of the point to avoid mutating the original
        const pointPosition = pointPrimitive.position.clone();

        // Retrieve associated line and label primitives based on the point's position
        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
            pointPosition,
            `annotate_${modeString}`,
            this.viewer.scene,
            this.pointCollection,
            this.labelCollection
        );

        // Remove the point, associated lines, and associated labels primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove any moving line and label primitives
        this.removeMovingPrimitives();

        // Proceed only if there are existing groups and the measurement is complete
        if (this.coords.groups.length > 0 && this.flags.isMeasurementComplete) {    // when the measure is complete
            // Find the group that contains the point being removed
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, pointPosition))
            );
            // Exit if no matching group is found
            if (!group) return;

            // Identify neighboring positions to reconnect the remaining points, lines, and labels
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);
            this._createReconnectPrimitives(neighbourPositions, group, modeString, isClamped, false);

            // Remove the point from the group's coordinates
            const pointIndex = group.coordinates.findIndex(cart =>
                Cartesian3.equals(cart, pointPosition)
            );
            if (pointIndex === -1) return;

            const isRemoveLastPoint = group.coordinates.length - 1 === pointIndex;
            if (isRemoveLastPoint) {
                // clone the position
                const lastPoint = group.coordinates[pointIndex].clone();
                // find the total label and remove it
                const targetTotalLabel = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.includes(`${modeString}_label_total`) &&
                        Cartesian3.equals(label.position, lastPoint)
                );
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
            }

            // Remove the point from the group's coordinates
            group.coordinates.splice(pointIndex, 1);

            // Update or create labels for the group
            const { distances, totalDistance, clampedPositions } = this.updateOrCreateLabels(group, modeString, isClamped, false);

            if (isClamped && clampedPositions) {
                // Update the group interpolated points with the clamped positions
                group.interpolatedPoints = clampedPositions;
            }

            // Handle chart-specific actions
            if (this.handleChartSpecific) {
                // Update the selected group index
                // this.coords.selectedGroupIndex = group.labelNumberIndex;
                // Handle the chart
                this.handleChartSpecific(group.interpolatedPoints, group.coordinates);
            }

            // Update or create the total label for the group
            this.updateOrCreateTotalLabel(group, totalDistance, modeString);

            // Update the color of selected lines to indicate selection change
            this.updateSelectedLineColor(group);

            // If the group still has more than one coordinate, update the log records
            if (group.coordinates.length > 1) {
                this.updateMultiDistancesLogRecords(distances, totalDistance);
            }

            // If only one coordinate remains, perform additional cleanup
            if (group.coordinates.length === 1) {
                // Remove the last remaining point from the point collection
                const lastPoint = this.pointCollection._pointPrimitives.find(
                    p => p && Cartesian3.equals(p.position, group.coordinates[0])
                );
                if (lastPoint) this.pointCollection.remove(lastPoint);

                // Remove the total label
                const targetTotalLabel = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.includes(`${modeString}_label_total`) &&
                        Cartesian3.equals(label.position, group.coordinates[0])
                );
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

                // Clear the group's coordinates as all points have been removed
                group.coordinates = [];

                if (isClamped) {
                    // update the group interpolated points with the clamped positions
                    group.interpolatedPoints = [];
                }

                // handle chart specific actions
                if (this.handleChartSpecific) {
                    // update the selected group index
                    // this.coords.selectedGroupIndex = null;
                    // handle the chart
                    this.handleChartSpecific([], []);
                }

                // Reset submission-related properties to their default states
                this.interactivePrimitives.selectedLines = [];

                // Log the removal of the line set
                // this.logRecordsCallback(`${group.id} Removed`);
            }

            return {
                updatedGroup: group,
                removedPoint: pointPrimitive,
                removedLinePrimitives: linePrimitives,
                removedLabelPrimitives: labelPrimitives,
            }
        }
    }

    /**
     * Removes an entire line set and its associated primitives based on a line primitive.
     *
     * @param {Primitive} linePrimitive - The line primitive identifying the line set.
     * @param {string} modeString - Mode identifier.
     * @returns {Object} Returns an object with:
     *   - updatedGroup {Object}: The modified group with cleared coordinates.
     *   - removedPoints {PointPrimitive[]}: Array of removed point primitives.
     *   - removedLinePrimitives {Primitive[]}: Array of removed line primitives.
     *   - removedLabelPrimitives {LabelPrimitive[]}: Array of removed label primitives.
     * @throws {Error} If no group data is found for the primitive position.
     */
    _removeLineSetByPrimitive(linePrimitive, modeString) {
        const primitivePosition = linePrimitive.positions[0];

        // Find the index of the group that contains the primitive position
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, primitivePosition))
        );
        if (!group) throw new Error("No group data found");

        // Confirm removal with the user
        if (!confirm(`Do you want to remove the ENTIRE line set ${group.id}?`)) return;

        // Retrieve associated primitives for the group
        const { pointPrimitives, linePrimitives, labelPrimitives } = this.findPrimitivesByPositions(group.coordinates, modeString);

        // Reset color of previously selected lines
        this.interactivePrimitives.selectedLines.forEach(line => changeLineColor(line, this.stateManager.getColorState("default")));

        // Update selected lines to the current group's line primitives and update their colors
        this.interactivePrimitives.selectedLines = linePrimitives;
        this.updateSelectedLineColor(group);

        // Remove point, line, and label primitives
        pointPrimitives.forEach(p => this.pointCollection.remove(p));
        linePrimitives.forEach(l => this.viewer.scene.primitives.remove(l));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // If in add mode, exit add mode and notify the user
        if (this.flags.isAddMode) {
            this.flags.isAddMode = false;
            showCustomNotification("You have exited add line mode", this.viewer.container);
        }

        // Remove the group coordinates from the coords.groups array
        group.coordinates = [];

        // handle chart specific actions
        if (this.handleChartSpecific) {
            // update the selected group index
            // this.coords.selectedGroupIndex = null;
            // handle the chart
            this.handleChartSpecific([], []);
        }

        // reset selected lines
        this.interactivePrimitives.selectedLines = [];

        // Log the removal of the trail
        // this.logRecordsCallback(`${group.id} Removed`);

        return {
            updatedGroup: group,
            removedPoints: pointPrimitives,
            removedLinePrimitives: linePrimitives,
            removedLabelPrimitives: labelPrimitives,
        };
    }

    /**
     * Creates reconnect primitives (line and label) for measuring distances.
     *
     * @param {Array<Cartesian3>} neighbourPositions - Array of positions: [previous, current, next].
     * @param {Object} group - Group object containing measurement data.
     * @param {string} modeString - Mode identifier used for labeling primitives.
     * @param {boolean} [isClamped=false] - Flag indicating whether to clamp the line to ground.
     * @param {boolean} [isPending=false] - Flag indicating if the primitives are temporary.
     * @returns {Object|undefined} If positions length is 3, returns an object with:
     *   - linePrimitive {Primitive}: The created line primitive.
     *   - label {LabelPrimitive}: The created label primitive.
     */
    _createReconnectPrimitives(neighbourPositions, group, modeString, isClamped = false, isPending = false) {
        if (neighbourPositions.length === 3) {
            // Create reconnect line primitive
            const linePrimitive = isClamped
                ? createGroundPolylinePrimitive(
                    [neighbourPositions[0], neighbourPositions[2]],
                    isPending ? `${modeString}_line_pending` : `${modeString}_line`,
                    this.stateManager.getColorState("line"),
                    this.cesiumPkg.GroundPolylinePrimitive
                )
                : createPolylinePrimitive(
                    [neighbourPositions[0], neighbourPositions[2]],
                    isPending ? `${modeString}_line_pending` : `${modeString}_line`,
                    3,
                    this.stateManager.getColorState("line"),
                    this.cesiumPkg.Primitive
                );
            this.viewer.scene.primitives.add(linePrimitive);

            // Create reconnect label primitive
            // Calculate the distance between the two points for clamped lines or normal lines
            const distance = isClamped
                ? calculateClampedDistance(
                    neighbourPositions[0],
                    neighbourPositions[2],
                    this.viewer.scene,
                    4
                ).distance
                : calculateDistance(neighbourPositions[0], neighbourPositions[2]);

            const midPoint = Cartesian3.midpoint(
                neighbourPositions[0],
                neighbourPositions[2],
                new Cartesian3()
            );
            // Create label primitive
            const label = createLabelPrimitive(
                neighbourPositions[0],
                neighbourPositions[2],
                distance
            );
            label.show = this.flags.isShowLabels;
            label.showBackground = this.flags.isShowLabels;
            label.id = generateId(
                midPoint,
                isPending ? `${modeString}_label_pending` : `${modeString}_label`
            );
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                neighbourPositions[1],
                group
            );
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);

            return { linePrimitive, label };
        }
    }

    removeActionByPointMeasuring(pointPrimitive, modeString, isClamped = false) {
        // Find the group that contains the clicked point
        const pointPosition = pointPrimitive.position.clone();
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, pointPosition))
        );
        if (!group) return;

        // Check if the clicked point is from the same group
        const isFromSameGroup = group.coordinates.some(cart =>
            Cartesian3.equals(cart, this.coords.cache[0])
        );
        if (!isFromSameGroup) return;

        // find line and label primitives by the point position
        const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
            pointPosition,
            modeString
        );

        // Remove relevant point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove moving line and label primitives
        this.removeMovingPrimitives();

        // Create reconnect primitives
        const neighbourPositions = this.findNeighbourPosition(pointPosition, group);
        this._createReconnectPrimitives(neighbourPositions, group, modeString, isClamped, true);

        // Update coords cache
        const pointIndex = this.coords.cache.findIndex(cart =>
            Cartesian3.equals(cart, pointPosition)
        );
        if (pointIndex === -1) return;

        // Remove the point from the cache
        this.coords.cache.splice(pointIndex, 1);

        // Update or create labels for the group
        const { distances, totalDistance, clampedPositions } = this.updateOrCreateLabels(group, modeString, isClamped, true);

        // Update group interpolated points
        if (clampedPositions && clampedPositions.length > 0) {
            group.interpolatedPoints = clampedPositions;
        }

        // handle chart specific actions
        if (this.handleChartSpecific) {
            this.handleChartSpecific(group.interpolatedPoints, group.coordinates);
        }

        // Update log records
        this.updateMultiDistancesLogRecords(distances, totalDistance);

        if (group.coordinates.length === 0) {
            this.flags.isMeasurementComplete = true; // When removing the only point, consider the measure ended
            this.interactivePrimitives.selectedLines = [];
        }
    }

    /*********************
     * HIGHLIGHT FEATURE *
     *********************/
    /**
     * Resets the highlighting state of interactive primitives (lines, points, and labels).
     *
     * @returns {Object} Returns an object containing:
     *   - hoveredLine {Entity|null}: Previously hovered line entity.
     *   - addModeLine {Entity|null}: Line entity in add mode.
     *   - selectedLines {Entity[]}: Array of currently selected line entities.
     *   - hoveredPoint {Entity|null}: Previously hovered point entity.
     *   - hoveredLabel {Entity|null}: Previously hovered label entity.
     */
    resetHighlighting() {
        const { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel } = this.interactivePrimitives;
        // when mouse move out of the line, reset the line color
        // Reset hovered line if it's not the selected line
        if (
            hoveredLine &&
            hoveredLine !== addModeLine   // don't change selected line color
        ) {
            let colorToSet;
            if (selectedLines && selectedLines.includes(hoveredLine)) {
                colorToSet = this.stateManager.getColorState("select");
            } else {
                colorToSet = this.stateManager.getColorState("default");
            }

            if (!colorToSet) console.error('color is not defined');

            changeLineColor(hoveredLine, colorToSet);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset hover point
        if (hoveredPoint) {
            hoveredPoint.outlineColor = Color.RED;
            hoveredPoint.outlineWidth = 0;
            this.interactivePrimitives.hoveredPoint = null;
        }
        // Reset hover label
        if (hoveredLabel) {
            hoveredLabel.fillColor = Color.WHITE;
            this.interactivePrimitives.hoveredLabel = null;
        }

        return { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel };
    }

    /*****************************************
    *        CHART SPECIFIC FEATURES        *
    * FOR PROFILE AND PROFILEDISTANCES MODE *
    *****************************************/
    /**
     * Sets up and initializes a Chart.js chart for displaying terrain profile data.
     *
     * @param {string} modeString - Mode identifier for the chart.
     * @param {Array} interpolatedPoints - Array of interpolated points for plotting.
     * @param {Object} coordinates - Coordinate data containing measurement groups.
     * @returns {Chart} Returns the created Chart.js instance.
     */
    setupChart(modeString, interpolatedPoints, coordinates) {
        this.chartDiv = document.createElement("div");
        this.chartDiv.className = "chart";
        this.viewer.container.appendChild(this.chartDiv);

        const canvas = document.createElement("canvas");
        canvas.id = `${modeString}Chart`;
        canvas.style.width = "400px";
        canvas.style.height = "200px";
        this.chartDiv.appendChild(canvas);

        this.chartDiv.style.cssText =
            "position: absolute; top: 10px; left: 10px; z-index: 1000; background: white; width: 400px; height: 200px;";
        this.chartDiv.style.display = "none";

        // configure of the chart
        const ctx = canvas.getContext("2d");
        const chartConfig = {
            type: "line",
            data: {
                datasets: [
                    {
                        label: "Profile of Terrain",
                        labels: [],
                        data: [],
                        borderColor: "rgba(75, 192, 192, 1)",
                        borderWidth: 2,
                        fill: true,
                    },
                ],
            },
            options: {
                onHover: (_, chartElement) => {
                    if (chartElement.length) {
                        const point = chartElement[0];
                        // const label = this.chart.data.labels[point.index];
                        // const dataPoint = this.chart.data.datasets[0].data[point.index];
                        // handle cesium to update the point primitive to the hover point
                        if (this.coords.groups.length > 0) {
                            const group = this.coords.groups[this.coords.selectedGroupIndex];
                            if (!group) return;
                            const interpolatedPoints = group.interpolatedPoints;
                            const pointIndex = point.index;
                            this.createPointForChartHoverPoint(interpolatedPoints[pointIndex], modeString);
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Distance (meters)",
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Height (meters)",
                        },
                    },
                },
            },
        }


        // create the chart
        this.chart = new Chart(ctx, chartConfig);

        // Store custom data for the chart; 
        // !important: custom data should be stored after the chart is created
        this.chart.customData = {
            modeString,
            interpolatedPoints,
            coordinates
        }

        // make the chart draggable
        makeDraggable(this.chartDiv, this.viewer.container);

        return this.chart;
    }

    /**
     * Displays the tooltip at the specified index in the chart.
     *
     * @param {Chart} chart - Chart.js chart instance.
     * @param {number} index - Index at which to display the tooltip.
     */
    showTooltipAtIndex(chart, index) {
        if (chart.data.datasets.length > 0 && chart.data.datasets[0].data.length > 1) {
            chart.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], chart.getDatasetMeta(0).data[1].element);
            chart.update();
        } else {
            console.error('Data is not sufficient to trigger tooltip at index 1');
        }
    }

    /**
     * Creates or updates a point primitive representing the currently hovered chart point.
     *
     * @param {Cartesian3} cartesian - 3D coordinates where the point should be created.
     * @param {string} modeString - Mode identifier for labeling the point.
     * @returns {Cesium.PointPrimitive|undefined} Returns the created point primitive or undefined if cartesian is not defined.
     */
    createPointForChartHoverPoint(cartesian, modeString) {
        if (!defined(cartesian)) return;
        if (this.interactivePrimitives.chartHoveredPoint) {
            this.pointCollection.remove(this.interactivePrimitives.chartHoveredPoint)
            this.interactivePrimitives.chartHoveredPoint = null;
        };
        const point = createPointPrimitive(
            cartesian,
            this.stateManager.getColorState("hoverChatPoint"),
            `${modeString}_moving`
        );
        const pointPrimitive = this.pointCollection.add(point);
        this.interactivePrimitives.chartHoveredPoint = pointPrimitive;

        return pointPrimitive;
    }

    /**
     * Updates the chart with new data and custom properties.
     *
     * @param {Array} labels - Labels for the chart's x-axis.
     * @param {Array} data - Data points for the chart.
     * @param {Array} [clampedPositions] - Optional array of interpolated points.
     * @param {Object} [coordinates] - Optional coordinate data.
     * @param {string} [modeString] - Optional mode identifier.
     * @returns {Chart|undefined} Returns the updated chart object if it exists.
     */
    updateChart(labels, data, clampedPositions, coordinates, modeString) {
        if (!this.chart) return;

        // Update required chart data
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = data;

        // Initialize customData if it doesn't exist
        this.chart.customData = this.chart.customData || {};

        // Create new custom data object with conditional properties
        const newCustomData = {
            ...(clampedPositions && { interpolatedPoints: clampedPositions }),
            ...(coordinates && { coordinates }),
            ...(modeString && { modeString })
        };

        // Merge with existing customData, only updating provided values
        this.chart.customData = {
            ...this.chart.customData,
            ...newCustomData
        };

        this.chart.update();
        return this.chart;
    }

    /**
     * Removes the chart used in profile and profileDistances modes.
     */
    removeChart() {
        if (this.chartDiv) {
            this.chartDiv.remove();
            this.chart = null;
            this.chartDiv = null;
        }
    }

    /*****************
     * OTHER FEATURE *
     *****************/
    /**
     * Sets up extra buttons for a given mode and manages their visibility based on UI state.
     *
     * @param {string} modeString - Mode identifier for the buttons.
     * @param {number} [reverseIndex=0] - Reverse index used for positioning the button from the right.
     */
    setUpExtraButtons(modeString, reverseIndex = 0) {
        const createButton = (text, className, onClick) => {
            const button = document.createElement("button");
            button.innerHTML = text;
            button.classList.add("cesium-button", "measure-mode-button", "show", className);
            button.setAttribute("type", "button");
            button.setAttribute("aria-label", `${className}`);
            button.setAttribute("aria-pressed", "false"); // For toggle behavior
            button.addEventListener("click", onClick);
            return button;
        };

        const setUpObserver = (target, callback, options) => {
            const observer = new MutationObserver(callback);
            observer.observe(target, options);
            return observer;
        };

        const toggleButtonVisibility = (activeModeButton, measureToolButton) => {
            const shouldDisplay =
                activeModeButton.classList.contains('active') &&
                measureToolButton.classList.contains('active');
            // Get the label button
            const labelButton = this.stateManager.getButtonState("labelButton");
            if (!labelButton) return; // Error handling: Exit if the label button is not found
            // Toggle the visibility of the label button
            labelButton.style.display = shouldDisplay ? 'block' : 'none';
        };

        const updateLabelButtonOverlay = (labelButton) => {
            const labelButtonText = labelButton.innerHTML.toLowerCase();
            if (labelButtonText === "hide") {
                this.updateButtonOverlay(labelButton, "toggle label off");
            } else if (labelButtonText === "show") {
                this.updateButtonOverlay(labelButton, "toggle label on");
            }
        }

        // Get the map cesium web component
        const mapCesium = document.querySelector("map-cesium");
        // Get the measure toolbox under map cesium
        const measureToolbox = mapCesium && mapCesium.shadowRoot.querySelector("cesium-measure");
        if (!measureToolbox) return; // Error handling: Exit if the measure toolbox is not found

        // Remove and create a new label button
        const existingLabelButton = this.stateManager.getButtonState("labelButton");
        if (existingLabelButton) { // if label button exist, set the state and add event listener
            existingLabelButton.remove();
        }
        // create the label button
        const labelButton = createButton("Hide", "toggle-label-button", this.handleLabelToggle.bind(this, modeString));
        labelButton.style.display = "none"; // Initially hidden
        this.stateManager.setButtonState("labelButton", labelButton); // Set the label button state

        // initialize the overlay text for the label button
        updateLabelButtonOverlay(labelButton);

        // Set up a MutationObserver on labelButton to update the overlay whenever its text changes.
        setUpObserver(labelButton, () => { updateLabelButtonOverlay(labelButton) }, { childList: true, characterData: true, subtree: true });

        // Set up a MutationObserver to watch for the presence of required elements
        setUpObserver(measureToolbox.shadowRoot, (_, obs) => {
            // Get the measure tool mode button
            const formattedModeString = modeString.replace(/_/g, "-");  // replace "_" with "-"; Note: class use this format "multi-distance"; modeString using "multi_distance"
            const toolMode = measureToolbox.shadowRoot.querySelector(`.${formattedModeString}`);

            // Get the measure toolbar
            const toolbar = measureToolbox.shadowRoot.querySelector(".measure-toolbar");

            // Get the measure toolbox button
            const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");
            if (!toolMode || !toolbar || !measureToolButton) return; // Error handling: Exit if the required elements are not found

            const labelButton = this.stateManager.getButtonState("labelButton");
            if (!labelButton) return; // Error handling: Exit if the label button is not found

            // Position buttons
            const BUTTON_WIDTH = 45; // Width of each button in pixels; This is common width of annotation buttons
            labelButton.style.left = `-${BUTTON_WIDTH * reverseIndex}px`; // Position the label button starts counting from the right
            labelButton.style.top = "-40px";

            // Append label buttons to the toolbar
            toolbar.appendChild(labelButton);

            obs.disconnect(); // Stop observing once the buttons are appended

            // Initial visibility check
            toggleButtonVisibility(toolMode, measureToolButton);

            // Set up another MutationObserver to watch class changes for visibility toggling
            setUpObserver(toolMode, () => toggleButtonVisibility(toolMode, measureToolButton), { attributes: true, attributeFilter: ['class'] });
            setUpObserver(measureToolButton, () => toggleButtonVisibility(toolMode, measureToolButton), { attributes: true, attributeFilter: ['class'] });
        }, { childList: true, subtree: true });
    }

    /**
     * Updates existing label primitives or creates new ones for measurement visualization.
     *
     * @param {Object} group - Group object containing coordinates and label data.
     * @param {string} modeString - Mode identifier.
     * @param {boolean} [isClamped=false] - Flag indicating whether to use ground clamped distances.
     * @param {boolean} [isPending=false] - Flag indicating if labels are temporary.
     * @returns {Object} Returns an object with:
     *   - distances {number[]}: Array of calculated distances.
     *   - clampedPositions {Cartesian3[]|undefined}: Array of clamped positions if applicable.
     *   - totalDistance {number}: Total distance sum.
     */
    updateOrCreateLabels(group, modeString, isClamped = false, isPending = false) {
        const midPoints = group.coordinates.slice(0, -1).map((pos, i) =>
            Cartesian3.midpoint(pos, group.coordinates[i + 1], new Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels.filter(
            l => l.id && l.id.includes(`${modeString}_label`)
        );

        // Arrays to collect distances and clampedPositions
        const distances = [];
        const allClampedPositions = [];


        // Update or create label primitives
        midPoints.forEach((midPoint, index) => {
            // find existed label primitives  
            let relativeLabelPrimitives = labelPrimitives.filter(l =>
                Cartesian3.equals(l.position, midPoint)
            );

            // Wrap the letter back to 'a' after 'z'
            const currentLetter = String.fromCharCode(97 + index % 26); // 'a' to 'z' to 'a' to 'z'...

            // Don't use getLabelProperties currentLetter in here as midPoint index is not the group coordinate index
            // const { labelNumberIndex } = this._getLabelProperties(
            //     group.coordinates[index],
            //     group

            // calculate distance based on whether is clamped to ground distance or not
            let distance, clampedPositions;
            if (isClamped) {
                const clampedResult = calculateClampedDistance(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                    this.viewer.scene,
                    4
                );
                distance = clampedResult.distance;
                clampedPositions = clampedResult.clampedPositions;
            } else {
                distance = calculateDistance(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                );
            };
            // error handling for no distance
            if (!distance) return; // Skip if distance is null or undefined

            // Store the calculated values
            distances.push(distance);
            if (clampedPositions) {
                allClampedPositions.push(...clampedPositions);
            }

            // create the label text
            const labelText = `${currentLetter}${group.labelNumberIndex}: ${formatDistance(distance)}`;

            // update existed labels if any
            if (relativeLabelPrimitives.length > 0) {
                // Update existing labels
                relativeLabelPrimitives.forEach(label => {
                    label.text = labelText;
                    label.show = this.flags.isShowLabels;
                    label.showBackground = this.flags.isShowLabels;
                });
            } else {    // Create new label
                const newLabel = createLabelPrimitive(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                    distance
                );
                newLabel.text = labelText;
                newLabel.show = this.flags.isShowLabels;
                newLabel.showBackground = this.flags.isShowLabels;
                newLabel.pixelOffset = new Cartesian2(0, -20);
                newLabel.position = midPoint;
                newLabel.id = isPending
                    ? generateId(midPoint, `${modeString}_label_pending`)
                    : generateId(midPoint, `${modeString}_label`);
                this.labelCollection.add(newLabel);
            }
        });

        return {
            distances,
            clampedPositions: allClampedPositions.length > 0 ? allClampedPositions : undefined,
            totalDistance: distances.reduce((acc, val) => acc + val, 0),
        };
    }

    /**
     * Gets label text properties based on a position within a group.
     *
     * @param {Cartesian3} position - Current position.
     * @param {Object} group - Group object containing measurement data.
     * @returns {Object} Returns an object with:
     *   - currentLetter {string}: Alphabetic label (a-z) or empty string.
     *   - labelNumberIndex {number}: Numeric index for the label.
     */
    _getLabelProperties(position, group) {
        // Find the index of the position in group
        const positionIndex = group.coordinates.findIndex(cart => Cartesian3.equals(cart, position));
        if (positionIndex === -1 || positionIndex === 0) return { currentLetter: "", labelNumberIndex: 0 }; // label exist when there is at least 2 position.

        // Calculate label index
        const labelIndex = positionIndex - 1;

        // Map index to alphabet letters starting from 'a'
        const currentLetter = String.fromCharCode(97 + (labelIndex % 26));

        // Use labelNumberIndex from the group
        const labelNumberIndex = group.labelNumberIndex;

        return { currentLetter, labelNumberIndex };
    }

    /**
     * Creates or updates the total distance label for a measurement group.
     *
     * @param {Object} group - Group object containing measurement data.
     * @param {number} totalDistance - Total calculated distance.
     * @param {string} modeString - Mode identifier for labeling.
     * @returns {LabelPrimitive} Returns the created or updated total distance label primitive.
     */
    updateOrCreateTotalLabel(group, totalDistance, modeString) {
        const currentPosition = group.coordinates[group.coordinates.length - 1];

        let totalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes(`${modeString}_label_total`) &&
                group.coordinates.some(pos => Cartesian3.equals(label.position, pos))
        );

        if (!totalLabel) {
            const label = createLabelPrimitive(
                currentPosition,
                currentPosition,
                totalDistance
            );
            totalLabel = this.labelCollection.add(label);
        }

        // Update label properties for both new and existing labels
        totalLabel.id = generateId(currentPosition, `${modeString}_label_total`);
        totalLabel.show = this.flags.isShowLabels;
        totalLabel.showBackground = this.flags.isShowLabels;
        totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        totalLabel.pixelOffset = new Cartesian2(0, -20);
        totalLabel.position = currentPosition;

        return totalLabel;
    }


    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * Updates the overlay text for a button and manages its display on mouse events.
     *
     * @param {HTMLElement} button - The button element.
     * @param {string} overlayText - Text to display in the overlay.
     * @throws {Error} If the button overlay or overlay text is undefined.
     */
    updateButtonOverlay(button, overlayText) {
        const buttonOverlay = this.stateManager.getOverlayState("button");
        if (!buttonOverlay || !overlayText) throw new Error("Button overlay or overlay text is not defined");

        button.addEventListener("mouseover", (e) => {
            const cesiumRect = this.viewer.container.getBoundingClientRect();
            buttonOverlay.style.display = "block";
            buttonOverlay.innerHTML = `${overlayText}`;
            buttonOverlay.style.left = e.pageX - cesiumRect.x + "px";
            buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
        });

        button.addEventListener("mouseout", () => {
            buttonOverlay.style.display = "none";
        });
    }

    /**
     * Toggles the visibility of labels and updates the label button state.
     *
     * @param {string} modeString - Mode identifier used to filter labels.
     * @returns {LabelPrimitive[]} Returns an array of labels that were toggled.
     */
    handleLabelToggle(modeString) {
        // Toggle the flag
        if (this.flags.isShowLabels === undefined) console.error("flags.isShowLabels is undefined"); // Error handling: Exit if the flag is undefined
        this.flags.isShowLabels = !this.flags.isShowLabels;

        // Get the label button
        const labelButton = this.stateManager.getButtonState("labelButton");
        if (!labelButton) return; // Error handling: Exit if the label button is not found

        if (this.flags.isShowLabels) {  // Show labels
            labelButton.textContent = "Hide"
            labelButton.setAttribute("aria-pressed", "true");
        } else {   // Hide labels
            labelButton.textContent = "Show";
            labelButton.setAttribute("aria-pressed", "false");
        }

        // Get all labels by the modeString
        const labels = this.labelCollection._labels.filter(label =>
            label.id &&
            label.id.startsWith(`annotate_${modeString}_label`)
        )

        // Toggle the visibility of the labels
        labels.forEach((label) => {
            label.show = this.flags.isShowLabels
            label.showBackground = this.flags.isShowLabels;
        });


        return labels;
    }

    /**
     * Removes various moving primitives from the scene based on provided options.
     *
     * @param {Object} [options={}] - Options for removal.
     * @param {boolean} [options.removePoint=false] - Whether to remove the moving point primitive.
     * @param {boolean} [options.removePoints=false] - Whether to remove multiple moving point primitives.
     * @param {boolean} [options.removeLines=true] - Whether to remove moving line primitives.
     * @param {boolean} [options.removeLabels=true] - Whether to remove moving label primitives.
     * @param {boolean} [options.removePolygon=false] - Whether to remove the moving polygon and its outline.
     */
    removeMovingPrimitives({ removePoint = false, removePoints = false, removeLines = true, removeLabels = true, removePolygon = false } = {}) {
        // Remove moving point primitive
        if (removePoint && this.interactivePrimitives.movingPoint) {
            this.pointCollection.remove(this.interactivePrimitives.movingPoint);
            this.interactivePrimitives.movingPoint = null;
        }

        // Remove moving points primitives
        if (removePoints && this.interactivePrimitives.movingPoints && this.interactivePrimitives.movingPoints.length > 0) {
            this.interactivePrimitives.movingPoints.forEach(primitive =>
                this.pointCollection.remove(primitive)
            );
            this.interactivePrimitives.movingPoints.length = 0;
        }

        // Remove moving line primitives
        if (removeLines && this.interactivePrimitives.movingPolylines && this.interactivePrimitives.movingPolylines.length > 0) {
            this.interactivePrimitives.movingPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.movingPolylines.length = 0;
        }

        // Remove moving label primitives
        if (removeLabels && this.interactivePrimitives.movingLabels && this.interactivePrimitives.movingLabels.length > 0) {
            this.interactivePrimitives.movingLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.movingLabels.length = 0;
        }

        // Remove moving polygon primitive and polygon outline primitive
        if (removePolygon && this.interactivePrimitives.movingPolygon && this.interactivePrimitives.movingPolygonOutline) {
            this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
            this.interactivePrimitives.movingPolygon = null;
            this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
            this.interactivePrimitives.movingPolygonOutline = null;
        }
    }

    /**
     * Removes drag moving primitives from the scene based on provided options.
     *
     * @param {Object} options - Options for removal.
     * @param {boolean} [options.removePoint=false] - Whether to remove the drag moving point primitive.
     * @param {boolean} [options.removePoints=false] - Whether to remove multiple drag moving points.
     * @param {boolean} [options.removeLines=true] - Whether to remove drag moving line primitives.
     * @param {boolean} [options.removeLabels=true] - Whether to remove drag moving label primitives.
     * @param {boolean} [options.removePolygon=false] - Whether to remove the drag moving polygon and its outline.
     */
    removeDragMovingPrimitives({ removePoint = false, removePoints = false, removeLines = true, removeLabels = true, removePolygon = false } = {}) {
        // Remove moving point primitive
        if (removePoint && this.interactivePrimitives.dragPoint) {
            this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
        }

        // Remove moving point primitives
        if (removePoints && this.interactivePrimitives.dragPoints && this.interactivePrimitives.dragPoints.length > 0) {
            this.interactivePrimitives.dragPoints.forEach(p => this.pointCollection.remove(p));
            this.interactivePrimitives.dragPoints.length = 0;
        }


        if (removeLines && this.interactivePrimitives.dragPolylines && this.interactivePrimitives.dragPolylines.length > 0) {
            // Remove moving line primitives
            this.interactivePrimitives.dragPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.dragPolylines.length = 0;
        }

        if (removeLabels && this.interactivePrimitives.dragLabels && this.interactivePrimitives.dragLabels.length > 0) {
            // Remove moving label primitives
            this.interactivePrimitives.dragLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.dragLabels.length = 0;
        }

        // Remove drag moving polygon primitive and polygon outline primitive
        if (removePolygon && this.interactivePrimitives.dragPolygon && this.interactivePrimitives.dragPolygonOutline) {
            this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygon);
            this.interactivePrimitives.dragPolygon = null;
            this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygonOutline);
            this.interactivePrimitives.dragPolygonOutline = null;
        }
    }

    /**
     * Finds relative primitives (point, line, and label) by a given position and mode identifier.
     *
     * @param {Cartesian3} position - Position to search for primitives.
     * @param {string} modeString - Mode identifier to filter primitives.
     * @returns {Object} Returns an object containing:
     *   - pointPrimitive {Object}: The matching point primitive.
     *   - linePrimitives {Object[]}: Array of matching line primitives.
     *   - labelPrimitives {Object[]}: Array of matching label primitives.
     */
    findPrimitiveByPosition(position, modeString) {
        // get point primitive by position
        const pointPrimitive = this.pointCollection._pointPrimitives.find(p =>
            p.id &&
            p.id.startsWith(`annotate_${modeString}`) &&
            !p.id.includes("moving") &&
            Cartesian3.equals(p.position, position)
        );

        // get line primitives by position
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.startsWith(`annotate_${modeString}`) &&
            !p.id.includes("moving") &&
            p.positions.some(cart => Cartesian3.equals(cart, position))
        );

        // get label primitives by lines positions
        // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
        const linePositions = linePrimitives.map(p => p.positions);
        const midPoints = linePositions.map((positions) => Cartesian3.midpoint(positions[0], positions[1], new Cartesian3()));
        const labelPrimitives = midPoints.map(midPoint =>
            this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith(`annotate_${modeString}`) &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, midPoint)
            )
        ).filter(label => label !== undefined);

        // Sort labelPrimitives by their text
        labelPrimitives.sort((a, b) => a.text.toUpperCase().localeCompare(b.text.toUpperCase()));

        return { pointPrimitive, linePrimitives, labelPrimitives };
    }

    /**
     * Finds the neighboring positions of a given position within a group.
     *
     * @param {Cartesian3} position - The reference position.
     * @param {Object} group - Group containing a coordinates array.
     * @returns {Cartesian3[]} Returns an array with the previous, current, and next positions (excluding nulls).
     */
    findNeighbourPosition(position, group) {
        const pointIndex = group.coordinates.findIndex(cart => Cartesian3.equals(cart, position));
        if (pointIndex === -1) return;

        let prevPosition = null;
        let nextPosition = null;

        if (pointIndex > 0) {
            prevPosition = group.coordinates[pointIndex - 1] || null;
        }
        if (pointIndex < group.coordinates.length - 1) {
            nextPosition = group.coordinates[pointIndex + 1] || null;
        }

        return [prevPosition, position, nextPosition].filter(pos => pos !== null);
    }

    /**
     * Finds and returns primitives (points, lines, and labels) that match given positions and mode identifier.
     *
     * @param {Cartesian3[]} positions - Array of positions to match.
     * @param {string} modeString - Mode identifier for filtering primitives.
     * @returns {Object} Returns an object with:
     *   - pointPrimitives {Object[]}: Array of matching point primitives.
     *   - linePrimitives {Object[]}: Array of matching line primitives.
     *   - labelPrimitives {Object[]}: Array of matching label primitives.
     */
    findPrimitivesByPositions(positions, modeString) {
        // lookup points primitives
        const pointPrimitives = this.pointCollection._pointPrimitives
            .filter(p =>
                p.id &&
                p.id.startsWith(`annotate_${modeString}_point`) &&
                !p.id.includes("moving") &&
                positions.some(pos => Cartesian3.equals(p.position, pos))
            )
        // lookup line primitives
        const linePrimitives = this.findLinesByPositions(positions, modeString);

        // lookup label primitives
        const midPoints = positions.slice(0, -1).map((pos, i) =>
            Cartesian3.midpoint(pos, positions[i + 1], new Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels
            .filter(l =>
                l.id &&
                l.id.startsWith(`annotate_${modeString}_label`) &&
                midPoints.some(pos => Cartesian3.equals(l.position, pos))
            );
        const totalLabelPrimitive = this.labelCollection._labels.find(l =>
            l.id &&
            l.id.includes(`${modeString}_label_total`) &&
            Cartesian3.equals(l.position, positions[positions.length - 1])
        );
        if (totalLabelPrimitive) {
            labelPrimitives.push(totalLabelPrimitive);
        }

        return { pointPrimitives, linePrimitives, labelPrimitives };
    }

    /**
     * Finds and returns line primitives from the scene that match given positions and a mode identifier.
     *
     * @param {Array} positions - Array of positions to match against line positions.
     * @param {string} modeString - Mode identifier to filter lines.
     * @returns {Array} Returns an array of matching line primitives.
     */
    findLinesByPositions(positions, modeString) {
        // Create a set of position keys from the input positions for quick lookup
        const positionKeys = new Set(positions.map(pos => positionKey(pos)));

        // Initialize a set to store matching line primitives
        const linePrimitives = new Set();

        // Filter the primitives to find lines that match certain criteria
        const linesPrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.startsWith("annotate") &&
            p.id.includes(`${modeString}_line`) &&
            !p.id.includes("moving") // Exclude moving lines
        );

        // Iterate over the filtered lines
        linesPrimitives.forEach(line => {
            // Get the positions of the line (array of Cartesian3)
            const linePositions = line.positions; // [Cartesian3, Cartesian3]

            // Check if any position of the line matches the input positions
            linePositions.forEach(linePos => {
                if (positionKeys.has(positionKey(linePos))) {
                    // If a match is found, add the line to the set of line primitives
                    linePrimitives.add(line);
                }
            });
        });

        // Convert the set of line primitives to an array and return it
        return Array.from(linePrimitives);
    }

    /**
     * Creates a default measurement record object with a consistent structure.
     *
     * This method returns a new object that serves as the template for measurement
     * records. The returned object contains default values for properties that
     * can be later customized by specific measurement modes.
     *
     * @returns {Object} A measurement record object with the following properties:
     * @property {null|number|string} id - The unique identifier for the measurement (initially null).
     * @property {string} mode - The measurement mode (initially an empty string).
     * @property {Array.<Cartesian3>} coordinates - An array to store the measurement's coordinate positions.
     * @property {number} labelNumberIndex - The index used for labeling or ordering (initially 0).
     * @property {string} status - The status of the measurement, e.g. "pending" or "completed" (default is "pending").
     * @property {Array.<number>} _records - An array to store intermediate or final measurement values.
     * @property {Array} interpolationPoints - An array to hold interpolated coordinate points (if applicable).
     */
    _createDefaultMeasure() {
        return {
            id: null,
            mode: "",
            coordinates: [],
            labelNumberIndex: 0,
            status: "pending",
            _records: [],
            interpolationPoints: []
        };
    }
}
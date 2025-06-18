import {
    Cartesian3,
    defined,
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    calculateClampedDistance,
    getPickedObjectType,
    changeLineColor,
    generateIdByTimestamp,
    createGroundPolylinePrimitive,
    showCustomNotification,
} from "../lib/helper/cesiumHelper.js";
import MeasureModeBase from "./MeasureModeBase.js";
import dataPool from "../lib/data/DataPool.js";

class MultiDistanceClamped extends MeasureModeBase {
    /**
     * Creates a new MultiDistanceClamped instance.
     * @param {Viewer} viewer - The Cesium Viewer instance.
     * @param {ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {StateManager} stateManager - The state manager holding the tool states.
     * @param {Object} cesiumPkg - The Cesium package object.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(viewer, handler, stateManager, cesiumPkg, emitter) {
        super(viewer, handler, stateManager, cesiumPkg);

        this.mode = "multi_distances_clamped";

        // Set the event emitter
        this.emitter = emitter;

        this.pointerOverlay = this.stateManager.getOverlayState("pointer");


        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isAddMode: false,
            isShowLabels: true,
            isReverse: false,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            measureCounter: 0,    // Counter for the number of groups
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
        };

        // Measurement data
        this.measure = super._createDefaultMeasure();

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels

            dragPoint: null,        // Currently dragged point primitive
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels

            hoveredLine: null,      // Hovered line primitive
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive

            addModeLine: null,      // Primitive for adding a new line
            selectedLines: [],      // Array of selected line primitives
        };
    }

    /**
     * Configures the input actions for multi-distance clamped mode.
     */
    setupInputActions() {
        super.setupInputActions();

        // setup label button
        super.setUpExtraButtons("multi_distances_clamped", 5);
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
      * Handles left-click events to initiate or continue a multi-distance clamped measurement.
      * @param {Object} movement - The mouse movement event data.
      */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multi_distances_clamped");

        this.determineClickAction(pickedObjectType, pickedObject);
    }

    /**
     * Determines the action to perform based on the type of the picked primitive.
     * @param {string} pickedObjectType - The type identifier of the picked object.
     * @param {Object} pickedObject - The picked object from the scene.
     */
    determineClickAction(pickedObjectType, pickedObject) {
        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                this.handleLabelClick(pickedObject);
                break;
            case "point":
                this.handlePointClick(pickedObject);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;

                if (
                    !this.flags.isAddMode &&  // not in add mode
                    (this.coords.cache.length === 0 && !this.flags.isMeasurementComplete) ||  // measurement not started
                    this.flags.isMeasurementComplete // not during measurement
                ) {
                    this.selectLines(linePrimitive);
                }
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode && !this.flags.isAddMode) {
                    this.startMeasure();
                }
                if (this.flags.isAddMode) {
                    this.addAction(this.interactivePrimitives.addModeLine);
                }
                break;
        }
    }

    /**
     * Handles click events on label primitives.
     * @param {Object} pickedObject - The object representing the clicked label.
     * @returns {Object} The label primitive that was clicked.
     */
    handleLabelClick(pickedObject) {
        const labelPrimitive = pickedObject.primitive;
        if (this.coords.cache.length === 0 && !this.flags.isAddMode) {
            editableLabel(this.viewer.container, labelPrimitive);
        }
        return labelPrimitive;
    }

    /**
     * Handles click events on point primitives.
     * @param {Object} pickedObject - The object representing the clicked point.
     */
    handlePointClick(pickedObject) {
        const pointPrimitive = pickedObject.primitive;

        // If the measurement is complete and not in add mode, select the fire trail
        if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
            this.selectLines(pointPrimitive);
        }

        // If currently measuring (measurement not complete) and cache has points, remove action
        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {
            super.removeActionByPointMeasuring(pointPrimitive, "multi_distances_clamped", true);
        }

        // If the measurement is complete, check if clicked point is first or last in the group to allow continue measurement
        if (this.coords.cache.length === 0 || this.flags.isMeasurementComplete) {
            // Find the group that contains the clicked point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart =>
                    Cartesian3.equals(cart, pointPrimitive.position))
            )
            if (!group) return; // error handling: exit if no group is found
            this.measure = group; // set the group as the current measure

            // Find the index of the clicked point within the group
            const pointIndex = group.coordinates.findIndex(cart =>
                Cartesian3.equals(cart, pointPrimitive.position)
            );

            // Determine if the clicked point is the first or last point in the group
            const isFirstPoint = pointIndex === 0;
            const isLastPoint = pointIndex === group.coordinates.length - 1;

            if (isFirstPoint || isLastPoint) {
                // Remove the total distance label associated with the group
                const totalLabel = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.includes("multi_distances_clamped_label_total") &&
                    Cartesian3.equals(label.position, group.coordinates[group.coordinates.length - 1])
                );
                if (totalLabel) {
                    this.labelCollection.remove(totalLabel);
                }

                // Update group status
                group.status = "pending"; // Reset the group status to pending

                // Update to data pool
                dataPool.updateOrAddMeasure({ ...this.measure });

                // Reset measurement state to allow continuation
                this.flags.isMeasurementComplete = false;
                this.coords.cache = group.coordinates;
                this.flags.isReverse = isFirstPoint; // Reverse if the first point was clicked
            }
        }
    }

    /**
     * Selects and processes line primitives associated with a group.
     * @param {Object} primitive - The line primitive to process.
     */
    selectLines(primitive) {
        let primitivePositions = [];

        const isAnnotateLine = typeof primitive?.id === 'string' && primitive?.id?.includes("multi_distances_clamped_line")
        if (isAnnotateLine) {     // Line primitive from annotations
            primitivePositions = primitive.positions;
        } else {     // Point primitive
            primitivePositions = [primitive.position];
        }

        if (primitivePositions && primitivePositions.length > 0) {
            // Find existing group containing the first position
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, primitivePositions[0]))
            );
            if (!group) return; // error handling: exit if no group is found
            this.measure = group; // set the group as the current measure

            // Display notification for the selected group
            showCustomNotification(`selected line: ${group.id}`, this.viewer.container)

            // Update log table for the current selected line 
            this.emitter.emit("selected:info", [{ "selected line": group.id }]);

            // Reset the previous selection if any
            if (this.interactivePrimitives.selectedLines.length > 0) {
                // Use this.interactivePrimitive.selectedLines before assigning the current one to look up previous selected lines
                // Find the previous selected group
                const pos = this.interactivePrimitives.selectedLines[0].positions;
                const prevGroup = this.coords.groups.find(group =>
                    group.coordinates.some(cart => Cartesian3.equals(cart, pos[0]))
                );
                if (!prevGroup) return; // Exit if no previous group is found

                // Find the previous selected lines
                const prevLines = super.findLinesByPositions(prevGroup.coordinates, "multi_distances_clamped");

                // reset the previous selected lines
                prevLines.forEach(line => {
                    // reset line color
                    changeLineColor(line, this.stateManager.getColorState("default"));
                });
            }

            // Find the current selected lines
            const currentLines = super.findLinesByPositions(group.coordinates, "multi_distances_clamped");

            // Highlight the currently selected lines
            currentLines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select")); // reset line color
            });

            // Update the selected group and lines
            this.interactivePrimitives.selectedLines = currentLines;
        }
    }

    /**
     * Initiates the measurement process 
     */
    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = super._createDefaultMeasure();

            // Set values for the new measure
            this.measure.id = generateIdByTimestamp();
            this.measure.mode = this.mode;
            this.measure.labelNumberIndex = this.coords.measureCounter;
            this.measure.status = "pending";

            // Establish data relation
            this.coords.groups.push(this.measure);
            this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
            this.coords.measureCounter++;
        }

        // Reset the selection highlight to the default color for lines
        if (this.interactivePrimitives.selectedLines.length > 0) {
            this.interactivePrimitives.selectedLines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("default"));
            });
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "multi_distances_clamped_point_pending");
        const pointPrimitive = this.pointCollection.add(point);
        const firstPointPosition = pointPrimitive.position.clone();

        // Update the coordinate cache based on the measurement direction
        if (this.flags.isReverse) {
            this.coords.cache.unshift(this.coordinate);
        } else {
            this.coords.cache.push(this.coordinate);
        }

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Continue measurement if there are enough points in the cache
        if (this.coords.cache.length > 1) {
            this.continueMeasure(firstPointPosition);
        }
    }

    /**
     * Continues the current measurement by finalizing a segment and updating labels.
     * @param {Cartesian3} position - The current coordinate position.
     */
    continueMeasure(position) {
        // Remove the moving line and label primitives to continue measurement
        super.removeMovingPrimitives();

        // Find the group that contains the given position
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, position))
        );
        if (!group) return; // error handling: exit if no group is found
        this.measure = group; // set the group as the current measure

        // Determine the indices of the previous and current points based on the measurement direction
        const [prevIndex, currIndex] = this.flags.isReverse
            ? [0, 1] // If reversing, use the first two points
            : [group.coordinates.length - 2, group.coordinates.length - 1]; // Otherwise, use the last two points

        const prevPointCartesian = group.coordinates[prevIndex];
        const currPointCartesian = group.coordinates[currIndex];

        const linePrimitive = createGroundPolylinePrimitive(
            [prevPointCartesian, currPointCartesian],
            "multi_distances_clamped_line_pending",
            this.stateManager.getColorState("line"),
            this.cesiumPkg.GroundPolylinePrimitive
        )
        this.viewer.scene.primitives.add(linePrimitive);

        // Update or create the associated labels for the group
        const { distances, clampedPositions, totalDistance } = super.updateOrCreateLabels(group, "multi_distances_clamped", true, true);

        // Update group interpolated points
        group.interpolatedPoints = clampedPositions;

        // Update group status and records
        group.status = "pending";
        group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });
    }

    /**
     * Finalizes an 'add action' by processing the selected line primitive,
     * creating reconnect primitives if needed, and updating labels.
     * @param {Object} linePrimitive - The line primitive that is being added.
     */
    addAction(linePrimitive) {
        const linePositions = linePrimitive.positions;

        // Find the group that contains the line positions
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, linePositions[0]))
        );
        if (!group || group.length === 0) return;
        this.measure = group; // set the group as the current measure

        // Find the smallest index of the line positions in the group
        const linePositionIndex1 = group.coordinates.findIndex(cart => Cartesian3.equals(cart, linePositions[0]));
        const linePositionIndex2 = group.coordinates.findIndex(cart => Cartesian3.equals(cart, linePositions[1]));
        const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);

        // Check if there is already a point near the coordinate to avoid duplicates
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);

        if (!isNearPoint) {
            // Create a new point primitive
            const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "multi_distances_clamped_point");
            this.pointCollection.add(point);

            // Insert the new coordinate into the group's coordinates at the correct position
            group.coordinates.splice(positionIndex + 1, 0, this.coordinate);
        }

        // Create line and label primitives
        const neighbourPositions = super.findNeighbourPosition(
            group.coordinates[positionIndex + 1],
            group
        );

        // Remove selected line and its label
        this.viewer.scene.primitives.remove(linePrimitive);
        const midPoint = Cartesian3.midpoint(
            linePositions[0],
            linePositions[1],
            new Cartesian3()
        );
        const existedLabel = this.labelCollection._labels.find(l =>
            l.id &&
            l.id.includes("multi_distances_clamped_label") &&
            Cartesian3.equals(l.position, midPoint)
        );
        if (existedLabel) this.labelCollection.remove(existedLabel);

        // Create reconnect primitives
        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // Create line primitives
                if (i < neighbourPositions.length - 1) {
                    const newLinePrimitive = createGroundPolylinePrimitive(
                        [pos, neighbourPositions[i + 1]],
                        "multi_distances_clamped_line",
                        this.stateManager.getColorState("line"),
                        this.cesiumPkg.GroundPolylinePrimitive
                    )
                    this.viewer.scene.primitives.add(newLinePrimitive);
                }
            });
        }

        // Update or create labels for the group
        const { distances, totalDistance, clampedPositions } = super.updateOrCreateLabels(group, "multi_distances_clamped", true);

        // Update or create total distance label
        super.updateOrCreateTotalLabel(group, totalDistance, "multi_distances_clamped");

        // update selected line color
        this.updateSelectedLineColor(group);

        // Update the interpolated points of the group
        group.interpolatedPoints = clampedPositions;

        // Update groups status and records
        group.status = "completed";
        group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Reset flags
        this.flags.isAddMode = false;
        this.interactivePrimitives.addModeLine = null;
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to update the current coordinate, pointer overlay, and dynamic primitives.
     * @param {Object} movement - The mouse movement event data.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!defined(cartesian)) return;

        // Update the current coordinate and pick objects
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

        if (isMeasuring) {
            this.handleActiveMeasure(cartesian);
        } else {
            this.handleHoverHighlighting(pickedObjects[0]);  // highlight the line when hovering
        }
    }

    /**
     * Handles active measurement by drawing a moving line primitive from the reference point to the current position.
     * @param {Cartesian3} cartesian - The current coordinate position.
     */
    handleActiveMeasure(cartesian) {
        // Determine the reference point based on measurement direction
        let referencePointCartesian = null;
        if (this.flags.isReverse) {
            referencePointCartesian = this.coords.cache[0];
        } else {
            referencePointCartesian = this.coords.cache[this.coords.cache.length - 1];
        }

        // Remove existing moving primitives
        super.removeMovingPrimitives();

        // Create current line primitive
        const currentLinePrimitive = createGroundPolylinePrimitive(
            [referencePointCartesian, cartesian],
            "multi_distances_clamped_line_moving",
            this.stateManager.getColorState("move"),
            this.cesiumPkg.GroundPolylinePrimitive
        )
        const addedLinePrimitive = this.viewer.scene.primitives.add(currentLinePrimitive);
        this.interactivePrimitives.movingPolylines.push(addedLinePrimitive);

        // Calculate distance and create label
        const { distance: calculatedDistance } = calculateClampedDistance(
            referencePointCartesian,
            cartesian,
            this.viewer.scene,
            4
        );
        const labelPosition = Cartesian3.midpoint(
            referencePointCartesian,
            cartesian,
            new Cartesian3()
        );
        const distanceLabel = createLabelPrimitive(
            referencePointCartesian,
            cartesian,
            calculatedDistance
        );
        distanceLabel.showBackground = false;
        distanceLabel.show = this.flags.isShowLabels;
        distanceLabel.id = generateId(labelPosition, "multi_distances_clamped_label_moving");
        const addedLabelPrimitive = this.labelCollection.add(distanceLabel);
        this.interactivePrimitives.movingLabels.push(addedLabelPrimitive);
    }

    /**
     * Handles hover events to highlight line, point, or label primitives when the mouse moves over them.
     * @param {Object} pickedObject - The object obtained from the scene pick.
     */
    handleHoverHighlighting(pickedObject) {
        super.handleHoverHighlighting(pickedObject, "multi_distances_clamped");
    }


    /************************
     * RIGHT CLICK FEATURES *
     ************************/
    /**
     * Handles right-click events during multi-distance clamped measurement.
     * @param {Object} movement - The mouse movement event data.
     */
    handleRightClick(movement) {
        // place last point and place last line
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!defined(cartesian)) return;

            // Update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(
                p => p.id && p.id.includes("pending")
            );
            pendingPoints.forEach(p => {
                p.id = p.id.replace("_pending", "");
            });

            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(
                p =>
                    p.id &&
                    p.id.startsWith("annotate") &&
                    p.id.includes("pending") &&
                    p.id.includes("line")
            );
            pendingLines.forEach(p => {
                p.id = p.id.replace("_pending", "");
                changeLineColor(p, this.stateManager.getColorState("default"));
            });

            // update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l =>
                l.id && l.id.includes("pending")
            );
            pendingLabels.forEach(l => {
                l.id = l.id.replace("_pending", "")
            });

            // Remove moving line and label primitives
            super.removeMovingPrimitives();

            // Check if the last point is near any existing point
            const isNearPoint = this.coords.groups
                .flatMap(group => group.coordinates)
                .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
            if (isNearPoint) return;

            // Create last point
            const lastPoint = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "multi_distances_clamped_point");
            this.pointCollection.add(lastPoint);

            // Create last line
            let referencePointCartesian = null;
            if (this.flags.isReverse) {
                referencePointCartesian = this.coords.cache[0];
                this.coords.cache.unshift(this.coordinate);
            } else {
                referencePointCartesian = this.coords.cache[this.coords.cache.length - 1];
                // Update coordinate data cache
                this.coords.cache.push(this.coordinate);
            }

            const linePrimitive = createGroundPolylinePrimitive(
                [referencePointCartesian, this.coordinate],
                "multi_distances_clamped_line",
                this.stateManager.getColorState("default"),
                this.cesiumPkg.GroundPolylinePrimitive
            )
            this.viewer.scene.primitives.add(linePrimitive);

            // Find the group that contains the line positions
            const group = this.coords.groups.find(g => g.coordinates.some(cart => Cartesian3.equals(this.coordinate, cart)));
            if (!group) return; // error handling: exit if no group is found
            this.measure = group; // set the group as the current measure

            // Update or create labels for the group
            const { distances, totalDistance, clampedPositions } = super.updateOrCreateLabels(group, "multi_distances_clamped", true);

            // Update or create total distance label
            super.updateOrCreateTotalLabel(group, totalDistance, "multi_distances_clamped");

            // update selected line
            const lines = super.findLinesByPositions(group.coordinates, "multi_distances_clamped");
            this.interactivePrimitives.selectedLines = lines;
            lines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select"));
            });

            // Update group interpolated points
            group.interpolatedPoints = clampedPositions;

            // Update this.measure status and records
            group.status = "completed";
            group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });

            // Set flags
            this.flags.isMeasurementComplete = true; // set to true to prevent further measurement
            this.flags.isReverse = false; // reset reverse flag

            // Clear cache
            this.coords.cache = [];
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates the drag action for measurement points.
     * @param {Object} movement - The mouse movement event data at drag start.
     */
    handleDragStart(movement) {
        super._initializeDragStart(movement, "multi_distances_clamped", true);
    };

    /**
     * Updates the positions of measurement primitives during a drag operation.
     * @param {Object} movement - The mouse movement event data.
     * @param {Object} selectedPoint - The point primitive being dragged.
     */
    handleDragMove(movement, selectedPoint) {
        super._initializeDragMove(movement, selectedPoint, "multi_distances_clamped", true, true);
    };

    /**
     * Ends the drag operation and finalizes the positions of the measurement primitives.
     */
    handleDragEnd() {
        super._initializeDragEnd("multi_distances_clamped", true, true);
    };


    /************************
     * DOUBLE CLICK FEATURE *
     ************************/
    /**
     * Handles double-click events to finalize current measurement or perform related actions.
     * @param {Object} movement - The mouse movement event data.
     */
    handleDoubleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multi_distances_clamped");

        switch (pickedObjectType) {
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.setAddModeByLine(linePrimitive)
                break
        }
    }

    /**
     * Sets the add mode using the specified line primitive.
     * @param {Object} linePrimitive - The line primitive to use for setting add mode.
     */
    setAddModeByLine(linePrimitive) {
        // Reset the previously selected line if it exists and is different from the current selection
        if (
            this.interactivePrimitives.addModeLine &&
            this.interactivePrimitives.addModeLine !== linePrimitive
        ) {
            const previousSelectedLine = this.interactivePrimitives.addModeLine;

            if (this.interactivePrimitives.selectedLines.includes(this.interactivePrimitives.addModeLine)) {
                changeLineColor(previousSelectedLine, this.stateManager.getColorState("select"));
            } else {
                changeLineColor(previousSelectedLine, this.stateManager.getColorState("default"));
            }

            this.interactivePrimitives.addModeLine = null;
        }

        // reset previous selected lines if any
        this.interactivePrimitives.selectedLines.forEach(line =>
            changeLineColor(line, this.stateManager.getColorState("default"))
        );

        // update the selected lines to the selected line and update its highlight color
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, linePrimitive.positions[0]))
        );
        if (!group) return; // error handling: exit if no group is found
        this.measure = group; // set the group as the current measure

        // update the selected lines to the selected line and update its highlight color
        this.updateSelectedLineColor(group);

        // Change the color of the newly selected line to indicate it is being added
        changeLineColor(linePrimitive, this.stateManager.getColorState("add"));
        // Update the reference to the currently selected line
        this.interactivePrimitives.addModeLine = linePrimitive;

        // Enable add mode if a line is selected
        if (this.interactivePrimitives.addModeLine) {
            this.flags.isAddMode = true;
            // Display a custom notification to inform the user
            showCustomNotification(`Trail id ${group.id} have entered add line mode`, this.viewer.container);

            // Update log table for the current selected line
            this.emitter.emit("selected:info", [{ "select line": `${group.id}` }]);

            // Update group status
            group.status = "pending";
            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });
        }
    }


    /************************
     * MIDDLE CLICK FEATURE *
     ************************/
    /**
     * Handles middle-click events during multi-distance clamped measurement.
     * @param {Object} movement - The mouse movement event data.
     */
    handleMiddleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multi_distances_clamped");

        switch (pickedObjectType) {
            case "point":
                const pointPrimitive = pickedObject.primitive;
                super._removeActionByPoint(pointPrimitive, "multi_distances_clamped", true);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;
                super._removeLineSetByPrimitive(linePrimitive, "multi_distances_clamped");
                break;
        }
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Updates the color of line primitives based on the current group's selection.
     * @param {Cartesian3[]} group - Array of Cartesian3 points representing the current group.
     * @returns {Primitive[]} The updated line primitives.
     */
    updateSelectedLineColor(group) {
        const lines = super.findLinesByPositions(group.coordinates, "multi_distances_clamped");

        // check if there is one line in the this.interactivePrimitives.selectedLines
        let isLineSetSelected = false;
        if (this.interactivePrimitives.selectedLines.length > 0) {
            this.interactivePrimitives.selectedLines.forEach(line => {
                if (lines.includes(line)) {
                    isLineSetSelected = true;
                }
            });
        }
        if (isLineSetSelected) {
            lines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select"));
            });
            this.interactivePrimitives.selectedLines = lines;
        }
        return lines;
    }

    resetValue() {
        super.resetValue();
    }
}

export { MultiDistanceClamped }
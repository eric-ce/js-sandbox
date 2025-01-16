import * as Cesium from "cesium";
import {
    calculateDistance,
    formatDistance,
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    getPickedObjectType,
    changeLineColor,
    calculateDistanceFromArray,
    getPrimitiveByPointPosition,
    createPolylinePrimitive,
    showCustomNotification,
    generateIdByTimestamp
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class MultiDistance extends MeasureModeBase {
    /**
     * Creates a new MultiDistance instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        this.pointerOverlay = this.stateManager.getOverlayState("pointer");

        // flags to control the state of the tool
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
            groupCounter: 0,    // New counter for labelNumberIndex
            _records: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            dragPoint: null,        // Currently dragged point primitive
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels
            addModeLine: null,      // Selected line primitive in add mode
            selectedLines: [],      // Array of selected line primitives
            hoveredLine: null,      // Hovered line primitive
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive
        };
    }

    /**
     * Sets up input actions for the multi-distance mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * The method to handle left-click Cesium handler events 
     *
     * @param {*} movement - The mouse movement data.
     * @returns 
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance");

        this.determineClickAction(pickedObjectType, pickedObject);
    }

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

    handleLabelClick(pickedObject) {
        const labelPrimitive = pickedObject.primitive;
        if (this.coords.cache.length === 0 && !this.flags.isAddMode) {
            editableLabel(this.viewer.container, labelPrimitive);
        }
        return labelPrimitive;
    }

    handlePointClick(pickedObject) {
        const pointPrimitive = pickedObject.primitive;

        // If the measurement is complete and not in add mode, select the fire trail
        if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
            this.selectLines(pointPrimitive);
        }

        // If currently measuring (measurement not complete) and cache has points, remove action
        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {
            this.removeActionByPointMeasuring(pointPrimitive);
        }

        // If the measurement is complete, check if clicked point is first or last in the group to allow continue measurement
        if (this.coords.cache.length === 0 || this.flags.isMeasurementComplete) {
            // Find the group that contains the clicked point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart =>
                    Cesium.Cartesian3.equals(cart, pointPrimitive.position))
            )

            // If no group is found, exit the function
            if (!group) {
                console.warn("Clicked point does not belong to any group.");
                return;
            }

            // Find the index of the clicked point within the group
            const pointIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, pointPrimitive.position)
            );

            // Determine if the clicked point is the first or last point in the group
            const isFirstPoint = pointIndex === 0;
            const isLastPoint = pointIndex === group.coordinates.length - 1;

            if (isFirstPoint || isLastPoint) {
                // Remove the total distance label associated with the group
                const totalLabel = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.includes("multidistance_label_total") &&
                    Cesium.Cartesian3.equals(label.position, group.coordinates[group.coordinates.length - 1])
                );

                if (totalLabel) {
                    this.labelCollection.remove(totalLabel);
                }

                // Reset measurement state to allow continuation
                this.flags.isMeasurementComplete = false;
                this.coords.cache = group.coordinates;
                this.flags.isReverse = isFirstPoint; // Reverse if the first point was clicked
            }
        }
    }

    removeActionByPointMeasuring(pointPrimitive) {
        // find the group that contains the clicked point
        const pointPosition = pointPrimitive.position.clone();
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
        );
        if (!group) {
            console.warn("Clicked point does not belong to any group.");
            return;
        }

        // compare if the pick point is from the latest one in group that is still drawing
        const isFromMeasuring = group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition));
        if (isFromMeasuring) {
            // find line and label primitives by the point position
            const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
                pointPosition,
                "annotate_multidistance",
                this.viewer.scene,
                this.pointCollection,
                this.labelCollection
            );

            // Remove relevant point, line, and label primitives
            this.pointCollection.remove(pointPrimitive);
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => this.labelCollection.remove(l));

            // Remove moving line and label primitives
            this.removeMovingPrimitives();

            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

            this._createReconnectPrimitives(neighbourPositions, { coordinates: this.coords.cache }, true);

            // Update coords cache
            const pointIndex = this.coords.cache.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, pointPosition)
            );
            if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

            // Update or create labels for the group
            this.updateOrCreateLabels(group);

            if (group.coordinates.length === 0) {
                this.flags.isMeasurementComplete = true; // When removing the only point, consider the measure ended
                this.interactivePrimitives.selectedLines = [];
                this.coords.groupToSubmit = null;
            }
        }
    }

    selectLines(primitive) {
        let primitivePositions = [];

        const isAnnotateLine = typeof primitive?.id === 'string' && primitive?.id?.includes("multidistance_line")
        if (isAnnotateLine) {     // Line primitive from annotations
            primitivePositions = primitive.positions;
        } else {     // Point primitive
            primitivePositions = [primitive.position];
        }

        if (primitivePositions && primitivePositions.length > 0) {
            // Find existing group containing the first position
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePositions[0]))
            );
            if (!group) return;

            // Display notification for the selected group
            showCustomNotification(`selected line: ${group.id}`, this.viewer.container)

            // Update log records callback for the current selected line
            this.logRecordsCallback(`${group.id} selected`);

            // Reset the previous selection if any
            if (this.interactivePrimitives.selectedLines.length > 0) {
                // Use this.interactivePrimitive.selectedLines before assigning the current one to look up previous selected lines
                // Find the previous selected group
                const pos = this.interactivePrimitives.selectedLines[0].positions;
                const prevGroup = this.coords.groups.find(group =>
                    group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pos[0]))
                );
                if (!prevGroup) return; // Exit if no previous group is found

                // Find the previous selected lines
                const prevLines = this.findLinesByPositions(prevGroup.coordinates, "multidistance");

                // reset the previous selected lines
                prevLines.forEach(line => {
                    // reset line color
                    changeLineColor(line, this.stateManager.getColorState("default"));
                });
            }

            // Find the current selected lines
            const currentLines = this.findLinesByPositions(group.coordinates, "multidistance");

            // Highlight the currently selected lines
            currentLines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select")); // reset line color
            });

            // Update the selected group and lines
            this.interactivePrimitives.selectedLines = currentLines;
        }
    }

    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to `reference by address`
            const newGroup = {
                id: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter,
            };
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup.coordinates;
            this.coords.groupCounter++;
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
            .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // Create a new point primitive at the current coordinate with red color
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "multidistance_point_pending");
        const pointPrimitive = this.pointCollection.add(point);
        const firstPointPosition = pointPrimitive.position.clone();

        // Update the coordinate cache based on the measurement direction
        if (this.flags.isReverse) {
            this.coords.cache.unshift(this.coordinate);
        } else {
            this.coords.cache.push(this.coordinate);
        }

        // Continue measurement if there are enough points in the cache
        if (this.coords.cache.length > 1) {
            this.continueMeasure(firstPointPosition);
        }
    }

    continueMeasure(position) {
        // Remove the moving line and label primitives to continue measurement
        this.removeMovingPrimitives();

        // Find the group that contains the given position
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, position))
        );

        if (!group) {
            console.warn("Group not found for the given position.");
            return;
        }

        // Determine the indices of the previous and current points based on the measurement direction
        const [prevIndex, currIndex] = this.flags.isReverse
            ? [0, 1] // If reversing, use the first two points
            : [group.coordinates.length - 2, group.coordinates.length - 1]; // Otherwise, use the last two points

        const prevPointCartesian = group.coordinates[prevIndex];
        const currPointCartesian = group.coordinates[currIndex];

        const linePrimitive = createPolylinePrimitive(
            [prevPointCartesian, currPointCartesian],
            "multidistance_line_pending",
            3,
            this.stateManager.getColorState("default"),
            this.cesiumPkg.Primitive
        )
        this.viewer.scene.primitives.add(linePrimitive);

        // Update or create the associated labels for the group
        this.updateOrCreateLabels(group, "multidistance");
    }

    addAction(linePrimitive) {
        const linePositions = linePrimitive.positions;

        // Find the group that contains the line positions
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, linePositions[0]))
        );
        if (!group || group.coordinates.length === 0) return;

        // Find the smallest index of the line positions in the group
        const linePositionIndex1 = group.coordinates.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[0]));
        const linePositionIndex2 = group.coordinates.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[1]));
        const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);

        // Check if there is already a point near the coordinate to avoid duplicates
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);

        if (!isNearPoint) {
            // Create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "multidistance_point");
            this.pointCollection.add(point);

            // Insert the new coordinate into the group's coordinates at the correct position
            group.coordinates.splice(positionIndex + 1, 0, this.coordinate);
        }

        // create line and label primitives
        const neighbourPositions = this.findNeighbourPosition(
            group.coordinates[positionIndex + 1],
            group
        );

        // Remove selected line and its label
        this.viewer.scene.primitives.remove(linePrimitive);
        const midPoint = Cesium.Cartesian3.midpoint(
            linePositions[0],
            linePositions[1],
            new Cesium.Cartesian3()
        );
        const existedLabel = this.labelCollection._labels.find(l =>
            l.id &&
            l.id.includes("multidistance_label") &&
            Cesium.Cartesian3.equals(l.position, midPoint)
        );
        if (existedLabel) this.labelCollection.remove(existedLabel);

        // Create reconnect primitives
        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // Create line primitives
                if (i < neighbourPositions.length - 1) {
                    const newLinePrimitive = createPolylinePrimitive(
                        [pos, neighbourPositions[i + 1]],
                        "multidistance_line",
                        3,
                        Cesium.Color.YELLOWGREEN,
                        this.cesiumPkg.Primitive
                    );
                    this.viewer.scene.primitives.add(newLinePrimitive);

                    // create label primitives
                    const distance = calculateDistance(pos, neighbourPositions[i + 1]);
                    const midPoint = Cesium.Cartesian3.midpoint(pos, neighbourPositions[i + 1], new Cesium.Cartesian3());
                    const label = createLabelPrimitive(pos, neighbourPositions[i + 1], distance);
                    label.id = generateId(midPoint, "multidistance_label");
                    const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[i + 1], group, this.coords.groups);
                    label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                    this.labelCollection.add(label);
                }
            });
        }

        // Update or create labels for the group
        this.updateOrCreateLabels(group, "multidistance");

        // Recalculate distances and total distance
        const { distances, totalDistance } = calculateDistanceFromArray(group.coordinates);

        // update following label primitives
        this.updateOrCreateTotalLabel(group, totalDistance, "multidistance");

        // update selected line color
        this.updateSelectedLineColor(group);

        // Update log records
        this.updateMultiDistancesLogRecords(distances, totalDistance, group.coordinates);

        // Reset flags
        this.flags.isAddMode = false;
        this.interactivePrimitives.addModeLine = null;
    }

    /**
     * Update or create the labels for the following coordinates in group by the group index
     * @param {Cesium.Cartesian3[]} followingPositions 
     * @param {Number} followingIndex 
     * @param {Object} group - The group of data for which labels are to be created or updated.
     * @param {number} group.id - The unique identifier for the group.
     * @param {Cesium.Cartesian3[]} group.coordinates - An array of Cartesian3 coordinates defining the points.
     * @param {number} group.labelIndex - The index used for labeling purposes.
     */
    _updateFollowingLabelPrimitives(followingPositions, followingIndex, group) {
        // Get mid points from following positions
        const midPoints = followingPositions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, followingPositions[i + 1], new Cesium.Cartesian3())
        );

        // find the relative label primitives by midpoint
        const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.includes("multidistance_label"));
        // update label text 
        midPoints.forEach((midPoint, index) => {
            const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
            const currentLetter = String.fromCharCode(97 + followingIndex + index % 26);
            const { labelNumberIndex } = this._getLabelProperties(followingPositions[index], group, this.coords.groups);
            // const labelNumberIndex = this.coords.groups.length;
            const distance = calculateDistance(followingPositions[index], followingPositions[index + 1]);
            relativeLabelPrimitives.forEach(l => {
                l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            });
        });
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;

        // Update the current coordinate and pick objects
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // Update the pointer overlay based on the picked objects
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
     * The default method to handle mouse movement during measure 
     * @param {Cesium.Cartesian3} cartesian 
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
        this.removeMovingPrimitives();

        // Create current line primitive
        const currentLinePrimitive = createPolylinePrimitive(
            [referencePointCartesian, cartesian],
            "multidistance_line_moving",
            3,
            this.stateManager.getColorState("move"),
            this.cesiumPkg.Primitive
        )
        const addedLinePrimitive = this.viewer.scene.primitives.add(currentLinePrimitive);
        this.interactivePrimitives.movingPolylines.push(addedLinePrimitive);

        // Calculate distance and create label
        const distance = calculateDistance(referencePointCartesian, cartesian);
        const labelPosition = Cesium.Cartesian3.midpoint(
            referencePointCartesian,
            cartesian,
            new Cesium.Cartesian3()
        );
        const distanceLabel = createLabelPrimitive(
            referencePointCartesian,
            cartesian,
            distance
        );
        distanceLabel.showBackground = false;
        distanceLabel.show = this.flags.isShowLabels;
        distanceLabel.id = generateId(labelPosition, "multidistance_label_moving");
        const addedLabelPrimitive = this.labelCollection.add(distanceLabel);
        this.interactivePrimitives.movingLabels.push(addedLabelPrimitive);
    }

    /**
     * Hover to the line, point, or label to highlight it when the mouse move over it
     * @param {*} pickedObject - the picked object from the pick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance");

        // reset highlighting
        this.resetHighlighting();  // reset highlighting, need to reset before highlighting

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "line":
                const line = pickedObject.primitive;
                if (line && line !== this.interactivePrimitives.addModeLine) {
                    changeLineColor(line, hoverColor);
                    this.interactivePrimitives.hoveredLine = line;
                }
                break;
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


    /************************
     * RIGHT CLICK FEATURES *
     ************************/
    handleRightClick(movement) {
        // place last point and place last line
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

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
            this.removeMovingPrimitives();

            // Check if the last point is near any existing point
            const isNearPoint = this.coords.groups
                .flatMap(group => group.coordinates)
                .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);

            if (isNearPoint) return;

            // Create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED, "multidistance_point");
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

            const linePrimitive = createPolylinePrimitive(
                [referencePointCartesian, this.coordinate],
                "multidistance_line",
                3,
                this.stateManager.getColorState("default"),
                this.cesiumPkg.Primitive
            )
            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            const group = this.coords.groups.find(g => g.coordinates.some(cart => Cesium.Cartesian3.equals(this.coordinate, cart)));

            this.updateOrCreateLabels(group, "multidistance");

            // total distance label
            const { distances, totalDistance } = calculateDistanceFromArray(this.coords.cache);
            // Create or update total label
            this.updateOrCreateTotalLabel(group, totalDistance, "multidistance");

            // log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance, [...this.coords.cache]);

            // update selected line
            const lines = this.findLinesByPositions(group.coordinates, "multidistance");
            this.interactivePrimitives.selectedLines = lines;
            lines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select"));
            });

            // set flags
            this.flags.isMeasurementComplete = true; // set to true to prevent further measurement
            this.flags.isReverse = false; // reset reverse flag

            // Clear cache
            this.coords.cache = [];
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) { // when the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_multidistance_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // Disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // Set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // hightlight the line set that is being dragged
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (!group) return;

            // reset line color 
            const resetLinesColor = (lines) => {
                lines.forEach(line => {
                    changeLineColor(line, this.stateManager.getColorState("default"));
                });
            }
            resetLinesColor(this.interactivePrimitives.selectedLines);

            // highlight the drag lines as selected lines
            const lines = this.findLinesByPositions(group.coordinates);
            this.interactivePrimitives.selectedLines = lines;
            lines.forEach(line => {
                this.changeLinePrimitiveColor(line, 'select');
            });

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleDragMove(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleDragMove(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show, line primitive to remove 
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_multidistance", this.viewer.scene, this.pointCollection, this.labelCollection);

            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";  // hide pointer overlay so it won't interfere with dragging

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("move");
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "multidistance_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED, "multidistance_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // create moving line primitives
            const groupIndex = this.coords.groups.findIndex(group => group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return

            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines = [];

            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const linePrimitive = createPolylinePrimitive([pos, cartesian], "multidistance_line_moving", 3, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);

                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);

                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);
                // Create or update label primitive
                const distance = calculateDistance(pos, cartesian);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                const labelPrimitive = this.interactivePrimitives.dragLabels[idx];
                if (labelPrimitive) {
                    this.interactivePrimitives.dragLabels[idx].id = generateId(midPoint, "multidistance_label_moving");
                    this.interactivePrimitives.dragLabels[idx].position = midPoint;
                    this.interactivePrimitives.dragLabels[idx].text = `${formatDistance(distance)}`;
                    this.interactivePrimitives.dragLabels[idx].showBackground = false;
                } else {
                    const labelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    labelPrimitive.id = generateId(midPoint, "multidistance_label_moving");
                    labelPrimitive.showBackground = false;
                    const addedLabelPrimitive = this.labelCollection.add(labelPrimitive);
                    this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
                }
            });
        }

    }

    handleDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );

            // find the neighbour positions by the dragging point
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            // remove dragging point, line and label
            if (this.interactivePrimitives.dragPoint) {
                this.pointCollection.remove(this.interactivePrimitives.dragPoint);
                this.interactivePrimitives.dragPoint = null;
            }
            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.dragPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.dragPolylines.length = 0;
            this.interactivePrimitives.dragLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.dragLabels.length = 0;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.includes("multidistance_point") &&
                Cesium.Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "multidistance_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart =>
                !Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            otherPositions.forEach(pos => {
                // Create new line primitive
                const linePrimitive = createPolylinePrimitive(
                    [this.coordinate, pos],
                    "multidistance_line",
                    3,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.Primitive
                );
                this.viewer.scene.primitives.add(linePrimitive);

                // Find and update the existing label primitive
                const oldMidPoint = Cesium.Cartesian3.midpoint(
                    pos,
                    this.coords.dragStart,
                    new Cesium.Cartesian3()
                );
                const newMidPoint = Cesium.Cartesian3.midpoint(
                    pos,
                    this.coordinate,
                    new Cesium.Cartesian3()
                );

                // Find and update the existing label primitive
                const labelPrimitive = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.startsWith("annotate_multidistance_label") &&
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                )
                if (labelPrimitive) {
                    // update the existing label text and position
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    const distance = calculateDistance(pos, this.coordinate);
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = this.flags.isShowLabels;
                    labelPrimitive.showBackground = this.flags.isShowLabels;
                }
            });

            // Find total distance label by the last point in group
            const lastPosition = group.coordinates[group.coordinates.length - 1];
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("multidistance_label_total") &&
                Cesium.Cartesian3.equals(label.position, lastPosition)
            );

            // Update the coordinate data
            const positionIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            if (positionIndex !== -1)
                group.coordinates[positionIndex] = this.coordinate;


            // update total distance label
            const { distances, totalDistance } = calculateDistanceFromArray(group.coordinates);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group.coordinates[group.coordinates.length - 1];
                totalLabel.id = generateId(lastPosition, "multidistance_label_total");
            }

            // update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance, group.coordinates);

            // Update selected line color
            const lines = this.findLinesByPositions(group.coordinates, "multidistance");
            this.interactivePrimitives.selectedLines = lines;
            lines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select"));
            });

            // Reset flag
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


    /************************
     * DOUBLE CLICK FEATURE *
     ************************/
    handleDoubleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance");

        switch (pickedObjectType) {
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.setAddModeByLine(linePrimitive)
                break
        }
    }

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
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, linePrimitive.positions[0]))
        );
        if (!group) return;

        // update the selected lines to the selected line and update its highlight color
        // const lines = this.findLinesByPositions(group.coordinates, "multidistance")
        // this.interactivePrimitives.selectedLines = lines;
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
        }
    }


    /************************
     * MIDDLE CLICK FEATURE *
     ************************/
    handleMiddleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance");

        switch (pickedObjectType) {
            case "point":
                const pointPrimitive = pickedObject.primitive;
                this.removeActionByPoint(pointPrimitive);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.removeLineSetByPrimitive(linePrimitive);
                break;
        }
    }

    removeActionByPoint(pointPrimitive) {
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
            "annotate_multidistance",
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
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
            );
            // Exit if no matching group is found
            if (!group) return;

            // Identify neighboring positions to reconnect the remaining points, lines, and labels
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);
            this._createReconnectPrimitives(neighbourPositions, group);

            // Remove the point from the group's coordinates
            const pointIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, pointPosition)
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
                        label.id.includes("multidistance_label_total") &&
                        Cesium.Cartesian3.equals(label.position, lastPoint)
                );
                console.log(targetTotalLabel)
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
            }

            // Remove the point from the group's coordinates
            group.coordinates.splice(pointIndex, 1);

            // update or create labels for the group
            this.updateOrCreateLabels(group, "multidistance");

            // Calculate the updated distances and total distance after removal
            const { distances, totalDistance } = calculateDistanceFromArray(group.coordinates);

            // Update or create the total label for the group
            this.updateOrCreateTotalLabel(group, totalDistance, "multidistance");

            // Update the color of selected lines to indicate selection change
            const lines = this.findLinesByPositions(group.coordinates)
            lines.forEach(line => {
                changeLineColor(line, this.stateManager.getColorState("select"));
            });
            this.interactivePrimitives.selectedLines = lines;

            // If the group still has more than one coordinate, update the log records
            if (group.coordinates.length > 1) {
                this.updateMultiDistancesLogRecords(distances, totalDistance);
            }

            // If only one coordinate remains, perform additional cleanup
            if (group.coordinates.length === 1) {
                // Remove the last remaining point from the point collection
                const lastPoint = this.pointCollection._pointPrimitives.find(
                    p => p && Cesium.Cartesian3.equals(p.position, group.coordinates[0])
                );
                if (lastPoint) this.pointCollection.remove(lastPoint);

                // Remove the total label
                const targetTotalLabel = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.includes("multidistance_label_total") &&
                        Cesium.Cartesian3.equals(label.position, group.coordinates[0])
                );
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

                // Clear the group's coordinates as all points have been removed
                group.coordinates = [];

                // Reset submission-related properties to their default states
                this.interactivePrimitives.selectedLines = [];

                // Log the removal of the trail
                this.logRecordsCallback(`${group.trailId} Removed`);
            }
        }
    }

    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // create reconnect line primitive
            const linePrimitive = createPolylinePrimitive(
                [neighbourPositions[0], neighbourPositions[2]],
                isPending ? "multidistance_line_pending" : "multidistance_line",
                3,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const distance = calculateDistance(neighbourPositions[0], neighbourPositions[2]);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, isPending ? "multidistance_label_pending" : "multidistance_label");
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[1], group, this.coords.groups);
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);

            return { linePrimitive, label }
        };
    }

    removeLineSetByPrimitive(linePrimitive) {
        const primitivePosition = linePrimitive.positions[0];

        // Find the index of the group that contains the primitive position
        const groupIndex = this.coords.groups.findIndex(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePosition))
        );
        if (groupIndex === -1) return; // Error handling: no group found

        const group = this.coords.groups[groupIndex];

        // Confirm removal with the user
        if (!confirm(`Do you want to remove the ENTIRE fire trail ${group.trailId}?`)) return;

        // Retrieve associated primitives for the group
        const { pointPrimitives, linePrimitives, labelPrimitives } = this.findPrimitivesByPositions(group.coordinates, "multidistance");

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

        // reset selected lines
        this.interactivePrimitives.selectedLines = [];

        // Log the removal of the trail
        this.logRecordsCallback(`${group.id} Removed`);
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * found the next index and previous index position from group of positions
     * @param {Cesium.Cartesian3} position - the Cartesian3 coordinate
     * @param {Cesium.Cartesian3[]} group - the group of Cartesian3 coordinates
     * @returns {Cesium.Cartesian3[]} - the previous position, current position, and next position
     */
    findNeighbourPosition(position, group) {
        const pointIndex = group.coordinates.findIndex(cart => Cesium.Cartesian3.equals(cart, position));
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
     * look for line primitives by group positions, and update the selected line color
     * @param {Cesium.Cartesian3[]} group 
     * @returns {Cesium.Primitive[]} - the line primitives that match the group positions
     */
    updateSelectedLineColor(group) {
        const lines = this.findLinesByPositions(group.coordinates, "multidistance");

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

    /**
     * update the log records with the distances and the total distance
     * @param {Number[]} distances - the distances between each point
     * @param {Number} totalDistance - the total distance
     * @returns {Object} - the distance record object 
     */
    updateMultiDistancesLogRecords(distances, totalDistance, positions) {
        const distanceRecord = {
            distances: distances.map(d => d.toFixed(2)),
            totalDistance: totalDistance.toFixed(2)
        };
        this.logRecordsCallback(distanceRecord);

        if (positions) {
            console.table(positions); // this will interact with the server for updated positions
        }
        return distanceRecord;
    }

    resetValue() {
        super.resetValue();
    }
}

export { MultiDistance }
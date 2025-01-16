import * as Cesium from "cesium";
import {
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    calculateClampedDistance,
    calculateClampedDistanceFromArray,
    getPickedObjectType,
    resetLineColor,
    changeLineColor,
    getPrimitiveByPointPosition,
    createPolylinePrimitive,
    generateIdByTimestamp,
    createGroundPolylinePrimitive,
    showCustomNotification,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class MultiDistanceClamped extends MeasureModeBase {
    /**
     * Creates a new MultiDistance Clamped instance.
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
            groupCounter: 0,    // Counter for the number of groups
            _records: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
            // selectedGroup: [],  // Stores the selected group of coordinates
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            dragPoint: null,        // Currently dragged point primitive
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels
            addModeLine: null,      //Primitive for adding a new line
            selectedLines: [],      // Array of selected line primitives
            hoveredLine: null,      // Hovered line primitive
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive
        };

        this.buttons = {
            labelButton: null
        };

        // setup label button
        this.setUpButtons();
    }

    /**
     * Sets up input actions for multi-distance clamped mode.
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
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement data.
     * @returns 
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance_clamped");

        this.determineClickAction(pickedObjectType, pickedObject);

        // // Handle different scenarios based on the clicked primitive type and the state of the tool
        // switch (pickedObjectType) {
        //     case "label":
        //         const labelPrimitive = pickedObject.primitive;
        //         if (this.coords.cache.length === 0 && !this.flags.isAddMode) {
        //             editableLabel(this.viewer.container, labelPrimitive);
        //         }
        //         break;
        //     case "point":
        //         const pointPrimitive = pickedObject.primitive;
        //         // this.removeActionByPoint(pointPrimitive);
        //         this.removeActionByPointMeasuring(pointPrimitive);
        //         break;
        //     case "line":
        //         const linePrimitive = pickedObject.primitive;
        //         // this.setAddModeByLine(linePrimitive);
        //         break;
        //     case "other":
        //         break;
        //     default:
        //         if (!this.flags.isDragMode && !this.flags.isAddMode) {
        //             this.startMeasure();
        //         }
        //         if (this.flags.isAddMode) {
        //             this.addAction(this.interactivePrimitives.selectedLine);
        //         }
        //         break;
        // }
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
    }

    selectLines(primitive) {
        let primitivePositions = [];

        const isAnnotateLine = typeof primitive?.id === 'string' && primitive?.id?.includes("multidistance_clamped_line")
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
                const prevLines = this.findLinesByPositions(prevGroup.coordinates, "multidistance_clamped");

                // reset the previous selected lines
                prevLines.forEach(line => {
                    // reset line color
                    changeLineColor(line, this.stateManager.getColorState("default"));
                });
            }

            // Find the current selected lines
            const currentLines = this.findLinesByPositions(group.coordinates, "multidistance_clamped");

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
            // when cache changed, groups will be changed due to `reference by address`
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

        // create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "multidistance_clamped_point_pending");
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


        // if (this.coords.cache.length > 1) {
        //     // const positionIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate)); // find the index of the current position
        //     // if (positionIndex === -1) return;   // early exit to prevent duplication creation of the line

        //     // remove the moving line and label primitives
        //     this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
        //     this.interactivePrimitives.movingPolylines.length = 0;
        //     this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
        //     this.interactivePrimitives.movingLabels.length = 0;

        //     const prevIndex = this.coords.cache.length - 2;
        //     const currIndex = this.coords.cache.length - 1;
        //     const prevPointCartesian = this.coords.cache[prevIndex];
        //     const currPointCartesian = this.coords.cache[currIndex];

        //     // create line primitive
        //     const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_clamped_line_pending");
        //     const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
        //     this.viewer.scene.primitives.add(linePrimitive);

        //     // create label primitive
        //     const { distance } = calculateClampedDistance(prevPointCartesian, currPointCartesian, this.viewer.scene, 4);
        //     const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
        //     const { currentLetter, labelNumberIndex } = this._getLabelProperties(this.coordinate, this.coords.cache, this.coords.groups);
        //     const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
        //     label.id = generateId(midPoint, "multidistance_clamped_label_pending");
        //     label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
        //     this.labelCollection.add(label);
        // }
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

        const linePrimitive = createGroundPolylinePrimitive(
            [prevPointCartesian, currPointCartesian],
            "multidistance_clamped_line_pending",
            Cesium.Color.YELLOWGREEN,
            this.cesiumPkg.GroundPolylinePrimitive
        )
        this.viewer.scene.primitives.add(linePrimitive);

        // Update or create the associated labels for the group
        this.updateOrCreateLabels(group, "multidistance_clamped", true);
    }

    _updateFollowingLabelPrimitives(followingPositions, followingIndex, group) {
        // Get mid points from following positions
        const midPoints = followingPositions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, followingPositions[i + 1], new Cesium.Cartesian3())
        );

        // find the relative label primitives by midpoint
        const labelPrimitives = this.labelCollection._labels.filter(label => label.id && label.id.includes("multidistance_clamped_label"));
        // update label text 
        midPoints.forEach((midPoint, index) => {
            const relativeLabelPrimitives = labelPrimitives.filter(l => Cesium.Cartesian3.equals(l.position, midPoint));
            const currentLetter = String.fromCharCode(97 + followingIndex + index % 26);
            const { labelNumberIndex } = this._getLabelProperties(followingPositions[index], group, this.coords.groups);
            // const labelNumberIndex = this.coords.groups.length;
            const { distance } = calculateClampedDistance(followingPositions[index], followingPositions[index + 1], this.viewer.scene, 4);
            relativeLabelPrimitives.forEach(l => {
                l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            });
        });
    }

    addAction(linePrimitive) {
        const linePositions = linePrimitive.geometryInstances.geometry._positions;
        const group = this.coords.groups.find(group => group.some(cart => Cesium.Cartesian3.equals(cart, linePositions[0])));
        if (!group || group.length === 0) return;

        // Find the smallest index of the line positions in the group
        const linePositionIndex1 = group.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[0]));
        const linePositionIndex2 = group.findIndex(cart => Cesium.Cartesian3.equals(cart, linePositions[1]));
        const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);


        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (!isNearPoint) {
            // to create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "multidistance_clamped_point");
            this.pointCollection.add(point);
            // update cache
            group.splice(positionIndex + 1, 0, this.coordinate);
        }

        // create line and label primitives
        const neighbourPositions = this.findNeighbourPosition(group[positionIndex + 1], group); // find neighbour positions by the new added point

        // remove selected line and its label
        this.viewer.scene.primitives.remove(linePrimitive);
        const midPoint = Cesium.Cartesian3.midpoint(linePositions[0], linePositions[1], new Cesium.Cartesian3());
        const existedLabel = this.labelCollection._labels.find(l => l.id && l.id.includes("multidistance_clamped_label") && Cesium.Cartesian3.equals(l.position, midPoint));
        if (existedLabel) this.labelCollection.remove(existedLabel);

        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // create line primitives
                if (i < neighbourPositions.length - 1) {
                    const lineGeometryInstance = createClampedLineGeometryInstance([pos, neighbourPositions[i + 1]], "multidistance_clamped_line");
                    const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                    this.viewer.scene.primitives.add(linePrimitive);

                    // create label primitives
                    const { distance } = calculateClampedDistance(pos, neighbourPositions[i + 1], this.viewer.scene, 4);
                    const midPoint = Cesium.Cartesian3.midpoint(pos, neighbourPositions[i + 1], new Cesium.Cartesian3());
                    const label = createLabelPrimitive(pos, neighbourPositions[i + 1], distance);
                    label.id = generateId(midPoint, "multidistance_clamped_label");
                    const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[i + 1], group, this.coords.groups);
                    label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                    this.labelCollection.add(label);
                }
            });
        }

        // update following label primitives
        const followingIndex = positionIndex + 1;
        const followingPositions = group.slice(positionIndex + 1);
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);
        const { distances, totalDistance } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);

        // update total distance label
        const totalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_clamped_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
        if (totalLabel) {
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        }
        // update log records
        this.updateMultiDistancesLogRecords(distances, totalDistance, group);

        // reset flags
        this.flags.isAddMode = false;
        this.interactivePrimitives.selectedLines = [];
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
        const currentLinePrimitive = createGroundPolylinePrimitive(
            [referencePointCartesian, cartesian],
            "multidistance_clamped_line_moving",
            Cesium.Color.YELLOW,
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
        const labelPosition = Cesium.Cartesian3.midpoint(
            referencePointCartesian,
            cartesian,
            new Cesium.Cartesian3()
        );
        const distanceLabel = createLabelPrimitive(
            referencePointCartesian,
            cartesian,
            calculatedDistance
        );
        distanceLabel.showBackground = false;
        distanceLabel.show = this.flags.isShowLabels;
        distanceLabel.id = generateId(labelPosition, "multidistance_clamped_label_moving");
        const addedLabelPrimitive = this.labelCollection.add(distanceLabel);
        this.interactivePrimitives.movingLabels.push(addedLabelPrimitive);
    }

    /**
     * Hover to the line, point, or label to highlight it when the mouse move over it
     * @param {*} pickedObject - the picked object from the pick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance_clamped");

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
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED, "multidistance_clamped_point");
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
                "multidistance_clamped_line",
                this.stateManager.getColorState("default"),
                this.cesiumPkg.GroundPolylinePrimitive
            )
            this.viewer.scene.primitives.add(linePrimitive);

            // create last label
            const group = this.coords.groups.find(g => g.coordinates.some(cart => Cesium.Cartesian3.equals(this.coordinate, cart)));

            this.updateOrCreateLabels(group, "multidistance_clamped");

            // total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                this.coords.cache,
                this.viewer.scene,
                4
            );
            // Create or update total label
            this.updateOrCreateTotalLabel(group, totalDistance, "multidistance_clamped");

            // log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance, [...this.coords.cache]);

            // update selected line
            const lines = this.findLinesByPositions(group.coordinates, "multidistance_clamped");
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
                    primitiveId.startsWith("annotate_multidistance_clamped_point") &&
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
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(this.coords.dragStart, "annotate_multidistance_clamped", this.viewer.scene, this.pointCollection, this.labelCollection);

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
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "multidistance_clamped_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "multidistance_clamped_point_moving");
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
                const linePrimitive = createGroundPolylinePrimitive([pos, cartesian], "multidistance_clamped_line_moving", Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);

                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);

                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);
                // Create or update label primitive
                const { distance } = calculateClampedDistance(pos, cartesian, this.viewer.scene, 4);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                const labelPrimitive = this.interactivePrimitives.dragLabels[idx];
                if (labelPrimitive) {
                    this.interactivePrimitives.dragLabels[idx].id = generateId(midPoint, "multidistance_clamped_label_moving");
                    this.interactivePrimitives.dragLabels[idx].position = midPoint;
                    this.interactivePrimitives.dragLabels[idx].text = `${formatDistance(distance)}`;
                    this.interactivePrimitives.dragLabels[idx].showBackground = false;
                } else {
                    const labelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    labelPrimitive.id = generateId(midPoint, "multidistance_clamped_label_moving");
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
                p.id.includes("multidistance_clamped_point") &&
                Cesium.Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "multidistance_clamped_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart =>
                !Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            otherPositions.forEach(pos => {
                // Create new line primitive
                const linePrimitive = createGroundPolylinePrimitive(
                    [this.coordinate, pos],
                    "multidistance_clamped_line",
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
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
                    label.id.startsWith("annotate_multidistance_clamped_label") &&
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                )
                if (labelPrimitive) {
                    // update the existing label text and position
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    const { distance } = calculateClampedDistance(pos, this.coordinate, this.viewer.scene, 4);
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_clamped_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = this.flags.isShowLabels;
                    labelPrimitive.showBackground = this.flags.isShowLabels;
                }
            });

            // Find total distance label by the last point in group
            const lastPosition = group.coordinates[group.coordinates.length - 1];
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("multidistance_clamped_label_total") &&
                Cesium.Cartesian3.equals(label.position, lastPosition)
            );

            // Update the coordinate data
            const positionIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            if (positionIndex !== -1)
                group.coordinates[positionIndex] = this.coordinate;


            // update total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(group.coordinates, this.viewer.scene, 4);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group.coordinates[group.coordinates.length - 1];
                totalLabel.id = generateId(lastPosition, "multidistance_clamped_label_total");
            }

            // update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance, group.coordinates);

            // Update selected line color
            const lines = this.findLinesByPositions(group.coordinates, "multidistance_clamped");
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

    }

    setAddModeByLine(linePrimitive) {
        // Reset previous hovered line if any
        if (this.interactivePrimitives.hoveredLine && this.interactivePrimitives.hoveredLine !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.hoveredLine);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset previous selected line if different
        if (this.interactivePrimitives.selectedLines && this.interactivePrimitives.selectedLines !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.selectedLines);
        }

        // Change line color to indicate selection
        changeLineColor(linePrimitive, Cesium.Color.YELLOW);
        this.interactivePrimitives.selectedLines = linePrimitive;

        // Set flag to indicate add mode
        if (this.interactivePrimitives.selectedLines) {
            this.flags.isAddMode = true;
        }
    }


    /************************
     * MIDDLE CLICK FEATURE *
     ************************/
    handleMiddleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance_clamped");

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
            "annotate_multidistance_clamped",
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
                        label.id.includes("multidistance_clamped_label_total") &&
                        Cesium.Cartesian3.equals(label.position, lastPoint)
                );
                console.log(targetTotalLabel)
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
            }

            // Remove the point from the group's coordinates
            group.coordinates.splice(pointIndex, 1);

            // update or create labels for the group
            this.updateOrCreateLabels(group, "multidistance_clamped");

            // Calculate the updated distances and total distance after removal
            const { distances, totalDistance } = calculateClampedDistanceFromArray(group.coordinates, this.viewer.scene, 4);

            // Update or create the total label for the group
            this.updateOrCreateTotalLabel(group, totalDistance, "multidistance_clamped");

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
                        label.id.includes("multidistance_clamped_label_total") &&
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
            const linePrimitive = createGroundPolylinePrimitive(
                [neighbourPositions[0], neighbourPositions[2]],
                isPending ? "multidistance_clamped_line_pending" : "multidistance_clamped_line",
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const { distance } = calculateClampedDistance(neighbourPositions[0], neighbourPositions[2], this.viewer.scene, 4);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, isPending ? "multidistance_clamped_label_pending" : "multidistance_clamped_label");
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
        const { pointPrimitives, linePrimitives, labelPrimitives } = this.findPrimitivesByPositions(group.coordinates, "multidistance_clamped");

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


    /******************
     * OTHER FEATURES *
     ******************/
    setUpButtons() {
        const createButton = (text, className, onClick) => {
            const button = document.createElement("button");
            button.innerHTML = text;
            button.classList.add("cesium-button", "measure-mode-button", "show", className);
            button.setAttribute("type", "button");
            button.setAttribute("aria-label", `${className}`);
            button.setAttribute("aria-pressed", "false"); // For toggle behavior
            button.addEventListener("click", onClick);
            // button.style.position = "absolute";
            return button;
        };

        // setup label button
        this.buttons.labelButton = createButton("Show", "toggle-label-button", this.handleLabelToggle.bind(this));
        this.buttons.labelButton.style.display = "none"; // Initially hidden

        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium && mapCesium.shadowRoot.querySelector("cesium-measure");

        if (measureToolbox) {
            // Set up a MutationObserver to watch for the presence of required elements
            const observer = new MutationObserver((_, obs) => {
                const multiDClamped = measureToolbox.shadowRoot.querySelector(".multi-distances-clamped");
                const toolbar = measureToolbox.shadowRoot.querySelector(".measure-toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                // Update button overlay text
                this.updateButtonOverlay(this.buttons.labelButton, "toggle label on or off");

                if (multiDClamped && toolbar && measureToolButton) {
                    // Position buttons
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    this.buttons.labelButton.style.left = `-${BUTTON_WIDTH * 5}px`;
                    this.buttons.labelButton.style.top = "-40px";

                    // Append label buttons to the toolbar
                    toolbar.appendChild(this.buttons.labelButton);

                    obs.disconnect(); // Stop observing once the buttons are appended

                    // Add event listener to toggle button visibility based on multi-distances-clamped button state
                    const toggleButtonVisibility = () => {
                        const shouldDisplay =
                            multiDClamped.classList.contains('active') &&
                            measureToolButton.classList.contains('active');
                        this.buttons.labelButton.style.display = shouldDisplay ? 'block' : 'none';
                    };

                    // Initial visibility check
                    toggleButtonVisibility();

                    // Set up another MutationObserver to watch class changes for visibility toggling
                    const classObserver = new MutationObserver(toggleButtonVisibility);
                    classObserver.observe(multiDClamped, { attributes: true, attributeFilter: ['class'] });
                    classObserver.observe(measureToolButton, { attributes: true, attributeFilter: ['class'] });
                }
            });
            // Start observing the measureToolbox shadow DOM for child list changes
            observer.observe(measureToolbox.shadowRoot, { childList: true, subtree: true });
        }
    }

    handleLabelToggle() {
        // Toggle the flag
        this.flags.isShowLabels = !this.flags.isShowLabels;

        if (!this.buttons.labelButton) return;

        if (this.flags.isShowLabels) {
            this.buttons.labelButton.textContent = "Hide"
            this.buttons.labelButton.setAttribute("aria-pressed", "true");

        } else {
            this.buttons.labelButton.textContent = "Show";
            this.buttons.labelButton.setAttribute("aria-pressed", "false");
        }

        const labels = this.labelCollection._labels.filter(label =>
            label.id &&
            label.id.includes("multidistance_clamped_label")
        ).forEach((label) => {
            label.show = this.flags.isShowLabels
            label.showBackground = this.flags.isShowLabels;
        });

        return labels;
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
     * update the button overlay with the overlay text
     * @param { HTMLElement } button - the button element
     * @param {String} overlayText - the overlay text
     * @returns {HTMLElement} - the button overlay element
     */
    updateButtonOverlay(button, overlayText) {
        const buttonOverlay = this.stateManager.getOverlayState("button");

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
    updateMultiDistancesLogRecords(distances, totalDistance) {
        const distanceRecord = {
            distances: distances.map(d => d.toFixed(2)),
            totalDistance: totalDistance.toFixed(2)
        };
        this.logRecordsCallback(distanceRecord);

        return distanceRecord;
    }

    resetValue() {
        super.resetValue();
    }
}

export { MultiDistanceClamped }
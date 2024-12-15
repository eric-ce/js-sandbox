import * as Cesium from "cesium";
import {
    calculateDistance,
    formatDistance,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLineGeometryInstance,
    createLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    getPickedObjectType,
    resetLineColor,
    changeLineColor,
    calculateDistanceFromArray,
    getPrimitiveByPointPosition,
    createPolylinePrimitive,
    positionKey,
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
            draggingPoint: null,    // Currently dragged point primitive
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
                if (this.coords.cache.length === 0 && !this.flags.isAddMode) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                this.handlePointClick(pointPrimitive);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.selectLines(linePrimitive);
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

    handlePointClick(pointPrimitive) {
        // If the measurement is complete and not in add mode, select the lines
        if (!this.flags.isAddMode &&  // not in add mode
            (this.coords.cache.length === 0 && !this.flags.isMeasurementComplete) ||  // measurement not started
            this.flags.isMeasurementComplete // not during measurement
        ) {
            this.selectLines(pointPrimitive);
        }

        // If currently measuring (measurement not complete) and cache has points, remove action
        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {
            removeActionByPointMeasuring.call(this, pointPrimitive);
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
    }

    selectLines(primitive) {
        let primitivePositions = [];

        if (
            typeof primitive?.id === 'string' &&
            primitive.id.includes("multidistance_line")
        ) {
            primitivePositions = primitive.positions;
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
                const prevLines = this.findLinesByPositions(prevGroup.coordinates);

                // reset the previous selected lines
                prevLines.forEach(line => {
                    // reset line color
                    changeLineColor(line, this.stateManager.getColorState("default"));
                });
            }

            // Find the current selected lines
            const currentLines = this.findLinesByPositions(group.coordinates);

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
            // when cache changed groups will be changed due to reference by address
            const newGroup = {
                id: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter,
            };
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup.coordinates;
            this.coords.groupCounter++;
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // Create a new point primitive at the current coordinate with red color
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"));
        point.id = generateId(this.coordinate, "multidistance_point_pending");
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
            //TODO: here it can picked fire trail in the layer and continue, assign new id and set it to the cache
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


    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // create reconnect line primitive
            const lineGeometryInstance = createLineGeometryInstance([neighbourPositions[0], neighbourPositions[2]], isPending ? "multidistance_line_pending" : "multidistance_line");
            const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const distance = calculateDistance(neighbourPositions[0], neighbourPositions[2]);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, isPending ? "multidistance_label_pending" : "multidistance_label");
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(neighbourPositions[1], group, this.coords.groups);
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        };
    }

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
            point.id = generateId(this.coordinate, "multidistance_point");
            this.pointCollection.add(point);
            // update cache
            group.splice(positionIndex + 1, 0, this.coordinate);
        }

        // create line and label primitives
        const neighbourPositions = this.findNeighbourPosition(group[positionIndex + 1], group); // find neighbour positions by the new added point

        // remove selected line and its label
        this.viewer.scene.primitives.remove(linePrimitive);
        const midPoint = Cesium.Cartesian3.midpoint(linePositions[0], linePositions[1], new Cesium.Cartesian3());
        const existedLabel = this.labelCollection._labels.find(l => l.id && l.id.includes("multidistance_label") && Cesium.Cartesian3.equals(l.position, midPoint));
        if (existedLabel) this.labelCollection.remove(existedLabel);

        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // create line primtives
                if (i < neighbourPositions.length - 1) {
                    const lineGeometryInstance = createLineGeometryInstance([pos, neighbourPositions[i + 1]], "multidistance_line");
                    const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                    this.viewer.scene.primitives.add(linePrimitive);

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

        // update following label primitives
        const followingIndex = positionIndex + 1;
        const followingPositions = group.slice(positionIndex + 1);
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);
        const { distances, totalDistance } = calculateDistanceFromArray(group);

        // update total distance label
        const totalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
        if (totalLabel) {
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        }
        // update log records
        this.updateMultiDistancesLogRecords(distances, totalDistance, group);

        // reset flags
        this.flags.isAddMode = false;
        this.interactivePrimitives.selectedLine = null;
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
        const resetHighlighting = () => {
            const { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel } = this.interactivePrimitives;
            // when mouse move out of the line, reset the line color
            // Reset hovered line if it's not the selected line
            if (
                hoveredLine &&
                hoveredLine !== addModeLine   // don't change selected line color
            ) {
                let colorToSet;
                if (selectedLines.includes(hoveredLine)) {
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
                hoveredPoint.outlineColor = Cesium.Color.RED;
                hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            // Reset hover label
            if (hoveredLabel) {
                hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();    // reset highlighting, need to reset before highlighting

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

            // update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p =>
                p.id && p.id.includes("pending")
            );
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });

            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(p =>
                p.geometryInstances &&
                p.geometryInstances.id &&
                p.geometryInstances.id.includes("pending")
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
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "multidistance_point");
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

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set drag point position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

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
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "multidistance_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "multidistance_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // create moving line primitives
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return

            // Remove existing moving lines and moving labels 
            console.log(this.interactivePrimitives.dragPolylines);
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;


            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const lineGeometryInstance = createLineGeometryInstance([pos, cartesian], "multidistance_line_moving");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.Primitive);
                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                console.log("🚀  addedLinePrimitive:", addedLinePrimitive);

                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);
                console.log(this.interactivePrimitives.dragPolylines);
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

            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);

            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            // remove dragging point, line and label
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            // Remove existing moving lines and moving labels 
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;
            this.interactivePrimitives.dragLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.dragLabels.length = 0;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.includes("multidistance_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "multidistance_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            otherPositions.forEach(pos => {
                // Create new line primitive
                const lineGeometryInstance = createLineGeometryInstance([this.coordinate, pos], "multidistance_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                const distance = calculateDistance(pos, this.coordinate);
                const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());

                // Find and update the existing label primitive
                const labelPrimitive = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.startsWith("annotate_multidistance_label") &&
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                )
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            });

            // find total distance label by the last point in group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("multidistance_label_total") &&
                Cesium.Cartesian3.equals(label.position, group[group.length - 1])
            );

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update total distance label
            const { distances, totalDistance } = calculateDistanceFromArray(group);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "multidistance_label_total");
            }

            // update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance, group);

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


    handleDoubleClick(movement) {
        this.setAddModeByLine(linePrimitive)
    }

    setAddModeByLine(linePrimitive) {
        // Reset previous hovered line if any
        if (this.interactivePrimitives.hoveredLine && this.interactivePrimitives.hoveredLine !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.hoveredLine);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset previous selected line if different
        if (this.interactivePrimitives.selectedLine && this.interactivePrimitives.selectedLine !== linePrimitive) {
            resetLineColor(this.interactivePrimitives.selectedLine);
        }

        // Change line color to indicate selection
        changeLineColor(linePrimitive, Cesium.Color.YELLOW);
        this.interactivePrimitives.selectedLine = linePrimitive;

        // Set flag to indicate add mode
        if (this.interactivePrimitives.selectedLine) {
            this.flags.isAddMode = true;
        }
    }


    handleMiddleClick(movement) {
        this.removeActionByPoint(pointPrimitive)
    }
    removeActionByPoint(pointPrimitive) {
        const pointPosition = pointPrimitive.position.clone();

        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(pointPosition, "annotate_multidistance", this.viewer.scene, this.pointCollection, this.labelCollection);

        // Remove point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove moving line and label primitives
        this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
        this.interactivePrimitives.movingLabels.length = 0;

        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {     // when it is during the measure
            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, this.coords.cache);

            this._createReconnectPrimitives(neighbourPositions, this.coords.cache, true);

            // Update coords cache
            const pointIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
            if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = this.coords.cache.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(followingPositions, followingIndex, this.coords.cache);

            if (this.coords.cache.length === 0) {
                this.flags.isMeasurementComplete = true; // when remove the only point it is considered as that measure is ended
            }
        } else if (this.coords.groups.length > 0) {     // when the measure is ended
            const groupsIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, pointPosition)));
            const group = this.coords.groups[groupsIndex];

            // remove total label
            const lastPoint = group[group.length - 1];
            const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_label_total") && Cesium.Cartesian3.equals(label.position, lastPoint));

            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

            this._createReconnectPrimitives(neighbourPositions, group);

            // Update coords cache
            const pointIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, pointPosition));
            if (pointIndex !== -1) group.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = group.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

            const { distances, totalDistance } = calculateDistanceFromArray(group);

            // update total distance label
            if (targetTotalLabel) {
                targetTotalLabel.id = generateId(group[group.length - 1], "multidistance_label_total");
                targetTotalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                targetTotalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
                targetTotalLabel.position = group[group.length - 1];
            }

            // log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance, group);

            // remove point and total label when there is only one point left in the group
            if (group.length === 1) {
                // remove the point and the total label
                const targetPoint = this.pointCollection._pointPrimitives.find(p => p && Cesium.Cartesian3.equals(p.position, group[0]));
                if (targetPoint) this.pointCollection.remove(targetPoint);
                const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
                // remove the group
                group.splice(0, 1);

                // log distance result
                this.updateMultiDistancesLogRecords(distances, totalDistance, this.coords.groups[groupsIndex]);
            }
        } else {
            return;
        }
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/


    updateOrCreateLabels(group, modeString) {
        const midPoints = group.coordinates.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, group.coordinates[i + 1], new Cesium.Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels.filter(
            l => l.id && l.id.includes(`${modeString}_label`)
        );

        midPoints.forEach((midPoint, index) => {
            let relativeLabelPrimitives = labelPrimitives.filter(l =>
                Cesium.Cartesian3.equals(l.position, midPoint)
            );

            // Wrap the letter back to 'a' after 'z'
            const currentLetter = String.fromCharCode(97 + index % 26); // 'a' to 'z' to 'a' to 'z'...

            // Don't use getLabelProperties currentLetter in here as midPoint index is not the group coordinate index
            const { labelNumberIndex } = this._getLabelProperties(
                group.coordinates[index],
                group
            );
            const distance = calculateDistance(
                group.coordinates[index],
                group.coordinates[index + 1],
            );

            const labelText = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;

            if (relativeLabelPrimitives.length > 0) {
                // Update existing labels
                relativeLabelPrimitives.forEach(label => {
                    label.text = labelText;
                    label.show = this.flags.isShowLabels;
                    label.showBackground = this.flags.isShowLabels;
                });
            } else {
                // Create new label
                const newLabel = createLabelPrimitive(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                    distance
                );
                newLabel.text = labelText;
                newLabel.show = this.flags.isShowLabels;
                newLabel.showBackground = this.flags.isShowLabels;
                newLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
                newLabel.position = midPoint;
                newLabel.id = generateId(midPoint, `${modeString}_label`);
                this.labelCollection.add(newLabel);
            }
        });
    }

    updateOrCreateTotalLabel(group, totalDistance, modeString) {
        const currentPosition = group.coordinates[group.coordinates.length - 1];

        let totalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes(`${modeString}_label_total`) &&
                group.coordinates.some(pos => Cesium.Cartesian3.equals(label.position, pos))
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
        totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
        totalLabel.position = currentPosition;

        return totalLabel;
    }

    /**
     * found the next index and previous index position from group of positions
     * @param {Cesium.Cartesian3} position - the Cartesian3 coordinate
     * @param {Cesium.Cartesian3[]} group - the group of Cartesian3 coordinates
     * @returns {Cesium.Cartesian3[]} - the previous position, current position, and next position
     */
    findNeighbourPosition(position, group) {
        const pointIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, position));

        if (pointIndex === -1) return;

        const prevPosition = pointIndex > 0 ? group[pointIndex - 1] : null;
        const nextPosition = pointIndex < group.length - 1 ? group[pointIndex + 1] : null;

        return [prevPosition, position, nextPosition].filter(pos => pos !== null);
    }

    /**
     * Get the label text properties based on the position and group.
     * @param {Cesium.Cartesian3} position - The current position.
     * @param {Array} group - The group.
     * @returns {{ currentLetter: String, labelNumberIndex: Number }} - The label text properties.
     */
    _getLabelProperties(position, group) {
        // Find the index of the position in group
        const positionIndex = group.coordinates.findIndex(cart => Cesium.Cartesian3.equals(cart, position));
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
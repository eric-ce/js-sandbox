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
} from "../helper/helper.js";

class MultiDistanceClamped {
    /**
     * Creates a new MultiDistance Clamped instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isAddMode: false,
            countMeasure: 0,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            _distanceRecords: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
            selectedGroup: [],  // Stores the selected group of coordinates
        };

        // Label properties
        // this.label = {
        //     _labelIndex: 0,
        //     _labelNumberIndex: 0
        // }

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            dragPoint: null,        // Currently dragged point primitive
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels
            hoveredLine: null,      // Hovered line primitive
            selectedLine: null,     // Selected line primitive
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive
        };

        this.setUpButtons();
    }

    /**
     * Sets up input actions for multi-distance clamped mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for handler.
     */
    removeInputAction() {
        removeInputActions(this.handler);
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
    handleMultiDistanceClampedLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance_clamped");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                this.removeActionByPoint(pointPrimitive);
                break;
            case "line":
                const linePrimitive = pickedObject.primitive;
                this.setAddModeByLine(linePrimitive);
                break;
            case "other":
                break;
            default:
                if (!this.flags.isDragMode && !this.flags.isAddMode) {
                    this.startMeasure();
                }
                if (this.flags.isAddMode) {
                    this.addAction(this.interactivePrimitives.selectedLine);
                }
                break;
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
            const newGroup = [];
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup;
        }

        // create point primitive
        const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (!isNearPoint) {
            // create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "multidistance_clamped_point_pending");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }

        if (this.coords.cache.length > 1) {
            // const positionIndex = this.coords.cache.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coordinate)); // find the index of the current position
            // if (positionIndex === -1) return;   // early exit to prevent duplication creation of the line

            // remove the moving line and label primitives
            this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // create line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([prevPointCartesian, currPointCartesian], "multidistance_clamped_line_pending");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create label primitive
            const { distance } = calculateClampedDistance(prevPointCartesian, currPointCartesian, this.viewer.scene, 4);
            const midPoint = Cesium.Cartesian3.midpoint(prevPointCartesian, currPointCartesian, new Cesium.Cartesian3());
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(this.coordinate, this.coords.cache, this.coords.groups);
            const label = createLabelPrimitive(prevPointCartesian, currPointCartesian, distance);
            label.id = generateId(midPoint, "multidistance_clamped_label_pending");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        }
    }

    removeActionByPoint(pointPrimitive) {
        const pointPosition = pointPrimitive.position.clone();

        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(pointPosition, "annotate_multidistance_clamped", this.viewer.scene, this.pointCollection, this.labelCollection);

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
            const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_clamped_label_total") && Cesium.Cartesian3.equals(label.position, lastPoint));

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

            const { distances, totalDistance } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);

            // update total distance label
            if (targetTotalLabel) {
                targetTotalLabel.id = generateId(group[group.length - 1], "multidistance_clamped_label_total");
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
                const targetTotalLabel = this.labelCollection._labels.find(label => label.id && label.id.includes("multidistance_clamped_label_total") && Cesium.Cartesian3.equals(label.position, group[group.length - 1]));
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

    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // create reconnect line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance([neighbourPositions[0], neighbourPositions[2]], isPending ? "multidistance_clamped_line_pending" : "multidistance_clamped_line");
            const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
            this.viewer.scene.primitives.add(linePrimitive);

            // create reconnect label primitive
            const { distance } = calculateClampedDistance(neighbourPositions[0], neighbourPositions[2], this.viewer.scene, 4);
            const midPoint = Cesium.Cartesian3.midpoint(neighbourPositions[0], neighbourPositions[2], new Cesium.Cartesian3());
            const label = createLabelPrimitive(neighbourPositions[0], neighbourPositions[2], distance);
            label.id = generateId(midPoint, isPending ? "multidistance_clamped_label_pending" : "multidistance_clamped_label");
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
                // create line primtives
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
        this.interactivePrimitives.selectedLine = null;
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    handleMultiDistanceClampedMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        pickedObjects && updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;
        // const isMeasurementComplete = this.coords.groups.length > 0 && this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                this.handleActiveMeasure(cartesian);
                break;
            // case isMeasurementComplete:
            //     this.handleHoverHighlighting(pickedObjects);
            //     break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);  // highlight the line when hovering
                break;
        }
    }

    /**
     * The default method to handle mouse movement during measure 
     * @param {Cesium.Cartesian3} cartesian 
     */
    handleActiveMeasure(cartesian) {
        // Calculate the distance between the last selected point and the current cartesian position
        const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

        // create line primitive
        this.interactivePrimitives.movingPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
        this.interactivePrimitives.movingPolylines.length = 0;

        const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, cartesian], "multidistance_clamped_line_moving");
        const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
        const movingLine = this.viewer.scene.primitives.add(movingLinePrimitive);
        this.interactivePrimitives.movingPolylines.push(movingLine);

        // create label primitive
        this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
        this.interactivePrimitives.movingLabels.length = 0;
        const { distance } = calculateClampedDistance(lastPointCartesian, cartesian, this.viewer.scene, 4);
        const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, cartesian, new Cesium.Cartesian3());
        const label = createLabelPrimitive(lastPointCartesian, cartesian, distance);
        label.showBackground = false;
        label.id = generateId(midPoint, "multidistance_clamped_label_moving");
        const movingLabel = this.labelCollection.add(label);
        this.interactivePrimitives.movingLabels.push(movingLabel);
    }

    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "multidistance_clamped");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredLine && this.interactivePrimitives.hoveredLine !== this.interactivePrimitives.selectedLine) {
                resetLineColor(this.interactivePrimitives.hoveredLine);
                this.interactivePrimitives.hoveredLine = null;
            }
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();

        switch (pickedObjectType) {
            case "line": // highlight the line when hovering
                const linePrimitive = pickedObject.primitive;

                if (linePrimitive && linePrimitive !== this.interactivePrimitives.selectedLine) {
                    // Highlight the line
                    changeLineColor(linePrimitive, Cesium.Color.BLUE);
                    this.interactivePrimitives.hoveredLine = linePrimitive;
                }
                break;
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


    /************************
     * RIGHT CLICK FEATURES *
     ************************/
    handleMultiDistanceClampedRightClick(movement) {
        // place last point and place last line
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

            // update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });
            // update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id && p.geometryInstances.id.includes("pending"));
            pendingLines.forEach(p => {
                const position = p.geometryInstances.geometry._positions;
                this.viewer.scene.primitives.remove(p);
                const lineGeometryInstance = createClampedLineGeometryInstance(position, "multidistance_clamped_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);
            });
            // update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l => l.id && l.id.includes("pending"));
            pendingLabels.forEach(l => { l.id = l.id.replace("_pending", "") });

            // remove moving line primitives and moving label primitives
            this.interactivePrimitives.movingPolylines.forEach(p => this.viewer.scene.primitives.remove(p));
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.movingLabels.length = 0;

            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_multidistance_clamped_point") &&
                    !primitiveId.includes("moving");
            });

            if (!isPoint) {
                // create last point
                const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
                lastPoint.id = generateId(this.coordinate, "multidistance_clamped_point");
                this.pointCollection.add(lastPoint);

                // create last line
                // first point for last line
                const firstPoint = this.coords.cache[this.coords.cache.length - 1];
                const lineGeometryInstance = createClampedLineGeometryInstance([firstPoint, this.coordinate], "multidistance_clamped_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // update coordinate data cache
                this.coords.cache.push(this.coordinate);

                // create last label
                const { distance } = calculateClampedDistance(firstPoint, this.coordinate, this.viewer.scene, 4);
                const midPoint = Cesium.Cartesian3.midpoint(firstPoint, this.coordinate, new Cesium.Cartesian3());
                const label = createLabelPrimitive(firstPoint, this.coordinate, distance)
                const { currentLetter, labelNumberIndex } = this._getLabelProperties(this.coordinate, this.coords.cache, this.coords.groups);
                label.id = generateId(midPoint, "multidistance_clamped_label");
                label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`
                this.labelCollection.add(label);
            }

            // update total measure count
            this.flags.countMeasure++;

            // total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(this.coords.cache, this.viewer.scene, 4);
            const totalLabel = createLabelPrimitive(this.coordinate, this.coordinate, totalDistance);
            totalLabel.id = generateId(this.coordinate, "multidistance_clamped_label_total");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            totalLabel.position = this.coords.cache[this.coords.cache.length - 1];
            this.labelCollection.add(totalLabel);

            // log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance, [...this.coords.cache]);

            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleMultiDistanceClampedDragStart(movement) {
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

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set drag point position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleMultiDistanceClampedDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        };
    }

    handleMultiDistanceClampedDrag(movement, selectedPoint) {
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
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
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
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // error handling: if no neighbour positions found then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return

            // Remove existing moving lines
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;

            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([pos, cartesian], "multidistance_clamped_line_moving");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
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

    handleMultiDistanceClampedDragEnd() {
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
            this.interactivePrimitives.dragPolylines.forEach(primitive => this.viewer.scene.primitives.remove(primitive));
            this.interactivePrimitives.dragPolylines.length = 0;
            this.interactivePrimitives.dragLabels.forEach(label => this.labelCollection.remove(label));
            this.interactivePrimitives.dragLabels.length = 0;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.includes("multidistance_clamped_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "multidistance_clamped_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart => !Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            otherPositions.forEach(pos => {
                // Create new line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance([this.coordinate, pos], "multidistance_clamped_line");
                const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                const { distance } = calculateClampedDistance(pos, this.coordinate, this.viewer.scene, 4);
                const oldMidPoint = Cesium.Cartesian3.midpoint(pos, this.coords.dragStart, new Cesium.Cartesian3());
                const newMidPoint = Cesium.Cartesian3.midpoint(pos, this.coordinate, new Cesium.Cartesian3());

                // Find and update the existing label primitive
                const labelPrimitive = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.startsWith("annotate_multidistance_clamped_label") &&
                    Cesium.Cartesian3.equals(label.position, oldMidPoint)
                )
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "multidistance_clamped_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            });

            // find total distance label by the last point in group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("multidistance_clamped_label_total") &&
                Cesium.Cartesian3.equals(label.position, group[group.length - 1])
            );

            // update the coordinate data
            const positionIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(group, this.viewer.scene, 4);
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group[group.length - 1];
                totalLabel.id = generateId(group[group.length - 1], "multidistance_clamped_label_total");
            }

            // update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance, group);

            // reset flag
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


    /******************
     * OTHER FEATURES *
     ******************/
    /******************
     * OTHER FEATURES *
     ******************/
    setUpButtons() {
        const createButton = (text, className, onClick) => {
            const button = document.createElement("button");
            button.textContent = text;
            button.classList.add("cesium-button", className);
            button.addEventListener("click", onClick);
            button.style.position = "absolute";
            return button;
        };

        const toggleLabelButton = createButton("Show", "toggle-label-button", this.handleLabelToggle.bind(this));

        const submitButton = createButton("Submit", "submit-button", this.handleSubmit.bind(this));

        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium && mapCesium.shadowRoot.querySelector("cesium-measure");

        if (measureToolbox) {
            // Set up a MutationObserver to watch for the presence of required elements
            const observer = new MutationObserver((_, obs) => {
                const multiDClamped = measureToolbox.shadowRoot.querySelector(".multi-distances-clamped");
                const toolbar = measureToolbox.shadowRoot.querySelector(".toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (multiDClamped && toolbar && measureToolButton) {
                    // Position buttons
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    toggleLabelButton.style.left = `${BUTTON_WIDTH * 7}px`;
                    toggleLabelButton.style.top = "-40px";
                    submitButton.style.left = `${BUTTON_WIDTH * 7}px`;
                    submitButton.style.top = "-80px";

                    // Append buttons to the toolbar
                    toolbar.appendChild(toggleLabelButton);
                    toolbar.appendChild(submitButton);

                    obs.disconnect(); // Stop observing once the buttons are appended

                    // Add event listener to toggle button visibility based on multi-distances-clamped button state
                    const toggleButtonVisibility = () => {
                        const shouldDisplay =
                            multiDClamped.classList.contains('active') &&
                            measureToolButton.classList.contains('active');
                        toggleLabelButton.style.display = shouldDisplay ? 'block' : 'none';
                        submitButton.style.display = shouldDisplay ? 'block' : 'none';
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
        this.labelCollection._labels.filter(label =>
            label.id &&
            label.id.includes("multidistance_clamped_label") &&
            !label.id.includes("moving") &&
            !label.id.includes("pending")
        ).forEach(label => label.show = !label.show);

        const toggleLabelButton = document.querySelector('.toggle-label-button');
        if (toggleLabelButton) {
            toggleLabelButton.textContent = this.labelCollection.show ? "Hide" : "Show";
        }
    }

    handleSubmit() {
        if (this.coords.selectedGroup && this.coords.selectedGroup.length > 1) {
            const cartograhpicDegressPos = this.coords.selectedGroup.map(cart => {
                const cartographic = Cesium.Cartographic.fromCartesian(cart);
                return {
                    longitude: Cesium.Math.toDegrees(cartographic.longitude),
                    latitude: Cesium.Math.toDegrees(cartographic.latitude),
                    height: cartographic.height
                };
            });

            const { totalDistance } = calculateClampedDistanceFromArray(this.coords.selectedGroup, this.viewer.scene, 4);
            console.log("🚀  totalDistance:", totalDistance);


            const payload = {
                trackId: cartesianToId(this.coords.selectedGroup[0], false),
                content: [...cartograhpicDegressPos],
                com_length: totalDistance
            }
            console.log("🚀  payload:", payload);

            console.log(this.coords.selectedGroup); // this will interact with the server for updated positions

            // // Calling actionLogger and handling response
            // this.actionLogger("annotateTracks_V2", payload)
            //     .then(response => {
            //         console.log("✅ Action successfully logged:", response);
            //     })
            //     .catch(error => {
            //         console.error("❌ Error logging action:", error);
            //     });
        }
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
        const pointIndex = group.findIndex(cart => Cesium.Cartesian3.equals(cart, position));
        if (pointIndex === -1) return;

        const prevPosition = pointIndex > 0 ? group[pointIndex - 1] : null;
        const nextPosition = pointIndex < group.length - 1 ? group[pointIndex + 1] : null;

        return [prevPosition, position, nextPosition].filter(pos => pos !== null);
    }

    /**
     * get the label text properties based on the position and the positions array
     * @param {Cesium.Cartesian3} position 
     * @param {Cesium.Cartesian3[]} positionsArray 
     * @returns {currentLetter: String, labelNumberIndex: Number} - the label text properties
     */
    _getLabelProperties(position, positionArray, groups) {
        const positionIndexInCache = positionArray.findIndex(cart => Cesium.Cartesian3.equals(cart, position));

        // cache length - 1 is the index
        const labelIndex = positionIndexInCache - 1;
        // index 0 means alphabet 'a' 
        const currentLetter = String.fromCharCode(97 + labelIndex % 26);
        // label number index
        const groupIndex = groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, position)));
        const labelNumberIndex = groupIndex !== -1 ? groupIndex : this.flags.countMeasure;

        return { currentLetter, labelNumberIndex }
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
        this.coords._distanceRecords.push(distanceRecord);
        this.logRecordsCallback(distanceRecord);

        return distanceRecord;
    }

    resetValue() {
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState('pointer')
        pointer && (pointer.style.display = 'none');

        // this.label._labelNumberIndex = 0;
        // this.label._labelIndex = 0;

        // reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        this.flags.isAddMode = false;
        this.flags.countMeasure = 0;
        // reset coords
        this.coords.cache = [];
        this.coords.dragStart = null;
        this.coords.dragStartToCanvas = null;
        this.coords._distanceRecords = [];

        // reset interactive primitives
        this.interactivePrimitives.movingPolylines = [];
        this.interactivePrimitives.movingLabels = [];
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolylines = [];
        this.interactivePrimitives.dragLabels = [];
        this.interactivePrimitives.hoveredLine = null;
        this.interactivePrimitives.selectedLine = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}
export { MultiDistanceClamped }
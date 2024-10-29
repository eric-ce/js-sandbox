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
    cartesianToId,
    generateIdByTimestamp
} from "../helper/helper.js";

class FireTrail {
    /**
     * Creates a new MultiDistance Clamped instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, actionLogger, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.pointerOverlay = this.stateManager.getOverlayState("pointer");

        this.actionLogger = actionLogger;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isAddMode: false,
            isSubmitting: false
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations e.g [{trailId:111, coordinates: [{cart1}, {cart2}]}},{...}]
            groupCounter: 0, // New counter for labelNumberIndex
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

        this.sentPositionKeys = new Set();
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
        const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

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
            // Create a new group with trailId and coordinates
            const newGroup = {
                trailId: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter, // Assign unique labelNumberIndex to the group
            };
            this.coords.groups.push(newGroup);
            // Link cache to the coordinates array of the new group
            this.coords.cache = newGroup.coordinates;
            this.coords.groupCounter++;
        }

        // Create point primitive
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);

        if (!isNearPoint) {
            // Create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "fire_trail_point_pending");
            this.pointCollection.add(point);

            // Update coordinate data cache
            this.coords.cache.push(this.coordinate);
        }

        if (this.coords.cache.length > 1) {
            // Remove the moving line and label primitives
            this.interactivePrimitives.movingPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.movingLabels.length = 0;

            const prevIndex = this.coords.cache.length - 2;
            const currIndex = this.coords.cache.length - 1;
            const prevPointCartesian = this.coords.cache[prevIndex];
            const currPointCartesian = this.coords.cache[currIndex];

            // Create line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance(
                [prevPointCartesian, currPointCartesian],
                "fire_trail_line_pending"
            );
            const linePrimitive = createClampedLinePrimitive(
                lineGeometryInstance,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            linePrimitive.isSubmitted = false;
            this.viewer.scene.primitives.add(linePrimitive);

            // Create label primitive
            const { distance } = calculateClampedDistance(
                prevPointCartesian,
                currPointCartesian,
                this.viewer.scene,
                4
            );
            const midPoint = Cesium.Cartesian3.midpoint(
                prevPointCartesian,
                currPointCartesian,
                new Cesium.Cartesian3()
            );

            const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                this.coordinate,
                this.coords.cache,
            );

            const label = createLabelPrimitive(
                prevPointCartesian,
                currPointCartesian,
                distance
            );
            label.id = generateId(midPoint, "fire_trail_label_pending");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        }
    }

    removeActionByPoint(pointPrimitive) {
        // Prompt the user for confirmation before removing the point
        const confirmRemoval = confirm("Do you want to remove this point?");
        if (!confirmRemoval) {
            // User canceled the removal; do nothing
            return;
        }

        const pointPosition = pointPrimitive.position.clone();

        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
            pointPosition,
            "annotate_fire_trail",
            this.viewer.scene,
            this.pointCollection,
            this.labelCollection
        );

        // Remove point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove moving line and label primitives
        this.interactivePrimitives.movingPolylines.forEach(primitive =>
            this.viewer.scene.primitives.remove(primitive)
        );
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(label =>
            this.labelCollection.remove(label)
        );
        this.interactivePrimitives.movingLabels.length = 0;

        if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {
            // When it is during the measure

            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, {
                coordinates: this.coords.cache,
            });

            this._createReconnectPrimitives(neighbourPositions, { coordinates: this.coords.cache }, true);

            // Update coords cache
            const pointIndex = this.coords.cache.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, pointPosition)
            );
            if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = this.coords.cache.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(
                followingPositions,
                followingIndex,
                { coordinates: this.coords.cache }
            );

            if (this.coords.cache.length === 0) {
                this.flags.isMeasurementComplete = true; // When removing the only point, consider the measure ended
            }
        } else if (this.coords.groups.length > 0) {
            // When the measure is ended
            const groupIndex = this.coords.groups.findIndex(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
            );
            const group = this.coords.groups[groupIndex];

            // Remove total label
            const lastPoint = group.coordinates[group.coordinates.length - 1];
            const targetTotalLabel = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.includes("fire_trail_label_total") &&
                    Cesium.Cartesian3.equals(label.position, lastPoint)
            );

            // Create reconnect primitives
            const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

            this._createReconnectPrimitives(neighbourPositions, group);

            // Update group's coordinates
            const pointIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, pointPosition)
            );
            if (pointIndex !== -1) group.coordinates.splice(pointIndex, 1);

            // Update following label primitives
            const followingPositions = group.coordinates.slice(pointIndex);
            const followingIndex = pointIndex;
            this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                group.coordinates,
                this.viewer.scene,
                4
            );

            // Update total distance label
            if (targetTotalLabel) {
                const newLastPoint = group.coordinates[group.coordinates.length - 1];
                targetTotalLabel.id = generateId(newLastPoint, "fire_trail_label_total");
                targetTotalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                targetTotalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
                targetTotalLabel.position = newLastPoint;
            }

            // Log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance);
            this.coords.selectedGroup = group;

            // Remove point and total label when there is only one point left in the group
            if (group.coordinates.length === 1) {
                // Remove the point and the total label
                const targetPoint = this.pointCollection._pointPrimitives.find(
                    p => p && Cesium.Cartesian3.equals(p.position, group.coordinates[0])
                );
                if (targetPoint) this.pointCollection.remove(targetPoint);
                const targetTotalLabel = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.includes("fire_trail_label_total") &&
                        Cesium.Cartesian3.equals(label.position, group.coordinates[0])
                );
                if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

                // Remove the group from coords.groups
                this.coords.groups.splice(groupIndex, 1);

                // Log distance result (empty distances and totalDistance)
                this.updateMultiDistancesLogRecords([], 0);
                this.coords.selectedGroup = null;
            }
        } else {
            return;
        }
    }

    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // Create reconnect line primitive
            const lineGeometryInstance = createClampedLineGeometryInstance(
                [neighbourPositions[0], neighbourPositions[2]],
                isPending ? "fire_trail_line_pending" : "fire_trail_line"
            );
            const linePrimitive = createClampedLinePrimitive(
                lineGeometryInstance,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            linePrimitive.isSubmitted = false;
            this.viewer.scene.primitives.add(linePrimitive);

            // Create reconnect label primitive
            const { distance } = calculateClampedDistance(
                neighbourPositions[0],
                neighbourPositions[2],
                this.viewer.scene,
                4
            );
            const midPoint = Cesium.Cartesian3.midpoint(
                neighbourPositions[0],
                neighbourPositions[2],
                new Cesium.Cartesian3()
            );
            const label = createLabelPrimitive(
                neighbourPositions[0],
                neighbourPositions[2],
                distance
            );
            label.id = generateId(
                midPoint,
                isPending ? "fire_trail_label_pending" : "fire_trail_label"
            );
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                neighbourPositions[1],
                group.coordinates
            );
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        }
    }

    _updateFollowingLabelPrimitives(followingPositions, followingIndex, group) {
        // Get mid points from following positions
        const midPoints = followingPositions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, followingPositions[i + 1], new Cesium.Cartesian3())
        );

        // Find the relative label primitives by midpoint
        const labelPrimitives = this.labelCollection._labels.filter(
            label => label.id && label.id.includes("fire_trail_label")
        );
        // Update label text
        midPoints.forEach((midPoint, index) => {
            const relativeLabelPrimitives = labelPrimitives.filter(l =>
                Cesium.Cartesian3.equals(l.position, midPoint)
            );
            const currentLetter = String.fromCharCode(97 + (followingIndex + index) % 26);
            const { labelNumberIndex } = this._getLabelProperties(
                followingPositions[index],
                group.coordinates
            );
            const { distance } = calculateClampedDistance(
                followingPositions[index],
                followingPositions[index + 1],
                this.viewer.scene,
                4
            );
            relativeLabelPrimitives.forEach(l => {
                l.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            });
        });
    }

    setAddModeByLine(linePrimitive) {
        // Reset previous hovered line if any
        if (
            this.interactivePrimitives.hoveredLine &&
            this.interactivePrimitives.hoveredLine !== linePrimitive
        ) {
            resetLineColor(this.interactivePrimitives.hoveredLine);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset previous selected line if different
        if (
            this.interactivePrimitives.selectedLine &&
            this.interactivePrimitives.selectedLine !== linePrimitive
        ) {
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

        // Find the group that contains the line positions
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, linePositions[0]))
        );
        if (!group || group.coordinates.length === 0) return;

        // Find the indices of the line positions in the group's coordinates
        const linePositionIndex1 = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, linePositions[0])
        );
        const linePositionIndex2 = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, linePositions[1])
        );
        const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);

        // Check if there is already a point near the coordinate to avoid duplicates
        const isNearPoint = this.coords.groups.some(g =>
            g.coordinates.some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3)
        );

        if (!isNearPoint) {
            // Create a new point primitive
            const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            point.id = generateId(this.coordinate, "fire_trail_point");
            this.pointCollection.add(point);

            // Insert the new coordinate into the group's coordinates at the correct position
            group.coordinates.splice(positionIndex + 1, 0, this.coordinate);
        }

        // Create line and label primitives
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
            l.id.includes("fire_trail_label") &&
            Cesium.Cartesian3.equals(l.position, midPoint)
        );
        if (existedLabel) this.labelCollection.remove(existedLabel);

        if (neighbourPositions.length === 3) {
            neighbourPositions.forEach((pos, i) => {
                // Create line primitives
                if (i < neighbourPositions.length - 1) {
                    const lineGeometryInstance = createClampedLineGeometryInstance(
                        [pos, neighbourPositions[i + 1]],
                        "fire_trail_line"
                    );
                    const newLinePrimitive = createClampedLinePrimitive(
                        lineGeometryInstance,
                        Cesium.Color.YELLOWGREEN,
                        this.cesiumPkg.GroundPolylinePrimitive
                    );
                    newLinePrimitive.isSubmitted = false;
                    this.viewer.scene.primitives.add(newLinePrimitive);

                    // Create label primitives
                    const { distance } = calculateClampedDistance(
                        pos,
                        neighbourPositions[i + 1],
                        this.viewer.scene,
                        4
                    );
                    const newMidPoint = Cesium.Cartesian3.midpoint(
                        pos,
                        neighbourPositions[i + 1],
                        new Cesium.Cartesian3()
                    );
                    const label = createLabelPrimitive(pos, neighbourPositions[i + 1], distance);
                    label.id = generateId(newMidPoint, "fire_trail_label");

                    // Use the updated _getLabelProperties method
                    const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                        neighbourPositions[i + 1],
                        group.coordinates
                    );
                    label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                    this.labelCollection.add(label);
                }
            });
        }

        // Update following label primitives
        const followingIndex = positionIndex + 1;
        const followingPositions = group.coordinates.slice(positionIndex + 1);
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

        // Recalculate distances and total distance
        const { distances, totalDistance } = calculateClampedDistanceFromArray(
            group.coordinates,
            this.viewer.scene,
            4
        );

        // Update total distance label
        const totalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
                Cesium.Cartesian3.equals(
                    label.position,
                    group.coordinates[group.coordinates.length - 1]
                )
        );
        if (totalLabel) {
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.position = group.coordinates[group.coordinates.length - 1];
        }

        // Update log records
        this.updateMultiDistancesLogRecords(distances, totalDistance);
        this.coords.selectedGroup = group;

        // Reset flags
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
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

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

        const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, cartesian], "fire_trail_line_moving");
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
        label.id = generateId(midPoint, "fire_trail_label_moving");
        const movingLabel = this.labelCollection.add(label);
        this.interactivePrimitives.movingLabels.push(movingLabel);
    }

    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredLine &&
                this.interactivePrimitives.hoveredLine !== this.interactivePrimitives.selectedLine
            ) {
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
        // Place last point and place last line
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) {
            // Use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

            // Update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(
                p => p.id && p.id.includes("pending")
            );
            pendingPoints.forEach(p => {
                p.id = p.id.replace("_pending", "");
            });

            // Update pending lines id
            const pendingLines = this.viewer.scene.primitives._primitives.filter(
                p =>
                    p.geometryInstances &&
                    p.geometryInstances.id &&
                    p.geometryInstances.id.includes("pending")
            );
            pendingLines.forEach(p => {
                const position = p.geometryInstances.geometry._positions;
                this.viewer.scene.primitives.remove(p);
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    position,
                    "fire_trail_line"
                );
                const linePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                linePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(linePrimitive);
            });

            // Update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(
                l => l.id && l.id.includes("pending")
            );
            pendingLabels.forEach(l => {
                l.id = l.id.replace("_pending", "");
            });

            // Remove moving line and label primitives
            this.interactivePrimitives.movingPolylines.forEach(p =>
                this.viewer.scene.primitives.remove(p)
            );
            this.interactivePrimitives.movingPolylines.length = 0;
            this.interactivePrimitives.movingLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.movingLabels.length = 0;

            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return (
                    typeof primitiveId === "string" &&
                    primitiveId.startsWith("annotate_fire_trail_point") &&
                    !primitiveId.includes("moving")
                );
            });

            if (!isPoint) {
                // Create last point
                const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
                lastPoint.id = generateId(this.coordinate, "fire_trail_point");
                this.pointCollection.add(lastPoint);

                // Create last line
                const firstPoint = this.coords.cache[this.coords.cache.length - 1];
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    [firstPoint, this.coordinate],
                    "fire_trail_line"
                );
                const linePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                linePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(linePrimitive);

                // Update coordinate data cache
                this.coords.cache.push(this.coordinate);

                // Create last label
                const { distance } = calculateClampedDistance(
                    firstPoint,
                    this.coordinate,
                    this.viewer.scene,
                    4
                );
                const midPoint = Cesium.Cartesian3.midpoint(
                    firstPoint,
                    this.coordinate,
                    new Cesium.Cartesian3()
                );
                const label = createLabelPrimitive(firstPoint, this.coordinate, distance);
                const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                    this.coordinate,
                    this.coords.cache
                );
                label.id = generateId(midPoint, "fire_trail_label");
                label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                this.labelCollection.add(label);
            }

            // Total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                this.coords.cache,
                this.viewer.scene,
                4
            );
            const totalLabel = createLabelPrimitive(
                this.coordinate,
                this.coordinate,
                totalDistance
            );
            totalLabel.id = generateId(this.coordinate, "fire_trail_label_total");
            totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            totalLabel.position = this.coords.cache[this.coords.cache.length - 1];
            this.labelCollection.add(totalLabel);

            // Log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance);

            // Set selectedGroup to current group's coordinates
            const currentGroup = this.coords.groups[this.coords.groups.length - 1];
            this.coords.selectedGroup = currentGroup

            this.flags.isMeasurementComplete = true;
            // Clear cache
            this.coords.cache = [];
        }
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleMultiDistanceClampedDragStart(movement) {
        // Initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) {
            // When the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_fire_trail_point") &&
                    !primitiveId.includes("moving");
            });

            // Error handling: if no point primitives found, then early exit
            if (!Cesium.defined(isPoint)) return;

            // Disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // Set drag start position
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleMultiDistanceClampedDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    handleMultiDistanceClampedDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true;
        }

        if (this.flags.isDragMode) {
            // Set existing point and label primitives to not show, remove line primitive
            const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
                this.coords.dragStart,
                "annotate_fire_trail",
                this.viewer.scene,
                this.pointCollection,
                this.labelCollection
            );
            selectedPoint.primitive.show = false;
            linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
            labelPrimitives.forEach(l => l.show = false);

            this.pointerOverlay.style.display = "none"; // Hide pointer overlay

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // Create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {
                // If dragging point exists, update it
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "fire_trail_point_moving");
            } else {
                // If dragging point doesn't exist, create a new one
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "fire_trail_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // Find the group containing the dragged point
            const groupIndex = this.coords.groups.findIndex(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            // Updated call to findNeighbourPosition
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // Error handling: if no neighbour positions found, then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            // Remove existing moving lines
            this.interactivePrimitives.dragPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.dragPolylines.length = 0;

            const otherPositions = neighbourPositions.filter(cart =>
                !Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );

            otherPositions.forEach((pos, idx) => {
                // Create line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    [pos, cartesian],
                    "fire_trail_line_moving"
                );
                const linePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOW,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                const addedLinePrimitive = this.viewer.scene.primitives.add(linePrimitive);
                addedLinePrimitive.isSubmitted = false;
                this.interactivePrimitives.dragPolylines.push(addedLinePrimitive);

                // Create or update label primitive
                const { distance } = calculateClampedDistance(pos, cartesian, this.viewer.scene, 4);
                const midPoint = Cesium.Cartesian3.midpoint(pos, cartesian, new Cesium.Cartesian3());
                const labelPrimitive = this.interactivePrimitives.dragLabels[idx];
                if (labelPrimitive) {
                    labelPrimitive.id = generateId(midPoint, "fire_trail_label_moving");
                    labelPrimitive.position = midPoint;
                    labelPrimitive.text = `${formatDistance(distance)}`;
                    labelPrimitive.showBackground = false;
                } else {
                    const newLabelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    newLabelPrimitive.id = generateId(midPoint, "fire_trail_label_moving");
                    newLabelPrimitive.showBackground = false;
                    const addedLabelPrimitive = this.labelCollection.add(newLabelPrimitive);
                    this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
                }
            });
        }
    }

    handleMultiDistanceClampedDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // Reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const groupIndex = this.coords.groups.findIndex(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            // Updated call to findNeighbourPosition
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            // Error handling: if no neighbour positions found, then early exit
            if (!neighbourPositions || neighbourPositions.length === 0) return;

            // Remove dragging point, line, and label
            if (this.interactivePrimitives.dragPoint)
                this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            this.interactivePrimitives.dragPolylines.forEach(primitive =>
                this.viewer.scene.primitives.remove(primitive)
            );
            this.interactivePrimitives.dragPolylines.length = 0;
            this.interactivePrimitives.dragLabels.forEach(label =>
                this.labelCollection.remove(label)
            );
            this.interactivePrimitives.dragLabels.length = 0;

            // Update existing point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(
                p =>
                    p.id &&
                    p.id.includes("fire_trail_point") &&
                    Cesium.Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "fire_trail_point");
            }

            // Create new line primitives and update labels
            const otherPositions = neighbourPositions.filter(cart =>
                !Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            otherPositions.forEach(pos => {
                // Create new line primitive
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    [this.coordinate, pos],
                    "fire_trail_line"
                );
                const linePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                linePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(linePrimitive);

                // Calculate distances and midpoints
                const { distance } = calculateClampedDistance(pos, this.coordinate, this.viewer.scene, 4);
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
                const labelPrimitive = this.labelCollection._labels.find(
                    label =>
                        label.id &&
                        label.id.startsWith("annotate_fire_trail_label") &&
                        Cesium.Cartesian3.equals(label.position, oldMidPoint)
                );
                if (labelPrimitive) {
                    const oldLabelText = labelPrimitive.text.split(":")[0].trim();
                    labelPrimitive.text = `${oldLabelText}: ${formatDistance(distance)}`;
                    labelPrimitive.id = generateId(newMidPoint, "fire_trail_label");
                    labelPrimitive.position = newMidPoint;
                    labelPrimitive.show = true;
                }
            });

            // Find total distance label by the last point in group
            const lastPosition = group.coordinates[group.coordinates.length - 1];
            const totalLabel = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.includes("fire_trail_label_total") &&
                    Cesium.Cartesian3.equals(label.position, lastPosition)
            );

            // Update the coordinate data
            const positionIndex = group.coordinates.findIndex(cart =>
                Cesium.Cartesian3.equals(cart, this.coords.dragStart)
            );
            if (positionIndex !== -1)
                this.coords.groups[groupIndex].coordinates[positionIndex] = this.coordinate;

            // Update total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                group.coordinates,
                this.viewer.scene,
                4
            );
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = lastPosition;
                totalLabel.id = generateId(lastPosition, "fire_trail_label_total");
            }

            // Update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance);
            this.coords.selectedGroup = group;

            // Reset flag
            this.flags.isDragMode = false;
        }
        // Set back to default multi-distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMultiDistanceClampedMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


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
                const fireTrail = measureToolbox.shadowRoot.querySelector(".fire-trail");
                const toolbar = measureToolbox.shadowRoot.querySelector(".toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (fireTrail && toolbar && measureToolButton) {
                    // Position buttons
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    toggleLabelButton.style.left = `${BUTTON_WIDTH * 11}px`;
                    toggleLabelButton.style.top = "-40px";
                    submitButton.style.left = `${BUTTON_WIDTH * 11}px`;
                    submitButton.style.top = "-80px";

                    // Append buttons to the toolbar
                    toolbar.appendChild(toggleLabelButton);
                    toolbar.appendChild(submitButton);

                    obs.disconnect(); // Stop observing once the buttons are appended

                    // Update button overlay text
                    this.updateButtonOverlay(toggleLabelButton, "toggle label on or off");
                    this.updateButtonOverlay(submitButton, "submit the current annotation");

                    // Add event listener to toggle button visibility based on multi-distances-clamped button state
                    const toggleButtonVisibility = () => {
                        const shouldDisplay =
                            fireTrail.classList.contains('active') &&
                            measureToolButton.classList.contains('active');
                        toggleLabelButton.style.display = shouldDisplay ? 'block' : 'none';
                        submitButton.style.display = shouldDisplay ? 'block' : 'none';
                    };

                    // Initial visibility check
                    toggleButtonVisibility();

                    // Set up another MutationObserver to watch class changes for visibility toggling
                    const classObserver = new MutationObserver(toggleButtonVisibility);
                    classObserver.observe(fireTrail, { attributes: true, attributeFilter: ['class'] });
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
            label.id.includes("fire_trail_label") &&
            !label.id.includes("moving") &&
            !label.id.includes("pending")
        ).forEach(label => label.show = !label.show);

        const toggleLabelButton = document.querySelector('.toggle-label-button');
        if (toggleLabelButton) {
            toggleLabelButton.textContent = this.labelCollection.show ? "Hide" : "Show";
        }
    }

    handleSubmit() {
        // Prevent multiple submissions
        if (this.flags.isSubmitting) return;

        // Check if there is a selected group and it has more than one coordinate
        if (this.coords.selectedGroup && this.coords.selectedGroup.coordinates.length > 1) {
            // Function to generate a unique key for a position
            const positionKey = (pos) =>
                `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;

            // Start submission
            this.flags.isSubmitting = true;

            // Generate keys for selected positions
            const selectedPositionKeys = this.coords.selectedGroup.coordinates.map((pos) =>
                positionKey(pos)
            );

            // Filter out positions that have already been sent
            const newPositions = this.coords.selectedGroup.coordinates.find((pos, index) => {
                return !this.sentPositionKeys.has(selectedPositionKeys[index]);
            });

            if (newPositions) {
                const cartographicDegreesPos = this.coords.selectedGroup.coordinates.map((cart) => {
                    const cartographic = Cesium.Cartographic.fromCartesian(cart);
                    return {
                        longitude: Cesium.Math.toDegrees(cartographic.longitude),
                        latitude: Cesium.Math.toDegrees(cartographic.latitude),
                        height: cartographic.height,
                    };
                });

                const { totalDistance } = calculateClampedDistanceFromArray(
                    this.coords.selectedGroup.coordinates,
                    this.viewer.scene,
                    4
                );
                console.log("🚀  totalDistance:", totalDistance);

                const payload = {
                    trackId: this.coords.selectedGroup.trailId, // Set trackId to trailId
                    content: JSON.stringify(cartographicDegreesPos),
                    com_length: totalDistance,
                };
                console.log("🚀  payload:", payload);

                if (confirm("Do you want to submit this fire trail?")) {
                    // Lookup line primitives by the new positions
                    const lines = this.lookupLinesFromArray(
                        this.coords.selectedGroup.coordinates
                    );
                    // Set line primitives to isSubmitted true
                    lines.forEach((line) => (line.isSubmitted = true));

                    // Calling actionLogger and handling response
                    this.actionLogger("annotateTracks_V2", payload)
                        .then((response) => {
                            console.log("✅ Action successfully logged:", response);
                            // Apply color to the submitted lines
                            lines.forEach((linePrimitive) => {
                                changeLineColor(linePrimitive, Cesium.Color.DARKGREEN);
                            });
                            // Add the new positions to the sentPositionKeys set
                            this.coords.selectedGroup.coordinates.forEach((pos, index) => {
                                this.sentPositionKeys.add(selectedPositionKeys[index]);
                            });
                            // Notify user of successful submission
                            alert("Measure submitted successfully!");
                            // Reset submission flag
                            this.flags.isSubmitting = false;
                        })
                        .catch((error) => {
                            console.error("❌ Error logging action:", error);
                            alert("Message submission failed. Please try again.");
                            // Reset submission flag
                            this.flags.isSubmitting = false;
                        });
                } else {
                    // User canceled submission
                    this.flags.isSubmitting = false;
                }
            } else {
                alert("No new positions to submit.");
                // Reset submission flag
                this.flags.isSubmitting = false;
            }
        } else {
            // No valid selection, reset submission flag
            this.flags.isSubmitting = false;
        }
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Finds the previous, current, and next positions of a given position within a group's coordinates.
     * @param {Cesium.Cartesian3} position - The Cartesian3 coordinate to find.
     * @param {{ trailId: string, coordinates: Cesium.Cartesian3[] }} group - The group object containing the coordinates.
     * @returns {Cesium.Cartesian3[]} - An array containing the previous position, current position, and next position.
     */
    findNeighbourPosition(position, group) {
        const { coordinates } = group;
        const pointIndex = coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, position)
        );
        if (pointIndex === -1) return [];

        const prevPosition = pointIndex > 0 ? coordinates[pointIndex - 1] : null;
        const nextPosition =
            pointIndex < coordinates.length - 1 ? coordinates[pointIndex + 1] : null;

        return [prevPosition, position, nextPosition].filter(pos => pos !== null);
    }

    /**
     * Get the label text properties based on the position and the positions array.
     * @param {Cesium.Cartesian3} position - The current position.
     * @param {Cesium.Cartesian3[]} positionArray - The array of positions in the current group (this.coords.cache).
     * @returns {{ currentLetter: String, labelNumberIndex: Number }} - The label text properties.
     */
    _getLabelProperties(position, positionArray) {
        // Find the index of the position in the positionArray
        const positionIndexInCache = positionArray.findIndex(cart =>
            cart && Cesium.Cartesian3.equals(cart, position)
        );

        // Calculate label index
        const labelIndex = positionIndexInCache - 1;
        const adjustedLabelIndex = labelIndex >= 0 ? labelIndex : 0;

        // Map index to alphabet letters starting from 'a'
        const currentLetter = String.fromCharCode(97 + (adjustedLabelIndex % 26));

        // Find the group that contains the position
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => cart && Cesium.Cartesian3.equals(cart, position))
        );

        // Use labelNumberIndex from the group
        const labelNumberIndex = group.labelNumberIndex

        return { currentLetter, labelNumberIndex };
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
     * Lookup the line primitives array by the positions array
     * @param {Cesium.Cartesian3[]} positions - The array of Cartesian3 positions to lookup the lines.
     * @returns {Cesium.Primitive[]} - The array of line primitives that match the positions.
     */
    lookupLinesFromArray(positions) {
        // Function to generate a unique key for a position by rounding coordinates
        function positionKey(pos) {
            return `${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`;
        }

        // Create a set of position keys from the input positions for quick lookup
        const positionKeys = new Set(positions.map(pos => positionKey(pos)));

        // Initialize a set to store matching line primitives
        const linePrimitives = new Set();

        // Filter the primitives to find lines that match certain criteria
        const lines = this.viewer.scene.primitives._primitives.filter(p =>
            p.geometryInstances && // Ensure the primitive has geometry instances
            p.geometryInstances.id && // Ensure the geometry instance has an ID
            p.geometryInstances.id.startsWith("annotate_fire_trail_line") && // ID starts with specific string
            !p.geometryInstances.id.includes("moving") // Exclude moving lines
        );

        // Iterate over the filtered lines
        lines.forEach(line => {
            // Get the positions of the line (array of Cartesian3)
            const linePositions = line.geometryInstances.geometry._positions; // [Cartesian3, Cartesian3]

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
     * check if there are unsubmitted lines
     * @returns {Boolean} - whether there are unsubmitted lines
     */
    checkUnsubmittedLines() {
        const unsubmittedLines = this.viewer.scene.primitives._primitives.filter(p =>
            p.geometryInstances &&
            p.geometryInstances.id &&
            p.geometryInstances.id.includes("fire_trail_line") &&
            !p.isSubmitted
        );

        return unsubmittedLines.length > 0;
    };

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
export { FireTrail }
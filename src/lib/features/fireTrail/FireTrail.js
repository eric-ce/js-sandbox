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
    getPrimitiveByPointPosition,
    generateIdByTimestamp,
    positionKey,
    showCustomNotification,
} from "../../helper/helper.js";
import { handleFireTrailLeftClick } from "./fireTrailLeftClick.js";
import { handleFireTrailMouseMove } from "./fireTrailMouseMove.js";
import { handleFireTrailDoubleClick } from "./fireTrailDoubleLeftClick.js";
import { handleFireTrailRightClick } from "./fireTrailRightClick.js";

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
            isSubmitting: false,
            isShowLabels: false,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations e.g [{trailId:111, coordinates: [{cart1}, {cart2}]}},{...}]
            groupCounter: 0, // New counter for labelNumberIndex
            _distanceRecords: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
            groupToSubmit: null,  // Stores the group to submit
        };

        this.sentGroupKeys = new Set();

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
            selectedLines: [],      // Array of selected line primitives
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive
        };

        this.buttons = {
            labelButton: null,
            submitButton: null,
        }
        this.setUpButtons();

        this.stateColors = {
            hover: Cesium.Color.KHAKI,
            select: Cesium.Color.BLUE,
            default: Cesium.Color.YELLOWGREEN,
            submitted: Cesium.Color.DARKGREEN,
            add: Cesium.Color.YELLOW,
        }

        this.handleFireTrailLeftClick = handleFireTrailLeftClick.bind(this);
        this.handleFireTrailMouseMove = handleFireTrailMouseMove.bind(this);
        this.handleFireTrailDoubleClick = handleFireTrailDoubleClick.bind(this);
        this.handleFireTrailRightClick = handleFireTrailRightClick.bind(this);
    }

    /**
     * Sets up input actions for multi-distance clamped mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailDoubleClick(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleFireTrailMiddleClick(movement)
        }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
    }


    /*****************
     * DRAG FEATURES *
     *****************/
    handleFireTrailDragStart(movement) {
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

            // hightlight the line set that is being dragged
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );
            if (group) {
                // reset line color 
                const resetLinesColor = (lines) => {
                    lines.forEach(line => {
                        if (!line.isSubmitted) {    // don't change submitted line color
                            this.changeLinePrimitiveColor(line, 'default');
                        }
                    });
                }
                resetLinesColor(this.interactivePrimitives.selectedLines);

                // highlight the drag lines as selected lines
                const lines = this.lookupLinesByPositions(group.coordinates);
                this.interactivePrimitives.selectedLines = lines;
                lines.forEach(line => {
                    if (!line.isSubmitted) {    // don't change submitted line color
                        this.changeLinePrimitiveColor(line, 'select');
                    }
                });
            }

            // set flags to prevent other actions
            if (this.flags.isAddMode) {
                this.flags.isAddMode = false;
                showCustomNotification("you have exited add line mode", this.viewer.container);
            }

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handleFireTrailDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    handleFireTrailDrag(movement, selectedPoint) {
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
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );

            // Updated call to findNeighbourPosition
            const neighbourPositions = this.findNeighbourPosition(this.coords.dragStart, group);
            if (!neighbourPositions || neighbourPositions.length === 0) return; // Error handling: no neighbour positions found

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
                    labelPrimitive.show = this.flags.isShowLabels;
                } else {
                    const newLabelPrimitive = createLabelPrimitive(pos, cartesian, distance);
                    newLabelPrimitive.id = generateId(midPoint, "fire_trail_label_moving");
                    newLabelPrimitive.showBackground = false;
                    newLabelPrimitive.show = this.flags.isShowLabels;
                    const addedLabelPrimitive = this.labelCollection.add(newLabelPrimitive);
                    this.interactivePrimitives.dragLabels.push(addedLabelPrimitive);
                }
            });
        }
    }

    handleFireTrailDragEnd() {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // Reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart))
            );

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
                    labelPrimitive.show = this.flags.isShowLabels;
                    labelPrimitive.showBackground = this.flags.isShowLabels;
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
                group.coordinates[positionIndex] = this.coordinate;

            // Update total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                group.coordinates,
                this.viewer.scene,
                4
            );
            if (totalLabel) {
                totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
                totalLabel.position = group.coordinates[group.coordinates.length - 1];
                totalLabel.id = generateId(lastPosition, "fire_trail_label_total");
            }

            // Update log records
            this.updateMultiDistancesLogRecords(distances, totalDistance);
            this.coords.groupToSubmit = group;

            // Update selected line color
            const lines = this.lookupLinesByPositions(group.coordinates);
            this.interactivePrimitives.selectedLines = lines;
            this.updateSelectedLineColor(group);

            // Reset flag
            this.flags.isDragMode = false;
        }
        // Set back to default multi-distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleFireTrailMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    handleFireTrailMiddleClick(movement) {
        // don't allow middle click when during other actions
        if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

        switch (pickedObjectType) {
            case "point":
                this.removeLineSetByPrimitive(pickedObject.primitive, "point");
                break;
            case "line":
                this.removeLineSetByPrimitive(pickedObject.primitive, "line");
                break
        }
    }

    /**
     * Remove the line set by the point or line primitive
     * @param {Cesium.Primitive} primitive - The primitive to lookup group coordinates
     * 
     */
    async removeLineSetByPrimitive(primitive, primitiveType) {
        let primitivePosition;
        if (primitiveType === "point") {
            primitivePosition = primitive.position;
        } else if (primitiveType === "line") {
            primitivePosition = primitive.geometryInstances.geometry._positions[0];
        }

        // Find the index of the group that contains the primitive position
        const groupIndex = this.coords.groups.findIndex(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePosition))
        );
        if (groupIndex === -1) return; // Error handling: no group found

        const group = this.coords.groups[groupIndex];

        // Confirm removal with the user
        if (!confirm(`Do you want to remove the fire trail ${group.trailId}?`)) return;

        // Retrieve associated primitives for the group
        const { pointPrimitives, linePrimitives, labelPrimitives } = this.lookupPrimitivesByPositions(group.coordinates);

        // Reset color of previously selected lines if they are not submitted
        this.interactivePrimitives.selectedLines.forEach(line => {
            if (!line.isSubmitted) {
                this.changeLinePrimitiveColor(line, 'default');
            }
        });

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

        // Generate a unique key for the group to check submission status
        const groupKey = group.coordinates.map(pos => positionKey(pos)).join('|');
        const isLineSetSubmitted = this.sentGroupKeys.has(groupKey);

        // If the line set was submitted, log the removal action
        if (isLineSetSubmitted) {
            const payload = {
                trackId: group.trailId, // Associate with the correct trail ID
                content: "",
                comp_length: 0.0,
            };

            try {
                // Await the actionLogger promise and handle the response
                const response = await this.actionLogger("annotateTracks_V5", payload);
                console.log("✅ Remove action submitted:", response);
                this.logRecordsCallback({ submitStatus: `${group.trailId} Removed From Server Successfully` });
            } catch (error) {
                console.error("❌ Error logging action:", error);
                alert(`Fire Trail ${group.trailId} Submission Failed`);
                this.logRecordsCallback({ submitStatus: `${group.trailId} Removal From Server Failed` });
            }
        }

        // Remove the group coordinates from the coords.groups array
        group.coordinates = [];

        // Reset submission-related properties to their default states
        this.coords.groupToSubmit = null;
        this.interactivePrimitives.selectedLines = [];

        // Log the removal of the trail
        this.logRecordsCallback(`${group.trailId} Removed`);
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
            label.show = this.flags.isShowLabels;
            label.showBackground = this.flags.isShowLabels;
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
        this.buttons.labelButton = toggleLabelButton;

        const submitButton = createButton("Submit", "submit-button", this.handleSubmit.bind(this));
        this.buttons.submitButton = submitButton;

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
        // Toggle the flag
        this.flags.isShowLabels = !this.flags.isShowLabels;

        const labels = this.labelCollection._labels.filter(label =>
            label.id &&
            label.id.includes("fire_trail_label")
        ).forEach((label) => {
            label.show = this.flags.isShowLabels
            label.showBackground = this.flags.isShowLabels;
        });

        if (this.buttons.labelButton) {
            this.buttons.labelButton.textContent = this.flags.isShowLabels ? "Hide" : "Show";
        }
        return labels;
    }

    /**
     * Handles the submission of the selected fire trail.
     * Prevents multiple submissions, checks submission status, and logs actions.
     */
    async handleSubmit() {
        // Prevent multiple submissions by checking if a submission is already in progress
        if (this.flags.isSubmitting) return;

        const groupToSubmit = this.coords.groupToSubmit;

        // Validate the selected group to ensure it exists and has more than one coordinate
        if (!groupToSubmit || groupToSubmit.coordinates.length <= 1) {
            showCustomNotification("Please select a valid fire trail to submit", this.viewer.container);
            this.flags.isSubmitting = false;
            return;
        }

        // Generate a unique key for the group by concatenating position keys with a separator
        const groupKey = groupToSubmit.coordinates.map(pos => positionKey(pos)).join('|');

        // Check if the group has already been submitted to prevent redundant submissions
        if (this.sentGroupKeys.has(groupKey)) {
            alert(`No new changes to submit for this fire trail ${groupToSubmit.trailId}`);
            this.flags.isSubmitting = false;
            return;
        }

        // Set the submitting flag to true to indicate that a submission is in progress
        this.flags.isSubmitting = true;

        // Transform Cartesian coordinates to cartographic degrees
        const cartographicDegreesPos = groupToSubmit.coordinates.map(cart => {
            const cartographic = Cesium.Cartographic.fromCartesian(cart);
            return {
                longitude: Cesium.Math.toDegrees(cartographic.longitude),
                latitude: Cesium.Math.toDegrees(cartographic.latitude),
                height: cartographic.height,
            };
        });

        // Calculate the total distance of the fire trail using a helper function
        const { totalDistance } = calculateClampedDistanceFromArray(
            groupToSubmit.coordinates,
            this.viewer.scene,
            4
        );

        // Prepare the payload to be sent to the server
        const payload = {
            trackId: groupToSubmit.trailId,
            content: JSON.stringify(cartographicDegreesPos),
            comp_length: totalDistance,
        };
        console.log("🚀  payload:", payload);

        // Prompt the user for confirmation before proceeding with the submission
        if (!confirm("Do you want to submit this fire trail?")) {
            this.flags.isSubmitting = false;
            return;
        }

        try {
            // Retrieve all line primitives associated with the group's coordinates
            const lines = this.lookupLinesByPositions(groupToSubmit.coordinates);

            // Log the submission action by sending the payload to the server
            const response = await this.actionLogger("annotateTracks_V5", payload);
            console.log("✅ Action successfully logged:", response);

            // Update the color and submission status of each line primitive to indicate successful submission
            lines.forEach(linePrimitive => {
                this.changeLinePrimitiveColor(linePrimitive, 'submitted');
                linePrimitive.isSubmitted = true;
            });

            // Add the group's unique key to the set of submitted groups to track submissions
            this.sentGroupKeys.add(groupKey);

            // Display a notification to the user indicating successful submission
            showCustomNotification(`Fire Trail ${groupToSubmit.trailId} Submitted Successfully!`, this.viewer.container);

            // Log the successful submission status
            this.logRecordsCallback({ submitStatus: `${groupToSubmit.trailId} Submit Successful` });
        } catch (error) {
            // Handle any errors that occur during the submission process
            console.error("❌ Error logging action:", error);
            alert(`Fire Trail ${groupToSubmit.trailId} submission failed. Please try again`);

            // Log the failed submission status
            this.logRecordsCallback({ submitStatus: `${groupToSubmit.trailId} Submit Failed` });
        } finally {
            // Reset the submitting flag regardless of success or failure to allow future submissions
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
     * @returns {Object} - The array of line primitives that match the positions.
     */
    lookupPrimitivesByPositions(positions) {
        // lookup points primitives
        const pointPrimitives = this.pointCollection._pointPrimitives
            .filter(p =>
                p.id &&
                p.id.startsWith("annotate_fire_trail_point") &&
                !p.id.includes("moving") &&
                positions.some(pos => Cesium.Cartesian3.equals(p.position, pos))
            )
        // lookup line primitives
        const linePrimitives = this.lookupLinesByPositions(positions);

        // lookup label primitives
        const midPoints = positions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, positions[i + 1], new Cesium.Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels
            .filter(l =>
                l.id &&
                l.id.startsWith("annotate_fire_trail_label") &&
                midPoints.some(pos => Cesium.Cartesian3.equals(l.position, pos))
            );
        const totalLabelPrimitive = this.labelCollection._labels.find(l =>
            l.id &&
            l.id.includes("fire_trail_label_total") &&
            Cesium.Cartesian3.equals(l.position, positions[positions.length - 1])
        );
        if (totalLabelPrimitive) {
            labelPrimitives.push(totalLabelPrimitive);
        }

        return { pointPrimitives, linePrimitives, labelPrimitives };
    }

    /**
     * Lookup the line primitives array by the positions array
     * @param {Cesium.Cartesian3[]} positions - The array of Cartesian3 positions to lookup the lines.
     * @returns {Cesium.Primitive[]} - The array of line primitives that match the positions.
     */
    lookupLinesByPositions(positions) {
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

    /**
     * change the color of the line primitive based on the color type
     * @param {Cesium.Primitive} linePrimitive 
     * @param {String} colorType 
     * @returns {Cesium.Primitive} - the line primitive with the updated color
     */
    changeLinePrimitiveColor(linePrimitive, colorType) {
        let colorToSet;
        switch (colorType) {
            case 'hover':
                colorToSet = this.stateColors.hover;
                break;
            case 'select':
                colorToSet = this.stateColors.select;
                break;
            case 'submitted':
                colorToSet = this.stateColors.submitted;
                break;
            case 'add':
                colorToSet = this.stateColors.add;
                break;
            default:
                colorToSet = this.stateColors.default;
                break;
        }

        // Change the color
        linePrimitive.appearance.material.uniforms.color = colorToSet;
        // if linePrimitive has depthFailAppearance, change the color as well
        if (linePrimitive.depthFailAppearance) {
            linePrimitive.depthFailAppearance.material.uniforms.color = colorToSet;
        }

        return linePrimitive;
    }

    /**
     * look for line primitives by group positions, and update the selected line color
     * @param {Cesium.Carteisan3[]} group 
     * @returns {Cesium.Primitive[]} - the line primitives that match the group positions
     */
    updateSelectedLineColor(group) {
        // const groupIndex = this.coords.groups.findIndex(group =>
        //     group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, position))
        // );
        // if (groupIndex === -1) return;
        // const group = this.coords.groups[groupIndex];
        const lines = this.lookupLinesByPositions(group.coordinates);

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
                if (!line.isSubmitted) {    // don't change submitted line color
                    this.changeLinePrimitiveColor(line, 'select');
                }
            });
            this.interactivePrimitives.selectedLines = lines;
        }
        return lines;
    }

    /**
     * remove moving primitives: lines and labels
     */
    removeMovingPrimitives() {
        this.interactivePrimitives.movingPolylines.forEach(primitive =>
            this.viewer.scene.primitives.remove(primitive)
        );
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(label =>
            this.labelCollection.remove(label)
        );
        this.interactivePrimitives.movingLabels.length = 0;
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
        // this.coords.groupToSubmit = null;

        // reset interactive primitives
        this.interactivePrimitives.movingPolylines = [];
        this.interactivePrimitives.movingLabels = [];
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolylines = [];
        this.interactivePrimitives.dragLabels = [];
        this.interactivePrimitives.hoveredLine = null;
        // this.interactivePrimitives.selectedLines = [];
        this.interactivePrimitives.selectedLine = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}
export { FireTrail }
import * as Cesium from "cesium";
import {
    formatDistance,
    removeInputActions,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    calculateClampedDistance,
    calculateClampedDistanceFromArray,
    positionKey,
    showCustomNotification,
    createGroundPolylinePrimitive,
    makeDraggable,
} from "../../helper/helper.js";
import { sharedStyleSheet } from "../../../sharedStyle.js";
import { multiDClampedIcon } from '../../../assets/icons.js';
import { handleFireTrailLeftClick } from "./fireTrailLeftClick.js";
import { handleFireTrailMouseMove } from "./fireTrailMouseMove.js";
import { handleFireTrailDoubleClick } from "./fireTrailDoubleLeftClick.js";
import { handleFireTrailRightClick } from "./fireTrailRightClick.js";
import { handleFireTrailMiddleClick } from "./fireTrailMiddleClick.js";

export class FireTrail extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        // cesium variables
        this._viewer = null;
        this._handler = null;
        this._cesiumPkg = null;
        this._app = null;

        this._cesiumPkg = null;

        this._cesiumStyle = null;

        this.pointerOverlay = null;

        // helpBox
        this._setupHelpBox = null;
        this._updateHelpBox = null;

        // logBox
        this._setupLogBox = null;
        this._updateRecords = null;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isAddMode: false,
            isSubmitting: false,
            isShowLabels: false,
            isReverse: false,
            isActive: false,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations e.g [{trailId:111, coordinates: [{cart1}, {cart2}]}},{...}]
            groupCounter: 0,    // New counter for labelNumberIndex
            _distanceRecords: [],
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null, // Store the drag start position to canvas in Cartesian2
            groupToSubmit: null,  // Stores the group to submit
        };

        this.sentGroupKeys = new Set();

        // Cesium primitives collections
        this.pointCollection = null;
        this.labelCollection = null;

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            dragPoint: null,        // Currently dragged point primitive
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels
            addModeLine: null,      // Selected line primitive in add mode
            selectedLines: [],      // Array of selected line primitives
            hoveredPoint: null,     // Hovered point primitive
            hoveredLabel: null,     // Hovered label primitive
            hoveredLine: null,      // Hovered line primitive
        };

        // buttons for fire trail mode
        this.buttons = {
            fireTrailContainer: null,
            fireTrailButton: null,
            labelButton: null,
            submitButton: null,
        }

        // color for cesium primitives
        this.stateColors = {
            hover: Cesium.Color.KHAKI,
            select: Cesium.Color.BLUE,
            default: Cesium.Color.YELLOWGREEN,
            submitted: Cesium.Color.DARKGREEN,
            add: Cesium.Color.YELLOW,
            layerColor: null,
        }

        // cesium handler action
        this.handleFireTrailLeftClick = handleFireTrailLeftClick.bind(this);
        this.handleFireTrailMouseMove = handleFireTrailMouseMove.bind(this);
        this.handleFireTrailDoubleClick = handleFireTrailDoubleClick.bind(this);
        this.handleFireTrailRightClick = handleFireTrailRightClick.bind(this);
        this.handleFireTrailMiddleClick = handleFireTrailMiddleClick.bind(this);

        /**
         * @typedef {function} ActionLoggerBound
         * @param {*} payload - content to be sent
         * @param {string} table - destination table
         * @returns {*} The return value of the function
         */
        this.actionLogger = async (table, payload) => {
            //todo move edits of firebase to the firebase package
            let options = {
                streamType: "core",
                streamId: table
            }
            return await this.app.logAction("iot", payload, options)
        }
    }


    connectedCallback() {
        if (this.viewer) {
            this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
            this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

            this.initialize();
        }
    }


    /*********************
     * GETTER AND SETTER *
     *********************/
    set app(app) {
        this._app = app
        this.log = app.log
    }

    get app() {
        return this._app
    }

    get viewer() {
        return this._viewer;
    }

    set viewer(viewer) {
        this._viewer = viewer;
    }

    get stateManager() {
        return this._stateManager;
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get logRecordsCallback() {
        return this._logRecordsCallback;
    }

    set logRecordsCallback(callback) {
        this._logRecordsCallback = callback;
    }

    get cesiumPkg() {
        return this._cesiumPkg;
    }

    set cesiumPkg(cesiumPkg) {
        this._cesiumPkg = cesiumPkg;
    }

    get updateRecords() {
        return this._updateRecords;
    }

    set updateRecords(callback) {
        this._updateRecords = callback;
    }

    get cesiumStyle() {
        return this._cesiumStyle;
    }

    set cesiumStyle(style) {
        const clonedStyle = style.cloneNode(true);
        this._cesiumStyle = clonedStyle;
        if (clonedStyle) {
            this.shadowRoot.appendChild(clonedStyle)
        };
    }

    get setupHelpBox() {
        return this._setupHelpBox;
    }

    set setupHelpBox(callback) {
        this._setupHelpBox = callback;
    }

    get updateHelpBox() {
        return this._updateHelpBox;
    }

    set updateHelpBox(callback) {
        this._updateHelpBox = callback;
    }

    get setupLogBox() {
        return this._setupLogBox;
    }

    set setupLogBox(callback) {
        this._setupLogBox = callback;
    }


    /***************
     * MAIN METHOD *
     ***************/
    initialize() {
        // apply shared style
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // if screenSpaceEventHandler existed use it, if not create a new one
        if (this.viewer.screenSpaceEventHandler) {
            this.handler = this.viewer.screenSpaceEventHandler;
        } else {
            this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        }

        // setup label button and submit buttons
        this.setUpButtons();

        // set the pointer overlay
        this.pointerOverlay = this.stateManager.getOverlayState("pointer");
    }


    /***************************************
     * CESIUM FEATURES FOR FIRE TRAIL MODE *
     ***************************************/
    /**
     * Sets up input actions for fire trail mode.
     */
    setupInputActions() {
        // remove existing input actions
        removeInputActions(this.handler);

        // Set up input actions for fire trail mode
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
            if (!group) return;

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
            const lines = this.findLinesByPositions(group.coordinates);
            this.interactivePrimitives.selectedLines = lines;
            lines.forEach(line => {
                if (!line.isSubmitted) {    // don't change submitted line color
                    this.changeLinePrimitiveColor(line, 'select');
                }
            });

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
            const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
                this.coords.dragStart,
                "fire_trail",
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
            if (!group) return; // Error handling: no group found

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
                const linePrimitive = createGroundPolylinePrimitive(
                    [pos, cartesian],
                    "fire_trail_line_moving",
                    Cesium.Color.YELLOW,
                    this.cesiumPkg.GroundPolylinePrimitive
                )
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
            if (!group) return; // Error handling: no group found

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
                const linePrimitive = createGroundPolylinePrimitive(
                    [this.coordinate, pos],
                    "fire_trail_line",
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                )
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
            const lines = this.findLinesByPositions(group.coordinates);
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


    _createReconnectPrimitives(neighbourPositions, group, isPending = false) {
        if (neighbourPositions.length === 3) {
            // Create reconnect line primitive
            const linePrimitive = createGroundPolylinePrimitive(
                [neighbourPositions[0], neighbourPositions[2]],
                isPending ? "fire_trail_line_pending" : "fire_trail_line",
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
                group
            );
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        }
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

        // setup fire trail container
        this.fireTrailContainer = document.createElement("div");
        this.fireTrailContainer.classList.add("fire-trail-container");
        this.shadowRoot.appendChild(this.fireTrailContainer);
        makeDraggable(this.fireTrailContainer, this.viewer.container);

        // setup fire trail button
        const fireTrailImg = `<img src="${multiDClampedIcon}" alt="fire-trail" style="width: 30px; height: 30px;" aria-hidden="true">`
        this.buttons.fireTrailButton = createButton(fireTrailImg, "fire-trail", this.handleFireTrailToggle.bind(this));
        this.fireTrailContainer.appendChild(this.buttons.fireTrailButton);

        // setup label button
        this.buttons.labelButton = createButton("Show", "toggle-label-button", this.handleLabelToggle.bind(this));
        this.buttons.labelButton.style.display = "none"; // Initially hidden
        this.fireTrailContainer.appendChild(this.buttons.labelButton);

        // setup submit button
        this.buttons.submitButton = createButton("Submit", "submit-button", this.handleSubmit.bind(this));
        this.buttons.submitButton.style.display = "none";
        this.fireTrailContainer.appendChild(this.buttons.submitButton);

        // Update button overlay text
        this.updateButtonOverlay(this.buttons.labelButton, "toggle label on or off");
        this.updateButtonOverlay(this.buttons.submitButton, "submit the current annotation");
        this.updateButtonOverlay(this.buttons.fireTrailButton, "toggle fire trail annotation mode");

        // Function to toggle visibility of label and submit buttons
        const toggleButtonVisibility = () => {
            const isActive = this.buttons.fireTrailButton.classList.contains('active');
            this.buttons.labelButton.style.display = isActive ? 'block' : 'none';
            this.buttons.submitButton.style.display = isActive ? 'block' : 'none';
        };

        // Initial visibility check
        toggleButtonVisibility();
        // Set up MutationObserver for class changes on fireTrailButton
        this._classObserver = new MutationObserver(toggleButtonVisibility);
        this._classObserver.observe(this.buttons.fireTrailButton, { attributes: true, attributeFilter: ['class'] });
    }

    handleFireTrailToggle() {
        const activeButton = this.stateManager.getButtonState("activeButton")
        if (activeButton && activeButton === this.buttons.fireTrailButton) { // Deactivate Fire Trail
            this.flags.isActive = false
        } else {
            // Deactivate previously active button if it exists
            if (activeButton) {
                // remove active style
                activeButton.classList.remove("active");
                // set aria-pressed to false
                activeButton.setAttribute("aria-pressed", "false");
                // reset value of the active measure mode
                const measureModes = this.stateManager.getButtonState("measureModes");
                measureModes.forEach(mode => {
                    if (activeButton === mode.button) {
                        mode?.resetValue();
                    }
                })
            }
            // set fire trail button to active
            this.flags.isActive = !this.flags.isActive;
        }

        if (this.flags.isActive) { // activate fire trail mode
            this.setupInputActions();

            this.buttons.fireTrailButton.classList.add("active");
            this.buttons.fireTrailButton.setAttribute("aria-pressed", "true");

            this.stateManager.setButtonState("activeButton", this.buttons.fireTrailButton);

            // find and update help box
            const helpBox = this.stateManager.getElementState("helpBox");
            // if no help box then recreate it
            if (!helpBox) this.setupHelpBox();
            // update help box, if there is help box
            this.updateHelpBox();

            const logBox = this.stateManager.getElementState("logBox");
            // if no log box then recreate it
            if (!logBox) this.setupLogBox();
        } else { // deactivate fire trail mode
            // remove existing input actions
            removeInputActions(this.handler);
            this.resetValue();
            this.stateManager.setButtonState("activeButton", null);

            this.buttons.fireTrailButton.classList.remove("active");
            this.buttons.fireTrailButton.setAttribute("aria-pressed", "false");

            // deactivate fireTrail then remove help box and help box toggle button
            const helpBox = this.stateManager.getElementState("helpBox");
            helpBox && helpBox.remove();
            this.stateManager.setElementState("helpBox", null);
            const toggleHelpBoxButton = this.stateManager.getButtonState("toggleHelpBoxButton");
            toggleHelpBoxButton && toggleHelpBoxButton.remove();
            this.stateManager.setButtonState("toggleHelpBoxButton", null);
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
            label.id.includes("fire_trail_label")
        ).forEach((label) => {
            label.show = this.flags.isShowLabels
            label.showBackground = this.flags.isShowLabels;
        });

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
            if (!this.flags.isSubmitting) {
                this.buttons.submitButton.setAttribute("aria-pressed", "false");
            }
            return;
        }

        // Generate a unique key for the group by concatenating position keys with a separator
        const groupKey = groupToSubmit.coordinates.map(pos => positionKey(pos)).join('|');

        // Check if the group has already been submitted to prevent redundant submissions
        if (this.sentGroupKeys.has(groupKey)) {
            alert(`No new changes to submit for this fire trail ${groupToSubmit.trailId}`);
            this.flags.isSubmitting = false;
            if (!this.flags.isSubmitting) {
                this.buttons.submitButton.setAttribute("aria-pressed", "false");
            }
            return;
        }

        // Set the submitting flag to true to indicate that a submission is in progress
        this.flags.isSubmitting = true;
        if (this.flags.isSubmitting) {
            this.buttons.submitButton.setAttribute("aria-pressed", "false");
        }

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
            email: this.app?.currentUser?.sessions?.navigator?.userId || "",
        };

        // Prompt the user for confirmation before proceeding with the submission
        if (!confirm(`Do you want to submit this fire trail ${groupToSubmit.trailId}?`)) {
            this.flags.isSubmitting = false;
            if (!this.flags.isSubmitting) {
                this.buttons.submitButton.setAttribute("aria-pressed", "false");
            }
            return;
        }

        try {
            // Retrieve all line primitives associated with the group's coordinates
            const lines = this.findLinesByPositions(groupToSubmit.coordinates);

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
            if (!this.flags.isSubmitting) {
                this.buttons.submitButton.setAttribute("aria-pressed", "false");
            }
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
     * Get the label text properties based on the position and group.
     * @param {Cesium.Cartesian3} position - The current position.
     * @param {}
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
    findPrimitivesByPositions(positions) {
        // lookup points primitives
        const pointPrimitives = this.pointCollection._pointPrimitives
            .filter(p =>
                p.id &&
                p.id.startsWith("annotate_fire_trail_point") &&
                !p.id.includes("moving") &&
                positions.some(pos => Cesium.Cartesian3.equals(p.position, pos))
            )
        // lookup line primitives
        const linePrimitives = this.findLinesByPositions(positions);

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

    findPrimitiveByPosition(position, modeString) {
        // get point primitive by position
        const pointPrimitive = this.pointCollection._pointPrimitives.find(p =>
            p.id &&
            p.id.startsWith(`annotate_${modeString}`) &&
            !p.id.includes("moving") &&
            Cesium.Cartesian3.equals(p.position, position)
        );

        // get line primitives by position
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.startsWith(`annotate_${modeString}`) &&
            !p.id.includes("moving") &&
            p.positions.some(cart => Cesium.Cartesian3.equals(cart, position))
        );

        // get label primitives by lines positions
        // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
        const linePositions = linePrimitives.map(p => p.positions);
        const midPoints = linePositions.map((positions) => Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3()));
        const labelPrimitives = midPoints.map(midPoint =>
            this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith(`annotate_${modeString}`) &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, midPoint)
            )
        ).filter(label => label !== undefined);

        // Sort labelPrimitives by their text
        labelPrimitives.sort((a, b) => a.text.toUpperCase().localeCompare(b.text.toUpperCase()));

        return { pointPrimitive, linePrimitives, labelPrimitives };
    }

    /**
     * Lookup the line primitives array by the positions array
     * @param {Cesium.Cartesian3[]} positions - The array of Cartesian3 positions to lookup the lines.
     * @returns {Cesium.Primitive[]} - The array of line primitives that match the positions.
     */
    findLinesByPositions(positions) {
        // Create a set of position keys from the input positions for quick lookup
        const positionKeys = new Set(positions.map(pos => positionKey(pos)));

        // Initialize a set to store matching line primitives
        const linePrimitives = new Set();

        // Filter the primitives to find lines that match certain criteria
        const linesPrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.startsWith("annotate_fire_trail_line") &&
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

    updateOrCreateLabels(group) {
        const midPoints = group.coordinates.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, group.coordinates[i + 1], new Cesium.Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels.filter(
            l => l.id && l.id.includes("fire_trail_label")
        );

        // Update or create label primitives
        midPoints.forEach((midPoint, index) => {
            // find existed label primitives    
            let relativeLabelPrimitives = labelPrimitives.filter(l =>
                Cesium.Cartesian3.equals(l.position, midPoint)
            );

            // Wrap the letter back to 'a' after 'z'
            const currentLetter = String.fromCharCode(97 + index % 26); // 'a' to 'z' to 'a' to 'z'...

            // Don't use getLabelProperties currentLetter in here as midPoint index is not the group coordinate index
            const { labelNumberIndex } = this._getLabelProperties(
                group.coordinates[index + 1],
                group
            );
            const { distance } = calculateClampedDistance(
                group.coordinates[index],
                group.coordinates[index + 1],
                this.viewer.scene,
                4
            );
            const labelText = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;

            // update existed labels if any
            if (relativeLabelPrimitives.length > 0) {
                // Update existing labels
                relativeLabelPrimitives.forEach(label => {
                    label.text = labelText;
                    label.show = this.flags.isShowLabels;
                    label.showBackground = this.flags.isShowLabels;
                });
            } else {    // create new label if not existed
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
                newLabel.id = generateId(midPoint, "fire_trail_label");
                this.labelCollection.add(newLabel);
            }
        });
    }

    updateOrCreateTotalLabel(group, totalDistance) {
        const currentPosition = group.coordinates[group.coordinates.length - 1];

        let totalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
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
        totalLabel.id = generateId(currentPosition, "fire_trail_label_total");
        totalLabel.show = this.flags.isShowLabels;
        totalLabel.showBackground = this.flags.isShowLabels;
        totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
        totalLabel.position = currentPosition;

        return totalLabel;
    }

    /**
     * check if there are unsubmitted lines
     * @returns {Boolean} - whether there are unsubmitted lines
     */
    checkUnsubmittedLines() {
        const unsubmittedLines = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.includes("fire_trail_line") &&
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
            case 'default':
                colorToSet = this.stateColors.default;
                break;
            default:
                if (colorType instanceof Cesium.Color) {
                    colorToSet = colorType
                };
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
     * @param {Cesium.Cartesian3[]} group 
     * @returns {Cesium.Primitive[]} - the line primitives that match the group positions
     */
    updateSelectedLineColor(group) {
        // const groupIndex = this.coords.groups.findIndex(group =>
        //     group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, position))
        // );
        // if (groupIndex === -1) return;
        // const group = this.coords.groups[groupIndex];
        const lines = this.findLinesByPositions(group.coordinates);

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
        this.interactivePrimitives.addModeLine = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}

// Define the custom element
customElements.define('fire-trail-mode', FireTrail);
import * as Cesium from "cesium";
import { TwoPointsDistance } from "./lib/features/TwoPointsDistance.js";
import { Points } from "./lib/features/Points.js";
import { ThreePointsCurve } from "./lib/features/ThreePointsCurve.js";
import { Height } from "./lib/features/Height.js";
import { MultiDistance } from "./lib/features/MultiDistance.js";
import { MultiDistanceClamped } from "./lib/features/MultiDistanceClamped.js";
import { Polygon } from "./lib/features/Polygon.js";
import { Profile } from "./lib/features/Profile.js";
import { ProfileDistances } from "./lib/features/ProfileDistances.js";
import { Picker } from "./lib/features/Picker.js";
import { FireTrail } from "./lib/features/fireTrail/FireTrail.js";
import { FlyThrough } from "./lib/features/flyThrough/FlyThrough.js";
import { StateManager } from "./lib/features/StateManager.js";
import { removeInputActions, makeDraggable, createGroundPolylinePrimitive } from "./lib/helper/helper.js";
import { toolIcon, pickerIcon, pointsIcon, distanceIcon, curveIcon, heightIcon, multiDImage, multiDClampedIcon, polygonIcon, profileIcon, profileDistancesIcon, clearIcon, helpBoxIcon, logBoxIcon } from './assets/icons.js';
import { sharedStyleSheet } from './sharedStyle.js';

import EventEmitter from "eventemitter3";

/**
 * An HTMLElement that provides tools for various measurement functions on a Cesium Viewer.
 * The toolbox offers functionalities such as point measurements, distance calculations,
 * height measurements, curve and polygon plotting, and more.
 * Clear tool to remove all plotted elements.
 *
 * @extends {HTMLElement}
 */
export class MeasureToolbox extends HTMLElement {
    /**
     * Initializes the MeasureToolbox, attaching a shadow root and setting up event handlers
     * and elements for various measurement functionalities.
     */
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        // cesium variables
        this._viewer = null;
        this.handler = null;
        this._cesiumPkg = null;

        this.pointCollection = null;
        this.labelCollection = null;

        // log variables
        this._records = [];

        // Element style position variables
        this.position = {
            logBox: { top: "380px", left: "0px" },
            helpBox: { top: "70px", left: "0px" },
        };

        // state manager
        this.stateManager = new StateManager();

        // cesium style
        this.cesiumStyle = null;

        this.data = [];

        // event emitter
        this.emitter = new EventEmitter();
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

    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }

    set cesiumPkg(cesiumPkg) {
        this._cesiumPkg = cesiumPkg;
    }

    get cesiumPkg() {
        return this._cesiumPkg;
    }

    /**********************
     * CONNECTED CALLBACK *
     **********************/
    async connectedCallback() {
        // link cesium package default style
        this.cesiumStyle = document.createElement("link");
        this.cesiumStyle.rel = "stylesheet";
        this.cesiumStyle.href = `/Widgets/widgets.css`;
        this.shadowRoot.appendChild(this.cesiumStyle);

        // add measure toolbox with measure modes
        if (this.viewer) {
            this.initialize();
        }
    }

    disconnectedCallback() {    // clean up when the web component is removed from the DOM
        // Clean up Cesium handlers
        if (this.handler) {
            removeInputActions(this.handler);
        }

        // Remove Cesium primitives
        if (this.pointCollection) {     // point collection is the annotate point collection, remove called if create it again will throw destroy error 
            this.viewer.scene.primitives.remove(this.pointCollection);
            this.pointCollection = null;
        }
        if (this.labelCollection) {     // label collection is the annotate label collection, remove called if create it again will throw destroy error 
            this.viewer.scene.primitives.remove(this.labelCollection);
            this.labelCollection = null;
        }

        // Clean up references to avoid memory leaks
        this._viewer = null;
        this.handler = null;

        // this.overlay = null;
        // this.element = null;
        // this.button = null;
    }


    /************
     * FEATURES *
     ************/
    /**
     * Initializes the MeasureToolbox, setting up event handlers
     */
    initialize() {
        // if screenSpaceEventHandler existed use it, if not create a new one
        if (this.viewer.screenSpaceEventHandler) {
            this.handler = this.viewer.screenSpaceEventHandler;
        } else {
            this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        }

        // remove relevant input actions assigned to the handler
        removeInputActions(this.handler);

        // Initialize Cesium primitives collections
        const pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        const labelCollection = new this.cesiumPkg.LabelCollection();
        pointCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        labelCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        pointCollection.id = "annotate_point_collection";
        labelCollection.id = "annotate_label_collection";
        this.pointCollection = this.viewer.scene.primitives.add(pointCollection);
        this.labelCollection = this.viewer.scene.primitives.add(labelCollection);

        // initiate clamped line due to the delay for the first clamped line creation
        const clampedLine = createGroundPolylinePrimitive(
            [Cesium.Cartesian3.fromDegrees(0, 0), Cesium.Cartesian3.fromDegrees(0, 0)],
            "line_initiate",
            Cesium.Color.YELLOWGREEN,
            this.cesiumPkg.GroundPolylinePrimitive
        );
        this.initialLine = this.viewer.scene.primitives.add(clampedLine);

        // initialize all the measure modes, including its UI, and event listeners
        this.initializeMeasureModes();

        // initialize fire trail mode
        const fireTrailUser = this.hasRole("fireTrail");
        fireTrailUser && this.initializeFireTrail();

        // initialize fly through mode
        const flyThroughUser = this.hasRole("flyThrough");
        flyThroughUser && this.initializeFlyThrough();

        // initialize event listeners
        this.emitter.on("dataUpdate", (data) => {
            this.data.push(data);
            console.log(this.data);
        })
    }

    /**
     * Initialize all the measure modes
     */
    async initializeMeasureModes() {
        // setup tool button
        this.setupToolButton();

        // initialize style of pointerOverlay, the moving dot
        this.setupPointerOverlay();

        // apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // all measure modes
        const modes = [
            {
                instance: new Picker(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "picker"),
                    this.activateModeByName.bind(this),
                    this.cesiumPkg
                ),
                name: "Picker",
                icon: pickerIcon,
            },
            {
                instance: new Points(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "points"),
                    this.cesiumPkg
                ),
                name: "Points",
                icon: pointsIcon,
            },
            {
                instance: new TwoPointsDistance(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "distances"),
                    this.emitter,
                    this.cesiumPkg
                ),
                name: "Distance",
                icon: distanceIcon,
            },
            {
                instance: new ThreePointsCurve(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "curves"),
                    this.cesiumPkg
                ),
                name: "Curve",
                icon: curveIcon,
            },
            {
                instance: new Height(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "height"),
                    this.cesiumPkg
                ),
                name: "Height",
                icon: heightIcon,
            },
            {
                instance: new MultiDistance(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "m-distance"),
                    this.cesiumPkg
                ),
                name: "Multi-Distances",
                icon: multiDImage,
            },
            {
                instance: new MultiDistanceClamped(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "m-distance-clamped"),
                    this.cesiumPkg
                ),
                name: "Multi-Distances-Clamped",
                icon: multiDClampedIcon,
            },
            {
                instance: new Polygon(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "polygons"),
                    this.cesiumPkg
                ),
                name: "Polygon",
                icon: polygonIcon,
            },
            {
                instance: new Profile(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "profile"),
                    this.cesiumPkg
                ),
                name: "Profile",
                icon: profileIcon,
            },
            {
                instance: new ProfileDistances(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "profile-distances"),
                    this.cesiumPkg
                ),
                name: "Profile-Distances",
                icon: profileDistancesIcon,
            }
        ];

        // Determine allowed modes based on user roles
        const allowedModes = this.getAllowedModes(modes);

        // set measure modes 
        this.stateManager.setButtonState("measureModes", modes.map((mode) => mode.instance));

        // create measure mode buttons
        allowedModes.forEach((mode) => {
            this.createMeasureModeButton(mode.instance, mode.name, mode.icon);
        });

        // setup clear button
        this.setupClearButton();

        // setup button overlay
        this.setupButtonOverlay();
    }

    /**
     * Determine allowed modes based on user roles checking
     * @param {Array} modes - All available measure modes
     * @returns {Array} - Filtered allowed modes
     */
    getAllowedModes(modes) {
        try {
            const roles = this.app?.currentUser?.sessions?.navigator?.roles;
            // error handling if roles are not available
            if (!Array.isArray(roles)) {
                console.warn("Roles information is unavailable or not an array.");
                return modes; // Default to all modes if roles are not properly defined
            }

            return modes;
        } catch (error) {
            console.error("Error accessing user roles:", error);
            return modes; // Default to all modes in case of error
        }
    }

    /**
     * Sets up measure tool button to control collapse/expand for buttons.
     */
    setupToolButton() {
        const toolbar = document.createElement("div");
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "Measurement Tools");
        toolbar.className = "measure-toolbar";

        // set state for the toolbar
        this.stateManager.setElementState("toolbar", toolbar);

        // initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = `<img src="${toolIcon}" alt="tool" style="width: 30px; height: 30px;">`;
        toolButton.addEventListener("click", () => {
            toolButton.classList.toggle("active");
            this.toggleTools();
        });
        toolbar.appendChild(toolButton);

        this.shadowRoot.appendChild(toolbar);

        // make toolbar draggable
        makeDraggable(toolbar, this.viewer.container);
    }

    /**
     * Creates a measurement mode button, setting up event listeners and setup helpBox and logBox based on buttons interaction. 
     * @param {Object} toolInstance - The instance of the measurement mode class.
     * @param {string} buttonText - The text to display on the button.
     * @param {string} icon - The image src to display on the button.
     */
    createMeasureModeButton(toolInstance, buttonText, icon) {
        // setup buttons
        const button = document.createElement("button");
        const lowerCaseString = buttonText.toLowerCase().replace(/\s+/g, '-');
        button.className = `${lowerCaseString} cesium-button measure-mode-button`;
        button.innerHTML = `<img src="${icon}" alt="${lowerCaseString}" style="width: 30px; height: 30px;" aria-hidden="true">`;
        button.setAttribute("type", "button");
        button.setAttribute("aria-label", `${buttonText} Tool`);
        button.setAttribute("aria-pressed", "false"); // For toggle behavior

        // setup button actions
        button.addEventListener("click", () => {
            const activeButton = this.stateManager.getButtonState("activeButton");
            const isSameButton = activeButton === button;
            const activeTool = this.stateManager.getButtonState("activeTool");

            // check fireTrail mode to prevent switching/deactivation if there are unsubmitted lines
            if (activeButton && activeButton.classList.contains("fire-trail")) {
                const fireTrailMode = this.shadowRoot.querySelector("fire-trail-mode");
                const checkUnsubmittedLines = fireTrailMode.checkUnsubmittedLines();
                if (checkUnsubmittedLines) {
                    alert("Please submit all of FireTrail measurement before switching modes.");
                    return;
                }
            }

            // Deactivate existed active button if it is not the same button
            if (activeButton && !isSameButton) {
                this.deactivateButton(activeButton, activeTool);
            }

            // Toggle button activation
            if (isSameButton) {
                this.deactivateButton(button, toolInstance);
                this.stateManager.setButtonState("activeButton", null);
                this.stateManager.setButtonState("activeTool", null);

                // Hide helpBox and remove logBox
                const helpBox = this.stateManager.getElementState("helpBox");
                const logBox = this.stateManager.getElementState("logBox");
                if (helpBox) {
                    helpBox.style.display = "none";
                }
                if (logBox) {
                    logBox.remove();
                    this.stateManager.setElementState("logBox", null);
                }
            } else {
                // Activate the button
                this.activateButton(button, toolInstance);
                this.stateManager.setButtonState("activeButton", button);
                this.stateManager.setButtonState("activeTool", toolInstance);
            }

            // remove logBox to recreate it
            const logBox = this.stateManager.getElementState("logBox");
            if (!logBox) this.setupLogBox();

            // set helpBox to hide or show without remove it to avoid recreation - to save resources
            const helpBox = this.stateManager.getElementState("helpBox");
            if (helpBox) {
                helpBox.style.display = "block";
            } else {
                this.setupHelpBox();
            }

            // Update the helpBox content
            this.updateHelpBox();

            // set the pointerOverlay to hide
            this.stateManager.getOverlayState("pointer").style.display = "none";
        });

        // append button to the toolbar
        const toolbar = this.stateManager.getElementState("toolbar");
        toolbar.appendChild(button);

        toolInstance.button = button;   // Use the setter to store the button in the measure mode instance
    }

    /**
     * Activates a measurement tool button.
     * @param {HTMLElement} button - The button element to activate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    activateButton(button, toolInstance) {
        button.classList.add("active");
        toolInstance.setupInputActions && toolInstance.setupInputActions();
        this.stateManager.setButtonState("activeButton", button);
        this.stateManager.setButtonState("activeTool", toolInstance);

        // Update ARIA attribute
        button.setAttribute("aria-pressed", "true");
    }

    /**
     * Deactivates a measurement tool button.
     * @param {HTMLElement} button - The button element to deactivate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    deactivateButton(button, toolInstance) {
        button.classList.remove("active");
        removeInputActions(this.handler);
        toolInstance?.resetValue();

        // Update ARIA attribute
        button.setAttribute("aria-pressed", "false");

        // remove moving or pending primitives
        // remove moving or pending line primitives 
        this.viewer.scene.primitives._primitives.filter(p =>
            typeof p.id === "string" &&
            p.id.startsWith("annotate") &&
            (p.id.includes("moving") || p.id.includes("pending") || p.id.includes("line_initiate"))
        ).forEach(p => { this.viewer.scene.primitives.remove(p) });

        // remove moving or pending label primitives
        this.labelCollection._labels.filter(l =>
            l &&
            l.id &&
            (l.id.includes("moving") || l.id.includes("pending"))
        ).forEach(l => { this.labelCollection.remove(l) });

        // remove moving or pending point primitives
        this.pointCollection._pointPrimitives.filter(p =>
            p &&
            p.id &&
            (p.id.includes("moving") || p.id.includes("pending"))
        ).forEach(p => { this.pointCollection.remove(p) });
    }

    /**
     * toggle action for the tool button to show/hide measure modes
     */
    toggleTools() {
        const isToolsExpanded = this.stateManager.getFlagState("isToolsExpanded");
        this.stateManager.setFlagState("isToolsExpanded", !isToolsExpanded);

        const buttons = Array.from(this.shadowRoot.querySelectorAll(".measure-mode-button"));

        buttons.forEach((button, index) => {
            setTimeout(() => {
                button.classList.toggle("show", this.stateManager.getFlagState("isToolsExpanded"));
            }, index * 50 + 25);
        });
    }

    /**
     * Sets up the clear button.
     */
    setupClearButton() {
        const clearButton = document.createElement("button");
        clearButton.className = "clear-button cesium-button measure-mode-button";
        clearButton.innerHTML = `<img src="${clearIcon}" alt="clear" style="width: 30px; height: 30px;">`;
        this.stateManager.setButtonState("clearButton", clearButton);

        const toolbar = this.stateManager.getElementState("toolbar");
        toolbar.appendChild(clearButton);

        this.stateManager.getButtonState("clearButton").addEventListener("click", () => {
            // check fireTrail mode to prevent switching/deactivation if there are unsubmitted lines
            const activeButton = this.stateManager.getButtonState("activeButton");

            if (activeButton && activeButton.classList.contains("fire-trail")) {
                const fireTrailMode = this.shadowRoot.querySelector("fire-trail-mode");
                const checkUnsubmittedLines = fireTrailMode.checkUnsubmittedLines();
                if (checkUnsubmittedLines) {
                    const confirmed = confirm("There is unsubmitted fireTrail, please confirm to clear all annotations.");
                    if (!confirmed) {
                        return; // Exit if the user cancels
                    }
                }
            }

            // remove line primitives by id
            this.viewer.scene.primitives._primitives.filter(
                (p) =>
                    p.id &&
                    p.id.startsWith("annotate") &&
                    (p.id.includes("line") || p.id.includes("polygon"))
            ).forEach((p) => this.viewer.scene.primitives.remove(p));

            // remove point primitives from point collections
            const pointCollections = this.viewer.scene.primitives._primitives.filter(
                (p) =>
                    p._pointPrimitives &&
                    p._pointPrimitives.some(
                        (point) =>
                            point.id &&
                            point.id.startsWith("annotate") &&
                            point.id.includes("point")
                    )
            );
            pointCollections &&
                pointCollections.forEach((pointCollection) => pointCollection.removeAll());

            // remove label primitives from label collections
            const labelCollections = this.viewer.scene.primitives._primitives.filter(
                (p) =>
                    p._labels &&
                    p._labels.some(
                        (label) =>
                            label.id &&
                            label.id.startsWith("annotate") &&
                            label.id.includes("label")
                    )
            );
            labelCollections &&
                labelCollections.forEach((labelCollection) => {
                    labelCollection.removeAll();    // moving label was not remove, because same label cannot recreate and hence cause destroy error
                });

            // reset handler
            removeInputActions(this.handler);

            // reset pointerOverlay
            this.stateManager.getOverlayState("pointer").style.display = "none";

            // clear helpBox
            const helpBox = this.stateManager.getElementState("helpBox");
            helpBox && helpBox.style.display === "none";

            // clear logBox
            const logBox = this.stateManager.getElementState("logBox");
            if (logBox) {
                logBox.remove();
                this.stateManager.setElementState("logBox", null);
            }

            // call reset value method in all measure modes
            this.stateManager.getButtonState("measureModes").forEach((mode) => {
                mode?.resetValue();
                if (mode?.coords?.groups) {
                    mode.coords.groups = [];
                }
            });

            // reset active button
            if (this.stateManager.getButtonState("activeButton")) {
                this.stateManager.getButtonState("activeButton").classList.remove("active");
                this.stateManager.setButtonState("activeButton", null);
                this.stateManager.setButtonState("activeTool", null);
            }
        });
    }

    /**
     * Sets up the button overlay to display the description of the button when mouse hover.
     */
    setupButtonOverlay() {
        const buttonOverlay = document.createElement("div");
        buttonOverlay.className = "button-overlay";
        buttonOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; display: none; background: white; border-radius: 5px; box-shadow: 0 0 10px #000; transition: 0.1s ease-in-out; z-index: 1000;";
        this.viewer.container.appendChild(buttonOverlay);
        this.stateManager.setOverlayState("button", buttonOverlay);

        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // cesium container rectangle
                const cesiumRect = this.viewer.container.getBoundingClientRect();
                const buttonOverlay = this.stateManager.getOverlayState("button");
                // set overlay to display
                buttonOverlay.style.display = "block";
                // get description of the button
                const description = button.querySelector("img")?.alt.split("-").join(" ");
                buttonOverlay.innerHTML = `${description} mode`;
                // set position of the overlay
                buttonOverlay.style.left = e.pageX - cesiumRect.x + "px"; // Position the overlay right of the cursor
                buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
            });

            button.addEventListener("mouseout", () => {
                // set overlay to not display
                const buttonOverlay = this.stateManager.getOverlayState("button");
                buttonOverlay.style.display = "none";
            });
        });
    }

    /**
     * Setup the moving yellow dot to show the pointer position at cesium viewer
     */
    setupPointerOverlay() {
        const pointer = document.createElement("div");
        pointer.className = "backdrop";
        pointer.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(pointer);
        this.stateManager.setOverlayState("pointer", pointer);
    }

    /**
     * Setup messageBox of helpBox to show the instructions of how to use
     */
    setupHelpBox() {
        // Remove the existing helpBox if it exists to avoid duplicates
        const helpBox = this.stateManager.getElementState("helpBox");
        if (helpBox) {
            helpBox.remove()
            helpBox = null;
        }

        // Create a new helpBox div element
        const newHelpBox = document.createElement("div");
        newHelpBox.className = "cesium-infoBox cesium-infoBox-visible infoBox-expanded";
        newHelpBox.style.top = this.position.helpBox.top || "70px"; // Set initial position
        const containerRect = this.viewer.container.getBoundingClientRect();
        newHelpBox.style.left = `${containerRect.width - 250}px`; // Set initial position

        // Create a table element to hold the instructions
        const table = document.createElement("table");
        table.style.display = "table";

        // Append table to the helpBox
        newHelpBox.appendChild(table);
        // Append the helpBox to the shadow DOM
        this.shadowRoot.appendChild(newHelpBox);
        this.stateManager.setElementState("helpBox", newHelpBox);
    }

    updateHelpBox() {
        // Define common messages
        const commonMessages = {
            startMeasure: "Left Click to start measure",
            finishMeasure: "Right Click to finish measure",
            dragPoint: "Hold Left Click to drag point",
            editLabel: "Left Click on label to edit",
            addLineLeftClick: "Left Click on line to add line",
            addLineDoubleClick: "Double Left Click on line to add line",
            removeLineLeftClick: "Left Click on point to remove line",
            removeLineMiddleClick: "Middle Click on point to remove line segment",
            removeLineSetMiddleClick: "Middle Click on line to remove line set",
            pickAnnotation: "Left Click to pick annotation to switch modes",
            chartHoverPoint: "Hover on chart to show point on the map",
            hoverPointChart: "Hover on point to show on chart",
            continueMeasure: "Left Click on first or last point to continue measure"
        };

        // Define the messages to show based on the active mode
        const messages = {
            title: "How to use:",
            default: [commonMessages.startMeasure, commonMessages.dragPoint, commonMessages.editLabel],
            multiDistances: [
                commonMessages.startMeasure,
                commonMessages.finishMeasure,
                commonMessages.dragPoint,
                commonMessages.editLabel,
                commonMessages.addLineLeftClick,
                commonMessages.removeLineLeftClick
            ],
            picker: [commonMessages.pickAnnotation],
            polygon: [
                commonMessages.startMeasure,
                commonMessages.finishMeasure,
                commonMessages.dragPoint,
                commonMessages.editLabel,
            ],
            fireTrail: [
                commonMessages.startMeasure,
                commonMessages.finishMeasure,
                commonMessages.dragPoint,
                commonMessages.editLabel,
                commonMessages.addLineDoubleClick,
                commonMessages.removeLineMiddleClick,
                commonMessages.removeLineSetMiddleClick,
                commonMessages.continueMeasure
            ],
            profile: [
                commonMessages.startMeasure,
                commonMessages.dragPoint,
                commonMessages.editLabel,
                commonMessages.chartHoverPoint,
                commonMessages.hoverPointChart
            ],
            profileDistances: [
                commonMessages.startMeasure,
                commonMessages.finishMeasure,
                commonMessages.dragPoint,
                commonMessages.editLabel,
                commonMessages.chartHoverPoint,
                commonMessages.hoverPointChart
            ]
        };

        // Map button classes to message sets
        const modeClassToMessageSet = {
            'multi-distances': messages.multiDistances,
            'multi-distances-clamped': messages.multiDistances,
            'profile-distances': messages.profileDistances,
            'profile': messages.profile,
            'picker': messages.picker,
            'polygon': messages.polygon,
            'fire-trail': messages.fireTrail
        };

        // Function to determine the message set based on the active button
        const getMessageSet = () => {
            const defaultSet = messages.default;
            const currentButton = this.stateManager.getButtonState("activeButton")
            if (!currentButton) return defaultSet;

            const classList = currentButton.classList;
            for (const [className, messageArray] of Object.entries(modeClassToMessageSet)) {
                if (classList.contains(className)) {
                    return messageArray;
                }
            }
            return defaultSet;
        };

        // Build the instructions table
        const messageSet = getMessageSet();
        const helpBox = this.stateManager.getElementState("helpBox");
        const table = helpBox.querySelector("table");
        // remove the existing rows
        table.innerHTML = "";
        // create a row for each message
        table.appendChild(this.createRow(messages.title));
        messageSet.forEach((message) => table.appendChild(this.createRow(message)));

        // Function to update the position of the helpBox
        const updateHelpBoxPosition = (newTop, newLeft) => {
            this.position.helpBox.top = `${newTop}px`;
            this.position.helpBox.left = `${newLeft}px`;
        };

        // Setup the toggle button for the helpBox
        const toggleHelpBoxButton = this.stateManager.getButtonState("toggleHelpBoxButton");
        if (!toggleHelpBoxButton) {
            const toggleButton = this.setupMessageBoxToggleButton(helpBox, helpBoxIcon, updateHelpBoxPosition, "helpBox");
            this.stateManager.setButtonState("toggleHelpBoxButton", toggleButton);
            helpBox.appendChild(toggleButton);
        }

        // Make the helpBox draggable within the viewer container
        makeDraggable(helpBox, this.viewer.container, updateHelpBoxPosition);
    }

    /**
     * Setup the messageBox of logBox to show the records of the measure modes
     */
    setupLogBox() {
        // Remove the existing logBox if it exists to avoid duplicates
        if (this.stateManager.getElementState("logBox")) {
            logBox.remove()
        };

        // Create a new logBox div element
        const newLogBox = document.createElement("div");
        newLogBox.className = "cesium-infoBox cesium-infoBox-visible log-box log-box-expanded";

        // set log box initial position
        newLogBox.style.top = this.position.logBox.top || "190px";
        const containerRect = this.viewer.container.getBoundingClientRect();
        newLogBox.style.left = `${containerRect.width - 250}px`;

        // Create a table element to hold the records
        const table = document.createElement("table");
        table.style.display = "table";

        // Create a row for the title
        const title = this.createRow("Actions");
        table.appendChild(title);

        // Append table to the logBox
        newLogBox.appendChild(table);
        // Append the logBox to the shadow DOM
        this.shadowRoot.appendChild(newLogBox);
        this.stateManager.setElementState("logBox", newLogBox);

        const logBox = this.stateManager.getElementState("logBox");
        // Function to update the position of the logBox
        const updateLogBoxPosition = (newTop, newLeft) => {
            this.position.logBox.top = `${newTop}px`;
            this.position.logBox.left = `${newLeft}px`;
        };

        // Setup the toggle button for the logBox
        const toggleLogBoxButton = this.stateManager.getButtonState("toggleLogBoxButton");
        if (!toggleLogBoxButton) {
            const toggleButton = this.setupMessageBoxToggleButton(logBox, logBoxIcon, updateLogBoxPosition, "logBox");
            logBox.appendChild(toggleButton);
            this.stateManager.setButtonState("toggleLogBoxButton", toggleButton);
        }

        // Make logBox draggable
        makeDraggable(logBox, this.viewer.container, updateLogBoxPosition);
    }

    /**
     * Updates the logBox with the records of the measure modes.
     * Clears existing log entries and appends new ones based on the current records.
     */
    updateLogBox() {
        // Retrieve the logBox element from the state manager
        const logBox = this.stateManager.getElementState("logBox");
        const table = logBox.querySelector("table");

        // Clear the existing table content
        table.innerHTML = "";

        // Create a document fragment to improve performance by minimizing reflows
        const fragment = document.createDocumentFragment();

        // Add the header row for actions
        fragment.appendChild(this.createRow("Actions"));

        // If there are no records, exit the function
        if (this._records.length === 0) return;

        // Iterate over each record to process and display
        this._records.forEach((record) => {
            // Destructure the key and its corresponding data from the record
            const [key, recordData] = Object.entries(record)[0];
            let rows = [];

            // Determine the type of record and process accordingly
            switch (key) {
                case "points":
                    // Extract the action and its coordinate details
                    const action = Object.keys(recordData)[0];
                    const [coordinateKey, coordinateValue] = Object.entries(recordData[action])[0];
                    // Format the row content and add to rows array
                    rows.push(`${key}: ${action}: (${coordinateKey}): ${coordinateValue}`);
                    break;

                case "m-distance":
                case "profile-distances":
                case "m-distance-clamped":
                    // Check and add distances if available
                    if (recordData.distances) {
                        rows.push(`${key}: distances: ${recordData.distances}`);
                    }
                    // Check and add total distance if available
                    if (recordData.totalDistance) {
                        rows.push(`${key}: totalDistance: ${recordData.totalDistance}`);
                    }
                    break;

                case "fire-trail":
                    // Determine if recordData is an object or a string
                    if (typeof recordData === "object" && recordData !== null) {
                        // Add distances if available
                        if (recordData.distances) {
                            rows.push(`${key}: distances: ${recordData.distances}`);
                        }
                        // Add total distance if available
                        if (recordData.totalDistance) {
                            rows.push(`${key}: totalDistance: ${recordData.totalDistance}`);
                        }
                        // Add submit status if available
                        if (recordData.submitStatus) {
                            rows.push(`${key}: ${recordData.submitStatus}`);
                        }
                    } else if (typeof recordData === "string") {
                        // If recordData is a string, add it directly
                        rows.push(`${key}: ${recordData}`);
                    }
                    break;

                default:
                    // For any other key, add the key-value pair directly
                    rows.push(`${key}: ${recordData}`);
            }

            // Append each formatted row to the document fragment
            rows.forEach(row => fragment.appendChild(this.createRow(row)));
        });

        // Append the populated fragment to the table in the DOM
        table.appendChild(fragment);

        // Auto-scroll to the bottom of the logBox with smooth behavior
        logBox.scrollTo({ top: logBox.scrollHeight, behavior: 'smooth' });
    }

    /**
     * Setup a toggle button for expanding and collapsing boxes (helpBox or logBox)
     * @param {HTMLElement} targetBox - The box to toggle
     * @param {string} toggleButtonImageSrc - The image source for the toggle button
     * @param {Function} updatePositionFn - The function to update the position of the box
     * @param {string} expandedClass - The class name for the expanded
     * @returns {HTMLElement} The toggle button element
     */
    setupMessageBoxToggleButton(targetBox, toggleButtonImageSrc, updatePositionFn, expandedClass) {
        const table = targetBox.querySelector("table");
        const toggleButton = document.createElement("button");
        toggleButton.className = "toggle-log-box-button cesium-button";
        toggleButton.innerHTML = `<img src="${toggleButtonImageSrc}" alt="toggle button" style="width: 30px; height: 30px;">`;
        toggleButton.style.display = "none"; // Initially hidden

        // Handle the expand action when the toggle button is clicked
        toggleButton.addEventListener("click", (event) => {
            event.stopPropagation();
            if (table.style.display === "none") {
                table.style.display = "table"; // Show the table
                toggleButton.style.display = "none"; // Hide the toggle button
                targetBox.classList.add(`${expandedClass}-expanded`);
                targetBox.classList.remove("messageBox-collapsed");
            }

            // Make sure it stays within the container
            makeDraggable(targetBox, this.viewer.container, updatePositionFn);
        });

        // Handle the collapse action when clicking on the target box
        targetBox.addEventListener("click", (event) => {
            if (table.style.display !== "none") {
                table.style.display = "none"; // Hide the table
                toggleButton.style.display = "block"; // Show the toggle button

                targetBox.classList.add("messageBox-collapsed");
                targetBox.classList.remove(`${expandedClass}-expanded`);
                event.stopPropagation(); // Prevent triggering any parent click events
            }
        });

        return toggleButton;
    }

    /**
     * create the row for the table
     * @param {string|number} value
     * @returns
     */
    createRow(value) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.style.borderBottom = "1px solid white";
        cell.innerHTML = value;
        row.appendChild(cell);

        return row;
    }

    /**
     * Update the records of the measure modes
     * @param {*} mode
     * @param {*} records
     */
    updateRecords(modeName, records) {
        const logEntry = { [modeName]: records };
        this._records.push(logEntry);
        this.updateLogBox(); // Ensure the log box is updated every time records change
    }

    activateModeByName(modeName) {
        const measureModes = this.stateManager.getButtonState("measureModes");
        const modeInstance = measureModes.find((mode) =>
            mode.button.classList.contains(modeName)
        );
        // const button = this.element.toolbar.querySelector(`.${modeName}`);
        const button = this.stateManager.getElementState("toolbar").querySelector(`.${modeName}`);

        if (modeInstance && button) {
            const activeTool = this.stateManager.getButtonState("activeTool");
            const activeButton = this.stateManager.getButtonState("activeButton");
            this.deactivateButton(activeButton, activeTool); // Deactivate old
            this.activateButton(button, modeInstance); // Activate new
        }
    }

    /**
     * Check if the user has the specified role
     * @param {String} role - Role to check 
     * @returns {Boolean} - True if the user has the role, false otherwise
     */
    hasRole(role) {
        const roles = this.app?.currentUser?.sessions?.navigator?.roles;

        // error handling if roles are not available
        if (!Array.isArray(roles)) {
            console.warn("Roles information is unavailable or not an array.");
        }

        return roles.includes(role);
    }

    /**
     * Check if the user has the specified component
     * @param {String} requestMode - Mode to check 
     * @param {Array} modes - Array of modes
     * @returns {Boolean} - True if the user has the component, false otherwise
     */
    hasComponent(requestMode, modes) {
        if (modes.length === 0) return false;
        return modes.some((m) => m.name === requestMode);
    }

    /***********************
     * FIRE TRAIL FEATURES *
     ***********************/
    initializeFireTrail() {
        // fire trail is a web component
        const fireTrail = document.createElement("fire-trail-mode");
        // setter values for the fire trail
        fireTrail.viewer = this.viewer;
        fireTrail.app = this.app;
        fireTrail.handler = this.handler;
        fireTrail.stateManager = this.stateManager;
        fireTrail.cesiumPkg = this.cesiumPkg;
        fireTrail.logRecordsCallback = this.updateRecords.bind(this, "fire-trail");
        fireTrail.setupLogBox = this.setupLogBox.bind(this);
        fireTrail.setupHelpBox = this.setupHelpBox.bind(this);
        fireTrail.updateHelpBox = this.updateHelpBox.bind(this);
        fireTrail.cesiumStyle = this.cesiumStyle;
        // append the fire trail to the measure toolbox
        return this.shadowRoot.appendChild(fireTrail);
    }

    /************************
     * FLY THROUGH FEATURES *
     ************************/
    initializeFlyThrough() {
        // const flyThrough = new FlyThrough(this.viewer, this.handler, this.stateManager, this.updateRecords.bind(this, "fly-through"), this.cesiumPkg);
        // return flyThrough;
        const flyThrough = document.createElement("fly-through-mode");
        // setter values for the fly through
        flyThrough.viewer = this.viewer;
        flyThrough.app = this.app;
        flyThrough.handler = this.handler;
        flyThrough.stateManager = this.stateManager;
        flyThrough.cesiumPkg = this.cesiumPkg;
        flyThrough.logRecordsCallback = this.updateRecords.bind(this, "fly-through");
        flyThrough.setupLogBox = this.setupLogBox.bind(this);
        flyThrough.cesiumStyle = this.cesiumStyle;
        // append the fly through to the measure toolbox
        return this.shadowRoot.appendChild(flyThrough);
    }
}

customElements.define("cesium-measure", MeasureToolbox);

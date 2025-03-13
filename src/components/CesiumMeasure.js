// This is the cesium measure web component that will be used in the MapCesium component.
import {
    ScreenSpaceEventHandler,
    BlendOption,
    Cartesian3,
    Color,
    Viewer,
} from "cesium";
import { TwoPointsDistance } from "../measure-modes/TwoPointsDistance.js";
import { Points } from "../measure-modes/Points.js";
import { ThreePointsCurve } from "../measure-modes/ThreePointsCurve.js";
import { Height } from "../measure-modes/Height.js";
import { MultiDistance } from "../measure-modes/MultiDistance.js";
import { MultiDistanceClamped } from "../measure-modes/MultiDistanceClamped.js";
import { Polygon } from "../measure-modes/Polygon.js";
import { Profile } from "../measure-modes/Profile.js";
import { ProfileDistances } from "../measure-modes/ProfileDistances.js";
import { Picker } from "../measure-modes/Picker.js";
import { FireTrail } from "../measure-modes/fireTrail/FireTrail.js";
import { FlyThrough } from "../measure-modes/flyThrough/FlyThrough.js";
import { removeInputActions, makeDraggable, createGroundPolylinePrimitive } from "../lib/helper/helper.js";
import { toolIcon, pickerIcon, pointsIcon, distanceIcon, curveIcon, heightIcon, multiDImage, multiDClampedIcon, polygonIcon, profileIcon, profileDistancesIcon, clearIcon, helpBoxIcon, logBoxIcon } from '../assets/icons.js';
import { sharedStyleSheet } from '../styles/sharedStyle.js';
import { LogTable } from './shared/LogTable.js';
import { HelpTable } from './shared/HelpTable.js';

// import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class CesiumMeasure extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        // cesium variables
        this._viewer = null;
        this.handler = null;
        this._cesiumPkg = null;

        // Button management properties
        this._buttonContainer = null;
        this._buttonFragment = document.createDocumentFragment();
        this._isToggling = false;
        this._toggleTimeouts = [];

        this.pointCollection = null;
        this.labelCollection = null;

        // log variables
        this._records = [];

        // state manager
        this._stateManager = null;

        // cesium style
        // this._cesiumStyle = null;

        // event emitter
        this._emitter = null;

        // navigator app
        this._app = null;
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

    set app(app) {
        this._app = app
        this.log = app.log
    }

    get app() {
        return this._app
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get stateManager() {
        return this._stateManager;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    get emitter() {
        return this._emitter;
    }


    /**********************
     * CONNECTED CALLBACK *
     **********************/
    async connectedCallback() {
        // link cesium package default style
        // this.cesiumStyle = document.createElement("link");
        // this.cesiumStyle.rel = "stylesheet";
        // this.cesiumStyle.href = `/Widgets/widgets.css`;
        // this.shadowRoot.appendChild(this.cesiumStyle);

        // set the web component style
        // this.style.position = "relative";
        // this.classList.add("cesium-measure");

        // apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // add measure toolbox with measure modes
        if (this.viewer && this.viewer instanceof Viewer) {
            await this.initialize();
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

    /**
     * Initializes the MeasureToolbox, FireTrail, and FlyThrough components.
     * Set handler and initialize basic setup for the measure toolbox.
     */
    async initialize() {
        // if screenSpaceEventHandler existed use it, if not create a new one
        if (this.viewer.screenSpaceEventHandler) {
            this.handler = this.viewer.screenSpaceEventHandler;
        } else {
            this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
        }

        // remove relevant input actions assigned to the handler
        removeInputActions(this.handler);

        // Initialize Cesium primitives collections
        const pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        const labelCollection = new this.cesiumPkg.LabelCollection();
        pointCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        labelCollection.blendOption = BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, performance improve 2x
        pointCollection.id = "annotate_point_collection";
        labelCollection.id = "annotate_label_collection";
        this.pointCollection = this.viewer.scene.primitives.add(pointCollection);
        this.labelCollection = this.viewer.scene.primitives.add(labelCollection);

        // initiate clamped line due to the delay for the first clamped line creation
        const clampedLine = createGroundPolylinePrimitive(
            [Cartesian3.fromDegrees(0, 0), Cartesian3.fromDegrees(0, 0)],
            "line_initiate",
            Color.YELLOWGREEN,
            this.cesiumPkg.GroundPolylinePrimitive
        );
        this.initialLine = this.viewer.scene.primitives.add(clampedLine);

        // initialize all the measure modes, including its UI, and event listeners
        await this.initializeMeasureTools();

        // initialize fire trail mode
        const fireTrailUser = this.hasRole("fireTrail");
        if (fireTrailUser) {
            await this._initializeFireTrail();
        }

        // initialize fly through mode
        const flyThroughUser = this.hasRole("flyThrough");
        if (flyThroughUser) {
            await this._initializeFlyThrough();
        }
    }

    /**
     * Initialize all the measure modes
     */
    async initializeMeasureTools() {
        const toolbar = this._setupToolbar();

        // setup tool button
        this._setupToolButton();

        // setup pointerOverlay, the moving dot
        this._setupPointerOverlay();

        // Create button container that will hold all measure modes buttons
        this._setupButtonContainer();

        // Initialize toolbar state (collapsed)
        this.stateManager.setFlagState("isToolsExpanded", false);
        toolbar.classList.add("collapsed");

        // all measure modes
        const modes = [
            {
                instance: new Picker(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.activateModeByName.bind(this),
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Picker",
                icon: pickerIcon,
            },
            {
                instance: new Points(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Points",
                icon: pointsIcon,
            },
            {
                instance: new TwoPointsDistance(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Distance",
                icon: distanceIcon,
            },
            {
                instance: new ThreePointsCurve(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Curve",
                icon: curveIcon,
            },
            {
                instance: new Height(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Height",
                icon: heightIcon,
            },
            {
                instance: new MultiDistance(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Multi-Distances",
                icon: multiDImage,
            },
            {
                instance: new MultiDistanceClamped(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Multi-Distances-Clamped",
                icon: multiDClampedIcon,
            },
            {
                instance: new Polygon(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Polygon",
                icon: polygonIcon,
            },
            {
                instance: new Profile(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Profile",
                icon: profileIcon,
            },
            {
                instance: new ProfileDistances(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.cesiumPkg,
                    this.emitter
                ),
                name: "Profile-Distances",
                icon: profileDistancesIcon,
            }
        ];

        // Determine allowed modes based on user roles
        const allowedModes = this.getAllowedModes(modes);

        // set measure modes 
        this.stateManager.setButtonState("measureModes", modes.map((mode) => mode.instance));

        // Create buttons directly in the container (which is already in the fragment)
        allowedModes.forEach((mode) => {
            this.createMeasureModeButton(mode.instance, mode.name, mode.icon);
        });

        // setup clear button directly in the container
        this.setupClearButton();

        // setup button overlay
        this.setupButtonOverlay();
    }

    _setupToolbar() {
        const toolbar = document.createElement("div");
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "Measurement Tools");
        toolbar.classList.add("measure-toolbar");
        // set toolbar position
        toolbar.style.position = "absolute";
        toolbar.style.transform = `translate(${120}px, ${-160}px)`;

        this.shadowRoot.appendChild(toolbar);

        // Set state for the toolbar
        this.stateManager.setElementState("toolbar", toolbar);

        // Make toolbar draggable
        makeDraggable(toolbar, this.viewer.container);

        return toolbar;
    }

    /**
     * Setup measure tool button to control collapse/expand for buttons.
     */
    _setupToolButton() {
        // Initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools annotate-button visible animate-on-show";
        toolButton.innerHTML = `<img src="${toolIcon}" alt="tool" style="width: 30px; height: 30px;">`;
        toolButton.addEventListener("click", () => {
            toolButton.classList.toggle("active");
            this.toggleTools();
        });
        const toolbar = this.stateManager.getElementState("toolbar");
        toolbar && toolbar.appendChild(toolButton);
        makeDraggable(toolbar, this.viewer.container)
    }

    /**
     * Setup the button container for the toolbar to include all modes button.
     */
    _setupButtonContainer() {
        // Create button container that will hold all measure modes buttons
        this._buttonContainer = document.createElement('div');
        this._buttonContainer.classList.add('toolbar-container');
        this._buttonContainer.style.display = 'flex';

        // Initialize a single fragment for all operations
        this._buttonFragment.appendChild(this._buttonContainer);
    }

    /**
     * Toggles visibility of measurement tool buttons
     */
    toggleTools() {
        // Prevent rapid toggling
        if (this._isToggling) return;
        this._isToggling = true;

        // Clear any pending timeouts
        if (this._toggleTimeouts && this._toggleTimeouts.length) {
            this._toggleTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        }
        this._toggleTimeouts = [];

        const isExpanded = this.stateManager.getFlagState("isToolsExpanded");
        this.stateManager.setFlagState("isToolsExpanded", !isExpanded);

        // Find toolbar
        const toolbar = this.stateManager.getElementState("toolbar");
        if (!toolbar) {
            this._isToggling = false;
            return;
        }

        const delayStep = 40;
        const animationDuration = 440;

        if (isExpanded) {
            // COLLAPSING: Animate buttons then move container to fragment
            toolbar.classList.remove("expanded");
            toolbar.classList.add("collapsed");

            // Get buttons in container
            const buttons = Array.from(this._buttonContainer.querySelectorAll("button"));
            const n = buttons.length;

            if (n === 0) {
                this._isToggling = false;
                return;
            }

            // Hide buttons one by one (right to left)
            buttons.forEach((button, index) => {
                const timeoutId = setTimeout(() => {
                    // Hide button animation by css style
                    button.classList.remove("visible");
                    button.classList.add("hidden");

                    // When last button is hidden, move container to fragment
                    if (index === n - 1) {
                        setTimeout(() => {
                            // Move the container (with all buttons) to the DocumentFragment
                            this._buttonFragment.appendChild(this._buttonContainer);
                            this._isToggling = false;
                        }, animationDuration);
                    }
                }, (n - index - 1) * delayStep);

                this._toggleTimeouts.push(timeoutId);
            });
        } else {
            // EXPANDING: Move container back to DOM then animate buttons
            toolbar.classList.remove("collapsed");
            toolbar.classList.add("expanded");

            // Always move container from fragment to toolbar (first toggle or subsequent)
            if (this._buttonContainer.parentNode !== toolbar) {
                // Insert container after main button
                const mainButton = toolbar.querySelector(".measure-tools");
                if (mainButton && mainButton.nextSibling) {
                    toolbar.insertBefore(this._buttonContainer, mainButton.nextSibling);
                } else {
                    toolbar.appendChild(this._buttonContainer);
                }
            }

            // Get buttons in the container
            const buttons = Array.from(this._buttonContainer.querySelectorAll("button"));
            if (buttons.length === 0) {
                this._isToggling = false;
                return;
            }

            // Make sure all buttons start hidden
            buttons.forEach(button => {
                button.classList.remove("visible");
                button.classList.add("hidden");
            });

            // Show buttons one by one (left to right)
            buttons.forEach((button, index) => {
                const timeoutId = setTimeout(() => {
                    button.classList.remove("hidden");
                    button.classList.add("visible");

                    // Release toggle lock after last button animation
                    if (index === buttons.length - 1) {
                        setTimeout(() => {
                            this._isToggling = false;
                        }, animationDuration);
                    }
                }, index * delayStep);

                this._toggleTimeouts.push(timeoutId);
            });
        }
    }

    /**
     * Creates a measurement mode button
     * @param {Object} toolInstance - The instance of the measurement mode class.
     * @param {string} buttonText - The text to display on the button.
     * @param {string} icon - The image src to display on the button.
     */
    createMeasureModeButton(toolInstance, buttonText, icon) {
        // Setup the button element
        const button = document.createElement("button");
        const lowerCaseString = buttonText.toLowerCase().replace(/\s+/g, '-');
        button.className = `${lowerCaseString} annotate-button animate-on-show hidden`;
        button.innerHTML = `<img src="${icon}" alt="${lowerCaseString}" style="width: 30px; height: 30px;" aria-hidden="true">`;
        button.setAttribute("type", "button");
        button.setAttribute("aria-label", `${buttonText} Tool`);
        button.setAttribute("aria-pressed", "false");


        // Setup button click actions
        button.addEventListener("click", () => {
            const activeButton = this.stateManager.getButtonState("activeButton");
            const isSameButton = activeButton === button;
            const activeTool = this.stateManager.getButtonState("activeTool");

            // Prevent switching modes if FireTrail has unsubmitted lines
            if (activeButton && activeButton.classList.contains("fire-trail")) {
                const fireTrailMode = this.shadowRoot.querySelector("fire-trail-mode");
                const checkUnsubmittedLines = fireTrailMode.checkUnsubmittedLines();
                if (checkUnsubmittedLines) {
                    alert("Please submit all of FireTrail measurement before switching modes.");
                    return;
                }
            }

            // Prevent switching mode if mode's flag isAddMode is true;
            if (activeTool && activeTool.flags.isAddMode) {
                alert("Please finish adding line segments before switching modes.");
                return;
            }

            // Check if a log table exists; if not, create one.
            let logTable = this.stateManager.getElementState("logTable");
            if (!logTable) {
                logTable = this._setupLogTable();
            }

            // Check if a help table exists; if not, create one.
            let helpTable = this.stateManager.getElementState("helpTable");
            if (!helpTable) {
                helpTable = this._setupHelpTable();
            }

            // Show the help table
            // helpTable.style.display = "block";
            // Update its content if your mode changes:
            helpTable.updateContent(buttonText);

            // Deactivate active button if not the same button
            if (activeButton && !isSameButton) {
                this.deactivateButton(activeButton, activeTool);
            }

            // Toggle button activation
            if (isSameButton) { // If it is same button, it means to toggle off
                this.deactivateButton(button, toolInstance);
                this.stateManager.setButtonState("activeButton", null);
                this.stateManager.setButtonState("activeTool", null);

                // Remove the help table and log table components
                const helpTable = this.stateManager.getElementState("helpTable");
                const logTable = this.stateManager.getElementState("logTable");
                if (helpTable) {
                    helpTable.remove();
                    this.stateManager.setElementState("helpTable", null);
                }
                if (logTable) {
                    logTable.remove();
                    this.stateManager.setElementState("logTable", null);
                }
            } else {    // If it is not the same button, it means to toggle on the other button
                this.activateButton(button, toolInstance);
                this.stateManager.setButtonState("activeButton", button);
                this.stateManager.setButtonState("activeTool", toolInstance);
            }

            // set pointerOverlay to hide
            const pointer = this.stateManager.getOverlayState("pointer");
            if (pointer) {
                pointer.style.display = "none";
            }
        });

        // Always add to the button container (which is initially in the fragment)
        this._buttonContainer.appendChild(button);

        toolInstance.button = button;
        return button;
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
     * Sets up the clear button.
     */
    setupClearButton() {
        const clearButton = document.createElement("button");
        clearButton.className = "clear-button annotate-button animate-on-show hidden";
        clearButton.innerHTML = `<img src="${clearIcon}" alt="clear" style="width: 30px; height: 30px;">`;
        // add clear button to button container
        this._buttonContainer.appendChild(clearButton);
        // update state manager
        this.stateManager.setButtonState("clearButton", clearButton);
        // add click event listener
        clearButton.addEventListener("click", this._handleClearButtonClick.bind(this));

        return clearButton;
    }

    _handleClearButtonClick() {
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
     * Setup the help table to display the relevant description of usage
     */
    _setupHelpTable() {
        const helpTable = document.createElement("help-table");
        // Pass shared properties as needed
        helpTable.emitter = this.emitter;
        this.shadowRoot.appendChild(helpTable);
        // Set the help table to the state manager
        this.stateManager.setElementState("helpTable", helpTable);

        // make help table draggable
        makeDraggable(helpTable._helpTableContainer, this.viewer.container);
        return helpTable;
    }

    _setupLogTable() {
        const logTable = document.createElement("log-table");
        // Pass shared properties as needed
        logTable.emitter = this.emitter;
        this.shadowRoot.appendChild(logTable);
        // Set the log table to the state manager
        this.stateManager.setElementState("logTable", logTable);

        makeDraggable(logTable._logTableContainer, this.viewer.container);
        return logTable;
    }

    /**
     * Setup the button overlay to display the description of the button when mouse hover.
     */
    setupButtonOverlay() {
        const buttonOverlay = document.createElement("div");
        buttonOverlay.className = "button-overlay";
        buttonOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; opacity: 0; border: 1px solid #444; color: rgba(38, 38, 38, 0.95); background: #edffff; border-radius: 5px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); z-index: 1000; transition: opacity 0.2s ease-in, transform 0.2s ease-in;";
        this.viewer.container.appendChild(buttonOverlay);
        this.stateManager.setOverlayState("button", buttonOverlay);

        // Store timeout ID
        let tooltipTimeout;
        const TOOLTIP_DELAY = 800; // 0.8 seconds in milliseconds

        this.shadowRoot.querySelectorAll(".annotate-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // Clear any existing timeout
                clearTimeout(tooltipTimeout);

                // Set new timeout
                tooltipTimeout = setTimeout(() => {
                    const cesiumRect = this.viewer.container.getBoundingClientRect();
                    const buttonOverlay = this.stateManager.getOverlayState("button");

                    // set overlay to display
                    buttonOverlay.style.opacity = "0.95";

                    // get description of the button
                    const description = button.querySelector("img")?.alt.split("-").join(" ");
                    buttonOverlay.innerHTML = `${description} mode`;

                    // set position of the overlay
                    buttonOverlay.style.left = e.pageX - cesiumRect.x + "px";
                    buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
                }, TOOLTIP_DELAY);
            });

            button.addEventListener("mouseout", () => {
                // set overlay to not display
                clearTimeout(tooltipTimeout);
                const buttonOverlay = this.stateManager.getOverlayState("button");
                buttonOverlay.style.opacity = "0";
            });
        });
    }

    /**
     * Setup the moving yellow dot to show the pointer position at cesium viewer
     */
    _setupPointerOverlay() {
        const pointer = document.createElement("div");
        pointer.className = "backdrop";
        pointer.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(pointer);
        this.stateManager.setOverlayState("pointer", pointer);
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

    // /***********************
    //  * FIRE TRAIL FEATURES *
    //  ***********************/
    async _initializeFireTrail() {
        // fire trail is a web component
        const fireTrail = document.createElement("fire-trail-mode");
        // error handling: if fire trail or viewer is not available
        if (!fireTrail || !this.viewer) {
            throw new Error("Failed to create fly-through element or viewer failed.")
        };

        // setter values for the fire trail
        fireTrail.viewer = this.viewer;
        fireTrail.app = this.app;
        fireTrail.handler = this.handler;
        fireTrail.stateManager = this.stateManager;
        fireTrail.cesiumPkg = this.cesiumPkg;
        fireTrail.setupLogTable = this._setupLogTable.bind(this);
        fireTrail.setupHelpTable = this._setupHelpTable.bind(this);

        // append the fire trail to the measure toolbox
        this.shadowRoot.appendChild(fireTrail);

        try {
            // check if the component is ready
            fireTrail.addEventListener('component-ready', (e) => {
                if (!e.detail || e.detail?.mode !== "fireTrail") return; // error handling: if fire trail component is not ready
                // set fire trail container position in the web component
                // fireTrail.style.position = "absolute";
                // fireTrail.style.transform = "translate(120px, -200px)";

                // make fire trail container draggable
                makeDraggable(fireTrail.fireTrailToolbar, this.viewer.container);
            });
        } catch (error) {
            console.error("Failed to position", error);
        }

        return fireTrail;
    } catch(error) {
        console.error("Failed to initialize fire trail mode:", error);
        return null;
    }


    // /************************
    //  * FLY THROUGH FEATURES *
    //  ************************/
    async _initializeFlyThrough() {
        try {
            const flyThrough = document.createElement("fly-through-mode");
            // error handling: if flyThrough or viewer is not available
            if (!flyThrough || !this.viewer) {
                throw new Error("Failed to create fly-through element or viewer failed.")
            };

            // setter values for the fly through
            flyThrough.viewer = this.viewer;
            flyThrough.app = this.app || {};
            flyThrough.handler = this.handler;
            flyThrough.stateManager = this.stateManager;
            flyThrough.cesiumPkg = this.cesiumPkg;
            flyThrough.setupLogTable = this._setupLogTable.bind(this);
            flyThrough.setupHelpTable = this._setupHelpTable.bind(this);

            // append the fly through to the measure toolbox
            this.shadowRoot.appendChild(flyThrough);

            try {
                // check if the component is ready
                flyThrough.addEventListener('component-ready', (e) => {
                    if (!e.detail || e.detail?.mode !== "flyThrough") return; // error handling: if fly through component is not ready
                    // set fly through component position
                    flyThrough.style.position = "absolute";
                    flyThrough.style.transform = "translate(120px, -320px)";

                    // make fly through draggable
                    makeDraggable(flyThrough, this.viewer.container);
                }, { once: true });
            } catch (error) {
                console.error("Failed to position", error);
            }

            return flyThrough;
        } catch (error) {
            console.error("Failed to initialize fly-through mode:", error);
            return null;
        }
    }

    /**********
     * HELPER *
     **********/
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
}

customElements.define("cesium-measure", CesiumMeasure);
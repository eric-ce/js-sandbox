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
import { removeInputActions, makeDraggable, createClampedLineGeometryInstance, createClampedLinePrimitive } from "./lib/helper/helper.js";
import { FlyThrough } from "./lib/features/FlyThrough.js";
import { StateManager } from "./lib/features/StateManager.js";
import toolIcon from "./assets/tool-icon.svg";
import pickerIcon from "./assets/picker-icon.svg";
import pointsIcon from "./assets/points-icon.svg";
import distanceIcon from "./assets/distance-icon.svg";
import curveIcon from "./assets/curve-icon.svg";
import heightIcon from "./assets/height-icon.svg";
import multiDImage from "./assets/multi-d-icon.svg";
import multiDClampedIcon from "./assets/multi-d-clamped-icon.svg";
import polygonIcon from "./assets/polygon-icon.svg";
import profileIcon from "./assets/profile-icon.svg";
import profileDistancesIcon from "./assets/profile-d-icon.svg";
import clearIcon from "./assets/clear-icon.svg";
import helpBoxIcon from "./assets/help-box-icon.svg";
import logBoxIcon from "./assets/log-box-icon.svg";
import recordIcon from "./assets/record-icon.svg";
import playIcon from "./assets/play-icon.svg";
import stopIcon from "./assets/stop-icon.svg";

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
        this.cesiumPkg = null;

        this.pointCollection = null;
        this.labelCollection = null;

        // log variables
        this._records = [];

        // Element style position variables
        this.position = {
            logBox: { top: "280px", right: "0px" },
            helpBox: { top: "70px", right: "0px" },
        };

        // state manager
        this.stateManager = new StateManager();

        // fly through variables
        this.coords = {
            _flyRecords: [],
            _mockFlyRecords: [
                {
                    "position": {
                        "x": 1216112.9570234974,
                        "y": -4736576.765693975,
                        "z": 4081200.1481931447
                    },
                    "hpr": {
                        "heading": 0.13000450388900298,
                        "pitch": -0.3625899685123126,
                        "roll": 0.000004638299138548518
                    }
                },
                {
                    "position": {
                        "x": 1216149.8221629532,
                        "y": -4736602.9220574815,
                        "z": 4081452.05891825
                    },
                    "hpr": {
                        "heading": 0.05783204009360077,
                        "pitch": -1.3214516649608017,
                        "roll": 0.000017948732042860627
                    }
                },
                {
                    "position": {
                        "x": 1216231.817715611,
                        "y": -4737091.234564315,
                        "z": 4081695.533198552
                    },
                    "hpr": {
                        "heading": 0.057832040093592774,
                        "pitch": -1.3214516649608137,
                        "roll": 0.000017948732044636984
                    }
                },
                {
                    "position": {
                        "x": 1216214.812668742,
                        "y": -4736968.679816875,
                        "z": 4081895.7453294657
                    },
                    "hpr": {
                        "heading": 6.226051845613029,
                        "pitch": -1.5347377349911553,
                        "roll": 0
                    }
                },
                {
                    "position": {
                        "x": 1216404.8079792114,
                        "y": -4737868.763048155,
                        "z": 4082919.5627028756
                    },
                    "hpr": {
                        "heading": 6.2260518456130285,
                        "pitch": -1.5347377349911953,
                        "roll": 0
                    }
                },
                {
                    "position": {
                        "x": 1216701.9791077161,
                        "y": -4738017.830972404,
                        "z": 4080125.5256115044
                    },
                    "hpr": {
                        "heading": 6.169643854213871,
                        "pitch": -0.15128947599652376,
                        "roll": 0.000010379170224616985
                    }
                }
            ]
        }
        this.flags = {
            isRecording: false,
            isScreenRecording: false,
        }

        // Screen recording variables
        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
    }


    /*********************
     * GETTER AND SETTER *
     *********************/
    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }


    /**********************
     * CONNECTED CALLBACK *
     **********************/
    async connectedCallback() {
        // link cesium package default style
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/Widgets/widgets.css`;
        this.shadowRoot.appendChild(link);

        // add measure toolbox with measure modes
        if (this.viewer) {
            this.initialize();
        }
    }

    disconnectedCallback() {    // clean up when the web component is removed from the DOM
        // Clean up event listeners for buttons
        const clearButton = this.stateManager.getButtonState("clearButton");
        clearButton && clearButton.removeEventListener("click", this.clearButtonHandler);

        // Clean up measure mode buttons
        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button) => {
            button.removeEventListener("click", this.modeButtonClickHandler);
        });

        // Clean up Cesium handlers
        if (this.handler) {
            removeInputActions(this.handler);
        }

        // Remove Cesium primitives
        if (this.pointCollection) {     // point collection is the annotate point collection, remove called if create it agian will throw destroy error 
            this.viewer.scene.primitives.remove(this.pointCollection);
        }
        if (this.labelCollection) {     // label collection is the annotate label collection, remove called if create it agian will throw destroy error 
            this.viewer.scene.primitives.remove(this.labelCollection);
        }

        // Clean up references to avoid memory leaks
        this._viewer = null;
        this.handler = null;
        this.pointCollection = null;
        this.labelCollection = null;
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

        // remove relevant input actions assgined to the handler
        removeInputActions(this.handler);

        // Initialize Cesium primitives collections
        const pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        const labelCollection = new this.cesiumPkg.LabelCollection();
        pointCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, perforamnce improve 2x
        labelCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, perforamnce improve 2x
        pointCollection.id = "annotate_point_collection";
        labelCollection.id = "annotate_label_collection";
        this.pointCollection = this.viewer.scene.primitives.add(pointCollection);
        this.labelCollection = this.viewer.scene.primitives.add(labelCollection);

        // initiate clamped line due to the delay for the first clamped line creation
        const lineGeometryInstance = createClampedLineGeometryInstance([Cesium.Cartesian3.fromDegrees(0, 0), Cesium.Cartesian3.fromDegrees(0, 0)], "line_initiate");
        const linePrimitive = createClampedLinePrimitive(lineGeometryInstance, Cesium.Color.YELLOWGREEN, this.cesiumPkg.GroundPolylinePrimitive);
        this.initialLine = this.viewer.scene.primitives.add(linePrimitive);

        // initialize all the measure modes, including its UI, and event listeners
        this.initializeMeasureModes();

        this.flyThrough();
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
        this.applyStyle();

        // all measure modes
        const modes = [
            {
                instance: new Picker(
                    this.viewer,
                    this.handler,
                    this.stateManager,
                    this.updateRecords.bind(this, "picker"),
                    this.activateModeByName.bind(this)
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
            },
        ];

        // set measure modes 
        this.stateManager.setButtonState("measureModes", modes.map((mode) => mode.instance));

        // create measure mode buttons
        modes.forEach((mode) => {
            this.createMeasureModeButton(mode.instance, mode.name, mode.icon);
        });

        // setup clear button
        this.setupClearButton();

        // setup button overlay
        this.setupButtonOverlay();
    }

    /**
     * Sets up measure tool button to control collapse/expand for buttons.
     */
    setupToolButton() {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        // set state for the toolsContainer
        this.stateManager.setElementState("toolsContainer", toolsContainer);

        // initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = `<img src="${toolIcon}" alt="tool" style="width: 30px; height: 30px;">`;
        toolButton.addEventListener("click", () => {
            toolButton.classList.toggle("active");
            this.toggleTools();
        });
        toolsContainer.appendChild(toolButton);

        this.shadowRoot.appendChild(toolsContainer);

        // make toolsContainer draggable
        makeDraggable(toolsContainer, this.viewer.container);
    }

    applyStyle() {
        // add style to the shadowRoot for this web component
        const style = document.createElement("style");
        style.textContent = `
            *{
                font-family:Roboto, sans-serif;
            }
            .toolbar{ 
                position:absolute;
                bottom: 6rem;
                left: 10rem;
                display: flex;
            }
            .toolbar button{
                height: 40px;
                width: 45px;
                border-radius: 5px;
                cursor: pointer;
                transition: all 0.2s ease-out;
                color: #e6f8f8;
                opacity: 0.9;
            }
            .toolbar button.active {
                color: #000;
                fill: #000;
                background: #adf;
                border-color: #fff;
                box-shadow: 0 0 8px #fff;
            }
            .measure-tools{
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .measure-mode-button {
                /* Hide the buttons by default */
                display: none;
                opacity: 0;
                position: relative;
            }
            .measure-mode-button.show {
                /* Show the buttons when the "tool" button is clicked */
                opacity: 0.9;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .cesium-button{
                margin: 0;
                padding: 0;
            }
            .cesium-infoBox{
                width: 250px;
                padding: 5px;
                font-size: 0.8rem;
                border-radius: 7px;
                cursor: grab; /* Indicates it can be moved */  
            }
            .cesium-infoBox table{
                width: 100%;
            }
            .cesium-infoBox td{
                padding: 5px 0;
                border: none;
            }
            .log-box {
                position: absolute;
                height: 250px;
                overflow-y: auto;
                z-index: 1000;
                cursor: grab; /* Indicates it can be moved */
                scrollbar-width: thin;
                scrollbar-color: #888 rgba(38, 38, 38, 0.95);
            }
            .toggle-log-box-button{
                cursor : pointer;
                transition : all 0.2s ease-in-out;
                color :  #e6f8f8;
                opacity : 0.9;
                padding: 3px 7px;
            }
            .helpBox-expanded{
                width: 250px;
                background-color: rgba(38, 38, 38, 0.95);
            }
            .messageBox-collapsed{
                width: fit-content;
                height: fit-content;
                background-color: transparent;
                border: none;
                box-shadow: none;
            }
            .logBox-expanded{
                width: 250px;
                height: 250px;
                background-color: rgba(38, 38, 38, 0.95);
            }
            `;
        this.shadowRoot.appendChild(style);
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
        const lowerCaseString = buttonText.toLowerCase();
        button.className = `${lowerCaseString} cesium-button measure-mode-button`;
        button.innerHTML = `<img src="${icon}" alt="${lowerCaseString}" style="width: 30px; height: 30px;">`;

        // setup button actions
        button.addEventListener("click", () => {
            const activeButton = this.stateManager.getButtonState("activeButton");
            const isActiveButton = activeButton === button;

            // Deactivate existed active button if it is not the same button
            if (activeButton && !isActiveButton) {
                const activeTool = this.stateManager.getButtonState("activeTool");
                this.deactivateButton(activeButton, activeTool);
            }

            // Toggle button activation
            if (isActiveButton) {
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
            const helpBox = this.stateManager.getElementState("helpBox");
            const logBox = this.stateManager.getElementState("logBox");
            if (!logBox) this.setupLogBox();

            // set helpBox to hide or show without remove it to avoid recreation - to save resources
            if (helpBox) {
                helpBox.style.display = "block";
            } else {
                this.setupHelpBox();
            }
            this.updateHelpBox();

            // set the pointerOverlay to hide
            this.stateManager.getOverlayState("pointer").style.display = "none";
        });

        // append button to the toolsContainer
        const toolsContainer = this.stateManager.getElementState("toolsContainer");
        toolsContainer.appendChild(button);
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
    }

    /**
     * Deactivates a measurement tool button.
     * @param {HTMLElement} button - The button element to deactivate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    deactivateButton(button, toolInstance) {
        button.classList.remove("active");
        toolInstance.removeInputAction && toolInstance.removeInputAction();
        toolInstance.resetValue && toolInstance.resetValue();

        // remove moving or pending primitives
        this.viewer.scene.primitives._primitives.filter(p =>
            p.geometryInstances &&
            p.geometryInstances.id &&
            p.geometryInstances.id.startsWith("annotate") &&
            (p.geometryInstances.id.includes("moving") || p.geometryInstances.id.includes("pending") || p.geometryInstances.id.includes("line_initiate"))
        ).forEach(p => { this.viewer.scene.primitives.remove(p) });

        this.labelCollection._labels.filter(l =>
            l &&
            l.id &&
            (l.id.includes("moving") || l.id.includes("pending"))
        ).forEach(l => { this.labelCollection.remove(l) });

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
        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button, index) => {
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

        const toolsContainer = this.stateManager.getElementState("toolsContainer");
        toolsContainer.appendChild(clearButton);

        this.stateManager.getButtonState("clearButton").addEventListener("click", () => {
            // remove line primitives
            const linePrimitives = this.viewer.scene.primitives._primitives.filter(
                (p) =>
                    p.geometryInstances &&
                    p.geometryInstances.id &&
                    p.geometryInstances.id.startsWith("annotate") &&
                    p.geometryInstances.id.includes("line")
            );
            linePrimitives.forEach((p) => this.viewer.scene.primitives.remove(p));
            // remove polygon primitives
            const polygonPrimitives = this.viewer.scene.primitives._primitives.filter(
                (p) =>
                    p.geometryInstances &&
                    p.geometryInstances.id &&
                    p.geometryInstances.id.startsWith("annotate") &&
                    p.geometryInstances.id.includes("polygon")
            );
            polygonPrimitives.forEach((p) => this.viewer.scene.primitives.remove(p));
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
                    labelCollection.removeAll(); // moving label was not remove, because same label cannot recreate and hence cause destory error
                });

            // reset handler
            removeInputActions(this.handler);

            // reset pointerOverlay
            this.stateManager.getOverlayState("pointer").style.display = "none";

            // clear helpBox
            const helpBox = this.stateManager.getElementState("helpBox");
            helpBox && helpBox.style.display === "none";
            // clear logbox
            const logBox = this.stateManager.getElementState("logBox");
            if (logBox) {
                logBox.remove();
                this.stateManager.setElementState("logBox", null);
            }
            // call reset value method in all measure modes
            this.stateManager.getButtonState("measureModes").forEach((mode) => {
                mode.resetValue && mode.resetValue();
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
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; display: none; background: white; border-radius: 5px; box-shadow: 0 0 10px #000; transition: 0.1s ease-in-out;";
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
                const description = button.querySelector("img")?.alt;
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
        newHelpBox.style.right = this.position.helpBox.right || "0px";

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
        // Define the messages to show based on the active mode
        const messages = {
            title: "How to use:",
            default: [
                "Left Click: start measure",
                "Hold Left Click: drag point to move annotation"
            ],
            multiDistances: [
                "Left Click: start measure",
                "Right Click: finish measure",
                "Hold Left Click: drag point to move annotation",
                "Add line: select line and click to add line",
                "Remove point: click point to remove"
            ],
            picker: ["Left Click: pick an annotation"],
            polygon: [
                "Left Click: start measure",
                "Right Click: finish measure",
                "Hold Left Click: drag point to move annotation"
            ]
        };

        // Map button classes to message sets
        const modeClassToMessageSet = {
            'multi-distances': messages.multiDistances,
            'multi-distances-clamped': messages.multiDistances,
            'profile-distances': messages.multiDistances,
            'picker': messages.picker,
            'polygon': messages.polygon,
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
        const updateHelpBoxPosition = (newTop, newLeft, containerRect) => {
            this.position.helpBox.top = `${newTop}px`;
            this.position.helpBox.right = `${containerRect.width - newLeft - helpBox.offsetWidth}px`;
        };

        // Setup the toggle button for the helpBox
        const toggleButton = this.setupMessageBoxToggleButton(helpBox, helpBoxIcon, updateHelpBoxPosition, "helpBox");
        helpBox.appendChild(toggleButton);

        // Make the helpBox draggable within the viewer container
        makeDraggable(helpBox, this.viewer.container, updateHelpBoxPosition);
    }

    /**
     * Setup the messageBox of logBox to show the records of the measure modes
     */
    setupLogBox() {
        if (this.stateManager.getElementState("logBox")) {
            logBox.remove()
        };

        const newLogBox = document.createElement("div");
        newLogBox.className = "cesium-infoBox cesium-infoBox-visible log-box log-box-expanded";
        newLogBox.style.top = this.position.logBox.top || "190px";
        newLogBox.style.right = this.position.logBox.right || "0px";

        const table = document.createElement("table");
        table.style.display = "table";

        const title = this.createRow("Actions");
        table.appendChild(title);

        // Append table to the logBox
        newLogBox.appendChild(table);
        // Append the logBox to the shadow DOM
        this.shadowRoot.appendChild(newLogBox);
        this.stateManager.setElementState("logBox", newLogBox);

        const logBox = this.stateManager.getElementState("logBox");
        // Function to update the position of the logBox
        const updateLogBoxPosition = (newTop, newLeft, containerRect) => {
            this.position.logBox.top = `${newTop}px`;
            this.position.logBox.right = `${containerRect.width - newLeft - newLogBox.offsetWidth}px`;
        };

        // Setup the toggle button for the logBox
        const toggleButton = this.setupMessageBoxToggleButton(logBox, logBoxIcon, updateLogBoxPosition, "logBox");
        logBox.appendChild(toggleButton);

        // Make logBox draggable
        makeDraggable(logBox, this.viewer.container, updateLogBoxPosition);
    }

    /**
     * Update the logBox with the records of the measure modes
     */
    updateLogBox() {
        const logBox = this.stateManager.getElementState("logBox");
        const table = logBox.querySelector("table");
        table.innerHTML = ""; // Clear the table

        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.createRow("Actions"));

        this._records.forEach((record) => {
            const key = Object.keys(record)[0];
            const recordData = record[key];

            if (key === "points") {
                // recordData = {points: {add: {key: value}}}, and callback pass {add: {key: value}}
                const action = Object.keys(recordData)[0];
                const [coordinateKey, coordinateValue] = Object.entries(recordData[action])[0];
                fragment.appendChild(
                    this.createRow(`${key}: ${action}: (${coordinateKey}): ${coordinateValue}`)
                );
            } else if (
                key === "m-distance" ||
                key === "profile-distances" ||
                key === "m-distance-clamped"
            ) {
                const { distances, totalDistance } = recordData;
                fragment.appendChild(this.createRow(`${key}: distances: ${distances}`));
                fragment.appendChild(this.createRow(`${key}: totalDistance: ${totalDistance}`));
            } else {
                fragment.appendChild(this.createRow(`${key}: ${recordData}`));
            }
        });

        table.appendChild(fragment);
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
    updateRecords(mode, records) {
        this._records.push({ [mode]: records });
        this.updateLogBox(); // Ensure the log box is updated every time records change
    }

    activateModeByName(modeName) {
        const measureModes = this.stateManager.getButtonState("measureModes");
        const modeInstance = measureModes.find((mode) =>
            mode.button.classList.contains(modeName)
        );
        // const button = this.element.toolsContainer.querySelector(`.${modeName}`);
        const button = this.stateManager.getElementState("toolsContainer").querySelector(`.${modeName}`);

        if (modeInstance && button) {
            const activeTool = this.stateManager.getButtonState("activeTool");
            const activeButton = this.stateManager.getButtonState("activeButton");
            this.deactivateButton(activeButton, activeTool); // Deactivate old
            this.activateButton(button, modeInstance); // Activate new
        }
    }


    /************************
     * FLY THROUGH FEATURES *
     ************************/
    flyThrough() {
        this.setupRecordButton();
        this.setupReplayButton();
        this.setupRecordScreenButton();
    }

    setupRecordButton() {
        const button = document.createElement("button");
        button.className = "cesium-button fly-through";
        button.innerHTML = `<img src="${recordIcon}" alt="Record" style="width: 30px; height: 30px;"/>`;
        button.style.position = "absolute";

        let moveEndListener;

        button.addEventListener("click", () => {
            this.flags.isRecording = !this.flags.isRecording;
            button.classList.toggle("active", this.flags.isRecording);

            // Update the icon based on the recording state
            button.innerHTML = `<img src="${this.flags.isRecording ? stopIcon : recordIcon}" alt="${this.flags.isRecording ? 'Stop' : 'Record'}" style="width: 30px; height: 30px;"/>`;

            if (this.flags.isRecording) {
                if (this.activeButton?.current === button) {
                    this.activeButton = { current: button };
                }
                moveEndListener = this.cameraMoveRecord();
            } else {
                if (moveEndListener) {
                    this.viewer.camera.moveEnd.removeEventListener(moveEndListener);
                    moveEndListener = null;
                }
            }
        });

        this.appendButtonToToolbar(button, 13, 0);

        return button;
    }

    cameraMoveRecord() {
        const listener = () => {
            console.log(this.viewer.camera);
            const position = this.viewer.camera.positionWC;
            const heading = this.viewer.camera.heading;
            const pitch = this.viewer.camera.pitch;
            const roll = this.viewer.camera.roll;
            this.coords._flyRecords.push({ position: { ...position }, hpr: { heading, pitch, roll } });
            console.log(this.coords._flyRecords);
        };

        this.viewer.camera.moveEnd.addEventListener(listener);
        return listener;
    }

    setupReplayButton() {
        const button = document.createElement("button");
        button.className = "cesium-button replay-button";
        button.innerHTML = `<img src="${playIcon}" alt="Play" style="width: 30px; height: 30px;"/>`;
        button.style.position = "absolute";

        button.addEventListener("click", () => {
            if (!this.flags.isRecording) {
                this.flyTo(0, this.coords._flyRecords, 3);
            } else {
                alert("Please stop recording before replaying.");
            }
        });

        this.appendButtonToToolbar(button, 13, -40);

        return button;
    }

    flyTo(index, data, duration = 3) {
        if (index >= data.length) {
            console.log("flyComplete");
            return;
        }

        const position = data[index].position;
        const nextIndex = index + 1;

        // flyToBoundingSphere approach 
        const pointBoundingSphere = new Cesium.BoundingSphere(position, 100);
        this.viewer.camera.flyToBoundingSphere(pointBoundingSphere, {
            offset: new Cesium.HeadingPitchRange(data[index].hpr.heading,
                data[index].hpr.pitch, 100),
            duration: duration,
            easingEffects: Cesium.EasingFunction.QUADRATIC_IN_OUT,
            flyOverLongitude: Cesium.Cartographic.fromCartesian(position).longitude,
            flyOverLongitudeWeight: 0.5,
            complete: () => {
                // this.viewer.camera.moveBackward(70);
                setTimeout(() => {
                    this.flyTo(nextIndex, this.coords._flyRecords, 3); // Recursively fly to the next point
                }, 1000);
            },
            cancel: () => {
                console.log('Fly-through was canceled.');
            },
        })
    }

    appendButtonToToolbar(button, buttonIndex, buttonTopOffset) {
        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium?.shadowRoot?.querySelector("cesium-measure");

        if (measureToolbox) {
            const observer = new MutationObserver((_, obs) => {
                const toolbar = measureToolbox.shadowRoot.querySelector(".toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (toolbar && measureToolButton) {
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    button.style.left = `${BUTTON_WIDTH * buttonIndex}px`;
                    button.style.top = `${buttonTopOffset}px`;
                    toolbar.appendChild(button);

                    obs.disconnect(); // Stop observing once the button is appended

                    const toggleButtonVisibility = () => {
                        if (measureToolButton.classList.contains('active')) {
                            setTimeout(() => {
                                button.style.display = 'block';
                            }, 500);
                        } else {
                            button.style.display = 'none';
                        }
                    };

                    // Initial visibility check
                    toggleButtonVisibility();

                    // Observe class changes for visibility toggling
                    const classObserver = new MutationObserver(toggleButtonVisibility);
                    classObserver.observe(measureToolButton, { attributes: true, attributeFilter: ['class'] });
                }
            });

            // Start observing the measureToolbox shadow DOM for child list changes
            observer.observe(measureToolbox.shadowRoot, { childList: true, subtree: true });
        }
    }

    setupRecordScreenButton() {
        const button = document.createElement("button");
        button.className = "cesium-button record-screen";
        button.innerHTML = `<img src="${recordIcon}" alt="Record Screen" style="width: 30px; height: 30px;"/>`;
        button.style.position = "absolute";

        button.addEventListener("click", async () => {
            this.flags.isScreenRecording = !this.flags.isScreenRecording;
            button.classList.toggle("active", this.flags.isScreenRecording);

            // Update the icon based on the recording state
            button.innerHTML = `<img src="${this.flags.isScreenRecording ? stopIcon : recordIcon}" alt="${this.flags.isScreenRecording ? 'Stop' : 'Record'}" style="width: 30px; height: 30px;"/>`;

            if (this.flags.isScreenRecording) {   // Start screen recording
                if (this.activeButton?.current === button) {
                    this.activeButton = { current: button };
                }
                await this.recordScreen(button);
            } else {    // Stop screen recording
                this.stopScreenRecording();
            }
        });

        this.appendButtonToToolbar(button, 13, -80);

        return button;
    }

    async recordScreen(button) {
        try {
            // Request screen capture
            const displayMediaOptions = {
                video: {
                    displaySurface: "browser",
                    frameRate: { ideal: 60, max: 60 }, // Request higher frame rate
                    height: { ideal: 1080 }, // Set ideal height for 1080p resolution
                    width: { ideal: 1920 } // Set ideal width for 1080p resolution
                },
                audio: false,
                preferCurrentTab: true,
            }
            this.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // Create a new MediaRecorder instance with WebM format
            const options = { mimeType: 'video/webm; codecs=vp8' };
            this.mediaRecorder = new MediaRecorder(this.stream, options);

            this.chunks = [];

            // Create a video element to display the live recording
            this.liveVideo = document.createElement('video');
            this.liveVideo.srcObject = this.stream;
            this.liveVideo.style.position = 'absolute';
            this.liveVideo.style.bottom = '10px';
            this.liveVideo.style.right = '10px';
            this.liveVideo.style.width = '300px';
            this.liveVideo.style.height = '200px';
            this.liveVideo.autoplay = true;
            this.liveVideo.controls = true;
            document.body.appendChild(this.liveVideo);

            // Listen for data events to collect video chunks
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.chunks.push(event.data);
                }
            };

            // When recording stops, create a downloadable WebM file
            this.mediaRecorder.onstop = () => {
                // Combine all recorded chunks into a single Blob
                const blob = new Blob(this.chunks, { type: 'video/webm' });
                this.chunks = [];

                // Create a download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'screen-recording.webm';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
            };

            // Start recording
            this.mediaRecorder.start();
            console.log('Recording started');

            // Add a listener to stop the recording if the user stops sharing the screen
            this.stream.getVideoTracks()[0].addEventListener('ended', () => {
                this.flags.isScreenRecording = false;
                this.stopScreenRecording();
            });
        } catch (err) {
            console.error('Error accessing screen capture:', err);
            // reset state and button
            this.flags.isScreenRecording = false;
            button.classList.toggle("active", this.flags.isScreenRecording);
            button.innerHTML = `<img src="${recordIcon}" alt="Record Screen" style="width: 30px; height: 30px;"/>`;
        }
    }

    stopScreenRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            console.log('Recording stopped');
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.liveVideo) {
            if (this.stream && this.stream.active === false) {
                document.body.removeChild(this.liveVideo);
                this.liveVideo = null;
            }
        }
    }

}

customElements.define("cesium-measure", MeasureToolbox);

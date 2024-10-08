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
import { StateManager } from "./lib/features/stateManager.js";
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

        // Overlay variables
        this.overlay = {
            pointer: null,
            button: null,
        };

        // UI element variables
        this.element = {
            helpBox: null,
            logBox: null,
            toolsContainer: null,
        };

        // Button state variables
        this.button = {
            activeButton: { current: null },  // handle dynamic active button state
            activeTool: null,
            clearButton: null,
            measureModes: [],
            isToolsExpanded: false,
        };

        // log variables
        this._records = [];

        // Element style position variables
        this.position = {
            logBox: { top: "280px", right: "0px" },
            helpBox: { top: "70px", right: "0px" },
        };

        // state manager
        this.stateManager = null;
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
        if (this.button.clearButton) {
            this.button.clearButton.removeEventListener("click", this.clearButtonHandler);
        }

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
        this.overlay = null;
        this.element = null;
        this.button = null;
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

        // initialize state manager
        this.stateManager = new StateManager();

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
    }

    /**
     * Initialize all the measure modes
     */
    async initializeMeasureModes() {
        this.setupButtons();

        // all measure modes
        const modes = [
            {
                instance: new Picker(
                    this.viewer,
                    this.handler,
                    this.overlay.pointer,
                    this.updateRecords.bind(this, "picker"),
                    this.button.measureModes
                ),
                name: "Picker",
                icon: pickerIcon,
            },
            {
                instance: new Points(
                    this.viewer,
                    this.handler,
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
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
                    this.overlay.pointer,
                    this.updateRecords.bind(this, "profile-distances"),
                    this.cesiumPkg
                ),
                name: "Profile-Distances",
                icon: profileDistancesIcon,
            },
            {
                instance: new FlyThrough(
                    this.viewer,
                    this.handler,
                    this.overlay.pointer,
                    this.button.activeButton,   // pass as object for dynamic update of active button state
                    this.updateRecords.bind(this, "fly-through"),
                    this.cesiumPkg
                ),
                name: "Fly-Through",
                icon: pickerIcon
            },
        ];

        this.button.measureModes = modes.map((mode) => mode.instance);

        const pickerInstance = modes.find((mode) => mode.name === "Picker").instance;
        pickerInstance.measureModes = this.button.measureModes;
        pickerInstance.activateModeCallback = this.activateModeByName.bind(this);

        modes.forEach((mode) => {
            this.createMeasureModeButton(mode.instance, mode.name, mode.icon);
        });

        this.setupClearButton();

        this.setupButtonOverlay();
    }

    /**
     * Sets up measure toolbar including buttons, and style.
     */
    setupButtons() {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        this.element.toolsContainer = toolsContainer;

        // initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = `<img src="${toolIcon}" alt="tool" style="width: 30px; height: 30px;">`;
        toolButton.addEventListener("click", () => {
            toolButton.classList.toggle("active");
            this.toggleTools();
        });
        toolsContainer.appendChild(toolButton);

        // initialize style of pointerOverlay, the moving dot
        this.setupPointerOverlay();

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
        this.shadowRoot.appendChild(toolsContainer);

        // make toolsContainer draggable
        makeDraggable(toolsContainer, this.viewer.container);
    }

    /**
     * Creates a measurement mode button.
     * @param {Object} toolInstance - The instance of the measurement tool.
     * @param {string} buttonText - The text to display on the button.
     * @param {string} icon - The image to display on the button.
     */
    createMeasureModeButton(toolInstance, buttonText, icon) {
        // setup buttons
        const button = document.createElement("button");
        const lowerCaseString = buttonText.toLowerCase();
        button.className = `${lowerCaseString} cesium-button measure-mode-button`;
        button.innerHTML = `<img src="${icon}" alt="${lowerCaseString}" style="width: 30px; height: 30px;">`;

        // setup button actions
        button.addEventListener("click", () => {
            if (!this.element.logBox) this.setupLogBox();
            if (!this.element.helpBox) this.setupHelpBox();

            this.overlay.pointer.style.display = "none";

            // if the click button the same as active button then deactivate it
            if (this.button.activeButton.current === button) {
                this.deactivateButton(button, toolInstance);
                // set state for the button
                this.button.activeButton.current = null;
                this.button.activeTool = null;

                if (this.element.helpBox) {
                    this.element.helpBox.remove();
                    this.element.helpBox = null;
                }
                if (this.element.logBox) {
                    this.element.logBox.remove();
                    this.element.logBox = null;
                }
            } else {
                // if the click button is not the active button
                // initialize button
                this.button.activeButton.current && this.deactivateButton(this.button.activeButton.current, this.button.activeTool);
                // activate button
                this.activateButton(button, toolInstance);
                // set state for the button and instance
                this.button.activeButton.current = button;
                this.button.activeTool = toolInstance;

                this.setupHelpBox();
                // this.setupLogBox();
            }
        });

        this.element.toolsContainer.appendChild(button);
        toolInstance.button = button; // Use the setter to store the button in the measure mode instance
    }

    /**
     * Activates a measurement tool button.
     * @param {HTMLElement} button - The button element to activate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    activateButton(button, toolInstance) {
        button.classList.add("active");
        toolInstance.setupInputActions && toolInstance.setupInputActions();
        this.button.activeButton.current = button;
        this.button.activeTool = toolInstance;
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
        this.button.isToolsExpanded = !this.button.isToolsExpanded;
        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button, index) => {
            setTimeout(() => {
                button.classList.toggle("show", this.button.isToolsExpanded);
            }, index * 50 + 25);
        });
    }

    /**
     * Sets up the clear button.
     */
    setupClearButton() {
        this.button.clearButton = document.createElement("button");
        this.button.clearButton.className = "clear-button cesium-button measure-mode-button";
        this.button.clearButton.innerHTML = `<img src="${clearIcon}" alt="clear" style="width: 30px; height: 30px;">`;

        this.element.toolsContainer.appendChild(this.button.clearButton);

        this.button.clearButton.addEventListener("click", () => {
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
            this.overlay.pointer.style.display = "none";

            // clear helpBox
            this.element.helpBox && this.element.helpBox.remove();
            // clear logbox
            this.element.logBox && this.element.logBox.remove();

            this.button.measureModes.forEach((mode) => {
                mode.resetValue && mode.resetValue();
            });

            if (this.button.activeButton.current) {
                this.button.activeButton.current.classList.remove("active");
                this.button.activeButton.current = null;
                this.button.activeTool = null;
            }
        });
    }

    /**
     * Sets up the button overlay to display the description of the button when mouse hover.
     */
    setupButtonOverlay() {
        this.overlay.button = document.createElement("div");
        this.overlay.button.className = "button-overlay";
        this.overlay.button.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; display: none; background: white; border-radius: 5px; box-shadow: 0 0 10px #000; transition: 0.1s ease-in-out;";
        this.viewer.container.appendChild(this.overlay.button);

        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // cesium container rectangle
                const cesiumRect = this.viewer.container.getBoundingClientRect();
                // set overlay to display
                this.overlay.button.style.display = "block";
                // get description of the button
                const description = button.querySelector("img")?.alt;
                this.overlay.button.innerHTML = `${description} mode`;
                // set position of the overlay
                this.overlay.button.style.left = e.pageX - cesiumRect.x + "px"; // Position the overlay right of the cursor
                this.overlay.button.style.top = e.pageY - cesiumRect.y - 40 + "px";
            });

            button.addEventListener("mouseout", () => {
                // set overlay to not display
                this.overlay.button.style.display = "none";
            });
        });
    }

    /**
     * Setup the moving yellow dot to show the pointer position at cesium viewer
     */
    setupPointerOverlay() {
        this.overlay.pointer = document.createElement("div");
        this.overlay.pointer.className = "backdrop";
        this.overlay.pointer.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(this.overlay.pointer);
    }

    /**
     * Setup messageBox of helpBox to show the instructions of how to use
     */
    setupHelpBox() {
        // Remove the existing helpBox if it exists to avoid duplicates
        if (this.element.helpBox) {
            this.element.helpBox.remove()
        }

        // Create a new helpBox div element
        this.element.helpBox = document.createElement("div");
        this.element.helpBox.className = "cesium-infoBox cesium-infoBox-visible infoBox-expanded";
        this.element.helpBox.style.top = this.position.helpBox.top || "70px"; // Set initial position
        this.element.helpBox.style.right = this.position.helpBox.right || "0px";

        // Create a table element to hold the instructions
        const table = document.createElement("table");
        table.style.display = "table";

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
            const currentButton = this.button.activeButton.current;
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
        table.appendChild(this.createRow(messages.title));
        messageSet.forEach((message) => table.appendChild(this.createRow(message)));

        // Append table to the helpBox
        this.element.helpBox.appendChild(table);
        // Append the helpBox to the shadow DOM
        this.shadowRoot.appendChild(this.element.helpBox);

        // Function to update the position of the helpBox
        const updateHelpBoxPosition = (newTop, newLeft, containerRect) => {
            this.position.helpBox.top = `${newTop}px`;
            this.position.helpBox.right = `${containerRect.width - newLeft - this.element.helpBox.offsetWidth}px`;
        };

        // Setup the toggle button for the helpBox
        const toggleButton = this.setupMessageBoxToggleButton(this.element.helpBox, helpBoxIcon, updateHelpBoxPosition, "helpBox");
        this.element.helpBox.appendChild(toggleButton);

        // Make the helpBox draggable within the viewer container
        makeDraggable(this.element.helpBox, this.viewer.container, updateHelpBoxPosition);
    }

    /**
     * Setup the messageBox of logBox to show the records of the measure modes
     */
    setupLogBox() {
        if (this.element.logBox) this.element.logBox.remove();

        this.element.logBox = document.createElement("div");
        this.element.logBox.className = "cesium-infoBox cesium-infoBox-visible log-box log-box-expanded";
        this.element.logBox.style.top = this.position.logBox.top || "190px";
        this.element.logBox.style.right = this.position.logBox.right || "0px";

        const table = document.createElement("table");
        table.style.display = "table";

        const title = this.createRow("Actions");
        table.appendChild(title);

        // Append table to the logBox
        this.element.logBox.appendChild(table);
        // Append the logBox to the shadow DOM
        this.shadowRoot.appendChild(this.element.logBox);

        // Function to update the position of the logBox
        const updateLogBoxPosition = (newTop, newLeft, containerRect) => {
            this.position.logBox.top = `${newTop}px`;
            this.position.logBox.right = `${containerRect.width - newLeft - this.element.logBox.offsetWidth}px`;
        };

        // Setup the toggle button for the logBox
        const toggleButton = this.setupMessageBoxToggleButton(this.element.logBox, logBoxIcon, updateLogBoxPosition, "logBox");
        this.element.logBox.appendChild(toggleButton);

        // Make logBox draggable
        makeDraggable(this.element.logBox, this.viewer.container, updateLogBoxPosition);
    }

    /**
     * Update the logBox with the records of the measure modes
     */
    updateLogBox() {
        const table = this.element.logBox.querySelector("table");
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
        const modeInstance = this.button.measureModes.find((mode) =>
            mode.button.classList.contains(modeName)
        );
        const button = this.element.toolsContainer.querySelector(`.${modeName}`);

        if (modeInstance && button) {
            this.deactivateButton(this.button.activeButton.current, this.button.activeTool); // Deactivate old
            this.activateButton(button, modeInstance); // Activate new
        }
    }
}

customElements.define("cesium-measure", MeasureToolbox);

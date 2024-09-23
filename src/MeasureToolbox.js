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
import { removeInputActions, makeDraggable } from "./lib/helper/helper.js";
import { FireTrack } from "./lib/features/FireTrack.js";
import { FlyThrough } from "./lib/features/FlyThrough.js";
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

        this.pointerOverlay = null;
        this.infoBox = null;
        this.logBox = null;

        this.cesiumPkg = null;

        // buttons variables
        this.toolsContainer = null;
        this.clearButton = null;
        this.activeButton = null;
        this.activeTool = null;
        this.measureModes = [];
        this.isToolsExpanded = false;
        this.buttonOverlay = null;

        // log variables
        this._records = [];

        // element style position variable
        this.logBoxPosition = { top: "190px", right: "0px" };
        this.infoBoxPosition = { top: "70px", right: "0px" };
    }

    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }

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

    /**
     * Initializes the MeasureToolbox, setting up event handlers
     */
    initialize() {
        // if there is pre-existing screenSpaceEventHandler, use it, otherwise create a new one
        if (this.viewer.screenSpaceEventHandler) {
            this.handler = this.viewer.screenSpaceEventHandler;
        } else {
            this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        }

        removeInputActions(this.handler);

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
                    this.pointerOverlay,
                    this.updateRecords.bind(this, "picker"),
                    this.measureModes
                ),
                name: "Picker",
                icon: pickerIcon,
            },
            {
                instance: new Points(
                    this.viewer,
                    this.handler,
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
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
                    this.pointerOverlay,
                    this.updateRecords.bind(this, "profile-distances"),
                    this.cesiumPkg
                ),
                name: "Profile-Distances",
                icon: profileDistancesIcon,
            },
            // {
            //     instance: new FlyThrough(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "profile-distances"), this.cesiumPkg),
            //     name: "Fly-Through",
            //     icon: pickerImg
            // },
        ];

        this.measureModes = modes.map((mode) => mode.instance);

        const pickerInstance = modes.find((mode) => mode.name === "Picker").instance;
        pickerInstance.measureModes = this.measureModes;
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

        this.toolsContainer = toolsContainer;

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
            .info-panel td{
                border: 1px 0 solid #edffff;
                font-size: 0.8rem;
            }
            .log-box {
                position: absolute;
                height: 250px;
                overflow-y: auto;
                width: 250px;
                background: rgba(38, 38, 38, 0.95);
                opacity: 1; /* Adjusted for CSS readability */
                padding: 5px;
                border-radius: 7px;
                box-shadow: 0 0 10px 1px #000;
                z-index: 1000;
                color: #edffff;
                cursor: grab; /* Indicates it can be moved */
                scrollbar-width: thin;
                scrollbar-color: #888 rgba(38, 38, 38, 0.95);
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
            if (!this.logBox) this.setupLogBox();
            if (!this.infoBox) this.setupInfoBox();

            this.pointerOverlay.style.display = "none";

            // if the click button the same as active button then deactivate it
            if (this.activeButton === button) {
                this.deactivateButton(button, toolInstance);
                // set state for the button
                this.activeButton = null;
                this.activeTool = null;

                if (this.infoBox) {
                    this.infoBox.remove();
                    this.infoBox = null;
                }
                if (this.logBox) {
                    this.logBox.remove();
                    this.logBox = null;
                }
            } else {
                // if the click button is not the active button
                // initialize button
                this.activeButton && this.deactivateButton(this.activeButton, this.activeTool);
                // activate button
                this.activateButton(button, toolInstance);
                // set state for the button and instance
                this.activeButton = button;
                this.activeTool = toolInstance;

                this.setupInfoBox();
                this.setupLogBox();
            }
        });

        this.toolsContainer.appendChild(button);
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
        this.activeButton = button;
        this.activeTool = toolInstance;
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
    }

    /**
     * toggle action for the tool button to show/hide measure modes
     */
    toggleTools() {
        this.isToolsExpanded = !this.isToolsExpanded;
        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button, index) => {
            setTimeout(() => {
                button.classList.toggle("show", this.isToolsExpanded);
            }, index * 50 + 25);
        });
    }

    /**
     * Sets up the clear button.
     */
    setupClearButton() {
        this.clearButton = document.createElement("button");
        this.clearButton.className = "clear-button cesium-button measure-mode-button";
        this.clearButton.innerHTML = `<img src="${clearIcon}" alt="clear" style="width: 30px; height: 30px;">`;

        this.toolsContainer.appendChild(this.clearButton);

        this.clearButton.addEventListener("click", () => {
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
            this.pointerOverlay.style.display = "none";

            // clear infobox
            this.infoBox && this.infoBox.remove();
            // clear logbox
            this.logBox && this.logBox.remove();

            this.measureModes.forEach((mode) => {
                mode.resetValue && mode.resetValue();
            });

            if (this.activeButton) {
                this.activeButton.classList.remove("active");
                this.activeButton = null;
                this.activeTool = null;
            }
        });
    }

    /**
     * Sets up the button overlay to display the description of the button when mouse hover.
     */
    setupButtonOverlay() {
        this.buttonOverlay = document.createElement("div");
        this.buttonOverlay.className = "button-overlay";
        this.buttonOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; display: none; background: white; border-radius: 5px; box-shadow: 0 0 10px #000; transition: 0.1s ease-in-out;";
        this.viewer.container.appendChild(this.buttonOverlay);

        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // cesium container rectangle
                const cesiumRect = this.viewer.container.getBoundingClientRect();
                // set overlay to display
                this.buttonOverlay.style.display = "block";
                // get description of the button
                const description = button.querySelector("img")?.alt;
                this.buttonOverlay.innerHTML = `${description} mode`;
                // set position of the overlay
                this.buttonOverlay.style.left = e.pageX - cesiumRect.x + "px"; // Position the overlay right of the cursor
                this.buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
            });

            button.addEventListener("mouseout", () => {
                // set overlay to not display
                this.buttonOverlay.style.display = "none";
            });
        });
    }

    /**
     * Setup the moving yellow dot to show the pointer position at cesium viewer
     */
    setupPointerOverlay() {
        this.pointerOverlay = document.createElement("div");
        this.pointerOverlay.className = "backdrop";
        this.pointerOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(this.pointerOverlay);
    }

    /**
     * Setup the infoBox to show the instruction of the measure modes, how to use
     */
    setupInfoBox() {
        // remove infoBox if it exists
        if (this.infoBox) this.infoBox.remove();

        // create infoBox div
        this.infoBox = document.createElement("div");
        this.infoBox.className = "cesium-infoBox cesium-infoBox-visible";
        this.infoBox.style.top = this.infoBoxPosition.top || "70px";
        this.infoBox.style.right = this.infoBoxPosition.right || "0px";

        const infoBoxTable = document.createElement("table");

        // show different message to different mode
        const messageTitle = "How to use:";
        const message1 = "Left Click: start measure";
        const message2 = "Right Click: finish measure";
        const message3 = "Hold Left Click: drag point move annotation";
        const messagePicker = "Left Click: pick an annotation";
        // create table first row for the title
        infoBoxTable.appendChild(this.createRow(messageTitle));
        // create table rows for the messages
        if (
            this.activeButton &&
            (this.activeButton.classList.contains("multi-distances") ||
                this.activeButton.classList.contains("multi-distances-clamped") ||
                this.activeButton.classList.contains("polygon") ||
                this.activeButton.classList.contains("profile-distances"))
        ) {
            infoBoxTable.appendChild(this.createRow(message1));
            infoBoxTable.appendChild(this.createRow(message2));
            infoBoxTable.appendChild(this.createRow(message3));
        } else if (this.activeButton && this.activeButton.classList.contains("picker")) {
            infoBoxTable.appendChild(this.createRow(messagePicker));
        } else {
            infoBoxTable.appendChild(this.createRow(message1));
            infoBoxTable.appendChild(this.createRow(message3));
        }

        this.infoBox.appendChild(infoBoxTable);
        this.shadowRoot.appendChild(this.infoBox);

        // Make infoBox draggable
        makeDraggable(this.infoBox, this.viewer.container, (newTop, newLeft, containerRect) => {
            this.infoBoxPosition.top = `${newTop}px`;
            this.infoBoxPosition.right = `${containerRect.width - newLeft - this.infoBox.offsetWidth
                }px`;
        });
    }

    /**
     * Setup the logBox to show the records of the measure modes
     */
    setupLogBox() {
        if (this.logBox) this.logBox.remove();

        this.logBox = document.createElement("div");
        this.logBox.className = "log-box";
        this.logBox.style.top = this.logBoxPosition.top || "190px";
        this.logBox.style.right = this.logBoxPosition.right || "0px";

        const table = document.createElement("table");
        table.className = "info-panel";
        table.style.width = "100%";
        const title = this.createRow("Records");
        table.appendChild(title);

        this.logBox.appendChild(table);
        this.shadowRoot.appendChild(this.logBox);

        // Make logBox draggable
        makeDraggable(this.logBox, this.viewer.container, (newTop, newLeft, containerRect) => {
            this.logBoxPosition.top = `${newTop}px`;
            this.logBoxPosition.right = `${containerRect.width - newLeft - this.logBox.offsetWidth}px`;
        });
    }

    /**
     * Update the logBox with the records of the measure modes
     */
    updateLogBox() {
        const table = this.logBox.querySelector("table");
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
        const modeInstance = this.measureModes.find((mode) =>
            mode.button.classList.contains(modeName)
        );
        const button = this.toolsContainer.querySelector(`.${modeName}`);

        if (modeInstance && button) {
            this.deactivateButton(this.activeButton, this.activeTool); // Deactivate old
            this.activateButton(button, modeInstance); // Activate new
        }
    }
}

customElements.define("cesium-measure", MeasureToolbox);

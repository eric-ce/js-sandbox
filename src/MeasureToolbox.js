import * as Cesium from "cesium";
import { TwoPointsDistance } from "./lib/features/TwoPointsDistance.js";
import { Points } from "./lib/features/Points.js";
import { ThreePointsCurve } from "./lib/features/ThreePointsCurve.js";
import { Height } from "./lib/features/Height.js";
import { MultiDistance } from "./lib/features/MultiDistance.js";
import { Polygon } from "./lib/features/Polygon.js";
import { removeInputActions } from "./lib/helper/helper.js";

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
        // constructor(viewer) {
        super();
        this.attachShadow({ mode: "open" });

        this.toolsContainer = null;
        this.infoBox = null;
        this.nameOverlay = null;
        this.handler = null;
        this.clearButton = null;
        this.activeButton = null;
        this.activeTool = null;

        this._viewer = null;

        this.pointMode = null;

        this._records = {
            points: [],
            distances: [],
            curves: [],
            heights: [],
            "m-distance": [],
            polygons: [],
        };
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

    initialize() {
        this.handler = new Cesium.ScreenSpaceEventHandler(
            this.viewer.scene.canvas
        );

        // initialize all the measure modes, including its UI, and event listeners
        this.initializeMeasureModes();
    }
    /**
     * Initialize all the measure modes
     */
    async initializeMeasureModes() {
        this.setupButtons();

        this.createMeasureModeButton(
            new Points(
                this.viewer,
                this.handler,
                this.nameOverlay,
                this.updateRecords.bind(this, "points")
            ),
            "Points"
        );
        this.createMeasureModeButton(
            new TwoPointsDistance(
                this.viewer,
                this.handler,
                this.nameOverlay,
                this.updateRecords.bind(this, "distances")
            ),
            "Distance"
        );
        this.createMeasureModeButton(
            new ThreePointsCurve(
                this.viewer,
                this.handler,
                this.nameOverlay,
                this.updateRecords.bind(this, "curves")
            ),
            "Curve"
        );
        this.createMeasureModeButton(
            new Height(
                this.viewer,
                this.handler,
                this.nameOverlay,
                this.updateRecords.bind(this, "height")
            ),
            "Height"
        );
        this.createMeasureModeButton(
            new MultiDistance(
                this.viewer,
                this.handler,
                this.nameOverlay,
                this.updateRecords.bind(this, "m-distance")
            ),
            "Multi-Distance"
        );
        this.createMeasureModeButton(
            new Polygon(this.viewer, this.handler, this.nameOverlay),
            "Polygon"
        );

        this.setupClearButton();
    }

    /**
     * Sets up toolbar container, buttons, and style.
     */
    setupButtons() {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        this.toolsContainer = toolsContainer;

        // initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = "Tools";
        toolButton.addEventListener("click", () => {
            this.toggleTools();
        });
        toolsContainer.appendChild(toolButton);

        // initialize style of nameOverlay, the moving dot
        this.setupNameOverlay();

        // add style to the shadowRoot for this web component
        const style = document.createElement("style");
        style.textContent = `
            .toolbar{ 
                position:absolute;
                bottom: 6rem;
                left: 10rem;
                display: flex;
                }
            .toolbar button{
                font-family: "work sans", sans-serif;
                font-size: 14px;
                height: 2.45rem;
                padding: 0.5rem 1.472rem;
                margin: 0 5px;
                border-radius: 6rem;
                cursor: pointer;
                transition: all 0.2s ease-out;
            }
            .toolbar button.active {
                color: #000;
                fill: #000;
                background: #adf;
                border-color: #fff;
                box-shadow: 0 0 8px #fff;
            }
            .toolbar .measure-mode-button {
                /* Hide the buttons by default */
                display: none;
                opacity: 0;
                position: relative;
            }
            .toolbar .measure-mode-button.show {
                /* Show the buttons when the "tool" button is clicked */
                display: block;
                opacity: 1;
            }
            `;

        this.shadowRoot.appendChild(style);
        this.shadowRoot.appendChild(toolsContainer);
    }

    /**
     * toggle tools to show measure modes
     */
    toggleTools() {
        this.isToolsExpanded = !this.isToolsExpanded;
        const buttons = this.toolsContainer.querySelectorAll(
            ".measure-mode-button"
        );
        buttons.forEach((button, index) => {
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
        this.clearButton.className =
            "clear-button cesium-button measure-mode-button";
        this.clearButton.innerHTML = "Clear";

        this.toolsContainer.appendChild(this.clearButton);

        this.clearButton.addEventListener("click", () => {
            this.viewer.entities.removeAll();
            removeInputActions(this.handler);
            this.nameOverlay.style.display = "none";

            this.infoBox.remove();

            if (this.activeButton) {
                this.activeButton.classList.remove("active");
            }
        });
    }

    setupNameOverlay() {
        this.nameOverlay = document.createElement("div");
        this.nameOverlay.className = "backdrop";
        this.nameOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(this.nameOverlay);
    }

    setupInfoBox() {
        if (this.infoBox) {
            this.infoBox.remove();
        }

        this.infoBox = document.createElement("div");
        this.infoBox.className = "cesium-infoBox cesium-infoBox-visible";
        this.infoBox.style.width = "250px";
        this.infoBox.style.padding = "10px";

        // show different message to different mode
        const messageTitle = "How to use: <br><br>";
        const message1 = messageTitle + "Left Click: start measure";
        const message2 =
            messageTitle +
            "Left Click: start measure <br><br> Right Click: finish measure";
        if (
            this.activeButton &&
            (this.activeButton.classList.contains("multi-distance") ||
                this.activeButton.classList.contains("polygon"))
        ) {
            this.infoBox.innerHTML = message2;
        } else {
            this.infoBox.innerHTML = message1;
        }

        this.shadowRoot.appendChild(this.infoBox);
    }

    /**
     * Creates a measurement mode button.
     * @param {Object} toolInstance - The instance of the measurement tool.
     * @param {string} buttonText - The text to display on the button.
     */
    createMeasureModeButton(toolInstance, buttonText) {
        const button = document.createElement("button");
        const lowerCaseString = buttonText.toLowerCase();
        button.className = `${lowerCaseString} cesium-button measure-mode-button`;
        button.innerHTML = buttonText;

        button.addEventListener("click", () => {
            if (this.activeButton === button) {
                // if the click button the same as active button then deactivate it
                this.deactivateButton(button, toolInstance);
                // set state for the button
                this.activeButton = null;
                this.activeTool = null;

                this.infoBox && this.infoBox.remove();
            } else {
                // initialize button
                this.activeButton &&
                    this.deactivateButton(this.activeButton, this.activeTool);
                // activate button
                this.activateButton(button, toolInstance);
                // set state for the button and instance
                this.activeButton = button;
                this.activeTool = toolInstance;

                this.setupInfoBox();
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

    // log features for measure modes
    updateLogBox() {
        console.log("Updated records:", this.records);
    }

    /**
     * Updates records for the specified measure mode.
     * @param {string} mode - The measurement mode ('points', 'distances', etc.).
     * @param {Array} records - The updated records.
     */
    updateRecords(mode, records) {
        this._records[mode] = records;
        this.updateLogBox();
    }

    get records() {
        const nonEmptyRecords = {};
        for (const key in this._records) {
            if (Object.values(this._records[key]).length > 0) {
                nonEmptyRecords[key] = this._records[key];
            }
        }
        return nonEmptyRecords;
    }
}

customElements.define("measure-toolbox", MeasureToolbox);

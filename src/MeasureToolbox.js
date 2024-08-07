import * as Cesium from "cesium";
import { TwoPointsDistance } from "./lib/features/TwoPointsDistance.js";
import { TwoPointsDistanceP } from "./lib/features/TwoPointsDistanceP.js";
import { Points } from "./lib/features/Points.js";
import { ThreePointsCurve } from "./lib/features/ThreePointsCurve.js";
import { Height } from "./lib/features/Height.js";
import { MultiDistance } from "./lib/features/MultiDistance.js";
import { Polygon } from "./lib/features/Polygon.js";
import { Profile } from "./lib/features/Profile.js";
import { ProfileDistances } from "./lib/features/ProfileDistances.js";
import { removeInputActions } from "./lib/helper/helper.js";
import toolImg from "./assets/toolImg.svg";
import pointsImg from "./assets/pointsImg.svg";
import distanceImg from "./assets/distanceImg.svg";
import curveImg from "./assets/curveImg.svg";
import heightImg from "./assets/heightImg.svg";
import multiDImage from "./assets/multiDImg.svg";
import polygonImg from "./assets/polygonImg.svg";
import profileImg from "./assets/profileImg.svg";
import profileDistancesImg from "./assets/profileDistancesImg.svg";
import clearImg from "./assets/clearImg.svg"

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
        this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

        // initialize all the measure modes, including its UI, and event listeners
        this.initializeMeasureModes();
    }

    /**
     * Initialize all the measure modes
     */
    async initializeMeasureModes() {
        this.setupButtons();

        const modes = [
            {
                instance: new Points(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "points")),
                name: "Points",
                icon: pointsImg
            },
            {
                instance: new TwoPointsDistance(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "distances")),
                name: "Distance",
                icon: distanceImg
            },
            {
                instance: new TwoPointsDistanceP(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "distances")),
                name: "DistanceP",
                icon: distanceImg
            },
            {
                instance: new ThreePointsCurve(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "curves")),
                name: "Curve",
                icon: curveImg
            },
            {
                instance: new Height(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "height")),
                name: "Height",
                icon: heightImg
            },
            {
                instance: new MultiDistance(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "m-distance")),
                name: "Multi-Distances",
                icon: multiDImage
            },
            {
                instance: new Polygon(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "polygons")),
                name: "Polygon",
                icon: polygonImg
            },
            {
                instance: new Profile(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "profile")),
                name: "Profile",
                icon: profileImg
            },
            {
                instance: new ProfileDistances(this.viewer, this.handler, this.pointerOverlay, this.updateRecords.bind(this, "profile-distances")),
                name: "Profile-Distances",
                icon: profileDistancesImg
            },
        ];

        this.measureModes = modes.map(mode => mode.instance);

        modes.forEach(mode => {
            this.createMeasureModeButton(mode.instance, mode.name, mode.icon);
        });

        this.setupClearButton();

        this.setupButtonOverlay();

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
        toolButton.innerHTML = `<img src="${toolImg}" alt="tool" style="width: 30px; height: 30px;">`;
        toolButton.addEventListener("click", () => {
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
            .cesium-infoBox table{
                width: 100%;
            }
            .cesium-infoBox td{
                padding: 5px 0;
                border: none;
            }
            .cesium-infoBox{
                width: 250px;
                padding: 5px;
                font-size: 0.8rem;
            }
            .log-box{
                position: absolute; 
                top: 150px; 
                right: 0; 
                height: 250px; 
                overflow-y: auto; 
                width: 250px; 
                background: #303336; 
                opacity: 90%; 
                padding: 5px; 
                border-radius: 5px; 
                box-shadow: 0 0 10px #000; 
                z-index: 1000;
                color: #e6f8f8;
            }
            .info-panel td{
                border: 1px 0 solid #e6f8f8;
                font-size: 0.8rem;
            }
            `;
        this.shadowRoot.appendChild(style);
        this.shadowRoot.appendChild(toolsContainer);
    }

    /**
     * Creates a measurement mode button.
     * @param {Object} toolInstance - The instance of the measurement tool.
     * @param {string} buttonText - The text to display on the button.
     */
    createMeasureModeButton(toolInstance, buttonText, iconImg) {
        // setup buttons
        const button = document.createElement("button");
        const lowerCaseString = buttonText.toLowerCase();
        button.className = `${lowerCaseString} cesium-button measure-mode-button`;
        button.innerHTML = `<img src="${iconImg}" alt="${lowerCaseString}" style="width: 30px; height: 30px;">`;

        // setup button actions
        button.addEventListener("click", () => {
            this.setupLogBox();

            this.pointerOverlay.style.display = "none";

            // if the click button the same as active button then deactivate it
            if (this.activeButton === button) {
                this.deactivateButton(button, toolInstance);
                // set state for the button
                this.activeButton = null;
                this.activeTool = null;

                this.infoBox && this.infoBox.remove();
                this.logBox && this.logBox.remove();
            } else {
                // if the click button is not the active button
                // initialize button
                this.activeButton &&
                    this.deactivateButton(this.activeButton, this.activeTool);
                // activate button
                this.activateButton(button, toolInstance);
                // set state for the button and instance
                this.activeButton = button;
                this.activeTool = toolInstance;

                this.setupInfoBox();
                this.logBox && this.updateLogBox();
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

    /**
     * toggle tools to show measure modes
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
        this.clearButton.innerHTML = `<img src="${clearImg}" alt="clear" style="width: 30px; height: 30px;">`;

        this.toolsContainer.appendChild(this.clearButton);

        this.clearButton.addEventListener("click", () => {
            this.viewer.entities.removeAll();
            removeInputActions(this.handler);
            this.pointerOverlay.style.display = "none";

            // clear infobox
            this.infoBox && this.infoBox.remove();
            // clear logbox
            this.logBox && this.logBox.remove();

            this.measureModes.forEach(mode => {
                mode.resetValue && mode.resetValue();
            });

            if (this.activeButton) {
                this.activeButton.classList.remove("active");
                this.activeButton = null;
                this.activeTool = null;
            }
        });
    }

    setupButtonOverlay() {
        this.buttonOverlay = document.createElement("div");
        this.buttonOverlay.className = "button-overlay";
        this.buttonOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px 8px; display: none; background: white; border-radius: 5px; box-shadow: 0 0 10px #000; transition: 0.1s ease-in-out;";
        this.viewer.container.appendChild(this.buttonOverlay);

        // cesium container rectangle 
        const cesiumRect = this.viewer.container.getBoundingClientRect();

        this.shadowRoot.querySelectorAll(".measure-mode-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // set overlay to display
                this.buttonOverlay.style.display = "block";
                // get description of the button
                const description = button.querySelector("img")?.alt;
                this.buttonOverlay.innerHTML = `${description} mode`;
                // set position of the overlay
                this.buttonOverlay.style.left = e.pageX - cesiumRect.x + 'px';  // Position the overlay right of the cursor
                this.buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + 'px';
            });
            button.addEventListener("mouseout", () => {
                // set overlay to not display
                this.buttonOverlay.style.display = "none";
            });
        })
    }

    setupPointerOverlay() {
        this.pointerOverlay = document.createElement("div");
        this.pointerOverlay.className = "backdrop";
        this.pointerOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        this.viewer.container.appendChild(this.pointerOverlay);
    }

    setupInfoBox() {
        // remove infoBox if it exists
        if (this.infoBox) {
            this.infoBox.remove();
        }
        // create infoBox div
        this.infoBox = document.createElement("div");
        this.infoBox.className = "cesium-infoBox cesium-infoBox-visible";

        const infoBoxTable = document.createElement("table");

        // show different message to different mode
        const messageTitle = "How to use:";
        const message1 = "Left Click: start measure";
        const message2 = "Right Click: finish measure";
        // create table first row for the title
        infoBoxTable.appendChild(this.createRow(messageTitle));
        // create table rows for the messages
        if (this.activeButton &&
            (
                this.activeButton.classList.contains("multi-distances") ||
                this.activeButton.classList.contains("polygon") ||
                this.activeButton.classList.contains("profile-distances")
            )
        ) {
            // if the active button is multi-distance or polygon, show both messages
            infoBoxTable.appendChild(this.createRow(message1));
            infoBoxTable.appendChild(this.createRow(message2));
        } else {
            infoBoxTable.appendChild(this.createRow(message1));

        }

        this.infoBox.appendChild(infoBoxTable);
        this.shadowRoot.appendChild(this.infoBox);
    }

    setupLogBox() {
        if (this.logBox) {
            this.logBox.remove();
        }
        this.logBox = document.createElement("div");
        this.logBox.className = "log-box";

        const table = document.createElement("table");
        table.className = "info-panel";
        table.style.width = "100%";
        const title = this.createRow("Records");
        table.appendChild(title);

        this.logBox.appendChild(table);
        this.shadowRoot.appendChild(this.logBox);
    }

    updateLogBox() {
        const table = this.logBox.querySelector("table");
        table.innerHTML = ""; // Clear the table

        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.createRow("Records"));

        this._records.forEach(record => {
            const key = Object.keys(record)[0];
            const recordData = record[key];

            if (key === "points") {
                const action = recordData.add ? "add" : "remove";
                const { latitude, longitude, height } = recordData[action];
                fragment.appendChild(this.createRow(`${key}: ${action}: lat: ${latitude}, long: ${longitude}, height: ${height}`));
            } else if (key === "m-distance") {
                const { distances, totalDistance } = recordData;
                fragment.appendChild(this.createRow(`${key}: distances: ${distances}`));
                fragment.appendChild(this.createRow(`${key}: totalDistance: ${totalDistance}`));
            } else {
                fragment.appendChild(this.createRow(`${key}: ${recordData}`));
            }
        });

        table.appendChild(fragment);
    }

    createRow(value) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.style.borderBottom = "1px solid white";
        cell.innerHTML = value;
        row.appendChild(cell);

        return row;
    }

    updateRecords(mode, records) {
        this._records.push({ [mode]: records });
        this.updateLogBox(); // Ensure the log box is updated every time records change
    }
}

customElements.define("measure-toolbox", MeasureToolbox);

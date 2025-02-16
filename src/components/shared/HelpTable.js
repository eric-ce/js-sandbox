// src/components/shared/HelpTable.js
import { makeDraggable } from '../../lib/helper/helper.js'; // adjust the path as needed
import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { helpBoxIcon } from '../../assets/icons.js';

export class HelpTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this._cesiumStyle = null; // shared cesium style, to be set via property

        // flags
        this.helpVisible = false;

        // help table messages of instructions 
        const multiDistancesInstructions = [
            "Left Click to start measure",
            "Right Click to finish measure",
            "Hold Left Click to drag point",
            "Left Click on label to edit",
            "Double Left Click on line to add line",
            "Middle Click on point to remove line segment",
            "Middle Click on line to remove line set",
            "Left Click on first or last point to continue measure",
        ];

        // Define default instruction messages keyed by mode.
        this.modeMessages = {
            "default": [
                "Left Click to start measure",
                "Hold Left Click to drag point",
                "Left Click on label to edit"
            ],
            "fireTrail": [...multiDistancesInstructions],
            "Multi-Distances": [...multiDistancesInstructions],
            "Multi-Distances-Clamped": [...multiDistancesInstructions],
            "Picker": [
                "Left Click to pick annotation to switch modes"
            ],
            "Polygon": [
                "Left Click to start measure",
                "Right Click to finish measure",
                "Hold Left Click to drag point",
                "Left Click on label to edit"
            ],
            "Profile": [
                "Left Click to start measure",
                "Hold Left Click to drag point",
                "Left Click on label to edit",
                "Hover on chart to show point on the map",
                "Hover on point to show on chart"
            ],
            "Profile-Distances": [
                ...multiDistancesInstructions,
                "Left Click on first or last point to continue measure",
                "Hover on chart to show point on the map",
                "Hover on point to show on chart"
            ]
        };

        // help table header
        this.header = "How to use:";

        // UI elements
        this.helpBox = null;
        this.table = null;
        this.helpIconButton = null;

        // create help table UI
        this._createUI();
    }

    // use Cesium style
    connectedCallback() {
        // link cesium package default style
        this._cesiumStyle = document.createElement("link");
        this._cesiumStyle.rel = "stylesheet";
        this._cesiumStyle.href = `/Widgets/widgets.css`;
        this.shadowRoot.appendChild(this._cesiumStyle);
    }

    // Create the basic UI structure.
    _createUI() {
        // Button that toggles the help box
        this.helpIconButton = document.createElement("button");
        // set button style
        this.helpIconButton.className = "cesium-button toggle-table-button";
        this.helpIconButton.style.position = "absolute";
        this.helpIconButton.style.top = "70px";
        this.helpIconButton.style.left = "calc(100% - 45px)";
        // set the icon as button image
        this.helpIconButton.innerHTML = `<img src="${helpBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        // set aria attributes
        this.helpIconButton.setAttribute("type", "button");
        this.helpIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this.helpIconButton.setAttribute("aria-pressed", "false");

        // Toggle the help box on click
        this.helpIconButton.addEventListener("click", () => {
            this.showHelpBox();
        });
        // Append the button to the shadow DOM
        this.shadowRoot.appendChild(this.helpIconButton);

        // Create the container (the help box)
        this.helpBox = document.createElement("div");
        this.helpBox.className = "cesium-infoBox cesium-infoBox-visible helpBox-expanded";
        this.helpBox.style.position = "absolute";
        this.helpBox.style.top = "70px";
        this.helpBox.style.left = "calc(100% - 260px)";
        this.helpBox.style.display = "none"; // hidden by default

        // Add click handler to close help box when clicked
        this.helpBox.addEventListener("click", () => {
            this.hideHelpBox();
        });

        // Create a table element for the instructions
        this.table = document.createElement("table");
        this.table.style.display = "table";
        this.helpBox.appendChild(this.table);
        // Append the container to the shadow DOM
        this.shadowRoot.appendChild(this.helpBox);

        // Apply shared styles
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        const viewerContainer = document.getElementById("cesiumContainer");
        // Make the help box draggable
        makeDraggable(this.helpBox, viewerContainer, (newTop, newLeft) => {
            this.helpBox.style.top = `${newTop}px`;
            this.helpBox.style.left = `${newLeft}px`;
        });
        // Make the help icon draggable
        makeDraggable(this.helpIconButton, viewerContainer, (newTop, newLeft) => {
            this.helpIconButton.style.top = `${newTop}px`;
            this.helpIconButton.style.left = `${newLeft}px`;
        });

        // Set the default content
        this.updateContent("default");
    }

    // Show the help box and hide the help icon
    showHelpBox() {
        this.helpVisible = true;
        this.helpBox.style.display = "block";
        this.helpIconButton.style.display = "none";
        this.helpIconButton.setAttribute("aria-pressed", "true");
    }

    // Hide the help box and show the help icon
    hideHelpBox() {
        this.helpVisible = false;
        this.helpBox.style.display = "none";
        this.helpIconButton.style.display = "block";
        this.helpIconButton.setAttribute("aria-pressed", "false");
    }

    /**
     * Updates the table content based on the mode key.
     * @param {string} modeKey - One of the keys from modeMessages.
     */
    updateContent(modeKey) {
        const messages = this.modeMessages[modeKey] || this.modeMessages.default;
        // Clear existing rows
        this.table.innerHTML = "";
        // Add header row
        this.table.appendChild(this._createRow(this.header));
        // Add a row for each message
        messages.forEach(msg => {
            this.table.appendChild(this._createRow(msg));
        });
    }

    // Creates a new table row with a single cell containing the provided text.
    _createRow(text) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.style.borderBottom = "1px solid white";
        cell.textContent = text;
        row.appendChild(cell);
        return row;
    }
}

customElements.define("help-table", HelpTable);
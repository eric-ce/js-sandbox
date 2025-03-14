// src/components/shared/HelpTable.js
import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { helpBoxIcon } from '../../assets/icons.js';

export class HelpTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // UI elements
        this._fragment = document.createDocumentFragment();
        this._isExpanded = false;
        this._helpVisible = false;
        this._helpBox = null;
        this._table = null;
        this._helpIconButton = null;

        // Find the viewer container
        const mapCesium = document.querySelector("map-cesium");
        this.viewerContainer = mapCesium && mapCesium.shadowRoot.getElementById("cesiumContainer");

        // Instruction messages
        const multiDistancesInstructions = [
            "Left Click to start measure",
            "Left Click on label to edit",
            "Left Click on first or last point to continue measure",
            "Hold Left Click to drag point",
            "Right Click to finish measure",
            "Double Left Click on line to add line",
            "Middle Click on point to remove line segment",
            "Middle Click on line to remove line set",
        ];
        this._modeMessages = {
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
                "Hover on chart to show point on the map",
                "Hover on point to show on chart"
            ]
        };

        // Header text
        this._header = "How to use:";

        // Create UI elements
        this._createUI();
    }

    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // Set the initial transform.
        this._updatePositions();
    }

    /**
     * Updates the help table initial position based on viewer dimensions
     */
    _updatePositions() {
        const rect = this.viewerContainer.getBoundingClientRect();
        const container = this._helpTableContainer.getBoundingClientRect();
        if (!rect || !this._helpTableContainer || rect.width === 0 || container.width === 0) console.error("invalid rect")

        // const x = (rect.width - container.width) || 0;
        const x = rect.width - 250;
        const y = (rect.height - container.height) || 260;

        this._helpTableContainer.style.transform = `translate(${x}px, ${-y}px)`;
    }

    /**
     * Creates the UI structure for the help table
     */
    _createUI() {
        this._setupHelpTableContainer();

        this._setupHelpIcon();

        this._setupHelpBox();

        // Set default content.
        this.updateContent("default");
    }

    /**
     * Creates and configures the container element
     */
    _setupHelpTableContainer() {
        this._helpTableContainer = document.createElement("div");
        this._helpTableContainer.classList.add("help-table-container");
        this._helpTableContainer.style.position = "absolute";

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._helpTableContainer);
    }

    _setupHelpIcon() {
        // Create a button to toggle the help box.
        this._helpIconButton = document.createElement("button");
        this._helpIconButton.className = "annotate-button animate-on-show visible";
        this._helpIconButton.style.position = "absolute";
        this._helpIconButton.innerHTML = `<img src="${helpBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._helpIconButton.setAttribute("type", "button");
        this._helpIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this._helpIconButton.setAttribute("aria-pressed", "false");

        this._helpIconButton.addEventListener("click", () => {
            this._showHelpBox();
        });
        // Append to container initially
        this._helpTableContainer.appendChild(this._helpIconButton);
    }

    /**
     * Creates the help box and table elements
     */
    _setupHelpBox() {
        // Create the help box container.
        this._helpBox = document.createElement("div");
        this._helpBox.className = "info-box help-box hidden";
        this._helpBox.style.position = "absolute";

        this._helpBox.addEventListener("click", () => {
            this._hideHelpBox();
        });

        // Create a table for the help instructions.
        this._table = document.createElement("table");
        this._table.style.display = "table";
        // Append table to help box
        this._helpBox.appendChild(this._table);

        // Store in fragment initially
        this._fragment.appendChild(this._helpBox);
    }

    /**
     * Shows the help box and hides the icon
     */
    _showHelpBox() {
        // Update state
        this._isExpanded = true;

        this._helpBox.classList.add("visible");
        this._helpBox.classList.remove("hidden");

        // Store icon in fragment
        if (this._helpIconButton.parentNode === this._helpTableContainer) {    // ensure icon is in the container
            this._fragment.appendChild(this._helpIconButton);
        }

        // Move helpBox to container if it's in the fragment
        if (this._helpBox.parentNode !== this._helpTableContainer) {   // ensure helpBox is not already in the container
            this._helpTableContainer.appendChild(this._helpBox);

            // set help table container width and height for drag position usage
            this._updateContainerSize();
        }

        // Update ARIA state
        this._helpIconButton.setAttribute("aria-pressed", "true");
    }

    /**
     * Hides the help box and shows the icon
     */
    _hideHelpBox() {
        // Update state
        this._isExpanded = false;

        // Update element classes
        this._helpBox.classList.add("hidden");
        this._helpBox.classList.remove("visible");

        // Store helpBox in fragment
        if (this._helpBox.parentNode === this._helpTableContainer) {  // ensure helpBox is in the container
            this._fragment.appendChild(this._helpBox);
        }

        // Move icon to container if it's in the fragment
        if (this._helpIconButton.parentNode !== this._helpTableContainer) { // ensure icon is not already in the container
            this._helpTableContainer.appendChild(this._helpIconButton);

            // set help table container width and height for drag position usage
            this._updateContainerSize();
        }

        this._helpIconButton.classList.add("visible");
        this._helpIconButton.classList.remove("hidden");

        // Update ARIA state
        this._helpIconButton.setAttribute("aria-pressed", "false");
    }

    /**
     * Updates container size based on expanded state
     */
    _updateContainerSize() {
        const elementToMeasure = this._isExpanded ? this._helpBox : this._helpIconButton;
        if (elementToMeasure && elementToMeasure.isConnected) {
            const rect = elementToMeasure.getBoundingClientRect();
            this._helpTableContainer.style.width = `${rect.width}px`;
            this._helpTableContainer.style.height = `${rect.height}px`;

            this._helpTableContainer.dataset.state = this._isExpanded ? "expanded" : "collapsed";
        } else {
            // Fallback dimensions if measurement fails
            this._helpTableContainer.style.width = "45px";
            this._helpTableContainer.style.height = "40px";
        }
    }

    /**
     * Updates the help table content based on the mode key
     * @param {String} modeKey - The key for the mode to display instructions for
     */
    updateContent(modeKey) {
        const messages = this._modeMessages[modeKey] || this._modeMessages.default;
        this._table.innerHTML = "";
        this._table.appendChild(this._createRow(this._header));
        messages.forEach(msg => {
            this._table.appendChild(this._createRow(msg));
        });
    }

    /**
     * Creates a row element with the given text
     * @param {String} text - The text to display in the row
     * @returns {HTMLElement} - The created row element
     */
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
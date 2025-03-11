// src/components/shared/HelpTable.js
import { makeDraggable } from '../../lib/helper/helper.js'; // adjust the path as needed
import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { helpBoxIcon } from '../../assets/icons.js';

export class HelpTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Flags
        this.helpVisible = false;

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
                "Hover on chart to show point on the map",
                "Hover on point to show on chart"
            ]
        };

        // Header text
        this.header = "How to use:";

        // UI elements
        this.helpBox = null;
        this.table = null;
        this.helpIconButton = null;

        // Get the Cesium viewer container from the map-cesium web component.
        const mapCesium = document.querySelector("map-cesium");
        this.viewerContainer = mapCesium && mapCesium.shadowRoot.getElementById("cesiumContainer");

        // Create UI elements
        this._createUI();
    }

    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // Set the initial transform.
        this.updatePositions();

        // Set up observers to update the position when the container changes.
        // this.setupObservers();

        // Make the help table draggable within the Cesium container.
        // if (this.viewerContainer) {
        //     makeDraggable(
        //         this,
        //         this.viewerContainer,
        //         (newTop, newLeft, containerRect) => {
        //             // This callback is optional.
        //             console.log("HelpTable moved to:", { newTop, newLeft });
        //         },
        //         (isDragging) => {
        //             console.log("Dragging state changed:", isDragging);
        //         }
        //     );
        // }
        // makeDraggable(this, this.viewerContainer);
    }

    disconnectedCallback() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.mutationObserver) this.mutationObserver.disconnect();
    }

    updatePositions() {
        const rect = this.viewerContainer.getBoundingClientRect();
        const container = this._helpTableContainer.getBoundingClientRect();
        if (!rect || !this._helpTableContainer || rect.width === 0 || container.width === 0) console.error("invalid rect")

        const x = (rect.width - container.width - 15) || 0;
        const y = (rect.height - container.height) || 260;

        this._helpTableContainer.style.transform = `translate(${x}px, ${-y}px)`;
    }

    setupObservers() {
        const navigatorContainer = document.querySelector('.navigator-container');
        if (!navigatorContainer) return;

        // ResizeObserver to update position on dimension changes.
        this.resizeObserver = new ResizeObserver(() => {
            this.updatePositions();
        });
        this.resizeObserver.observe(navigatorContainer);

        // MutationObserver to update position on DOM changes.
        this.mutationObserver = new MutationObserver(() => {
            this.updatePositions();
        });
        this.mutationObserver.observe(navigatorContainer, {
            childList: true,
            attributes: true,
            subtree: true
        });
    }

    // Create the UI for the help table.
    _createUI() {
        this._helpTableContainer();

        this._setupHelpIcon();

        this._setupHelpBox();

        // Set default content.
        this.updateContent("default");
    }
    _helpTableContainer() {
        this._helpTableContainer = document.createElement("div");
        this._helpTableContainer.classList.add("help-table-container", "collapsed");
        this._helpTableContainer.style.position = "absolute";
        this._helpTableContainer.style.width = "auto";
        this._helpTableContainer.style.height = "auto";
        this.shadowRoot.appendChild(this._helpTableContainer);
    }

    _setupHelpIcon() {
        // Create a button to toggle the help box.
        this.helpIconButton = document.createElement("button");
        this.helpIconButton.className = "annotate-button animate-on-show visible";
        this.helpIconButton.style.position = "absolute";

        this.helpIconButton.innerHTML = `<img src="${helpBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this.helpIconButton.setAttribute("type", "button");
        this.helpIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this.helpIconButton.setAttribute("aria-pressed", "false");

        this.helpIconButton.addEventListener("click", () => {
            this._showHelpBox();
        });
        this._helpTableContainer.appendChild(this.helpIconButton);
    }

    _setupHelpBox() {
        // Create the help box container.
        this.helpBox = document.createElement("div");
        this.helpBox.className = "info-box help-box hidden";
        this._helpTableContainer.appendChild(this.helpBox);
        this.helpBox.addEventListener("click", () => {
            this._hideHelpBox();
        });

        // Create a table for the help instructions.
        this.table = document.createElement("table");
        this.table.style.display = "table";
        this.helpBox.appendChild(this.table);
    }

    _showHelpBox() {
        this.helpVisible = true;
        this.helpBox.classList.add("visible");
        this.helpBox.classList.remove("hidden");
        this.helpIconButton.classList.add("hidden");
        this.helpIconButton.classList.remove("visible");
        this.helpIconButton.setAttribute("aria-pressed", "true");
    }

    _hideHelpBox() {
        this.helpVisible = false;
        this.helpBox.classList.add("hidden");
        this.helpBox.classList.remove("visible");
        this.helpIconButton.classList.add("visible");
        this.helpIconButton.classList.remove("hidden");
        this.helpIconButton.setAttribute("aria-pressed", "false");
    }

    updateContent(modeKey) {
        const messages = this.modeMessages[modeKey] || this.modeMessages.default;
        this.table.innerHTML = "";
        this.table.appendChild(this._createRow(this.header));
        messages.forEach(msg => {
            this.table.appendChild(this._createRow(msg));
        });
    }

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
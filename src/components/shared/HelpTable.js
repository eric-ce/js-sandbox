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

        // Initial position
        this.position = {
            initialX: 0,
            initialY: 0
        };

        // Create UI elements
        this._createUI();
    }

    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // Use transform-based positioning only. Remove any bottom/left settings.
        this.style.position = "absolute";
        this.style.bottom = "auto";
        this.style.left = "auto";

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
        if (!this.viewerContainer) return;
        const containerRect = this.viewerContainer.getBoundingClientRect();

        // Get help table's dimensions.
        const helpTable = this.shadowRoot.querySelector(".help-box");
        if (!helpTable) return;
        const helpTableRect = helpTable.getBoundingClientRect();
        const tx = containerRect.right - helpTableRect.width;
        const ty = containerRect.top - 650;
        // Set transform and store the initial offset in dataset.
        this.style.transform = `translate(${tx}px, ${ty}px)`;
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
        // Create a button to toggle the help box.
        this.helpIconButton = document.createElement("button");
        this.helpIconButton.className = "annotate-button animate-on-show visible";
        this.helpIconButton.style.position = "absolute";

        this.helpIconButton.innerHTML = `<img src="${helpBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this.helpIconButton.setAttribute("type", "button");
        this.helpIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this.helpIconButton.setAttribute("aria-pressed", "false");

        this.helpIconButton.addEventListener("click", () => {
            this.showHelpBox();
        });
        this.shadowRoot.appendChild(this.helpIconButton);

        // Create the help box container.
        this.helpBox = document.createElement("div");
        this.helpBox.className = "info-box help-box hidden";
        this.helpBox.style.position = "absolute";
        // Remove conflicting bottom/left rules.
        this.helpBox.style.bottom = "auto";
        this.helpBox.style.left = "auto";

        this.helpBox.addEventListener("click", () => {
            this.hideHelpBox();
        });

        // Create a table for the help instructions.
        this.table = document.createElement("table");
        this.table.style.display = "table";
        this.helpBox.appendChild(this.table);

        this.shadowRoot.appendChild(this.helpBox);

        // Set default content.
        this.updateContent("default");
    }

    showHelpBox() {
        this.helpVisible = true;
        this.helpBox.classList.add("visible");
        this.helpBox.classList.remove("hidden");
        this.helpIconButton.classList.add("hidden");
        this.helpIconButton.classList.remove("visible");
        this.helpIconButton.setAttribute("aria-pressed", "true");
    }

    hideHelpBox() {
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
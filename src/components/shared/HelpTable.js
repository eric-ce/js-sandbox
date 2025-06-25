import { sharedStyleSheet } from '../../styles/sharedStyle.js'
import { helpBoxIcon } from '../../assets/icons.js';
import { createCloseButton, makeDraggable } from '../../lib/helper/helper.js';

export class HelpTable extends HTMLElement {
    _dragCleanup = null;

    _helpBox = null; // The help box that contains the help table
    _table = null;
    _helpIconButton = null;

    _isExpanded = false;
    _helpVisible = false;

    _modeId = null;
    _container = null; // The map html container where the help table will be placed

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Initialize the document fragment for DOM manipulation
        this._fragment = document.createDocumentFragment();

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
            "multi_distances": [...multiDistancesInstructions],
            "multi_distances_clamped": [...multiDistancesInstructions],
            "picker": [
                "Left Click to pick annotation to switch modes"
            ],
            "polygon": [
                "Left Click to start measure",
                "Right Click to finish measure",
                "Hold Left Click to drag point",
                "Left Click on label to edit"
            ],
            "profile": [
                "Left Click to start measure",
                "Hold Left Click to drag point",
                "Left Click on label to edit",
                "Hover on chart to show point on the map",
                "Hover on point to show on chart"
            ],
            "profile-Distances": [
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

    /*****************************
     * GETTER AND SETTER METHODS *
     *****************************/
    get container() {
        return this._container
    }

    set container(container) {
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }

        this._container = container;
    }

    get modeId() {
        return this._modeId;
    }

    set modeId(modeId) {
        this._modeId = modeId;

        if (this._container) {
            // Update the content based on the modeId
            this.updateContent(modeId);
        }
    }


    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];
    }

    disconnectedCallback() {
        // Clean up event listeners and references
        this._destroyHelpTable();
    }


    /***************
     * UI CREATION *
     ***************/
    /**
     * Creates the UI structure for the help table
     */
    _createUI() {
        this._createHelpTableContainer();

        this._createHelpIcon();

        this._createHelpBox();

        // Set default content
        this.updateContent("default");
    }

    /**
     * Creates and configures the container element
     */
    _createHelpTableContainer() {
        this._helpTableContainer = document.createElement("div");
        this._helpTableContainer.classList.add("help-table-container");
        Object.assign(this._helpTableContainer.style, {
            position: "absolute",
            top: "0",
            left: "0",
            zIndex: "1000", // Ensure it appears above other elements
            transform: "translate(0px, 0px)",
        });

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._helpTableContainer);
    }

    _createHelpIcon() {
        // Create a button to toggle the help box.
        this._helpIconButton = document.createElement("button");
        this._helpIconButton.className = "annotate-button animate-on-show visible";
        this._helpIconButton.style.position = "absolute";
        this._helpIconButton.innerHTML = `<img src="${helpBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._helpIconButton.setAttribute("type", "button");
        this._helpIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this._helpIconButton.setAttribute("aria-pressed", "false");

        this._helpIconButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showHelpBox();
        });
        // Append to container initially
        this._helpTableContainer.appendChild(this._helpIconButton);
    }

    /**
     * Creates the help box and table elements
     */
    _createHelpBox() {
        // Create the help box container.
        this._helpBox = document.createElement("div");
        this._helpBox.className = "info-box help-box hidden";
        this._helpBox.style.position = "absolute";

        this._helpBox.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._hideHelpBox();
        });

        // Create a table for the help instructions.
        this._table = document.createElement("table");
        this._table.style.display = "table";
        this._table.style.width = "100%";
        this._table.style.paddingTop = "5px";
        // Append table to help box
        this._helpBox.appendChild(this._table);

        // Create close button for the help box
        const closeButton = createCloseButton({
            color: "#edffff",
            top: "2px",
            right: "0px",
            click: (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._destroyHelpTable();
            }
        });
        this._helpBox.appendChild(closeButton); // Add close button to help box

        // Store in fragment initially
        this._fragment.appendChild(this._helpBox);
    }


    /****************
     * TOGGLE LOGIC *
     ****************/
    /**
     * Shows the help box and hides the icon
     */
    _showHelpBox() {
        // Update state
        this._isExpanded = true;

        this._helpBox.classList.add("visible");
        this._helpBox.classList.remove("hidden");

        // Store icon in fragment
        if (this._helpIconButton.parentNode === this._helpTableContainer) {
            this._fragment.appendChild(this._helpIconButton);
        }

        // Move helpBox to container if it's in the fragment
        if (this._helpBox.parentNode !== this._helpTableContainer) {
            this._helpTableContainer.appendChild(this._helpBox);
            // set help table container width and height for drag position usage
            this._updateContainerSize();
        }
        // Only constrain to bounds if expanded table exceeds container
        requestAnimationFrame(() => {
            this._constrainToContainer();
        });
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

    /**********************************
     * UPDATE POSITION AND DIMENSIONS *
     **********************************/
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
     * One-time positioning adjustment if expanded table exceeds container bounds
     * @private
     */
    _constrainToContainer() {
        if (!this._container || !this._helpTableContainer) return;

        const containerRect = this._container.getBoundingClientRect();
        const helpTableRect = this._helpTableContainer.getBoundingClientRect();

        if (containerRect.width === 0 || helpTableRect.width === 0) return;

        // Get current position
        const style = window.getComputedStyle(this._helpTableContainer);
        const transform = style.transform;
        let currentX = 0, currentY = 0;

        if (transform && transform !== 'none') {
            // Handle matrix format first (what browser returns)
            const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
            if (matrixMatch) {
                const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 6) {
                    currentX = values[4]; // translateX in matrix
                    currentY = values[5]; // translateY in matrix
                }
            } else {
                // Fallback to translate format
                const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if (translateMatch) {
                    currentX = parseFloat(translateMatch[1]) || 0;
                    currentY = parseFloat(translateMatch[2]) || 0;
                }
            }
        }

        // Calculate max allowed position
        const maxX = containerRect.width - helpTableRect.width;
        const maxY = containerRect.height - helpTableRect.height;

        // Only reposition if out of bounds
        const newX = Math.max(0, Math.min(currentX, maxX));
        const newY = Math.max(0, Math.min(currentY, maxY));

        // Apply correction only if needed
        if (newX !== currentX || newY !== currentY) {
            this._helpTableContainer.style.transform = `translate(${newX}px, ${newY}px)`;
        }
    }

    /**
     * Enables dragging functionality
     * Should be called AFTER _updatePositions() for proper initialization
     * @private
     */
    _enableDragging() {
        if (!this._helpTableContainer || !this._container) return;

        this._dragCleanup = makeDraggable(this._helpTableContainer, this._container);
    }

    /**
     * Updates the help table initial position based on viewer dimensions
     */
    _updatePositions() {
        const containerRect = this.container.getBoundingClientRect();
        const helpTableContainer = this._helpTableContainer.getBoundingClientRect();
        if (!containerRect || !this._helpTableContainer || containerRect.width === 0 || helpTableContainer.width === 0) return;

        const x = containerRect.width - helpTableContainer.width - 5;
        const y = 130;

        this._helpTableContainer.style.transform = `translate(${x}px, ${y}px)`;
    }


    /***************
     * TABLE LOGIC *
     ***************/
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


    /*********
     * RESET *
     *********/
    _destroyHelpTable() {
        // this._fragment.remove();
        // this._helpTableContainer.remove();
        this.remove();

        this._container = null;
        this._helpBox = null;
        this._table = null;
        this._helpIconButton = null;
        this._helpTableContainer = null;

        this._modeMessages = null;
        this._header = null;

        this._fragment = null;

        this.shadowRoot.innerHTML = ""; // Clear the shadow DOM
        this.shadowRoot.adoptedStyleSheets = []; // Clear the adopted stylesheets
        this._isExpanded = false;
        this._helpVisible = false;

        // Clean up dragging
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }
    }
}

customElements.define("help-table", HelpTable);
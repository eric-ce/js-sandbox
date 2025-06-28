import { sharedStyleSheet } from '../../styles/sharedStyle.js'
import { instructionsBoxIcon } from '../../assets/icons.js';
import { createCloseButton, createExpandCollapseButton, makeDraggable } from '../../lib/helper/helper.js';

export class InstructionsTable extends HTMLElement {
    // External references
    /** @type {string} */
    _modeId = null;
    /** @type {HTMLDivElement} */
    _container = null; // The map html container where the instructions table will be placed

    // Flags and state
    /** @type {boolean} */
    _isExpanded = false;

    // Table related variables
    /** @type {HTMLDivElement} */
    _instructionsBox = null; // The instructions box that contains the instructions table
    /** @type {HTMLTableElement} */
    _table = null;
    /** @type {HTMLButtonElement} */
    _instructionsIconButton = null;
    /** @type {DocumentFragment} */
    _fragment = null;
    /** @type {HTMLDivElement} */
    _instructionsTableContainer = null;
    /** @type {string} */
    _header = null;
    /** @type {Object.<string, string[]>} */
    _modeMessages = null;

    // Events
    /** @type {function(): void} */
    _dragCleanup = null;
    /** @type {function(): void} */
    _closeButtonCleanup;
    /** @type {function(): void} */
    _expandCollapseButtonCleanup;

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
        this._destroyInstructionsTable();
    }


    /***************
     * UI CREATION *
     ***************/
    /**
     * Creates the UI structure for the instructions table
     */
    _createUI() {
        this._createInstructionTableContainer();

        this._createInstructionsIcon();

        this._createInstructionsBox();

        // Set default content
        this.updateContent("default");
    }

    /**
     * Creates and configures the container element
     */
    _createInstructionTableContainer() {
        this._instructionsTableContainer = document.createElement("div");
        this._instructionsTableContainer.classList.add("instructions-table-container");
        Object.assign(this._instructionsTableContainer.style, {
            position: "absolute",
            top: "0",
            left: "0",
            zIndex: "1000", // Ensure it appears above other elements
            transform: "translate(0px, 0px)",
        });

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._instructionsTableContainer);
    }

    _createInstructionsIcon() {
        // Create a button to toggle the instructions box.
        this._instructionsIconButton = document.createElement("button");
        this._instructionsIconButton.className = "annotate-button animate-on-show visible";
        this._instructionsIconButton.style.position = "absolute";
        this._instructionsIconButton.innerHTML = `<img src="${instructionsBoxIcon}" alt="instructions box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._instructionsIconButton.setAttribute("type", "button");
        this._instructionsIconButton.setAttribute("aria-label", "Toggle box for instructions");
        this._instructionsIconButton.setAttribute("aria-pressed", "false");

        this._instructionsIconButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showInstructionsBox();
        });
        // Append to container initially
        this._instructionsTableContainer.appendChild(this._instructionsIconButton);
    }

    /**
     * Creates the instructions box and table elements
     */
    _createInstructionsBox() {
        // -- Create the instructions box container --
        this._instructionsBox = document.createElement("div");
        this._instructionsBox.className = "info-box instructions-box hidden";
        this._instructionsBox.style.position = "absolute";

        // -- Create a table -- 
        this._table = document.createElement("table");
        this._table.style.display = "table";
        this._table.style.width = "100%";
        this._table.style.marginTop = "7px";
        this._table.style.borderCollapse = "collapse";
        // Append table to instructions box
        this._instructionsBox.appendChild(this._table);

        // -- Create close button for the instructions box --
        const { button: closeButton, cleanup: closeButtonCleanup } = createCloseButton({
            color: "#edffff",
            clickCallback: () => {
                this._destroyInstructionsTable();
            }
        });
        this._closeButtonCleanup = closeButtonCleanup; // Store cleanup function
        this._instructionsBox.appendChild(closeButton); // Add close button to instructions box

        // -- Create expand/collapse button for the instructions box --
        const { button: expandCollapseButton, cleanup: expandCollapseCleanup } = createExpandCollapseButton({
            color: "#edffff",
            right: "22px",
            clickCallback: () => {
                this._hideInstructionsBox();
                expandCollapseButton.style.transform = "scale(1.0)"; // Reset scale on collapse 
            }
        });
        this._expandCollapseButtonCleanup = expandCollapseCleanup; // Store cleanup function
        this._instructionsBox.appendChild(expandCollapseButton); // Add expand/collapse button to instructions box

        // Store in fragment initially
        this._fragment.appendChild(this._instructionsBox);
    }


    /****************
     * TOGGLE LOGIC *
     ****************/
    /**
     * Shows the instructions box and hides the icon
     */
    _showInstructionsBox() {
        // Update state
        this._isExpanded = true;

        this._instructionsBox.classList.add("visible");
        this._instructionsBox.classList.remove("hidden");

        // Store icon in fragment
        if (this._instructionsIconButton.parentNode === this._instructionsTableContainer) {
            this._fragment.appendChild(this._instructionsIconButton);
        }

        // Move instructionsBox to container if it's in the fragment
        if (this._instructionsBox.parentNode !== this._instructionsTableContainer) {
            this._instructionsTableContainer.appendChild(this._instructionsBox);
            // set instructions table container width and height for drag position usage
            this._updateContainerSize();
        }
        // Only constrain to bounds if expanded table exceeds container
        requestAnimationFrame(() => {
            this._constrainToContainer();
        });
        // Update ARIA state
        this._instructionsIconButton.setAttribute("aria-pressed", "true");
    }

    /**
     * Hides the instructions box and shows the icon
     */
    _hideInstructionsBox() {
        // Update state
        this._isExpanded = false;

        // Update element classes
        this._instructionsBox.classList.add("hidden");
        this._instructionsBox.classList.remove("visible");

        // Store instructionsBox in fragment
        if (this._instructionsBox.parentNode === this._instructionsTableContainer) {  // ensure instructionsBox is in the container
            this._fragment.appendChild(this._instructionsBox);
        }

        // Move icon to container if it's in the fragment
        if (this._instructionsIconButton.parentNode !== this._instructionsTableContainer) { // ensure icon is not already in the container
            this._instructionsTableContainer.appendChild(this._instructionsIconButton);

            // set instructions table container width and height for drag position usage
            this._updateContainerSize();
        }

        this._instructionsIconButton.classList.add("visible");
        this._instructionsIconButton.classList.remove("hidden");

        // Update ARIA state
        this._instructionsIconButton.setAttribute("aria-pressed", "false");
    }

    /**********************************
     * UPDATE POSITION AND DIMENSIONS *
     **********************************/
    /**
     * Updates container size based on expanded state
     */
    _updateContainerSize() {
        const elementToMeasure = this._isExpanded ? this._instructionsBox : this._instructionsIconButton;
        if (elementToMeasure && elementToMeasure.isConnected) {
            const rect = elementToMeasure.getBoundingClientRect();
            this._instructionsTableContainer.style.width = `${rect.width}px`;
            this._instructionsTableContainer.style.height = `${rect.height}px`;

            this._instructionsTableContainer.dataset.state = this._isExpanded ? "expanded" : "collapsed";
        } else {
            // Fallback dimensions if measurement fails
            this._instructionsTableContainer.style.width = "45px";
            this._instructionsTableContainer.style.height = "40px";
        }
    }

    /**
     * One-time positioning adjustment if expanded table exceeds container bounds
     * @private
     */
    _constrainToContainer() {
        if (!this._container || !this._instructionsTableContainer) return;

        const containerRect = this._container.getBoundingClientRect();
        const instructionsTableRect = this._instructionsTableContainer.getBoundingClientRect();

        if (containerRect.width === 0 || instructionsTableRect.width === 0) return;

        // Get current position
        const style = window.getComputedStyle(this._instructionsTableContainer);
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
        const maxX = containerRect.width - instructionsTableRect.width;
        const maxY = containerRect.height - instructionsTableRect.height;

        // Only reposition if out of bounds
        const newX = Math.max(0, Math.min(currentX, maxX));
        const newY = Math.max(0, Math.min(currentY, maxY));

        // Apply correction only if needed
        if (newX !== currentX || newY !== currentY) {
            this._instructionsTableContainer.style.transform = `translate(${newX}px, ${newY}px)`;
        }
    }

    /**
     * Enables dragging functionality
     * Should be called AFTER _updatePositions() for proper initialization
     * @private
     */
    _enableDragging() {
        if (!this._instructionsTableContainer || !this._container) return;

        this._dragCleanup = makeDraggable(this._instructionsTableContainer, this._container);
    }

    /**
     * Updates the instructions table initial position based on viewer dimensions
     */
    _updatePositions() {
        const containerRect = this.container.getBoundingClientRect();
        const instructionsTableContainer = this._instructionsTableContainer.getBoundingClientRect();
        if (!containerRect || !this._instructionsTableContainer || containerRect.width === 0 || instructionsTableContainer.width === 0) return;

        const x = containerRect.width - instructionsTableContainer.width - 5;
        const y = 130;

        this._instructionsTableContainer.style.transform = `translate(${x}px, ${y}px)`;
    }


    /***************
     * TABLE LOGIC *
     ***************/
    /**
     * Updates the instructions table content based on the mode key
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
    _destroyInstructionsTable() {
        // this._fragment.remove();
        // this._instructionsTableContainer.remove();
        this.remove();

        this._container = null;
        this._instructionsBox = null;
        this._table = null;
        this._instructionsIconButton = null;
        this._instructionsTableContainer = null;

        this._modeMessages = null;
        this._header = null;

        this._fragment = null;

        this.shadowRoot.innerHTML = ""; // Clear the shadow DOM
        this.shadowRoot.adoptedStyleSheets = []; // Clear the adopted stylesheets
        this._isExpanded = false;

        // Clean up dragging
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }

        // Clean up close button
        if (this._closeButtonCleanup) {
            this._closeButtonCleanup();
            this._closeButtonCleanup = null;
        }

        // Clean up expand/collapse button
        if (this._expandCollapseButtonCleanup) {
            this._expandCollapseButtonCleanup();
            this._expandCollapseButtonCleanup = null;
        }
    }
}

customElements.define("instructions-table", InstructionsTable);
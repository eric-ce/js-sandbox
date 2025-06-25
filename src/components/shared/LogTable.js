import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { logBoxIcon } from '../../assets/icons.js';
import { createCloseButton, makeDraggable } from '../../lib/helper/helper.js';

export class LogTable extends HTMLElement {
    _dragCleanup = null;

    _records = [];
    _emitter = null;
    _stateManager = null;

    _container = null;
    _fragment = null;
    _logBox = null;
    _logTableContainer = null;
    _logIconButton = null;
    _table = null;

    _isExpanded = false;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Initialize document fragment
        this._fragment = document.createDocumentFragment();

        // create log table UI
        this._createUI();
    }


    /*****************************
     * GETTER AND SETTER METHODS *
     *****************************/
    get emitter() {
        return this._emitter;
    }
    set emitter(emitter) {
        this._emitter = emitter;

        // listen for data:updated
        this._emitter.on('data:updated', (data) => this._handleDataAdded(data));

        // listen for mode:selected
        this._emitter.on('selected:info', (info) => this._handleModeSelected(info));
    }

    get stateManager() {
        return this._stateManager;
    }
    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get container() {
        return this._container;
    }
    set container(container) {
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }

        this._container = container;
    }


    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];
    }

    disconnectedCallback() {
        this._destroyLogTable();
    }


    /***************
     * UI CREATION *
     ***************/
    /**
     * Creates the UI structure for the log table
     */
    _createUI() {
        // Create the container to wrap the whole components
        this._createTableContainer();
        // Create the log table icon to toggle the log box
        this._createTableIcon();
        // Create the log box that contains the table
        this._createTable();
    }

    /**
     * Creates and configures the container element
     */
    _createTableContainer() {
        this._logTableContainer = document.createElement("div");
        this._logTableContainer.classList.add("log-table-container");
        this._logTableContainer.style.position = "absolute";
        this._logTableContainer.style.top = "0";
        this._logTableContainer.style.left = "0";
        this._logTableContainer.style.zIndex = "1000"; // Ensure it appears above other elements

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._logTableContainer);
    }

    /**
     * Creates the toggle button for showing the log table
     * Initially stored in the fragment, toggle to show or hide when clicked
     */
    _createTableIcon() {
        // Button that toggles the log box
        this._logIconButton = document.createElement("button");
        this._logIconButton.className = "annotate-button animate-on-show visible";
        this._logIconButton.style.position = "absolute";
        this._logIconButton.innerHTML = `<img src="${logBoxIcon}" alt="log" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._logIconButton.setAttribute("type", "button");
        this._logIconButton.setAttribute("aria-label", "Toggle log table");
        this._logIconButton.setAttribute("aria-pressed", "false");

        // Toggle the log box on click
        this._logIconButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showLogBox();
        });

        // Store in fragment initially
        this._fragment.appendChild(this._logIconButton);
    }

    /**
     * Creates the log box and table elements
     */
    _createTable() {
        // Create container div for the log table
        this._logBox = document.createElement("div");
        this._logBox.className = "info-box log-box visible";
        this._logBox.style.position = "absolute";

        // Add click handler to close log box when clicked
        this._logBox.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._hideLogBox();
        });

        // Create the table element 
        this._table = document.createElement("table");
        this._table.style.display = "table";
        this._table.style.width = "100%";
        this._table.style.paddingTop = "5px";
        this._table.style.borderCollapse = "collapse";

        // Create a header row
        this._table.appendChild(this._createRow("Actions"));
        // Append table to logBox
        this._logBox.appendChild(this._table);

        // Create close button 
        const closeButton = createCloseButton({
            color: "#edffff",
            top: "2px",
            right: "0px",
            click: (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._destroyLogTable();
            }
        });
        this._logBox.appendChild(closeButton); // Add close button to log box

        // Append to container initially
        this._logTableContainer.appendChild(this._logBox);
    }


    /****************
     * TOGGLE LOGIC *
     ****************/
    /**
     * Shows the log box and hides the icon
     */
    _showLogBox() {
        // Update state
        this._isExpanded = true;

        // Update element classes
        this._logBox.classList.add("visible");
        this._logBox.classList.remove("hidden");

        // Store icon in fragment
        if (this._logIconButton.parentNode === this._logTableContainer) {    // ensure icon is in the container
            this._fragment.appendChild(this._logIconButton);
        }

        // Move logBox to container if it's in the fragment
        if (this._logBox.parentNode !== this._logTableContainer) {   // ensure logBox is not already in the container
            this._logTableContainer.appendChild(this._logBox);

            // set log table container width and height for drag position usage
            this._updateContainerSize();
        }
        // Only constrain to bounds if expanded table exceeds container
        requestAnimationFrame(() => {
            this._constrainToContainer();
        });
        // Update ARIA state
        this._logIconButton.setAttribute("aria-pressed", "true");
    }

    /**
     * Hides the log box and shows the icon
     */
    _hideLogBox() {
        // Update state
        this._isExpanded = false;

        // Update element classes
        this._logBox.classList.add("hidden");
        this._logBox.classList.remove("visible");

        // Store logBox in fragment
        if (this._logBox.parentNode === this._logTableContainer) {  // ensure logBox is in the container
            this._fragment.appendChild(this._logBox);
        }

        // Move icon to container if it's in the fragment
        if (this._logIconButton.parentNode !== this._logTableContainer) { // ensure icon is not already in the container
            this._logTableContainer.appendChild(this._logIconButton);

            // set log table container width and height for drag position usage
            this._updateContainerSize();
        }

        this._logIconButton.classList.add("visible");
        this._logIconButton.classList.remove("hidden");

        // Update ARIA state
        this._logIconButton.setAttribute("aria-pressed", "false");
    }


    /**********************************
     * UPDATE POSITION AND DIMENSIONS *
     **********************************/
    /**
     * Updates container size based on expanded state
     */
    _updateContainerSize() {
        const elementToMeasure = this._isExpanded ? this._logBox : this._logIconButton;
        if (elementToMeasure && elementToMeasure.isConnected) {
            const rect = elementToMeasure.getBoundingClientRect();
            this._logTableContainer.style.width = `${rect.width}px`;
            this._logTableContainer.style.height = `${rect.height}px`;

            this._logTableContainer.dataset.state = this._isExpanded ? "expanded" : "collapsed";
        } else {
            // Fallback dimensions if measurement fails
            this._logTableContainer.style.width = "250px";
            this._logTableContainer.style.height = "250px";
        }
    }

    /**
    * One-time positioning adjustment if expanded table exceeds container bounds
    * @private
    */
    _constrainToContainer() {
        if (!this._container || !this._logTableContainer) return;

        const containerRect = this._container.getBoundingClientRect();
        const logTableRect = this._logTableContainer.getBoundingClientRect();

        if (containerRect.width === 0 || logTableRect.width === 0) return;

        // Get current position
        const style = window.getComputedStyle(this._logTableContainer);
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
        const maxX = containerRect.width - logTableRect.width;
        const maxY = containerRect.height - logTableRect.height;

        // Only reposition if out of bounds
        const newX = Math.max(0, Math.min(currentX, maxX));
        const newY = Math.max(0, Math.min(currentY, maxY));

        // Apply correction only if needed
        if (newX !== currentX || newY !== currentY) {
            this._logTableContainer.style.transform = `translate(${newX}px, ${newY}px)`;
        }
    }

    /**
     * Enables dragging functionality
     * Should be called AFTER _updatePositions() for proper initialization
     * @private
     */
    _enableDragging() {
        if (!this._logTableContainer || !this._container) return;

        this._dragCleanup = makeDraggable(
            this._logTableContainer,
            this._container
        );
    }

    /**
     * Updates the log table initial position based on viewer dimensions
     */
    _updatePositions() {
        const containerRect = this.container.getBoundingClientRect();
        const logTableContainer = this._logTableContainer.getBoundingClientRect();
        if (!containerRect || !this._logTableContainer || containerRect.width === 0 || logTableContainer.width === 0) return;

        const x = containerRect.width - logTableContainer.width - 5;
        const y = 300;

        this._logTableContainer.style.transform = `translate(${x}px, ${y}px)`;
    }


    /***************
     * TABLE LOGIC *
     ***************/
    /**
     * Creates a new table row with a single cell containing the provided text and a copy button.
     * @param {String} text 
     * @returns { HTMLTableRowElement } A new table row element.
     */
    _createRow(text) {
        const row = document.createElement("tr");

        // Text cell
        const textCell = document.createElement("td");
        textCell.style.borderBottom = "1px solid white";
        textCell.style.paddingRight = "4px";
        textCell.textContent = text;

        // Copy button cell
        const buttonCell = document.createElement("td");
        buttonCell.style.borderBottom = "1px solid white";
        buttonCell.style.width = "30px";
        buttonCell.style.textAlign = "center";

        // Copy button that is in the button cell
        const copyButton = document.createElement("button");
        copyButton.innerHTML = "📋"; // Copy icon
        Object.assign(copyButton.style, {
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: "5px",
            padding: "2px",
            cursor: "pointer",
            width: "1.4rem",
            height: "1.4rem",
        });
        copyButton.style.fontSize = "12px";
        copyButton.setAttribute("aria-label", `Copy "${text}"`);
        copyButton.setAttribute("title", "Copy to clipboard");

        // Copy functionality
        copyButton.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent triggering parent click handlers

            try {
                // extract only the numbers from the text but keep the , - symbol
                const formattedText = text.replace(/[^0-9,.\s-]/g, '').trim();
                const textToCopy = formattedText.replace(/\s+/g, ' '); // Replace multiple spaces with a single space
                await navigator.clipboard.writeText(textToCopy);

                // Visual feedback
                const originalText = copyButton.innerHTML;
                copyButton.innerHTML = "✓";
                copyButton.style.color = "#4CAF50";

                setTimeout(() => {
                    copyButton.innerHTML = originalText;
                    copyButton.style.color = "";
                }, 1000);

            } catch (err) {
                console.warn('Failed to copy text:', err);

                // Fallback: select text for manual copy
                const range = document.createRange();
                range.selectNodeContents(textCell);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        // if text == "Actions", don't append the copy button
        row.appendChild(textCell);
        if (text !== "Actions") {
            buttonCell.appendChild(copyButton);
        }
        row.appendChild(buttonCell);

        return row;
    }

    /**
     * Handles the "data:updated" event from the emitter.
     * @param {Object} record - The measure record to be processed. 
     * @returns  
     */
    _handleDataAdded(data) {
        // Only process if the data’s status is "completed"
        if (!data || data.status !== "completed") return;

        // Convert the record into an array of formatted strings.
        const formattedLines = this._formatRecordsToStrings(data);

        // Append each formatted line to the internal _records array.
        formattedLines.forEach(line => {
            this._records.push(line);
        });

        // Update the table UI.
        this._updateTable();
    }

    /**
 * Converts the received record's _records value into an array of display strings.
 * @param {object} data - The update of measure data object
 * @returns {string[]} An array of formatted strings.
 */
    _formatRecordsToStrings(data) {
        const { mode, _records } = data;

        if (!mode || !_records) return [];

        const lines = [];

        // Helper to safely format a number
        const safeFormat = (value, decimals = 2) => {
            if (typeof value === "number" && !isNaN(value)) {
                return Number.isInteger(value) ? value.toString() : value.toFixed(decimals);
            }
            if (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "") {
                const num = Number(value);
                return Number.isInteger(num) ? num.toString() : num.toFixed(decimals);
            }
            return value; // Return as-is for strings, null, undefined
        };

        // Determine the data structure type
        const getDataType = (_records) => {
            if (!Array.isArray(_records) || _records.length === 0) return 'unknown';

            const firstItem = _records[0];
            if (typeof firstItem === 'number' || typeof firstItem === 'string' || firstItem == null) {
                if (mode === 'pointInfo') {
                    return 'coordinate_array'; // Special case for coordinate arrays
                }
                return 'simple_array';
            }
            if (typeof firstItem === 'object' && firstItem !== null) {
                return 'object_array';
            }
            return 'unknown';
        };

        const dataType = getDataType(_records);

        switch (dataType) {
            case 'simple_array':
                // Case 1 & 2: [1234.56343] or [1234.21, 123.45, 21234.21] or ["string"]
                const formattedValues = _records
                    .map(value => safeFormat(value))
                    .filter(value => value !== null && value !== undefined);
                lines.push(`${mode}: ${formattedValues.join(", ")}`);
                break;

            case 'object_array':
                // Case 3: [{ distances: [1234.56343, 1234.56343], totalDistance: 1234.56343 }]
                _records.forEach(obj => {
                    Object.entries(obj).forEach(([key, value]) => {
                        if (Array.isArray(value)) {
                            const formattedNumbers = value
                                .map(num => safeFormat(num))
                                .filter(val => val !== null && val !== undefined);
                            lines.push(`${key}: ${formattedNumbers.join(", ")}`);
                        } else {
                            const formattedValue = safeFormat(value);
                            lines.push(`${key}: ${formattedValue}`);
                        }
                    });
                });
                break;
            case 'coordinate_array':
                // case 4: [11.2232,1.232,5321]
                const roundedCoords = _records.map(coord => safeFormat(coord, 4)); // Round to 4 decimal places
                const formattedCoords = `lat: ${safeFormat(roundedCoords[0], 4)}, lon: ${safeFormat(roundedCoords[1], 4)}, alt: ${safeFormat(roundedCoords[2], 2)}`;

                lines.push(`${mode}: ${formattedCoords}`);
                break;
            case 'unknown':
            default:
                // Fallback for unexpected data structures
                lines.push(`${mode}: ${JSON.stringify(_records)}`);
                break;
        }

        return lines;
    }

    _handleModeSelected(record) {
        if (!Array.isArray(record)) return;

        const modeObject = record[0];
        Object.entries(modeObject).forEach(([key, value]) => {
            this._records.push(`${key}: ${value}`);
        });

        this._updateTable();
    }

    /**
     * Updates the table UI based on the current log records.
     * Assumes that this._records is an array of objects with "key" and "string" properties.
     */
    _updateTable() {
        if (!this._logBox || !this._table) return;
        // Clear all rows except the header (assuming header is the first row).
        while (this._table.rows.length > 1) {
            this._table.deleteRow(1);
        }

        // Iterate over each formatted record string.
        this._records.forEach(line => {
            this._table.appendChild(this._createRow(line));
        });

        // Auto-scroll to the bottom for smooth UX.
        this._logBox.scrollTo({ top: this._logBox.scrollHeight, behavior: 'smooth' });
    }


    /*********
     * RESET *
     *********/
    _destroyLogTable() {
        this.remove();

        this.shadowRoot.adoptedStyleSheets = [];

        this._records = [];  // Clear the records
        this._isExpanded = false;  // Reset the expanded state
        this._logTableContainer = null;
        this._logIconButton = null;
        this._logBox = null;
        this._table = null;
        this._container = null;  // Clear the container reference
        this._fragment = null;  // Reset the fragment
        this._stateManager = null;  // Clear the state manager reference
        if (this._emitter) {
            this._emitter.off('data:updated', (data) => this._handleDataAdded(data));
            this._emitter.off('selected:info', (info) => this._handleModeSelected(info));
        }
        this._emitter = null;  // Clear the emitter reference

        // Clean up dragging
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }
    }
}

customElements.define('log-table', LogTable);

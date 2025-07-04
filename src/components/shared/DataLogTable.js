import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { dataLogBoxIcon } from '../../assets/icons.js';
import { createCloseButton, createExpandCollapseButton, makeDraggable } from '../../lib/helper/helper.js';
import dataPool from '../../lib/data/DataPool.js';

/**@typedef {import('../../lib/state/StateManager.js')} StateManager */
/**@typedef {import('../../lib/events/ShareEmitter.js')} Emitter */

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'| string} mapName - Map provider name ("google")
 */

export class DataLogTable extends HTMLElement {
    // Events
    /** @type {function(): void} */
    _dragCleanup = null;
    /** @type {function(): void} */
    _closeButtonCleanup;
    /** @type {Set<{button: HTMLButtonElement, handler: function}>} */
    _copyButtonCleanupSet; // Renamed from _copyButtonHandlers

    // External references
    /** @type {Emitter} */
    _emitter = null;
    /** @type {StateManager} */
    _stateManager = null;
    /** @type {HTMLElement} */
    _container = null;
    /** @type {"cesium"|"google"|"leaflet"} - The name of the map */
    _mapName = null;

    // Table related variables
    /** @type {string[]} */
    _logRecords = [];
    /** @type {DocumentFragment} */
    _fragment = null;
    /** @type {HTMLDivElement} */
    _dataLogBox = null;
    /** @type {HTMLDivElement} */
    _dataLogTableContainer = null;
    /** @type {HTMLButtonElement} */
    _dataLogIconButton = null;
    /** @type {HTMLTableElement} */
    _table = null;

    // Flags and state
    /** @type {boolean} */
    _isExpanded = false;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Initialize document fragment
        this._fragment = document.createDocumentFragment();


    }


    /*****************************
     * GETTER AND SETTER METHODS *
     *****************************/
    get emitter() {
        return this._emitter;
    }
    set emitter(emitter) {
        this._emitter = emitter;

        // Initial data load when emitter is set
        this._loadInitialData();

        // listen for data:updated
        this._emitter.on('data:updated', () => {
            const data = dataPool.data;
            if (data.length === 0) return; // No data to process
            this._handleData(data);
        });

        this._emitter.on('data:removed', () => {
            const data = dataPool.data;
            console.log("🚀 data:", data);

            this._handleData(data);
        });


        // listen for mode:selected
        // this._emitter.on('selected:info', (info) => this._handleModeSelected(info));
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

    get mapName() {
        return this._mapName;
    }

    set mapName(mapName) {
        this._mapName = mapName;
    }


    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // create data log table UI
        this._createUI();
    }

    disconnectedCallback() {
        this._destroy();
    }


    /***************
     * UI CREATION *
     ***************/
    /**
     * Creates the UI structure for the data log table
     */
    _createUI() {
        // Create the container to wrap the whole components
        this._createDataTableContainer();
        // Create the data log table icon to toggle the data log box
        this._createDataTableIcon();
        // Create the data log box that contains the table
        this._createDataTable();
    }

    /**
     * Creates and configures the container element
     */
    _createDataTableContainer() {
        this._dataLogTableContainer = document.createElement("div");
        this._dataLogTableContainer.classList.add("data-log-table-container");
        this._dataLogTableContainer.style.position = "absolute";
        this._dataLogTableContainer.style.top = "0";
        this._dataLogTableContainer.style.left = "0";
        this._dataLogTableContainer.style.zIndex = "1000"; // Ensure it appears above other elements

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._dataLogTableContainer);
    }

    /**
     * Creates the toggle button for showing the datalog table
     * Initially stored in the fragment, toggle to show or hide when clicked
     */
    _createDataTableIcon() {
        // Button that toggles the data log box
        this._dataLogIconButton = document.createElement("button");
        this._dataLogIconButton.className = "annotate-button animate-on-show visible";
        this._dataLogIconButton.style.position = "absolute";
        this._dataLogIconButton.innerHTML = `<img src="${dataLogBoxIcon}" alt="data log icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._dataLogIconButton.setAttribute("type", "button");
        this._dataLogIconButton.setAttribute("aria-label", "Toggle data log table");
        this._dataLogIconButton.setAttribute("aria-pressed", "false");
        this._dataLogIconButton.title = "Toggle data log table";

        // Toggle the data log box on click
        this._dataLogIconButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showDataLogBox();
        });

        // Store in fragment initially
        this._fragment.appendChild(this._dataLogIconButton);
    }

    /**
     * Creates the data log box and table elements
     */
    _createDataTable() {
        // -- Create the data log box container --
        this._dataLogBox = document.createElement("div");
        this._dataLogBox.className = "info-box data-log-box visible";
        this._dataLogBox.style.position = "absolute";

        // -- Create title div --
        const titleDiv = document.createElement("div");
        const formatTitleText = this.mapName ? `All Data Log - ${this.mapName.charAt(0).toUpperCase() + this.mapName.slice(1)}` : "Data Log";
        titleDiv.textContent = formatTitleText;
        titleDiv.style.fontWeight = "bold";
        titleDiv.style.padding = "2px 0px 0px 2px";
        this._dataLogBox.appendChild(titleDiv);

        // -- Create a table -- 
        this._table = document.createElement("table");
        this._table.style.display = "table";
        this._table.style.width = "100%";
        this._table.style.marginTop = "7px";
        this._table.style.borderCollapse = "collapse";
        // Append table to dataLogBox
        this._dataLogBox.appendChild(this._table);


        // -- Create close button --
        const { button: closeButton, cleanup: closeButtonCleanup } = createCloseButton({
            color: "#edffff",
            clickCallback: () => this._destroy()
        });
        this._closeButtonCleanup = closeButtonCleanup; // Store cleanup function
        this._dataLogBox.appendChild(closeButton); // Add close button to data log box


        // -- Create expand/collapse button for the data log box --
        const { button: expandCollapseButton, cleanup: expandCollapseCleanup } = createExpandCollapseButton({
            color: "#edffff",
            right: "1.5rem",
            clickCallback: () => {
                this._hideDataLogBox();
                expandCollapseButton.style.transform = "scale(1.0)"; // Reset scale on collapse 
            }
        });
        this._expandCollapseButtonCleanup = expandCollapseCleanup; // Store cleanup function
        this._dataLogBox.appendChild(expandCollapseButton); // Add expand/collapse button to data log box

        // Append to container initially
        this._dataLogTableContainer.appendChild(this._dataLogBox);
    }


    /****************
     * TOGGLE LOGIC *
     ****************/
    /**
     * Shows the data log box and hides the icon
     */
    _showDataLogBox() {
        // Update state
        this._isExpanded = true;

        // Update element classes
        this._dataLogBox.classList.add("visible");
        this._dataLogBox.classList.remove("hidden");

        // Store icon in fragment
        if (this._dataLogIconButton.parentNode === this._dataLogTableContainer) {    // ensure icon is in the container
            this._fragment.appendChild(this._dataLogIconButton);
        }

        // Move data logBox to container if it's in the fragment
        if (this._dataLogBox.parentNode !== this._dataLogTableContainer) {   // ensure logBox is not already in the container
            this._dataLogTableContainer.appendChild(this._dataLogBox);

            // set data log table container width and height for drag position usage
            this._updateContainerSize();
        }
        // Only constrain to bounds if expanded table exceeds container
        requestAnimationFrame(() => {
            this._constrainToContainer();
        });
        // Update ARIA state
        this._dataLogIconButton.setAttribute("aria-pressed", "true");
    }

    /**
     * Hides the data log box and shows the icon
     */
    _hideDataLogBox() {
        // Update state
        this._isExpanded = false;

        // Update element classes
        this._dataLogBox.classList.add("hidden");
        this._dataLogBox.classList.remove("visible");

        // Store data logBox in fragment
        if (this._dataLogBox.parentNode === this._dataLogTableContainer) {  // ensure data logBox is in the container
            this._fragment.appendChild(this._dataLogBox);
        }

        // Move icon to container if it's in the fragment
        if (this._dataLogIconButton.parentNode !== this._dataLogTableContainer) { // ensure icon is not already in the container
            this._dataLogTableContainer.appendChild(this._dataLogIconButton);

            // set data log table container width and height for drag position usage
            this._updateContainerSize();
        }

        this._dataLogIconButton.classList.add("visible");
        this._dataLogIconButton.classList.remove("hidden");

        // Update ARIA state
        this._dataLogIconButton.setAttribute("aria-pressed", "false");
    }


    /**********************************
     * UPDATE POSITION AND DIMENSIONS *
     **********************************/
    /**
     * Updates container size based on expanded state
     */
    _updateContainerSize() {
        const elementToMeasure = this._isExpanded ? this._dataLogBox : this._dataLogIconButton;
        if (elementToMeasure && elementToMeasure.isConnected) {
            const rect = elementToMeasure.getBoundingClientRect();
            this._dataLogTableContainer.style.width = `${rect.width}px`;
            this._dataLogTableContainer.style.height = `${rect.height}px`;

            this._dataLogTableContainer.dataset.state = this._isExpanded ? "expanded" : "collapsed";
        } else {
            // Fallback dimensions if measurement fails
            this._dataLogTableContainer.style.width = "250px";
            this._dataLogTableContainer.style.height = "250px";
        }
    }

    /**
    * One-time positioning adjustment if expanded table exceeds container bounds
    * @private
    */
    _constrainToContainer() {
        if (!this._container || !this._dataLogTableContainer) return;

        const containerRect = this._container.getBoundingClientRect();
        const dataLogTableRect = this._dataLogTableContainer.getBoundingClientRect();

        if (containerRect.width === 0 || dataLogTableRect.width === 0) return;

        // Get current position
        const style = window.getComputedStyle(this._dataLogTableContainer);
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
        const maxX = containerRect.width - dataLogTableRect.width;
        const maxY = containerRect.height - dataLogTableRect.height;

        // Only reposition if out of bounds
        const newX = Math.max(0, Math.min(currentX, maxX));
        const newY = Math.max(0, Math.min(currentY, maxY));

        // Apply correction only if needed
        if (newX !== currentX || newY !== currentY) {
            this._dataLogTableContainer.style.transform = `translate(${newX}px, ${newY}px)`;
        }
    }

    /**
     * Enables dragging functionality
     * Should be called AFTER _updatePositions() for proper initialization
     * @private
     */
    _enableDragging() {
        if (!this._dataLogTableContainer || !this._container) return;

        this._dragCleanup = makeDraggable(
            this._dataLogTableContainer,
            this._container
        );
    }

    /**
     * Updates the log table initial position based on viewer dimensions
     */
    _updatePositions() {
        const containerRect = this.container.getBoundingClientRect();
        const logTableContainer = this._dataLogTableContainer.getBoundingClientRect();
        if (!containerRect || !this._dataLogTableContainer || containerRect.width === 0 || logTableContainer.width === 0) return;

        const x = containerRect.width - logTableContainer.width - 5;
        const y = 300;

        this._dataLogTableContainer.style.transform = `translate(${x}px, ${y}px)`;
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

        // Create the copy button
        const copyButton = this._createCopyButton(text);
        buttonCell.appendChild(copyButton);

        row.appendChild(textCell);
        row.appendChild(buttonCell);

        return row;
    }

    _createCopyButton(text) {
        const copyButton = document.createElement("button");
        copyButton.textContent = "📋";
        Object.assign(copyButton.style, {
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: "5px",
            padding: "2px",
            cursor: "pointer",
            width: "1.4rem",
            height: "1.4rem",
            transition: "background-color 0.3s, color 0.3s",
        });
        copyButton.style.fontSize = "12px";
        copyButton.setAttribute("aria-label", `Copy "${text}"`);
        copyButton.setAttribute("title", "Copy to clipboard");

        if (!this._copyButtonCleanupSet) {
            this._copyButtonCleanupSet = new Set();
        }

        const copyHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const formattedText = text.replace(/[^0-9,.\s-]/g, '').trim();
                const textToCopy = formattedText.replace(/\s+/g, ' ');
                await navigator.clipboard.writeText(textToCopy);

                const originalText = copyButton.innerHTML;
                copyButton.innerHTML = "✓";
                copyButton.style.color = "#4CAF50";

                setTimeout(() => {
                    copyButton.innerHTML = originalText;
                    copyButton.style.color = "";
                }, 1000);

            } catch (err) {
                console.warn('Failed to copy text:', err);
            }
        };

        // Hover effect handlers
        const mouseOverHandler = () => {
            copyButton.style.backgroundColor = "rgba(170, 221, 255, 0.8)";
        };

        const mouseOutHandler = () => {
            copyButton.style.backgroundColor = "transparent";
        };

        // Attach event listeners
        copyButton.addEventListener("click", copyHandler);
        copyButton.addEventListener("mouseover", mouseOverHandler);
        copyButton.addEventListener("mouseout", mouseOutHandler);

        // Store all handlers for cleanup
        this._copyButtonCleanupSet.add({
            button: copyButton,
            clickHandler: copyHandler,
            mouseOverHandler: mouseOverHandler,
            mouseOutHandler: mouseOutHandler
        });

        return copyButton;
    }

    /**
     * Handles dataPool data and triggered by "data:updated" event from the emitter.
     * @param {MeasurementGroup[]} data - The dataPool data to be processed. 
     * @returns {void} 
     */
    _handleData(data) {
        // Handle array of data from dataPool
        if (!Array.isArray(data)) return;

        if (data.length === 0) {
            while (this._table && this._table.rows.length > 0) {
                this._table.deleteRow(0);
            }
        }

        // Process only completed data
        const completedData = data.filter(item =>
            item && item.status === "completed"
        );

        if (completedData.length === 0) return;

        // Clear existing records to show current state
        this._logRecords = [];

        // Process each completed data item
        completedData.forEach(item => {
            const formattedLines = this._formatDataToStrings(item);
            formattedLines.forEach(line => {
                this._logRecords.push(line);
            });
        });

        // Update the table UI
        this._updateTable();
    }

    /**
     * Converts the received record's _records value into an array of display strings.
     * @param {object} data - The update of measure data object
     * @returns {string[]} An array of formatted strings.
     */
    _formatDataToStrings(data) {
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

    // _handleModeSelected(record) {
    //     if (!Array.isArray(record)) return;

    //     const modeObject = record[0];
    //     Object.entries(modeObject).forEach(([key, value]) => {
    //         this._records.push(`${key}: ${value}`);
    //     });

    //     this._updateTable();
    // }

    /**
     * Updates the table UI based on the current data log records.
     * Assumes that this._records is an array of objects with "key" and "string" properties.
     */
    _updateTable() {
        if (!this._dataLogBox || !this._table) return;

        // Clear all rows (no header row to preserve)
        while (this._table.rows.length > 0) {
            this._table.deleteRow(0);
        }

        // if (this._records.length === 0) {
        //     // if no records, remove all rows
        //     if (this._table.rows.length > 0) {
        //         this._table.deleteRow(0);
        //     }
        // }

        // Iterate over each formatted record string.
        this._logRecords.forEach(line => {
            this._table.appendChild(this._createRow(line));
        });

        // Auto-scroll to the bottom for smooth UX.
        this._dataLogBox.scrollTo({ top: this._dataLogBox.scrollHeight, behavior: 'smooth' });
    }

    /**
     * Loads initial data from dataPool when component is first set up
     * @private
     */
    _loadInitialData() {
        const data = dataPool.data;
        if (data && data.length > 0) {
            this._handleData(data);
        }
    }

    /*********
     * RESET *
     *********/
    _destroy() {
        this.remove();

        this.shadowRoot.adoptedStyleSheets = [];

        this._logRecords = [];  // Clear the records
        this._isExpanded = false;  // Reset the expanded state
        this._dataLogTableContainer = null;
        this._dataLogIconButton = null;
        this._dataLogBox = null;
        this._table = null;
        this._container = null;  // Clear the container reference
        this._fragment = null;  // Reset the fragment
        this._stateManager = null;  // Clear the state manager reference
        if (this._emitter) {
            this._emitter.off('data:updated', this._handleData);
            // this._emitter.off('selected:info', (info) => this._handleModeSelected(info));
        }
        this._emitter = null;  // Clear the emitter reference

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

        // Clean up copy button handlers
        if (this._copyButtonCleanupSet) {
            this._copyButtonCleanupSet.forEach(({ button, clickHandler, mouseOverHandler, mouseOutHandler }) => {
                button.removeEventListener("click", clickHandler);
                button.removeEventListener("mouseover", mouseOverHandler);
                button.removeEventListener("mouseout", mouseOutHandler);
            });
            this._copyButtonCleanupSet.clear();
            this._copyButtonCleanupSet = null;
        }
    }
}

customElements.define('data-log-table', DataLogTable);

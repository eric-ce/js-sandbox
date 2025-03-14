import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { logBoxIcon } from '../../assets/icons.js';

export class LogTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this._records = [];         // internal storage for log entries
        this._emitter = null;       // shared emitter, to be set via property
        this._stateManager = null;  // shared state manager, to be set via property

        // UI related fields
        this._fragment = document.createDocumentFragment();
        this._isExpanded = false;
        this._logBox = null;        // container for the log table
        this._table = null;         // table element for the log entries
        this._logIconButton = null; // button to toggle log box

        // Find the viewer container
        const mapCesium = document.querySelector("map-cesium");
        this.viewerContainer = mapCesium && mapCesium.shadowRoot.getElementById("cesiumContainer");

        // create log table UI
        this._createUI();
    }

    /*****************************
     * GETTER AND SETTER METHODS *
     *****************************/
    // event emitter
    get emitter() {
        return this._emitter;
    }
    set emitter(emitter) {
        this._emitter = emitter;

        // listen for data:updated
        this._emitter.on('data:updated', this._handleDataAdded.bind(this));

        // listen for mode:selected
        this._emitter.on('selected:info', this._handleModeSelected.bind(this));
    }

    get stateManager() {
        return this._stateManager;
    }
    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    connectedCallback() {
        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // initialize the style for the web component
        // this.style.position = "absolute";
        this._updatePositions();
    }

    /**
     * Updates the log table initial position based on viewer dimensions
     */
    _updatePositions() {
        const rect = this.viewerContainer.getBoundingClientRect();
        const container = this._logTableContainer.getBoundingClientRect();
        if (!rect || !this._logTableContainer || rect.width === 0 || container.width === 0) console.error("invalid rect")

        const x = (rect.width - container.width) || 0;
        const y = (rect.height - container.height) || 260;

        this._logTableContainer.style.transform = `translate(${x}px, ${-y}px)`;
    }


    /**
     * Creates the UI structure for the log table
     */
    _createUI() {
        // Create the container to wrap the whole components
        this._setupLogTableContainer();
        // Create the log table icon to toggle the log box
        this._setupLogTableIcon();
        // Create the log box that contains the table
        this._setupLogTable();
    }

    /**
     * Creates and configures the container element
     */
    _setupLogTableContainer() {
        this._logTableContainer = document.createElement("div");
        this._logTableContainer.classList.add("log-table-container");
        this._logTableContainer.style.position = "absolute";

        // set the initial size of the container
        this._updateContainerSize();

        this.shadowRoot.appendChild(this._logTableContainer);
    }

    /**
     * Creates the toggle button for showing the log table
     */
    _setupLogTableIcon() {
        // Button that toggles the log box
        this._logIconButton = document.createElement("button");
        this._logIconButton.className = "annotate-button animate-on-show visible";
        this._logIconButton.style.position = "absolute";
        this._logIconButton.innerHTML = `<img src="${logBoxIcon}" alt="log" style="width: 30px; height: 30px;" aria-hidden="true">`;
        this._logIconButton.setAttribute("type", "button");
        this._logIconButton.setAttribute("aria-label", "Toggle log table");
        this._logIconButton.setAttribute("aria-pressed", "false");

        // Toggle the log box on click
        this._logIconButton.addEventListener("click", () => {
            this._showLogBox();
        });

        // Store in fragment initially
        this._fragment.appendChild(this._logIconButton);
    }

    /**
     * Creates the log box and table elements
     */
    _setupLogTable() {
        // Create container div for the log table
        this._logBox = document.createElement("div");
        this._logBox.className = "info-box log-box visible";
        this._logBox.style.position = "absolute";

        // Add click handler to close log box when clicked
        this._logBox.addEventListener("click", () => {
            this._hideLogBox();
        });

        // Create the table element
        this._table = document.createElement("table");
        this._table.style.display = "table";

        // Create a header row
        this._table.appendChild(this._createRow("Actions"));

        // Append table to logBox
        this._logBox.appendChild(this._table);

        // Append to container initially
        this._logTableContainer.appendChild(this._logBox);
    }

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
     * Creates a new table row with a single cell containing the provided text.
     * @param {String} text 
     * @returns { HTMLTableRowElement } A new table row element.
     */
    _createRow(text) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.style.borderBottom = "1px solid white";
        cell.textContent = text;
        row.appendChild(cell);
        return row;
    }

    /**
     * Handles the "data:updated" event from the emitter.
     * @param {Object} record - The measure record to be processed. 
     * @returns  
     */
    _handleDataAdded(record) {
        // Only process if the record’s status is "completed"
        if (record.status !== "completed") return;

        // Extract the mode and valueArray from the record.
        const { mode, _records: valueArray } = record;
        if (!mode || !valueArray) return;

        // Convert the record into an array of formatted strings.
        const formattedLines = this._formatRecordsToStrings(mode, valueArray);

        // Append each formatted line to the internal _records array.
        formattedLines.forEach(line => {
            this._records.push(line);
        });

        // Update the table UI.
        this._updateTable();
    }

    /**
     * Converts the received record’s _records value into an array of display strings.
     * @param {string} mode - The measurement mode.
     * @param {Array} valueArray - The record’s _records array.
     * @returns {Array<string>} An array of formatted strings.
     */
    _formatRecordsToStrings(mode, valueArray) {
        const lines = [];
        // Error handling: if valueArray is empty or undefined, return an "unknown" line.
        if (!valueArray || valueArray.length === 0) {
            return [];
        }

        // Case 1: valueArray is an array of numbers. e.g: [1234.3456]
        if (typeof valueArray[0] === 'number') {
            const roundedNumbers = valueArray.map(n =>
                ((n * 1000) % 1 === 0) ? n : n.toFixed(2)
            );
            lines.push(`${mode}: ${roundedNumbers.join(", ")}`);
            return lines;
        }

        // Case 2/3: valueArray is an array of objects whose values are arrays or objects.
        // Case 2: [{ distances: [1234.3456, 1234.3456] }, { totalDistance: [1234.3456] }]
        // Case 3: [{add: {latitude: 1234.3456, longitude: 1234.3456}}]
        if (typeof valueArray[0] === 'object') {
            const firstPropValue = Object.values(valueArray[0])[0];
            if (Array.isArray(firstPropValue)) {  // Case 2
                valueArray.forEach((obj) => {   // obj = {distances: [1234.3456, 1234.3456], totalDistance: [1234.3456]}
                    Object.keys(obj).forEach((key, keyIndex) => {
                        const numbers = obj[key];
                        // Round each number to 2 decimal places
                        const rounded = numbers.map(n =>
                            ((n * 100) % 1 === 0) ? n : n.toFixed(2)
                        );
                        // if keyIndex is 0, use the mode as the key
                        key = keyIndex === 0 ? mode : key;
                        // Add the formatted line to the array
                        lines.push(`${key}: ${rounded.join(", ")}`);
                    });
                });
                return lines;
            } else if (typeof firstPropValue === 'object') {  // Case 3
                const actionKey = Object.keys(valueArray[0])[0];
                const coords = Object.values(valueArray[0])[0];
                const { latitude, longitude } = coords;
                if (!latitude || !longitude) return [];  // Error handling
                // Round to 6 decimal places for lat and lon.
                const roundedLat = latitude.toFixed(6);
                const roundedLng = longitude.toFixed(6);
                // const roundedHeight = coords.height.toFixed(2);

                // Add the formatted line to the array
                lines.push(`${mode}: ${actionKey}: lat,lng: ${roundedLat},${roundedLng}`);
                return lines;
            }
        }
        // Error handling: if the valueArray is not recognized, return any value in string.
        lines.push(`${mode}: ${JSON.stringify(valueArray)}`);

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
}

customElements.define('log-table', LogTable);

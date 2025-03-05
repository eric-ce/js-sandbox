import { makeDraggable } from '../../lib/helper/helper.js';
import { sharedStyleSheet } from '../../styles/sharedStyle.js';
import { logBoxIcon } from '../../assets/icons.js';

export class LogTable extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._records = [];         // internal storage for log entries
        this._emitter = null;       // shared emitter, to be set via property
        this._stateManager = null;  // shared state manager, to be set via property
        this._cesiumStyle = null;   // shared cesium style, to be set via property


        this.logBox = null; // container for the log table
        this.table = null;  // table element for the log entries

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

    // state manager
    get stateManager() {
        return this._stateManager;
    }
    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    /************
     * FEATuRES *
     ************/
    // apply Cesium style when connected
    connectedCallback() {
        // initialize the style for the web component
        this.style.position = "absolute";
        this.updatePositions();

        // observe for changes in the viewer container, to update the position of the log table
        this.setupObservers();
    }

    updatePositions() {
        const rect = this.viewerContainer.getBoundingClientRect();
        this.style.bottom = rect ? (rect.height - 260) + "px" : "40px";
        this.style.left = rect ? (rect.width - 267) + "px" : "0px";
    }

    setupObservers() {
        const navigatorContainer = document.querySelector('.navigator-container');
        if (!navigatorContainer) return;

        // Create a ResizeObserver to watch for dimension changes
        this.resizeObserver = new ResizeObserver(() => {
            this.updatePositions();
        });
        this.resizeObserver.observe(navigatorContainer);

        // Create a MutationObserver to watch for DOM changes
        this.mutationObserver = new MutationObserver((mutations) => {
            // You could filter mutations if needed
            this.updatePositions();
        });
        this.mutationObserver.observe(navigatorContainer, {
            childList: true,
            attributes: true,
            subtree: true
        });
    }

    // Create the basic UI structure.
    _createUI() {
        // Button that toggles the log box
        this.logIconButton = document.createElement("button");
        // set button style
        this.logIconButton.className = "annotate-button animate-on-show hidden";
        this.logIconButton.style.position = "absolute";
        // set the icon as button image
        this.logIconButton.innerHTML = `<img src="${logBoxIcon}" alt="help box icon" style="width: 30px; height: 30px;" aria-hidden="true">`;
        // set aria attributes
        this.logIconButton.setAttribute("type", "button");
        this.logIconButton.setAttribute("aria-label", "Toggle help box for instructions");
        this.logIconButton.setAttribute("aria-pressed", "true");
        // Toggle the help box on click
        this.logIconButton.addEventListener("click", () => {
            this.showLogBox();
        });
        // Append the button to the shadow DOM
        this.shadowRoot.appendChild(this.logIconButton);

        // Create container div for the log table.
        this.logBox = document.createElement("div");
        this.logBox.className = "info-box log-box log-box-expanded visible";
        // Set an initial position (could be customized or made responsive)
        this.logBox.style.position = "absolute";
        // Add click handler to close help box when clicked
        this.logBox.addEventListener("click", () => {
            this.hideLogBox();
        });

        // Create the table element.
        this.table = document.createElement("table");
        this.table.style.display = "table";
        // Create a header row.
        this.table.appendChild(this._createRow("Actions"));

        // Append the table to the container.
        this.logBox.appendChild(this.table);

        // Append the container to the shadow DOM.
        this.shadowRoot.appendChild(this.logBox);

        // Apply shared styles.
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        // Make the logBox draggable.
        // (Assuming your makeDraggable function accepts the element and a container.)
        // makeDraggable(this.logBox, this.viewerContainer, (newTop, newLeft) => {
        //     this.logBox.style.top = `${newTop}px`;
        //     this.logBox.style.left = `${newLeft}px`;
        // });
        // Make the log icon draggable.
        // makeDraggable(this.logIconButton, this.viewerContainer, (newTop, newLeft) => {
        //     this.logIconButton.style.top = `${newTop}px`;
        //     this.logIconButton.style.left = `${newLeft}px`;
        // });
    }

    // Show the log box and hide the log icon
    showLogBox() {
        this.logVisible = true;
        this.logBox.classList.add("visible");
        this.logBox.classList.remove("hidden");
        this.logIconButton.classList.add("hidden");
        this.logIconButton.classList.remove("visible");
        this.logIconButton.setAttribute("aria-pressed", "true");
    }

    // Hide the log box and show the log icon
    hideLogBox() {
        this.logVisible = false;
        this.logBox.classList.add("hidden");
        this.logBox.classList.remove("visible");
        this.logIconButton.classList.add("visible");
        this.logIconButton.classList.remove("hidden");
        this.logIconButton.setAttribute("aria-pressed", "false");
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
        while (this.table.rows.length > 1) {
            this.table.deleteRow(1);
        }

        // Iterate over each formatted record string.
        this._records.forEach(line => {
            this.table.appendChild(this._createRow(line));
        });

        // Auto-scroll to the bottom for smooth UX.
        this.logBox.scrollTo({ top: this.logBox.scrollHeight, behavior: 'smooth' });
    }
}

customElements.define('log-table', LogTable);

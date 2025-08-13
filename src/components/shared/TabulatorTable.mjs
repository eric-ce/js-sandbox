/**
 * Handle 
 */
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_midnight.min.css';

/**
 * Info Table to display picked object data specific to the map
 * @extends {HTMLElement}
 */
class TabulatorTable extends HTMLElement {
    container;
    _annotationComponent;
    _currentTable;
    _data;
    _descriptionData;

    constructor() {
        super();
        this.container = null;
        this._annotationComponent = null;
    }


    get annotationComponent() {
        return this._annotationComponent;
    }
    set annotationComponent(component) {
        this._annotationComponent = component;
    }
    get container() {
        return this._container;
    }
    /**
     * Sets the container element for the Tabulator table.
     * @param {HTMLElement} mapContainer - The container element.
     */
    set container(mapContainer) {
        return this._container = mapContainer;
    }



    connectedCallback() {
        this._createTabulatorTable();
    }

    disconnectedCallback() {
        this.destroy();
    }

    /**
       * Creates a Tabulator table to display the picked object data
       * @param {{string: *}} descriptionData - The data to display in the table
       * @param {string} primitiveId - The ID of the primitive for the table title
       * @private
       */
    _createTabulatorTable(descriptionData, primitiveId) {
        // Inject Tabulator CSS into shadow root if not already present
        // let link = this.container.querySelector('#tabulator_midnight-css');
        // if (!link) {
        //     link = document.createElement('link');
        //     link.id = 'tabulator_midnight-css';
        //     link.rel = 'stylesheet';
        //     link.href = '/styles/tabulator_midnight.min.css'; // Updated path
        //     this.container.appendChild(link);
        // }

        // Find existing container or create new one
        let tableContainer = this.container.querySelector('#cesium-picked-object-table');
        if (!tableContainer) {
            tableContainer = document.createElement('div');
            tableContainer.id = 'cesium-picked-object-table';
            tableContainer.style.cssText = `
                position: absolute;
                top: 0px;
                left: 0px;
                width: 450px;
                max-height: 450px;
                background: rgba(38, 38, 38, 0.95);
                border: 1px solid #444;
                border-radius: 7px;
                z-index: 1001;
            `;

            // Create title div that holds h3 and close button
            const titleDiv = document.createElement('div');
            titleDiv.classList.add('info-table-title-container');
            titleDiv.style.cssText = `
                display: flex;
                justify-content: space-between;
                flex-direction: row-reverse;
                align-items: center;
                font-size: 16px;
                font-weight: bold;
                color: white;
                padding: 4px;
                background: rgba(84, 84, 84, 1);
                border: 1px solid #444;
                border-radius: 7px 7px 0 0;
            `;

            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.cssText = `
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                cursor: pointer;
            `;
            closeBtn.onclick = () => this._closeTabulatorTable();

            // Add title element use h3
            const title = document.createElement('h3');
            title.style.cssText = 'color: white; margin: 0 0 0 5px; font-size: 14px;';

            titleDiv.appendChild(closeBtn);
            titleDiv.appendChild(title);
            tableContainer.appendChild(titleDiv);
            this.container.appendChild(tableContainer);


            // Set initial position and make draggable only once
            const rect = this.container.getBoundingClientRect();
            const tableContainerRect = tableContainer.getBoundingClientRect();
            if (rect && rect.width > 0 && tableContainerRect.width > 0) {
                tableContainer.style.transform = `translate(${rect.right - tableContainerRect.width}px, ${rect.top + 50}px)`;
            }
            // makeDraggable(tableContainer, this.container);
        }

        // Clear existing table content only
        const existingTable = tableContainer.querySelector('.tabulator');
        if (existingTable) {
            existingTable.remove();
        }

        // Update title content
        const title = tableContainer.querySelector('.info-table-title-container h3');
        const objectType = descriptionData["Type"] || "Unknown";
        title.textContent = `${capitalizeString(objectType)} Details`;

        // Transform data for Tabulator
        const tableData = Object.entries(descriptionData).map(([property, value]) => ({
            property,
            value: String(value)
        }));

        // Create table div
        const tableDiv = document.createElement('div');
        tableDiv.style.fontSize = "16px";
        tableDiv.style.padding = "5px 10px";
        tableDiv.style.border = "1px solid #444";
        tableDiv.style.borderRadius = "0 0 7px 7px";
        tableContainer.appendChild(tableDiv);

        // Initialize Tabulator with editable configuration
        const table = new Tabulator(tableDiv, {
            data: tableData,
            layout: "fitColumns",
            height: "300px",
            resizableColumns: true,
            resizableRows: false,
            movableColumns: false,
            history: true, // Enable undo/redo functionality
            columns: [
                {
                    title: "Property",
                    field: "property",
                    width: 120,
                    minWidth: 80,
                    resizable: true,
                    headerFilter: false
                },
                {
                    title: "Value",
                    field: "value",
                    formatter: "textarea",
                    resizable: true,
                    minWidth: 100,
                    headerFilter: false,
                    editor: "input", // Make value column editable
                    editorParams: {
                        search: false,
                    }
                }
            ],
            theme: "midnight",
            // Event handlers for cell editing
            // cellEdited: (cell) => this._onCellEdited(cell, primitiveId),
            // dataChanged: (data) => this._onDataChanged(data, primitiveId)
        });

        // Add event listeners after table initialization
        table.on("cellEdited", (cell) => this._onCellEdited(cell, primitiveId));
        table.on("dataChanged", (data) => this._onDataChanged(data, primitiveId));


        // Store table reference for undo/redo operations
        this._currentTable = table;

        // Add undo/redo buttons to the title bar
        this._addUndoRedoButtons(tableContainer, table);

        // Set initial positions
        const rect = this.container.getBoundingClientRect();
        const tableContainerRect = tableContainer.getBoundingClientRect();
        if (!rect || rect.width === 0 || tableContainerRect === 0) return;
        tableContainer.style.transform = `translate(${rect.width - tableContainerRect.width - 100}px, 50px)`;

        // Make the table draggable
        // makeDraggable(tableContainer, this.container);
    }

    /**
     * Adds undo/redo buttons to the table title bar
     * @param {HTMLElement} tableContainer - The table container element
     * @param {Tabulator} table - The Tabulator instance
     * @private
     */
    _addUndoRedoButtons(tableContainer, table) {
        const titleDiv = tableContainer.querySelector('.info-table-title-container');
        if (!titleDiv) return;

        let buttonContainer = titleDiv.querySelector('.info-table-history-button-container');
        // Create button container
        if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.className = 'info-table-history-button-container';
            buttonContainer.style.cssText = `
            display: flex;
            gap: 5px;
            margin-right: 10px;
            `;
            titleDiv.appendChild(buttonContainer);


            // Undo button
            const undoBtn = document.createElement('button');
            undoBtn.innerHTML = '↶';
            undoBtn.title = 'Undo (Ctrl+Z)';
            undoBtn.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 3px;
                color: white;
                font-size: 14px;
                width: 20px;
                height: 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            undoBtn.onclick = () => table.undo();

            // Redo button
            const redoBtn = document.createElement('button');
            redoBtn.innerHTML = '↷';
            redoBtn.title = 'Redo (Ctrl+Y)';
            redoBtn.style.cssText = undoBtn.style.cssText; // Same styling
            redoBtn.onclick = () => table.redo();

            buttonContainer.appendChild(undoBtn);
            buttonContainer.appendChild(redoBtn);

            // Insert buttons before the close button
            // const closeBtn = titleDiv.querySelector('button');
            // titleDiv.insertBefore(buttonContainer, closeBtn);
            titleDiv.appendChild(buttonContainer);

            // Add keyboard shortcuts
            this._addKeyboardShortcuts(table);
        }
    }

    /**
     * Adds keyboard shortcuts for undo/redo
     * @param {Tabulator} table - The Tabulator instance
     * @private
     */
    _addKeyboardShortcuts(table) {
        // Remove existing listener to avoid duplicates
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
        }

        this._keyboardHandler = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    table.undo();
                } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
                    e.preventDefault();
                    table.redo();
                }
            }
        };

        document.addEventListener('keydown', this._keyboardHandler);
    }

    /**
    * Handles cell edit events to update primitive data
    * @param {Cell} cell - The edited cell
    * @param {string} primitiveId - The primitive ID
    * @private
    */
    _onCellEdited(cell, primitiveId) {
        const property = cell.getRow().getData().property;
        const newValue = cell.getValue();

        console.log(`🔄 Property "${property}" updated to: "${newValue}"`);

        // Update the primitive's feature properties
        this._updatePrimitiveProperty(primitiveId, property, newValue);
    }

    /**
     * Handles data change events (fires after any data modification)
     * @param {Array} data - The current table data
     * @param {string} primitiveId - The primitive ID
     * @private
     */
    _onDataChanged(data, primitiveId) {
        console.log('📊 Table data changed for primitive:', primitiveId, data);
        // You can implement bulk update logic here if needed
    }

    /**
     * Updates a primitive's property value
     * @param {string} primitiveId - The primitive ID
     * @param {string} propertyName - The property name to update
     * @param {any} newValue - The new value
     * @private
     */
    _updatePrimitiveProperty(primitiveId, propertyName, newValue) {
        // Find the primitive by ID
        const primitive = this._findPrimitiveById(primitiveId);
        if (!primitive || !primitive.feature || !primitive.feature.properties) {
            console.warn(`Primitive with ID ${primitiveId} not found or has no properties`);
            return;
        }

        // Convert formatted property name back to original key format
        const originalKey = this._getOriginalPropertyKey(primitive.feature.properties, propertyName);
        if (originalKey) {
            primitive.feature.properties[originalKey] = newValue;
            console.log(`Updated primitive property: ${originalKey} = ${newValue}`);
        } else {
            console.warn(`Original property key not found for: ${propertyName}`);
        }
    }

    /**
     * Finds the original property key from formatted display name
     * @param {Object} properties - The primitive properties object
     * @param {string} formattedKey - The formatted key from the table
     * @returns {string|null} The original property key
     * @private
     */
    _getOriginalPropertyKey(properties, formattedKey) {
        // Find the original key by comparing formatted versions
        return Object.keys(properties).find(key => {
            const formatted = camelCaseToWords(key);
            return formatted === formattedKey;
        });
    }

    /**
     * Finds a primitive by its ID across all collections
     * @param {string} primitiveId - The primitive ID to search for
     * @returns {Primitive|null} The found primitive or null
     * @private
     */
    _findPrimitiveById(primitiveId) {
        // Search in point collection
        const pointsLength = this.annotationComponent.pointCollection?.length || 0;
        for (let i = 0; i < pointsLength; i++) {
            const point = this.annotationComponent.pointCollection.get(i);
            if (point && point.id === primitiveId) return point;
        }

        // Search in label collection
        const labelsLength = this.annotationComponent.labelCollection?.length || 0;
        for (let i = 0; i < labelsLength; i++) {
            const label = this.annotationComponent.labelCollection.get(i);
            if (label && label.id === primitiveId) return label;
        }

        // Search in polyline collection
        const polyline = this.annotationComponent.polylineCollection?.find(p => p.id === primitiveId);
        if (polyline) return polyline;

        // Search in polygon collection
        const polygon = this.annotationComponent.polygonCollection?.find(p => p.id === primitiveId);
        if (polygon) return polygon;

        return null;
    }

    /**
     * Closes and removes the Tabulator table
     * @private
     */
    _closeTabulatorTable() {
        // Clean up keyboard handler
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
            this._keyboardHandler = null;
        }

        // Clear table reference
        this._currentTable = null;

        const tableContainer = this.container.querySelector('#cesium-picked-object-table');
        if (tableContainer) {
            tableContainer.remove();
        }
    }

    _createDescriptionData(primitive) {
        if (!primitive || !primitive.feature || !primitive.feature.properties) return null;

        const { id } = primitive;
        if (!id) return null; // Ensure id exists

        const excludedKeys = ["positions"]

        const descriptionData = {};
        Object.entries(primitive.feature.properties).forEach(([key, value]) => {
            // Skips the excluded keys
            if (excludedKeys.includes(key)) return;

            // Convert camelCase to words and capitalize the first letter
            const formattedKey = camelCaseToWords(key);
            descriptionData[formattedKey] = value;
        });
        // handle positions
        // if (positions.length > 0) {
        //     const flatPositions = positions.flat();
        //     flatPositions.forEach((pos, index) => {
        //         const cartographicDegrees = convertToCartographicDegrees(pos);
        //         Object.entries(cartographicDegrees).forEach(([key, value]) => {
        //             descriptionData[`Pos ${index + 1} ${key}`] = JSON.stringify(value);
        //         });
        //     });
        // }
        return descriptionData;
    }

    destroy() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
    }


}

customElements.define('tabulator-table', TabulatorTable);
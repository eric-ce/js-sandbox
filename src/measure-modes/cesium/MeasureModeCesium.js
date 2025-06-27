import { Cartesian3 } from "cesium";
import { MeasureModeBase } from "../MeasureModeBase.js";
import { areCoordinatesEqual, convertToCartesian3, createPointerOverlay } from "../../lib/helper/cesiumHelper.js";
import dataPool from "../../lib/data/DataPool.js";
import { Chart } from "chart.js/auto";
import { createCloseButton, makeDraggable } from "../../lib/helper/helper.js";

// Cesium types
/** @typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection */
/** @typedef {import('cesium').LabelCollection} LabelCollection */

// Dependencies types
/** @typedef {import('../../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/CesiumMeasure.js').CesiumMeasure} CesiumMeasure */

// Measure data 
/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */


/**
 * Shared functionality between modes in Cesium.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `cesiumHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeCesium extends MeasureModeBase {
    // Chart related
    /** @type {import("chart.js/auto").Chart} */
    chartInstance;
    /** @type {HTMLElement} */
    chartDiv;

    // Events cleanup
    /** @type {function(): void} */
    _closeButtonCleanup;

    // UI components
    /** @type {HTMLElement} */
    contextMenu;

    /**
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {CesiumInputHandler} inputHandler - The map input event handler abstraction.
     * @param {CesiumDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {CesiumHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {CesiumMeasure} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

    /**
     * Finds a measure by its ID.
     * @param {number} measureId - The ID of the measure to find.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureById(measureId) {
        if (typeof measureId !== "number") {
            console.warn("Invalid measureId provided. It should be a number.");
            return null; // Return null if measureId is not a number
        }

        const measure = dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measure) return; // If no measure found, exit the function

        // Convert cartographic degrees to Cartesian3 coordinates
        measure.coordinates = measure.coordinates.map(coord => convertToCartesian3(coord)); // Ensure coordinates are in Cartesian3 format
        return measure;
    }

    /**
     * Finds a measure by its coordinate.
     * @param {Cartesian3|Cartographic|{latitude:number, longitude:number, height: number}} coordinate - The coordinate to find the measure.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to Cesium Cartesian3 object
        const cartesian = convertToCartesian3(coordinate);
        if (!cartesian) return null;

        // Get all measure data from the data pool in Cartesian3 format
        const data = dataPool.getAllMeasures("cartesian");
        if (Array.isArray(data) && data.length === 0) return null;

        // Find the measure that contains the coordinate
        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, cartesian));
        })

        if (!measure) return null;

        // Clone the coordinates to avoid mutating the original data
        const clonedCoordinates = measure.coordinates.map(coord => {
            return Cartesian3.clone(coord);
        });

        // Return a new object with the coordinates cloned
        return { ...measure, coordinates: clonedCoordinates }; // Return a new object with the coordinates cloned
    }

    /**
     * Checks if the given coordinate is near any existing point in the mode.
     * @param {Cartesian3} coordinate - The coordinate to check.
     * @return {boolean} - Returns true if the coordinate is near an existing point, false otherwise.
     */
    _isNearPoint(coordinate) {
        if (!coordinate) {   // Validate input coordinate
            console.warn("Invalid coordinate provided.");
            return false;
        };

        // Get all measure data from the data pool in Cartesian3 format
        const data = dataPool.getAllMeasures("cartesian");

        if (!Array.isArray(data) && data.length === 0) {
            console.warn("No measures available in the data pool.");
            return false; // No measures available}
        }

        // Check if the coordinate is near any existing point in the mode
        return data.some(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => Cartesian3.distance(coord, coordinate) < 0.2);
        });
    }

    _setupPointerOverlay() {
        // update pointerOverlay: the moving dot with mouse
        let pointerElement = this.stateManager.getOverlayState("pointer");
        if (!pointerElement) {
            pointerElement = createPointerOverlay(this.map.container); // Create pointer overlay if not exists
        }
        this.stateManager.setOverlayState("pointer", pointerElement);
        return pointerElement;
    }

    /********************
     * CLEANING METHOD *
     ********************/
    removeAnnotationsAndListeners() {
        this.drawingHelper.clearCollections();
    }


    /*****************************************
     *        CHART FEATURE SPECIFIC         *
     * FOR PROFILE AND PROFILEDISTANCES MODE *
     *****************************************/
    /**
     * Creates and initializes the chart.
     * @param {object} specificChartConfig - Mode-specific chart configuration to merge with defaults.
     * @param {object} specificChartData - Mode-specific data for the chart.
     * @param {function} onHoverCallback - Mode-specific callback for chart hover events.
     * @returns {import("chart.js").Chart | null}
     */
    _createChart(specificChartConfig = {}, specificChartData = {}, onHoverCallback = null) {
        // -- Validate dependencies --
        if (!this.drawingHelper || !this.drawingHelper.map || !this.drawingHelper.map.container) {
            console.error("Cesium viewer or container not available to create chart.");
            return null;
        }

        // Ensure any existing chart is destroyed before creating a new one
        this._destroyChart();


        // -- Handle chart container --
        this.chartDiv = document.createElement("div");
        this.chartDiv.className = "cesium-chart"; // Use a more specific class name
        // It's better to use this.drawingHelper.map.container
        this.drawingHelper.map.container.appendChild(this.chartDiv);


        // -- Create and add the close button --
        const { button: closeButton, cleanup: closeButtonCleanup } = createCloseButton({
            clickCallback: () => {
                this._destroyChart()
            },
        });
        this._closeButtonCleanup = closeButtonCleanup; // Store cleanup function    
        this.chartDiv.appendChild(closeButton); // Add close button to chart div


        // -- Create the canvas element --
        const canvas = document.createElement("canvas");
        // Use this.modeName for a more specific ID if modes can have charts simultaneously
        canvas.id = `${this.mode || 'common'}-chart`;
        // Let CSS handle sizing primarily, or make it configurable
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        this.chartDiv.appendChild(canvas);


        // -- Handle chart container styles --
        // Apply styles via CSS classes or make them configurable
        Object.assign(this.chartDiv.style, {
            position: "absolute",
            top: "0px",
            left: "0px",
            transform: "translate(10px, 10px)", // Offset from the top-left corner
            width: "400px",
            height: "200px",
            backgroundColor: "white", // Corrected property name
            zIndex: "1000",
            border: "1px solid #ccc",
            boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
            display: "block" // Show by default, or control via a separate method
        });

        // -- Handle the Chart param --
        const ctx = canvas.getContext("2d");

        // Default configuration - can be overridden/extended by specificChartConfig
        const baseChartConfig = {
            type: "line",
            data: { // Base data structure, specificChartData will populate datasets
                labels: [], // Populated by specificChartData
                datasets: [
                    {
                        label: "Profile Data", // Generic label
                        data: [], // Populated by specificChartData
                        borderColor: "rgba(75, 192, 192, 1)",
                        borderWidth: 2,
                        fill: false, // Often better for profile lines
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, chartElements) => {
                    if (onHoverCallback && typeof onHoverCallback === 'function') {
                        onHoverCallback(event, chartElements, this.chartInstance);
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Distance (meters)", // Generic
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Height (meters)", // Generic
                        },
                    },
                },
            },
        };

        // Deep merge specific config and data
        const finalConfig = { ...baseChartConfig, ...specificChartConfig };
        if (specificChartData.labels) finalConfig.data.labels = specificChartData.labels;
        if (specificChartData.datasets) finalConfig.data.datasets = specificChartData.datasets;

        // -- Error Handling if not Chart --
        if (typeof Chart === 'undefined') {
            console.error("Chart.js is not loaded.");
            this._destroyChart(); // Clean up div if chart cannot be created
            return null;
        }

        // -- Create the chart instance --
        this.chartInstance = new Chart(ctx, finalConfig);

        // Storing custom data directly on chartInstance.customData is fine if needed,
        // but often the mode itself will hold the relevant source data.
        // this.chartInstance.customData = { /* ... */ };

        // -- Make the chart draggable --
        makeDraggable(this.chartDiv, this.drawingHelper.map.container);

        return this.chartInstance;
    }

    // /**
    // * Creates and styles a close button for the chart.
    // * @param {string} [className="close-button"] - The CSS class name for the button.
    // * @returns {HTMLButtonElement} The created button element.
    // */
    // _createCloseButton(options = {}) {
    //     const {
    //         className = "close-button",
    //         title = "close"
    //     } = options;

    //     const closeButton = document.createElement("button");
    //     closeButton.textContent = "×"; // Unicode 'X' (multiplication sign)
    //     closeButton.title = title;
    //     closeButton.className = className;

    //     const originalButtonColor = "#333";
    //     const hoverButtonColor = "#aaddff";

    //     Object.assign(closeButton.style, {
    //         position: "absolute",
    //         top: "5px",
    //         right: "5px",
    //         width: "20px",
    //         height: "20px",
    //         padding: "0",
    //         border: "none",
    //         background: "transparent",
    //         color: originalButtonColor,
    //         fontSize: "16px",
    //         fontWeight: "bold",
    //         lineHeight: "20px",
    //         textAlign: "center",
    //         cursor: "pointer",
    //         zIndex: "1001", // Ensure it's above the canvas
    //         transition: "all 0.2s ease-in-out 0.1s"
    //     });

    //     // Event listener for click
    //     closeButton.addEventListener("click", () => {
    //         this._destroyChart();
    //     });

    //     // Event listeners for hover effect
    //     closeButton.addEventListener("mouseenter", () => {
    //         closeButton.style.color = hoverButtonColor;
    //         closeButton.style.transform = "scale(1.3) rotate(180deg)"; // Slightly enlarge on hover
    //         // closeButton.style.backgroundColor = hoverButtonColor; // Light background on hover
    //     });
    //     closeButton.addEventListener("mouseleave", () => {
    //         closeButton.style.color = originalButtonColor;
    //         closeButton.style.transform = "scale(1) rotate(0deg)"; // Reset size on mouse leave
    //         // closeButton.style.backgroundColor = "transparent"; // Reset background on mouse leave
    //     });

    //     return closeButton;
    // }

    _destroyChart() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        if (this.chartDiv) {
            this.chartDiv.remove();
            this.chartDiv = null;
        }

        if (this._closeButtonCleanup) {
            this._closeButtonCleanup();
            this._closeButtonCleanup = null;
        }
    }

    /**
     * Updates the chart with new data.
     * @param {object} newData - Object containing new labels and datasets.
     *                         Example: { labels: [...], datasets: [{ data: [...] }] }
     */
    _updateChartData(newData) {
        if (this.chartInstance && newData) {
            if (newData.labels) {
                this.chartInstance.data.labels = newData.labels;
            }
            if (newData.datasets) {
                // Assuming the structure of datasets matches (e.g., updating the first dataset)
                // For more complex updates, you might need to merge more carefully
                newData.datasets.forEach((newDataset, index) => {
                    if (this.chartInstance.data.datasets[index]) {
                        Object.assign(this.chartInstance.data.datasets[index], newDataset);
                    } else {
                        this.chartInstance.data.datasets[index] = newDataset;
                    }
                });
            }
            this.chartInstance.update();
        }
    }

    _setChartVisibility(visible) {
        if (this.chartDiv) {
            this.chartDiv.style.display = visible ? 'block' : 'none';
        }
    }

    // TODO: new feature: context menu to replace complicated left or middle click events
    _setupContextMenu(container, itemOptions = [], options = {}) {
        const {
            show = true,
            x = 0,
            y = 0
        } = options;

        if (!container) {
            console.warn("Container is not provided for context menu setup.");
            return;
        }

        // Create the context menu element
        this.contextMenu = document.createElement("div");
        this.contextMenu.classList.add("an-context-menu");

        // Apply styles directly to the element
        Object.assign(this.contextMenu.style, {
            background: "white",
            border: "1px solid #ddd",
            borderRadius: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: "4px 0",
            minWidth: "120px",
            display: show ? 'block' : 'none',
            position: "absolute",
            left: `${x}px`,
            top: `${y}px`,
            zIndex: "1000"
        });

        // list of menu items using ul li 
        const menuList = document.createElement("ul");
        menuList.className = "an-context-menu-list";
        Object.assign(menuList.style, {
            listStyle: "none",
            margin: "0",
            padding: "0"
        });

        // Add menu items with direct styling
        itemOptions.forEach(item => {
            const menuItem = document.createElement("li");
            menuItem.classList.add("an-context-menu-list-item");
            menuItem.textContent = item.text;

            Object.assign(menuItem.style, {
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid #eee"
            });

            // Add hover effects
            menuItem.addEventListener("mouseenter", () => {
                menuItem.style.backgroundColor = "#f5f5f5";
            });
            menuItem.addEventListener("mouseleave", () => {
                menuItem.style.backgroundColor = "transparent";
            });

            menuItem.addEventListener("click", event => {
                item.event(event);
                this._setContextMenuVisibility(false);
            });
            menuList.appendChild(menuItem);
        });

        // Remove border from last item
        if (menuList.lastElementChild) {
            menuList.lastElementChild.style.borderBottom = "none";
        }
        this.contextMenu.appendChild(menuList);

        // Append the context menu to the specified container
        container.appendChild(this.contextMenu);

        return this.contextMenu;
    }

    /**
     * Update the context menu with new items and position. Fallbacks to setup context menu if not exists.
     * @param {HTMLElement} container - the map container where the context menu should be displayed
     * @param {{x:number, y:number}} position - the position where the context menu should be displayed
     * @param {*} itemOptions - the context menu items options
     *      e.g: [{text: "remove point", event: function() { }},{text: "remove line", event: function() { }}]
     * @param {*} options - additional options for the context menu
     * @returns {HTMLElement|null} - the updated context menu element or null if not created
     */
    _updateContextMenu(container, position, itemOptions = [], options = {}) {
        if (!this.contextMenu) return;

        // FIXME: the position needs to located at the mouse position.
        // Update the position of the context menu
        this.contextMenu.style.left = `${position.x}px`;
        this.contextMenu.style.top = `${position.y}px`;

        // Clear existing items
        const menuList = this.contextMenu.querySelector(".an-context-menu-list");
        if (menuList) {
            menuList.innerHTML = ""; // Clear existing items
            // Add new items
            itemOptions.forEach(item => {
                const menuItem = document.createElement("li");
                menuItem.textContent = item.text;
                menuItem.addEventListener("click", item.event);
                menuList.appendChild(menuItem);
            });
        } else {
            console.warn("Menu list not found in context menu.");
        }

        return this.contextMenu || null;
    }

    _setContextMenuVisibility(visible) {
        if (this.contextMenu) {
            this.contextMenu.style.display = visible ? 'block' : 'none';
        } else {
            console.warn("Context menu is not initialized.");
        }
    }
}

export { MeasureModeCesium };
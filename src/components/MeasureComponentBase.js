/**
 * Base class for all measure components of cesium-measure, google-measure, and leaflet-measure.
 * It handles UI creation, event handling, and data management for measurement tools.
 */

import dataPool from "../lib/data/DataPool.js";
import { sharedStyleSheet } from "../styles/sharedStyle.js";
import {
    BlendOption,
} from "cesium";
import {
    toolIcon,
    pickerIcon,
    pointsIcon,
    distanceIcon,
    curveIcon,
    heightIcon,
    multiDImage,
    multiDClampedIcon,
    polygonIcon,
    profileIcon,
    profileDistancesIcon,
    clearIcon,
    helpBoxIcon,
    logBoxIcon,
} from "../assets/icons.js";
import { CesiumInputHandler } from "../lib/input/CesiumInputHandler.js";
import { CesiumDragHandler, GoogleDragHandler } from "../lib/interaction/index.js";
import { GoogleMapsInputHandler } from "../lib/input/GoogleMapsInputHandler.js";
import { TwoPointsDistanceCesium, TwoPointsDistanceGoogle, MultiDistanceGoogle } from "../measure-modes/index.js";
export class MeasureComponentBase extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        // Core component state
        this._isInitialized = false;
        this._data = [];
        /** @type {'cesium' | 'google' | 'leaflet' | null} */
        this._mapName = null; // Map name (e.g., 'cesium', 'google', 'leaflet')

        // Dependencies (set via setters)
        this._map = null; // The specific map instance (Viewer, google.maps.Map, etc.)
        this._cesiumPkg = null; // Only relevant for CesiumMeasure
        this._app = null;
        this._stateManager = null;
        this._emitter = null;

        // Event handler references for cleanup
        this._dataHandler = null;

        // --- Local Active Mode Management ---
        /** @type {import('../lib/input/CesiumInputHandler').CesiumInputHandler | import('../lib/input/GoogleMapsInputHandler').GoogleMapsInputHandler | null} */
        this.inputHandler = null; // Map-specific input handler instance
        /** @type {object | null} */
        this.activeModeInstance = null; // The active measurement mode logic instance
        /** @type {string | null} */
        this.activeModeId = null; // e.g., 'distance', 'height'

        /** @type {HTMLElement | null} */
        this.toolbar = null; // Reference to the toolbar UI element
        /** @type {Object.<string, HTMLElement>} */
        this.uiButtons = {}; // References to mode buttons { 'distance-cesium': buttonElement, ... }
        // Store mode configurations available for this map type
        this.availableModeConfigs = [];

        this.pointCollection = null; // Cesium PointPrimitiveCollection
        this.labelCollection = null; // Cesium LabelCollection
    }

    // Getters and setters
    get app() {
        return this._app;
    }

    set app(app) {
        this._app = app;
        this.log = app.log;
    }

    get stateManager() {
        return this._stateManager;
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get data() {
        return this._data;
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    get map() {
        return this._map;
    }

    set map(map) {
        this._map = map;
    }

    get mapName() {
        return this._mapName;
    }

    set mapName(mapName) {
        if (this._mapName === mapName) return;
        this._mapName = mapName;
        // Re-initialize if mapName changes after connection and map is set
        // if (this.isConnected && this.map) {
        //     this._isInitialized = false; // Allow re-initialization
        //     // Clean up previous state before re-initializing
        //     this._deactivateCurrentMode();
        //     this.inputHandler?.destroy();
        //     this.inputHandler = null;
        //     this.toolbar?.remove();
        //     this.toolbar = null;
        //     this.uiButtons = {};
        //     // Remove listeners before re-adding
        //     if (this._modeChangeHandler && this.stateManager) {
        //         this.stateManager.off('activeModeChanged', this._modeChangeHandler);
        //     }
        //     if (this._dataHandler && this._emitter) {
        //         this._emitter.off("data", this._dataHandler);
        //     }
        //     this._initialize();
        // }
    }

    get cesiumPkg() {
        return this._cesiumPkg;
    }

    set cesiumPkg(pkg) {
        if (this._cesiumPkg === pkg) return; // Avoid re-setting if same instance
        this._cesiumPkg = pkg;
        // Initialize Cesium collection from Cesium package
        this._initializeCesiumCollections();
    }



    async connectedCallback() {
        // Apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];
        // Initialization now depends on map and mapName being set
        if (this.map && this.mapName && !this._isInitialized) {
            await this._initialize();
        }
    }

    disconnectedCallback() {
        console.log(`${this.constructor.name}: Disconnecting...`);
        // Clean up event listeners
        if (this._dataHandler && this._emitter) {
            this._emitter.off("data", this._dataHandler);
            this._dataHandler = null;
        }

        // Deactivate current mode and destroy input handler
        this._deactivateCurrentMode();
        this.inputHandler?.destroy();
        this.inputHandler = null;

        this.toolbar = null;
        this.uiButtons = {};
        this.availableModeConfigs = [];

        // Clean up map annotations
        if (this._data.length > 0) {
            this._data.forEach((item) => {
                if (item.annotations) {
                    this._removeAnnotations(item.annotations);
                }
            });
        }
        this._isInitialized = false;
        console.log(`${this.constructor.name}: Disconnected cleanup complete.`);
    }

    async _initialize() {
        // Prevent re-initialization if already done
        if (this._isInitialized) return;

        // --- Dependency Checks ---
        if (!this.map) {
            console.warn(`${this.constructor.name}: Map not set.`);
            return;
        }
        if (!this.mapName) {
            console.warn(`${this.constructor.name}: MapName not set.`);
            return;
        }
        if (!this.emitter) {
            console.warn(`${this.constructor.name}: Emitter not set.`);
            return;
        }
        if (!this.stateManager) {
            console.warn(`${this.constructor.name}: StateManager not set.`);
            return;
        }

        // --- Create Input Handler ---
        try {
            // Destroy previous handler if any (e.g., if mapName changed)
            this.inputHandler?.destroy();

            switch (this.mapName) {
                case "cesium":
                    this.inputHandler = new CesiumInputHandler(this.map);
                    break;
                case "google":
                    this.inputHandler = new GoogleMapsInputHandler(this.map);
                    break;
                case "leaflet":
                    // this.inputHandler = new LeafletInputHandler(this.map);
                    console.warn("LeafletInputHandler not yet implemented.");
                    this.inputHandler = null; // Mark as unavailable
                    break;
                default:
                    throw new Error(`Unsupported map type for Input Handler: ${this.mapName}`);
            }
            console.log(`${this.constructor.name}: Input handler created.`);
        } catch (error) {
            console.error(`${this.constructor.name}: Failed to create Input Handler:`, error);
            return; // Cannot proceed without input handler
        }

        // --- *** Create Interaction Handlers *** ---
        try {
            this.dragHandler?.destroy(); // Destroy previous if any
            // this.highlightHandler?.destroy();

            switch (this.mapName) {
                case "cesium":
                    // Pass dependencies needed by CesiumDragHandler
                    this.dragHandler = new CesiumDragHandler(this.map, this.inputHandler, this.emitter);
                    // this.highlightHandler = new CesiumHighlightHandler(this.map, this.inputHandler, this.emitter);
                    break;
                case "google":
                    // Pass dependencies needed by GoogleDragHandler
                    this.dragHandler = new GoogleDragHandler(this.map, this.inputHandler, this.emitter);
                    // this.highlightHandler = new GoogleHighlightHandler(this.map, this.inputHandler, this.emitter);
                    break;
                // case "leaflet": // Add Leaflet handlers later
                default:
                    console.warn(`Drag/Highlight handlers not implemented for ${this.mapName}`);
                    this.dragHandler = null;
                    this.highlightHandler = null;
            }
            console.log(`${this.constructor.name}: Interaction handlers created (or skipped).`);
        } catch (error) {
            console.error(`${this.constructor.name}: Failed to create Interaction Handlers:`, error);
            // Continue without drag/highlight? Or return? Depends on requirements.
            this.dragHandler = null;
            this.highlightHandler = null;
        }

        // --- Create UI ---
        this._createUI(this.mapName); // Create the toolbar depends on the map type

        // --- Setup Listeners ---
        // Listen for data changes to draw persistent measurements
        if (!this._dataHandler) {
            const handleData = (data) => { this._drawFromDataArray(data); };
            this.emitter.on("data", handleData);
            this._dataHandler = handleData; // Store the handler reference for cleanup
        }

        // --- Draw Initial Data ---
        if (dataPool?.data?.length > 0) {
            this._data = [...dataPool.data];
            this._drawFromDataArray(this._data);
        }

        // --- Call map-specific initialization hook ---
        this._initializeMapSpecifics(); // Allow derived classes to add setup

        this._isInitialized = true;
    }

    //TODO: create the UI
    /**
     * Creates the measurement toolbar and buttons within the shadow DOM.
     * Uses lazy instantiation for mode classes.
     * @param {'cesium' | 'google' | 'leaflet'} mapName - The type of the current map.
     * @private
     */
    _createUI(mapName) {
        if (this.toolbar) this.toolbar.remove(); // Clear existing
        this.uiButtons = {};
        this.availableModeConfigs = []; // Reset available modes

        this.toolbar = document.createElement("div");
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", "Measurement Tools");
        this.toolbar.classList.add("measure-toolbar");
        // set toolbar position
        this.toolbar.style.position = "absolute";
        this.toolbar.style.transform = `translate(${120}px, ${-160}px)`;
        this.toolbar.style.zIndex = 400;

        // --- Define Mode Configurations ---
        // Store CLASS definitions, not instances
        const allModeConfigs = [
            {
                id: "picker",
                name: "Picker",
                icon: pickerIcon,
                mapAvailability: ["cesium", "google", "leaflet"], // Maps this mode works on
                getClass: (type) => {
                    // Function to get the correct class based on map type
                    if (type === "google") return PickerGoogle;
                    if (type === "cesium") return PickerCesium;
                    if (type === "leaflet") return PickerLeaflet;
                }
            },
            {
                id: 'bookmark',
                name: 'Bookmark',
                icon: pointsIcon,
                mapAvailability: ['cesium', 'google', 'leaflet'],
                getClass: (type) => {
                    if (type === 'google') return BookmarkGoogle;
                    if (type === 'cesium') return BookmarkCesium; // Use specific for now
                    if (type === 'leaflet') return BookmarkLeaflet;
                    return null;
                }
            },
            {
                id: "distance",
                name: "Distance",
                icon: distanceIcon,
                mapAvailability: ["cesium", "google", "leaflet"], // Maps this mode works on
                getClass: (type) => {
                    // Function to get the correct class based on map type
                    if (type === "google") return TwoPointsDistanceGoogle;
                    if (type === "cesium") return TwoPointsDistanceCesium; // Use specific for now
                    if (type === 'leaflet') return TwoPointsDistanceLeaflet;
                    return null;
                },
            },
            {
                id: "curve",
                name: "Curve",
                icon: curveIcon,
                mapAvailability: ["cesium"],
                getClass: (type) => (type === 'cesium' ? CurveCesium : null)
            },
            {
                id: 'multi_distance',
                name: 'Multi Distance',
                icon: multiDImage,
                mapAvailability: ['cesium', 'google', 'leaflet'],
                getClass: (type) => {
                    if (type === 'google') return MultiDistanceGoogle;
                    if (type === 'cesium') return MultiDistanceCesium; // Use specific for now
                    if (type === 'leaflet') return MultiDistanceLeaflet;
                    return null;
                },
            },
            {
                id: "multi_distances_clamped",
                name: "Multi Distances Clamped",
                icon: multiDClampedIcon,
                mapAvailability: ["cesium"],
                getClass: (type) => (type === 'cesium' ? MultiDistanceClampedCesium : null)
            },
            {
                id: "polygon",
                name: "Polygon",
                icon: polygonIcon,
                mapAvailability: ["cesium", "google", "leaflet"],
                getClass: (type) => {
                    if (type === 'google') return PolygonGoogle;
                    if (type === 'cesium') return PolygonCesium;
                    if (type === 'leaflet') return PolygonLeaflet;
                    return null; // Example: Polygon not implemented yet for Google/Cesium specific
                },
            },
            {
                id: 'height',
                name: 'Height',
                icon: heightIcon,
                mapAvailability: ['cesium'],
                getClass: (type) => (type === 'cesium' ? HeightCesium : null)
            },
            {
                id: 'profile',
                name: 'Profile',
                icon: profileIcon,
                mapAvailability: ['cesium'],
                getClass: (type) => (type === 'cesium' ? ProfileCesium : null)
            },
            {
                id: 'profile_distances',
                name: 'Profile Distances',
                icon: profileDistancesIcon,
                mapAvailability: ['cesium'],
                getClass: (type) => (type === 'cesium' ? ProfileDistanceCesium : null)
            },
            // Add other modes (Curve, MultiDistance, etc.) similarly
        ];

        // --- Filter modes available for the current map type ---
        this.availableModeConfigs = allModeConfigs.filter(m => m.mapAvailability.includes(mapName));

        // --- Create Buttons ---
        this.availableModeConfigs.forEach((modeConfig) => {
            const btn = document.createElement("button");
            const modeId = modeConfig.id; // Unique ID for the button

            if (modeConfig.icon) {
                btn.innerHTML = `<img src="${modeConfig.icon}" alt="${modeConfig.name}" style="width: 30px; height: 30px; display: block;">`; // Adjust size
            } else {
                btn.textContent = modeConfig.name.slice(0, 3); // Fallback text
            }
            btn.title = modeConfig.name; // Tooltip
            btn.className = `annotate-button animate-on-show measure-button-${modeId}`;
            btn.dataset.modeId = modeId; // Store mode ID for the handler

            btn.addEventListener("click", (e) => {
                e.stopPropagation(); // Prevent map click through button
                // When button is clicked, tell StateManager the desired mode ID
                // check if the button is inactive if so activate it
                if (btn.classList.contains("active")) {
                    btn.classList.remove("active");
                    btn.setAttribute("aria-pressed", "false");
                }

                // activate the mode
                this._handleModeButtonClick(modeId);
            });

            this.toolbar.appendChild(btn);
            this.uiButtons[modeId] = btn; // Store reference by mode ID
        });

        // Append the toolbar to the shadow root
        this.shadowRoot.appendChild(this.toolbar);
    }

    /**
     * Handles clicks on the mode buttons within this component's toolbar.
     * Determines whether to activate a new mode or deactivate the current one.
     * @param {string} clickedModeId - The ID of the mode button that was clicked.
     * @private
     */
    _handleModeButtonClick(clickedModeId) {
        console.log(`${this.constructor.name}: Button clicked for mode '${clickedModeId}'`);
        const currentModeId = this.activeModeId;

        if (currentModeId === clickedModeId) {
            // Clicked the already active button - deactivate
            this._activateMode(null, this.mapName); // Pass null to deactivate
        } else {
            // Clicked a new button - activate the new mode
            // _activateMode will handle deactivating the old one first
            this._activateMode(clickedModeId, this.mapName);
        }
    }

    /**
     * Activates a specific measurement mode based on ID and map type.
     * Handles lazy instantiation.
     * @param {string | null} modeId - The id of the mode to activate (e.g., 'distance').
     * @param {string} mapType - 'cesium', 'google', or 'leaflet'.
     * @private
     */
    _activateMode(modeId, mapType) {
        // --- Pre-checks ---
        if (!this.inputHandler && modeId) { // Don't check if deactivating (modeId is null)
            console.warn(`${this.constructor.name}: Input handler not ready. Cannot activate mode '${modeId}'.`);
            return;
        }
        // --- End Pre-checks ---

        const currentActiveModeId = this.activeModeId;

        // --- Deactivate existing mode ---
        if (this.activeModeInstance && (currentActiveModeId !== modeId || !modeId)) {
            this._deactivateCurrentMode();
        }

        // If the request was just to deactivate, exit now
        if (!modeId || modeId === "inactive") {
            // Ensure all buttons are visually inactive
            Object.values(this.uiButtons).forEach((btn) => { btn.classList.remove("active"); });
            return;
        }

        // Prevent activating the same mode again if it's already active
        if (currentActiveModeId === modeId) {
            return;
        }
        // --- End Deactivation ---

        // --- Find Mode Configuration ---
        const config = this.availableModeConfigs.find((m) => m.id === modeId);
        if (!config) {
            console.warn(
                `${this.constructor.name}: Mode "${modeId}" not found or not available for map type "${mapType}".`
            );
            return;
        }

        const ModeClass = config.getClass(mapType);
        if (!ModeClass) {
            console.warn(
                `${this.constructor.name}: Mode class for "${modeId}" on "${mapType}" is not defined or supported yet.`
            );
            return;
        }
        // --- End Find Mode ---

        // --- Instantiate and Activate New Mode ---
        let args = [];
        // --- Determine Arguments ---
        // FUTURE GOAL: All shared modes take standard args
        // Define standard arguments including interaction handlers
        const standardArgs = [
            this.inputHandler,     // IInputEventHandler
            this.dragHandler,      // IDragHandler | null
            this.highlightHandler, // IHighlightHandler | null
            this,                  // IDrawingHelper (this component)
            this.stateManager,     // StateManager
            this.emitter           // EventEmitter
        ];

        // TEMPORARY logic based on current specific classes:
        if (ModeClass.name.includes("Cesium")) {
            args = [...standardArgs, this._cesiumPkg]; // Cesium specific needs cesium package
        } else {
            args = standardArgs;
        }
        // --- End Determine Arguments ---

        // --- Activate the Mode ---
        this.activeModeId = modeId; // Store the ID
        console.log(`${this.constructor.name}: Instantiating and activating ${ModeClass.name}`);
        try {
            this.activeModeInstance = new ModeClass(...args);
            if (typeof this.activeModeInstance.activate !== "function") {
                throw new Error(`Mode class ${ModeClass.name} does not have an activate method.`);
            }
            this.activeModeInstance.activate();

            // Update UI Button State using classes
            Object.entries(this.uiButtons).forEach(([_, btn]) => {
                // Check dataset.modeId which should match the config ID
                if (btn.dataset.modeId === modeId) {
                    btn.classList.add("active"); // Add 'active' class
                } else {
                    btn.classList.remove("active");
                }
            });
        } catch (error) {
            console.error(`Error activating mode ${modeId} for ${mapType}:`, error);
            this.activeModeInstance = null;
            this.activeModeId = null;
            // Reset UI
            Object.values(this.uiButtons).forEach((btn) => {
                btn.classList.remove("active");
            });
        }
        // --- End Activation ---
    }

    /** Deactivates the currently active mode instance. */
    _deactivateCurrentMode = () => {
        if (this.activeModeInstance) {
            const modeName = this.activeModeId || "current";
            console.log(`${this.constructor.name}: Deactivating mode instance: ${modeName}`);
            try {
                if (typeof this.activeModeInstance.deactivate === "function") {
                    this.activeModeInstance.deactivate();
                }
            } catch (error) {
                console.error(`Error during deactivation of ${modeName}:`, error);
            } finally {
                // Ensure state is cleared even if deactivate fails
                this.activeModeInstance = null;
                this.activeModeId = null;
                // Reset input handler cursor to default when no mode is active
                this.inputHandler?.setCursor("default");
            }
        }
    };

    _initializeMapSpecifics() {
        // Base implementation does nothing, intended for override
        console.log(`${this.constructor.name}: Base _initializeMapSpecifics called.`);
    }

    /******************************
     * SYNC DRAWING DATA FOR MAPS *
     ******************************/
    /**
     * Draws the measurement data on the map based on the data array of objects.
     * @param {Array} data - The data array containing measurement data.
     * @returns {void}
     */
    _drawFromDataArray(data) {
        // Use Array.isArray for proper type checking
        if (!Array.isArray(data) || data.length === 0) return;

        // For small datasets, process immediately
        if (data.length <= 20) {
            data.forEach((item) => this._drawFromDataObject(item));
            return;
        }

        // For larger datasets, use batching
        this._processBatches(data, (item) => this._drawFromDataObject(item));
    }

    /**
     * Draws the measurement data on the map based on the data object.
     * @param {Object} data - The data object containing measurement data.
     * @param {string} data.id - Unique identifier for the data object.
     * @param {string} data.mode - Measurement mode
     * @param {Array<{latitude: number, longitude: number}>} data.coordinates - Array of coordinate objects.
     * @returns {void}
     */
    _drawFromDataObject(data) {
        // Check if coordinates property exists
        if (!data?.coordinates) return;
        // check if drawing from the map don't sync for the same map
        if (data.mapName === this.mapName) return;

        const emptyAnnotations = { markers: [], polylines: [], polygon: null, labels: [] };
        const existingIndex = this._data.findIndex((item) => item.id === data.id);
        const existingMeasure = existingIndex >= 0 ? this._data[existingIndex] : null;

        // Create empty annotations object
        const annotations = {
            markers: [],
            polylines: [],
            polygon: null,
            labels: [],
        };

        // Remove Operation: If no coordinates, remove annotations and exit early
        if (data.coordinates.length === 0) {
            if (existingMeasure?.annotations) {
                this._removeAnnotations(existingMeasure.annotations);
            }
            const updatedData = { ...data, annotations: emptyAnnotations };
            if (existingIndex >= 0) {
                this._data[existingIndex] = updatedData;
            } else {
                this._data.push(updatedData);
            }
            return;
        }

        // Update Operation: If data existing, check if coordinates changed
        if (existingMeasure) {
            // const coordsEqual = this._areCoordinatesEqual(existingMeasure.coordinates, data.coordinates);
            const coordsEqual = data.coordinates.every((coord, index) => {
                this._areCoordinatesEqual(coord, existingMeasure.coordinates[index]);
            });

            // It means data correctly drawn, coordinates haven't changed and annotations exist, exit early
            if (coordsEqual && existingMeasure.annotations) return;

            // It means data updates, Clean up existing annotations regardless of mode
            this._removeAnnotations(existingMeasure.annotations);
        }

        // Create new annotations based on the mode
        switch (data.mode) {
            case "polygon":
                annotations.polygon = this._addPolygon(data.coordinates);
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.labels = [
                    this._addLabel(data.coordinates, data._records[0], "squareMeter"),
                ];
                break;
            case "bookmark":
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.labels = [
                    this._addLabel(
                        [data.coordinates[0], data.coordinates[0]],
                        `Point ${data.labelNumberIndex + 1}`
                    ),
                ];
                break;
            case "multi_distances":
            case "multi_distances_clamped":
            case "profile_distances":
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.polylines = this._addPolylinesFromArray(data.coordinates);
                annotations.labels = this._addLabelsFromArray(
                    data.coordinates,
                    data._records[0]?.distances
                );
                // add label for total distance
                if (data.status === "completed") {
                    const endCoords = data.coordinates[data.coordinates.length - 1];
                    annotations.labels &&
                        annotations.labels.push(
                            this._addLabel(
                                [endCoords, endCoords],
                                data._records[0]?.totalDistance[0]
                            )
                        );
                }
                break;
            default:
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.polylines = this._addPolylinesFromArray(data.coordinates);
                annotations.labels = this._addLabelsFromArray(data.coordinates, data._records);
                break;
        }

        // Update data store
        const updatedData = { ...data, annotations };

        if (existingIndex >= 0) {
            // Update existing data
            this._data[existingIndex] = updatedData;
        } else {
            // Add new data
            this._data.push({ ...data, annotations });
        }
    }

    /**
     * Checks if two coordinate objects are equal by comparing only latitude and longitude.
     * Height values are intentionally ignored in the comparison.
     * @param {Object} coord1 - First coordinate object with latitude and longitude properties
     * @param {Object} coord2 - Second coordinate object with latitude and longitude properties
     * @returns {boolean}
     */
    _areCoordinatesEqual(coord1, coord2) {
        // Check if both coordinates have valid latitude and longitude
        if (!coord1 || !coord2) return false;
        if (typeof coord1.latitude !== "number" || typeof coord1.longitude !== "number")
            return false;
        if (typeof coord2.latitude !== "number" || typeof coord2.longitude !== "number")
            return false;

        // Compare only latitude and longitude, ignoring height
        return coord1.latitude === coord2.latitude && coord1.longitude === coord2.longitude;
    }

    /**
     * Process an array of items in batches to avoid UI blocking in order to improve performance.
     * @param {Array} items - Array of items to process
     * @param {Function} processor - Function to call for each item
     * @param {number} [batchSize=20] - Number of items to process per batch
     */
    _processBatches(items, processor, batchSize = 20) {
        let index = 0;

        const processNextBatch = () => {
            // Calculate end index for current batch
            const endIndex = Math.min(index + batchSize, items.length);

            // Process current batch
            for (let i = index; i < endIndex; i++) {
                processor(items[i]);
            }

            // Update index for next batch
            index = endIndex;

            // If more items remain, schedule next batch
            if (index < items.length) {
                requestAnimationFrame(processNextBatch);
            }
        };

        // Start processing the first batch
        processNextBatch();
    }

    /********************************************************
     *           VISUALIZATION OF MAP ANNOTATIONS           *
     * REPLACED IN SUBCLASSES TO HANDLE SPECIFIC ANNOTATION *
     ********************************************************/
    /**
     * Removes all annotations in the provided annotations object.
     * @private
     * @param {Object} annotations - Object containing markers, polylines, and polygon
     */
    _removeAnnotations(annotations) {
        if (!annotations) return;

        annotations.markers?.forEach((marker) => this._removePointMarker(marker));
        annotations.polylines?.forEach((line) => this._removePolyline(line));
        if (annotations.polygon) this._removePolygon(annotations.polygon);
        annotations.labels?.forEach((label) => this._removeLabel(label));
    }

    // Abstract methods that must be implemented by subclasses
    _addPointMarker(position, color, options) {
        throw new Error("_addPointMarker must be implemented by subclass");
    }

    _addPointMarkersFromArray(positions, color, options) {
        throw new Error("_addPointMarkersFromArray must be implemented by subclass");
    }

    _addPolyline(positions, color, options) {
        throw new Error("_addPolyline must be implemented by subclass");
    }

    _addPolylinesFromArray(positions, color, options) {
        throw new Error("_addPolylinesFromArray must be implemented by subclass");
    }

    _addPolygon(positions, color, options) {
        throw new Error("_addPolygon must be implemented by subclass");
    }
    _addLabel(positions, text, unit, options) {
        throw new Error("_addLabel must be implemented by subclass");
    }

    _addLabelsFromArray(positions, text, unit, options) {
        throw new Error("_addLabelsFromArray must be implemented by subclass");
    }

    _removePointMarker(marker) {
        throw new Error("_removePointMarker must be implemented by subclass");
    }

    _removePolyline(polyline) {
        throw new Error("_removePolyline must be implemented by subclass");
    }

    _removePolygon(polygon) {
        throw new Error("_removePolygon must be implemented by subclass");
    }

    _removeLabel(label) {
        throw new Error("_removeLabel must be implemented by subclass");
    }
}

import dataPool from "../lib/data/DataPool.js";
import { sharedStyleSheet } from "../styles/sharedStyle.js";
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
import { GoogleMapsInputHandler } from "../lib/input/GoogleMapsInputHandler.js";
import { LeafletInputHandler } from "../lib/input/LeafletInputHandler.js";
import { CesiumDragHandler, CesiumHighlightHandler, GoogleDragHandler, GoogleHighlightHandler, LeafletDragHandler, LeafletHighlightHandler } from "../lib/interaction/index.js";
import { TwoPointsDistanceCesium, PolygonCesium, ThreePointsCurveCesium, PointInfoCesium, HeightCesium, ProfileCesium, MultiDistancesCesium, MultiDistancesClampedCesium, ProfileDistancesCesium, PointInfoGoogle, TwoPointsDistanceGoogle, PolygonGoogle, MultiDistanceGoogle, PointInfoLeaflet, TwoPointsDistanceLeaflet, PolygonLeaflet, MultiDistanceLeaflet } from "../measure-modes/index.js";
import { InstructionsTable } from "./shared/InstructionsTable.js";
import { DataLogTable } from "./shared/DataLogTable.js";
import { makeDraggable } from "../lib/helper/helper.js";



/**
 * @typedef MeasurementGroup
 * @property {{labels: [], markers: [], polygon: object, polylines: []}} annotations
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */

/** @typedef {import('../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../lib/input/GoogleMapsInputHandler.js').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../lib/interaction/GoogleDragHandler.js').GoogleDragHandler} GoogleDragHandler */
/** @typedef {import('../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('../lib/interaction/GoogleHighlightHandler.js').GoogleHighlightHandler} GoogleHighlightHandler */
/** @typedef {import('../lib/interaction/LeafletDragHandler.js').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../lib/interaction/LeafletHighlightHandler.js').LeafletHighlightHandler} LeafletHighlightHandler */

/**
 * Base class for all measure components of cesium-measure, google-measure, and leaflet-measure.
 * It handles UI creation, event handling, and data management for measurement tools.
 */
export class MeasureComponentBase extends HTMLElement {
    // --- Private Fields ---
    /** @type {boolean} */
    #isInitialized = false;
    /** @type {MeasurementGroup[]} */
    #data = []; // Internal data, not for sharing with other components
    /** @type {'cesium' | 'google' | 'leaflet' | null} */
    #mapName = null;
    /** @type {import('cesium').Viewer | google.maps.Map| L.map| null| undefined} */
    #map = null; // The specific map instance (Viewer, google.maps.Map, etc.)
    /** @type {Object} */
    #cesiumPkg = null; // Only relevant for CesiumMeasure
    /** @type {Object} */
    #app = null;
    /** @type {import('../lib/state/StateManager').StateManager | null} */
    #stateManager = null;
    /** @type {import('../lib/events/EventEmitter').EventEmitter | null} */
    #emitter = null;
    /** @type {import('../lib/data/DataPool').DataPool | null} */
    #dataHandler = null; // Reference to the bound data listener

    /** @type {HTMLElement | null} */
    _buttonContainer = null;
    /** @type {DocumentFragment | null} */
    _buttonFragment = null;
    /** @type {boolean} */
    _isToggling = false;
    /** @type {Array<number>} */
    _toggleTimeouts = [];

    // --- Public Fields ---
    log = null;
    /** @type {CesiumInputHandler | GoogleMapsInputHandler | null} */
    inputHandler = null;
    /** @type {CesiumDragHandler | GoogleDragHandler | null} */
    dragHandler = null;
    /** @type {CesiumHighlightHandler | GoogleHighlightHandler | null} */ // Replace 'any' with specific type if available
    highlightHandler = null;
    /** @type {object | null} */
    activeModeInstance = null;
    /** @type {string | null} */
    activeModeId = null;
    /** @type {HTMLElement | null} */
    toolbar = null;
    /** @type {{string: HTMLElement}} */
    uiButtons = {};
    /** @type {HTMLElement | null} */
    dataLogTable = null;
    /** @type {HTMLElement | null} */
    instructionsTable = null;
    /** @type {Array<object>} */ // Consider a more specific type for mode configs
    availableModeConfigs = [];
    /** @type {{ [modeId: string]: object }} */
    #modeInstances = {}; // Pool to store instantiated modes

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._buttonFragment = document.createDocumentFragment();
    }

    /***********************
     * GETTERS AND SETTERS *
     ***********************/
    get app() {
        return this.#app;
    }
    set app(app) {
        this.#app = app;
        this.log = app.log;
    }

    get stateManager() {
        return this.#stateManager;
    }
    set stateManager(manager) {
        this.#stateManager = manager;
    }

    get data() {
        return this.#data;
    }

    get emitter() {
        return this.#emitter;
    }
    set emitter(emitter) {
        this.#emitter = emitter;
    }

    get map() {
        return this.#map;
    }
    set map(map) {
        this.#map = map;
    }

    get mapName() {
        return this.#mapName;
    }
    set mapName(name) {
        if (this.#mapName === name) return;
        this.#mapName = name;
    }

    get cesiumPkg() {
        return this.#cesiumPkg;
    }
    set cesiumPkg(pkg) {
        if (this.#cesiumPkg === pkg) return; // Avoid re-setting if same instance
        this.#cesiumPkg = pkg;
    }


    async connectedCallback() {
        // Apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];
        // Initialization now depends on map and mapName being set
        if (this.map && this.mapName && !this.#isInitialized) {
            await this._initialize();
        }
    }

    disconnectedCallback() {
        console.log(`${this.constructor.name}: Disconnecting...`);
        // Clean up event listeners
        if (this.#dataHandler && this.emitter) {
            this.emitter.off("data", this.#dataHandler);
            this.#dataHandler = null;
        }

        // Deactivate current mode
        // this._deactivateCurrentMode();
        Object.values(this.#modeInstances).forEach(instance => {
            if (instance && typeof instance.destroy === 'function') {
                // console.log(`${this.constructor.name}: Destroying pooled mode instance: ${instance.mode || 'unknown mode'}`);
                instance.destroy();
            }
        });
        this.#modeInstances = {}; // Clear the instance pool

        // Destroy interaction handler
        this.inputHandler?.destroy();
        this.inputHandler = null;
        this.dragHandler?.destroy();
        this.dragHandler = null;
        this.highlightHandler?.destroy();
        this.highlightHandler = null;

        this._toggleTimeouts.forEach(clearTimeout);
        this._toggleTimeouts = [];

        // Clear references 
        if (this.toolbar) {
            this.toolbar.remove();
            this.toolbar = null;
        }
        this._buttonContainer = null;

        this.uiButtons = {};
        this.availableModeConfigs = [];

        // Clean up map annotations from sync drawing
        if (this.#data.length > 0) {
            this.#data.forEach((item) => {
                if (item.annotations) {
                    this._removeAnnotations(item.annotations);
                }
            });
            this.#data = [];
        }
        this.#isInitialized = false;
        console.log(`${this.constructor.name}: Disconnected cleanup complete.`);

        // FIXME: update clean up methods to clean all necessary variables
    }


    /**************
     * INITIALIZE *
     **************/
    async _initialize() {
        // Prevent re-initialization if already done
        if (this.#isInitialized) return;

        // --- Dependency Checks ---
        if (!this.map || !this.mapName || !this.emitter || !this.stateManager) {
            console.error(`${this.constructor.name}: Initialization failed - missing dependencies.`);
            return;
        }

        // --- Create Handler ---
        try {
            // Destroy previous handler if any 
            this.inputHandler?.destroy();
            this.dragHandler?.destroy();
            this.highlightHandler?.destroy();

            switch (this.mapName) {
                case "cesium":
                    this.inputHandler = new CesiumInputHandler(this.map);
                    this.dragHandler = new CesiumDragHandler(this.map, this.inputHandler, this.emitter);
                    this.highlightHandler = new CesiumHighlightHandler(this.map, this.inputHandler, this.emitter);

                    break;
                case "google":
                    this.inputHandler = new GoogleMapsInputHandler(this.map);
                    this.dragHandler = new GoogleDragHandler(this.map, this.inputHandler, this.emitter);
                    this.highlightHandler = new GoogleHighlightHandler(this.map, this.inputHandler, this.emitter);
                    break;
                case "leaflet":
                    this.inputHandler = new LeafletInputHandler(this.map);
                    this.dragHandler = new LeafletDragHandler(this.map, this.inputHandler, this.emitter);
                    this.highlightHandler = new LeafletHighlightHandler(this.map, this.inputHandler, this.emitter);
                    break;
                default:
                    throw new Error(`Unsupported map type for Input Handler: ${this.mapName}`);
            }
        } catch (error) {
            this.inputHandler = null; // Reset input handler on error
            this.dragHandler = null;
            this.highlightHandler = null;

            console.error(`${this.constructor.name}: Failed to create Handler:`, error);

            return; // Cannot proceed without input handler
        }


        // --- Create UI ---
        this._createUI(this.mapName); // Create the toolbar depends on the map type

        // --- Setup Listeners ---
        // Listen for data changes to draw persistent measurements
        if (!this.#dataHandler) {
            const handleData = (data) => { this._drawFromDataArray(data); };
            this.emitter.on("data", handleData);
            this.#dataHandler = handleData; // Store the handler reference for cleanup
        }

        // --- Draw Initial Data ---
        if (dataPool?.data?.length > 0) {
            this.#data = [...dataPool.data];
            this._drawFromDataArray(this.#data);
        }

        // --- Call map-specific initialization hook ---
        this._initializeMapSpecifics(); // Allow derived classes to add setup

        this.#isInitialized = true;
    }

    _initializeMapSpecifics() {
        // this method is overridden in the subclasses to add map-specific initialization logic
        // console.log(`${this.constructor.name}: Base _initializeMapSpecifics called.`);
    }

    /***************
     * UI CREATION *
     ***************/
    // --- UI Creation and Mode Activation ---
    /**
     * Creates the measurement toolbar and buttons.
     * Uses lazy instantiation for mode classes.
     * @param {'cesium' | 'google' | 'leaflet'} mapName - The type of the current map.
     * @private
     */
    _createUI(mapName) {
        // Clear existing UI elements safely
        if (this.toolbar) this.toolbar.remove(); // Clear existing
        this.uiButtons = {};
        this.availableModeConfigs = []; // Reset available modes
        this._buttonContainer = null; // Reset button container

        this.toolbar = document.createElement("div");
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", "Measurement Tools");
        this.toolbar.classList.add("measure-toolbar");
        // set toolbar position
        this.toolbar.style.position = "absolute";
        this.toolbar.style.top = "0px";
        this.toolbar.style.left = "0px";
        this.toolbar.style.zIndex = 400;
        this.toolbar.style.transform = `translate(${0}px, ${0}px)`;
        // Append the toolbar to the shadow root
        this.shadowRoot.appendChild(this.toolbar);

        this._setupToolButton();      // Sets up the main toggle button
        this._setupButtonContainer(); // Sets up the container for mode buttons (initially in fragment)

        // Initialize toolbar state (collapsed)
        if (this.stateManager) {
            this.stateManager.setFlagState("isToolsExpanded", false);
        }
        this.toolbar.classList.add("collapsed");

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
                id: 'pointInfo',
                name: 'PointInfo',
                icon: pointsIcon,
                mapAvailability: ['cesium', 'google', 'leaflet'],
                getClass: (type) => {
                    if (type === 'google') return PointInfoGoogle;
                    if (type === 'cesium') return PointInfoCesium; // Use specific for now
                    if (type === 'leaflet') return PointInfoLeaflet;
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
                getClass: (type) => (type === 'cesium' ? ThreePointsCurveCesium : null)
            },
            {
                id: 'multi_distances',
                name: 'Multi Distances',
                icon: multiDImage,
                mapAvailability: ['cesium', 'google', 'leaflet'],
                getClass: (type) => {
                    if (type === 'google') return MultiDistanceGoogle;
                    if (type === 'cesium') return MultiDistancesCesium; // Use specific for now
                    if (type === 'leaflet') return MultiDistanceLeaflet;
                    return null;
                },
            },
            {
                id: "multi_distances_clamped",
                name: "Multi Distances Clamped",
                icon: multiDClampedIcon,
                mapAvailability: ["cesium"],
                getClass: (type) => (type === 'cesium' ? MultiDistancesClampedCesium : null)
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
                getClass: (type) => (type === 'cesium' ? ProfileDistancesCesium : null)
            },
            // Add other modes (Curve, MultiDistance, etc.) similarly
        ];

        // --- Filter modes available for the current map type ---
        this.availableModeConfigs = allModeConfigs.filter(m => m.mapAvailability.includes(mapName));

        if (!this._buttonContainer) return;

        // --- Create Buttons ---
        this.availableModeConfigs.forEach((modeConfig) => {
            const btn = document.createElement("button");
            const modeId = modeConfig.id; // Unique ID for the button

            if (modeConfig.icon) {
                const image = document.createElement("img");
                image.src = modeConfig.icon;
                image.alt = modeConfig.name;
                image.style.width = "28px"; // Adjust size
                image.style.height = "28px"; // Adjust size
                image.style.display = "block"; // Center the icon
                btn.appendChild(image);
                // btn.innerHTML = `<img src="${modeConfig.icon}" alt="${modeConfig.name}" style="width: 30px; height: 30px; display: block;">`; // Adjust size
            } else {
                btn.textContent = modeConfig.name.slice(0, 3); // Fallback text
            }
            btn.title = modeConfig.name; // Tooltip
            btn.className = `annotate-button animate-on-show measure-button-${modeId} hidden`;
            btn.dataset.modeId = modeId; // Store mode ID for the handler
            btn.setAttribute("aria-pressed", "false"); // Accessibility

            btn.addEventListener("click", (e) => {
                e.preventDefault(); // Prevent default button behavior
                e.stopPropagation(); // Prevent map click through button

                // activate the mode
                this._handleModeButtonClick(modeId);
            });

            this._buttonContainer.appendChild(btn);
            this.uiButtons[modeId] = btn;
        });

        this._setupClearButton(this._buttonContainer);

        // update this.toolbar positions after UI is created
        requestAnimationFrame(() => {
            const container = this._getContainer();
            if (container) {
                const containerRect = container.getBoundingClientRect();
                const toolbarRect = this.toolbar.getBoundingClientRect();
                this.toolbar.style.transform = `translate(${120}px, ${containerRect.height - toolbarRect.height - 120}px)`;
            }
            makeDraggable(this.toolbar, container);
        });
    }

    /**
     * Setup the tool button that toggles the visibility of annotation modes.
     * @returns {void}
     */
    _setupToolButton() {
        if (!this.toolbar) return;
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools annotate-button visible animate-on-show"; // Main button is always visible
        toolButton.innerHTML = `<img src="${toolIcon}" alt="Toggle Tools" style="width: 30px; height: 30px; display: block;">`;
        toolButton.title = "Toggle Measurement Tools";
        toolButton.setAttribute("aria-expanded", "false"); // Initial state: tools are collapsed

        toolButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleTools();
        });
        this.toolbar.appendChild(toolButton);
    }

    /**
     * Sets up the button container that holds all mode buttons.
     * @returns {void}
     */
    _setupButtonContainer() {
        this._buttonContainer = document.createElement('div');
        this._buttonContainer.classList.add('toolbar-container');
        // The container starts in the fragment and is moved to the toolbar by toggleTools when expanding
        if (this._buttonFragment && this._buttonContainer) {
            this._buttonFragment.appendChild(this._buttonContainer);
        }
    }

    /**
     * Toggles the visibility of the button container and its modes buttons.
     * This method handles the animation and state management for expanding/collapsing the toolbar.
     * @returns {void}
     */
    toggleTools() {
        if (this._isToggling || !this.toolbar || !this._buttonContainer || !this._buttonFragment || !this.stateManager) {
            console.warn("ToggleTools prerequisites not met", { isToggling: this._isToggling, toolbar: !!this.toolbar, container: !!this._buttonContainer, fragment: !!this._buttonFragment, sm: !!this.stateManager });
            this._isToggling = false; // Reset lock if prerequisites fail
            return;
        }
        this._isToggling = true;

        this._toggleTimeouts.forEach(clearTimeout);
        this._toggleTimeouts = [];

        const isExpanded = this.stateManager.getFlagState("isToolsExpanded");
        this.stateManager.setFlagState("isToolsExpanded", !isExpanded); // Toggle the state

        const toolButton = this.toolbar.querySelector(".measure-tools");
        if (toolButton) {
            toolButton.setAttribute("aria-expanded", String(!isExpanded));
            // Optional: Toggle 'active' class on the tool button itself
            if (!isExpanded) {
                toolButton.classList.add('active');
            } else {
                toolButton.classList.remove('active');
            }
        }

        const delayStep = 40; // ms
        const animationDuration = 300; // ms, should match CSS transition duration

        // Get all buttons within the container (mode buttons + clear button)
        const buttonsToAnimate = Array.from(this._buttonContainer.querySelectorAll("button.annotate-button"));

        if (isExpanded) { // Currently expanded, so COLLAPSING
            this.toolbar.classList.remove("expanded");
            this.toolbar.classList.add("collapsed");
            const n = buttonsToAnimate.length;
            if (n === 0) {
                this._isToggling = false;
                return;
            }

            buttonsToAnimate.slice().reverse().forEach((button, index) => { // Animate in reverse for collapse
                const timeoutId = setTimeout(() => {
                    button.classList.remove("visible");
                    button.classList.add("hidden");
                    if (index === n - 1) { // Last button animation finished
                        setTimeout(() => {
                            if (this._buttonFragment && this._buttonContainer) this._buttonFragment.appendChild(this._buttonContainer);
                            this._isToggling = false;
                        }, animationDuration);
                    }
                }, index * delayStep);
                this._toggleTimeouts.push(timeoutId);
            });
        } else { // Currently collapsed, so EXPANDING
            this.toolbar.classList.remove("collapsed");
            this.toolbar.classList.add("expanded");

            // Move container from fragment to toolbar
            if (this._buttonContainer && this._buttonContainer.parentNode !== this.toolbar) {
                const mainButton = this.toolbar.querySelector(".measure-tools");
                if (mainButton) {
                    if (mainButton.nextSibling) {
                        this.toolbar.insertBefore(this._buttonContainer, mainButton.nextSibling);
                    } else {
                        this.toolbar.appendChild(this._buttonContainer);
                    }
                } else { // Fallback if main tool button isn't found
                    this.toolbar.appendChild(this._buttonContainer);
                }
            }

            if (buttonsToAnimate.length === 0) {
                this._isToggling = false;
                return;
            }

            buttonsToAnimate.forEach(button => { // Ensure all start hidden before animation
                button.classList.remove("visible");
                button.classList.add("hidden");
            });

            buttonsToAnimate.forEach((button, index) => {
                const timeoutId = setTimeout(() => {
                    button.classList.remove("hidden");
                    button.classList.add("visible");
                    if (index === buttonsToAnimate.length - 1) { // Last button animation finished
                        setTimeout(() => {
                            this._isToggling = false;
                        }, animationDuration);
                    }
                }, index * delayStep);
                this._toggleTimeouts.push(timeoutId);
            });
        }
    }

    /**
     * Sets up the extra clear button within the specified container.
     * @param {*} container - The container element to hold the clear button.
     * @returns {void}
     */
    _setupClearButton(container) {
        if (!container) {
            console.error("Clear button setup failed: container is null");
            return;
        }
        const clearButton = document.createElement("button");
        clearButton.className = "clear-button annotate-button animate-on-show hidden"; // Start hidden
        clearButton.innerHTML = `<img src="${clearIcon}" alt="Clear All" style="width: 28px; height: 28px; display: block;">`;
        clearButton.title = "Clear";
        clearButton.setAttribute("aria-label", "Clear All Measurements");

        clearButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this._handleClearButtonClick();
        });
        container.appendChild(clearButton);
        this.uiButtons["clear"] = clearButton; // Store reference
    }

    _handleClearButtonClick() {
        // this.log.info(`${this.constructor.name}: Clear button clicked.`);
        const userConfirmation = confirm("Do you want to clear all measurements?");
        if (!userConfirmation) {
            return; // User cancelled
        }

        // 1. Deactivate active mode 
        // clone mode id 
        const cloneModeId = this.activeModeId;
        this._activateMode(null);
        this._activateMode(cloneModeId);

        // 2. Remove annotations from the map for data associated within this component/map
        this.clearCollections();


        // 3. reset its internal properties
        // this._activeModeInstance.resetValues();

        // 4. clean all data in the dataPool 
        dataPool.removeDataByMapName(this.mapName);

        // 5. clean the log table 
        if (this.dataLogTable) {
            // this.dataLogTable._destroy();
            // this.dataLogTable = null;
        }

        // optional: 4. Emit an event indicating measurements were cleared for this component
        // if (this.emitter) {
        //     this.emitter.emit("measurementsCleared", { mapName: this.mapName, component: this });
        // }
        // this.log.info(`${this.constructor.name}: Measurements cleared for map: ${this.mapName}.`);
    }


    /***********************
     * TOGGLE BUTTON LOGIC *
     ***********************/
    /**
     * Handles clicks on the mode buttons within this component's toolbar.
     * Determines whether to activate a new mode or deactivate the current one.
     * @param {string} clickedModeId - The ID of the mode button that was clicked.
     * @private
     */
    _handleModeButtonClick(clickedModeId) {
        const currentModeId = this.activeModeId;
        if (currentModeId === clickedModeId) {
            // Clicked the already active button - deactivate
            this._activateMode(null);
        } else {
            // Clicked a new button - activate the new mode
            this._activateMode(clickedModeId);
        }
    }

    /**
     * Activates a specific measurement mode based on ID and map type.
     * Handles lazy instantiation.
     * @param {string | null} modeId - The id of the mode to activate (e.g., 'distance').
     * @private
     */
    _activateMode(modeId) {
        // --- Early Exit Cases ---
        if (!this.#mapName || (!this.inputHandler && modeId)) {
            console.warn(`${this.constructor.name}: Input handler not ready or mapType missing. Cannot activate mode '${modeId}'.`);
            return;
        }

        // If clicking the same mode, just ensure UI state is correct
        if (this.activeModeId === modeId && modeId) {
            this._updateButtonStates(modeId);
            return;
        }

        // --- Deactivate Current Mode ---
        this._deactivateCurrentMode();

        // --- Handle Deactivation Request ---
        if (!modeId || modeId === "inactive") {
            this._updateButtonStates(null);
            return;
        }

        // --- Activate New Mode ---
        try {
            const instance = this._getOrCreateModeInstance(modeId);
            if (!instance) return;

            instance.activate();
            this.activeModeInstance = instance;
            this.activeModeId = modeId;
            this._updateButtonStates(modeId);

            // show help table 

            this._showInstructionsTable();
            this._showDataLogTable();
            requestAnimationFrame(() => {
                // this.instructionsTable._updatePositions(); // One-time initial positioning after render
                this.instructionsTable._enableDragging();   // Enable dragging with built-in resize handling
                // this.dataLogTable._updatePositions(); // One-time initial positioning after render
                this.dataLogTable._enableDragging();   // Enable dragging with built-in resize handling
            });
        } catch (error) {
            console.error(`Error activating mode ${modeId}:`, error);
            this._resetModeState();
        }
    }

    /**
     * Gets existing mode instance or creates a new one.
     * @param {string} modeId - The mode ID to get/create
     * @returns {object|null} The mode instance or null if failed
     * @private
     */
    _getOrCreateModeInstance(modeId) {
        // Check if instance already exists
        let instance = this.#modeInstances[modeId];
        if (instance) return instance;

        // Find mode configuration
        const config = this.availableModeConfigs.find(m => m.id === modeId);
        if (!config) {
            console.warn(`${this.constructor.name}: Mode config "${modeId}" not found.`);
            return null;
        }

        const ModeClass = config.getClass(this.#mapName);
        if (!ModeClass) {
            console.warn(`${this.constructor.name}: Mode class for "${modeId}" not supported.`);
            return null;
        }

        // Create new instance
        const standardArgs = [
            this.inputHandler, this.dragHandler, this.highlightHandler,
            this, this.stateManager, this.emitter
        ];

        const args = ModeClass.name.includes("Cesium")
            ? [...standardArgs, this.#cesiumPkg]
            : standardArgs;

        if (ModeClass.name.includes("Cesium") && !this.#cesiumPkg) {
            throw new Error("Cesium package not available for Cesium mode.");
        }

        instance = new ModeClass(...args);
        this.#modeInstances[modeId] = instance;
        return instance;
    }

    /**
     * Updates button states based on active mode.
     * @param {string|null} activeModeId - The currently active mode ID
     * @private
     */
    _updateButtonStates(activeModeId) {
        Object.entries(this.uiButtons).forEach(([id, btn]) => {
            const isActive = id === activeModeId;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-pressed", String(isActive));
        });
    }

    /**
     * Resets mode state after activation failure.
     * @private
     */
    _resetModeState() {
        this.activeModeInstance = null;
        this.activeModeId = null;
        this._updateButtonStates(null);
    }

    /** Deactivates the currently active mode instance. */
    _deactivateCurrentMode() {
        const instance = this.activeModeInstance;
        const modeId = this.activeModeId;

        if (!instance) return;

        console.log(`${this.constructor.name}: Deactivating mode instance: ${modeId}`);

        try {
            if (typeof instance.deactivate === "function") {
                instance.deactivate();
            } else {
                console.warn(`Instance for mode ${modeId} has no deactivate method.`);
            }
        } catch (error) {
            console.error(`Error during deactivation of ${modeId}:`, error);
        } finally {
            this.activeModeInstance = null;
            this.activeModeId = null;
            this.inputHandler?.setCursor("default");
        }
    }


    /****************************
     * HELP TABLE AND LOG TABLE *
     ****************************/
    _showInstructionsTable() {
        // Clear reference if element was removed
        if (this.instructionsTable && !this.instructionsTable.isConnected) {
            this.instructionsTable = null;
        }

        // Create if doesn't exist
        if (!this.instructionsTable) {
            this._createInstructionsTable();
            this.instructionsTable._updatePositions();
        }

        this.instructionsTable.modeId = this.activeModeId;
    }

    _createInstructionsTable() {
        this.instructionsTable = document.createElement("instructions-table");
        // set properties for instructions table
        const mapContainer = this._getContainer();
        this.instructionsTable.container = mapContainer;
        this.instructionsTable.modeId = this.activeModeId;

        mapContainer.appendChild(this.instructionsTable);
    }

    _showDataLogTable() {
        // Clear reference if element was removed
        if (this.dataLogTable && !this.dataLogTable.isConnected) {
            this.dataLogTable = null;
        }

        // Create if doesn't exist
        if (!this.dataLogTable) {
            this._createDataLogTable();
            this.dataLogTable._updatePositions();
        }
    }

    _createDataLogTable() {
        this.dataLogTable = document.createElement("data-log-table");
        // set properties for log table
        this.dataLogTable.stateManager = this.stateManager;
        this.dataLogTable.emitter = this.emitter;
        this.dataLogTable.mapName = this.mapName;
        const mapContainer = this._getContainer();
        this.dataLogTable.container = mapContainer;

        mapContainer.appendChild(this.dataLogTable);
    }

    _getContainer() {
        if (this.mapName === "cesium") {
            return this.map.container; // Cesium uses container directly
        }
        if (this.mapName === "google") {
            return this.map.getDiv(); // Google Maps uses getDiv()
        }
        if (this.mapName === "leaflet") {
            return this.map.getContainer(); // Leaflet uses getContainer()
        }
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
        if (data.length <= 30) {
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
        const existingIndex = this.#data.findIndex((item) => item.id === data.id);
        const existingMeasure = existingIndex >= 0 ? this.#data[existingIndex] : null;

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
                this.#data[existingIndex] = updatedData;
            } else {
                this.#data.push(updatedData);
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
            case "area":
                annotations.polygon = this._addPolygon(data.coordinates);
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.labels = [
                    this._addLabel(data.coordinates, data._records[0], "squareMeter"),
                ];
                break;
            case "pointInfo":
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.labels = [
                    this._addLabel(
                        [data.coordinates[0], data.coordinates[0]],
                        `Lat:${data.coordinates[0].latitude.toFixed(6)} 
Lng:${data.coordinates[0].longitude.toFixed(6)}`,
                        null,
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
                    data._records[0]?.distances,
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
                annotations.labels = this._addLabelsFromArray(data.coordinates, data._records, "meter");
                break;
        }

        // Update data store
        const updatedData = { ...data, annotations };

        if (existingIndex >= 0) {
            // Update existing data
            this.#data[existingIndex] = updatedData;
        } else {
            // Add new data
            this.#data.push({ ...data, annotations });
        }
    }


    /******************
     * HELPER METHODS *
     ******************/
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

    clearCollections() {
        throw new Error("clearCollections must be implemented by subclass");
    }
}

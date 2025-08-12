import { sharedStyleSheet } from "../styles/sharedStyle.mjs";
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
} from "../assets/icons.mjs";
import { CesiumInputHandler } from "../lib/input/CesiumInputHandler.mjs";
import { GoogleMapsInputHandler } from "../lib/input/GoogleMapsInputHandler.mjs";
import { LeafletInputHandler } from "../lib/input/LeafletInputHandler.mjs";
import { CesiumDragHandler, CesiumHighlightHandler, GoogleDragHandler, GoogleHighlightHandler, LeafletDragHandler, LeafletHighlightHandler } from "../lib/interaction/index.mjs";
import { PickerCesium, TwoPointsDistanceCesium, PolygonCesium, ThreePointsCurveCesium, PointInfoCesium, HeightCesium, ProfileCesium, MultiDistancesCesium, MultiDistancesClampedCesium, ProfileDistancesCesium, PointInfoGoogle, TwoPointsDistanceGoogle, PolygonGoogle, MultiDistanceGoogle, PickerGoogle, PointInfoLeaflet, TwoPointsDistanceLeaflet, PolygonLeaflet, MultiDistanceLeaflet, PickerLeaflet } from "../measure-modes/index.mjs";
import { InstructionsTable } from "./shared/InstructionsTable.mjs";
import { DataLogTable } from "./shared/DataLogTable.mjs";
import { makeDraggable, formatMeasurementValue } from "../lib/helper/helper.mjs";
import { SyncDrawingManager } from "../lib/events/SyncDrawingManager.mjs";


/**
 * @typedef {import('../lib/docs/types.mjs').ShareEmitter} ShareEmitter
 * @typedef {import('../lib/docs/types.mjs').StateManager} StateManager
 * @typedef {import('../lib/docs/types.mjs').MeasurementGroup} MeasurementGroup
 * @typedef {import('../lib/docs/types.mjs').DataPool} DataPool
 */

/** 
 * @typedef {import('../lib/docs/types.mjs').CesiumInputHandler} CesiumInputHandler 
 * @typedef {import('../lib/docs/types.mjs').GoogleMapsInputHandler} GoogleMapsInputHandler
 * @typedef {import('../lib/docs/types.mjs').CesiumDragHandler} CesiumDragHandler
 * @typedef {import('../lib/docs/types.mjs').GoogleDragHandler} GoogleDragHandler
 * @typedef {import('../lib/docs/types.mjs').CesiumHighlightHandler} CesiumHighlightHandler
 * @typedef {import('../lib/docs/types.mjs').GoogleHighlightHandler} GoogleHighlightHandler
 * @typedef {import('../lib/docs/types.mjs').LeafletDragHandler} LeafletDragHandler
 * @typedef {import('../lib/docs/types.mjs').LeafletHighlightHandler} LeafletHighlightHandler
 */


/**
 * Base class for all measure components of cesium-annotation, google-annotation, and leaflet-annotation.
 * It handles UI creation, event handling, and data management for measurement tools.
 */
export class AnnotationComponentBase extends HTMLElement {
    /** @type {boolean} */
    #isInitialized = false;
    /** @type {'cesium' | 'google' | 'leaflet' | null} */
    #mapName = null;
    /** @type {import('cesium').Viewer | google.maps.Map| L.map| null| undefined} */
    #map = null; // The specific map instance (Viewer, google.maps.Map, etc.)
    /** @type {Object} */
    #cesiumPkg = null; // Only relevant for CesiumAnnotation
    /** @type {Object} */
    #app = null;
    /** @type {import('../lib/state/StateManager').StateManager | null} */
    #stateManager = null;
    /** @type {import('../lib/events/EventEmitter').EventEmitter | null} */
    #emitter = null;// Reference to the bound data listener

    /** @type {HTMLElement | null} */
    _buttonContainer = null;
    /** @type {DocumentFragment | null} */
    _buttonFragment = null;
    /** @type {boolean} */
    _isToggling = false;
    /** @type {Array<number>} */
    _toggleTimeouts = [];

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
    // instructionsTable = null;
    /** @type {Array<object>} */ // Consider a more specific type for mode configs
    availableModeConfigs = [];
    /** @type {{ [modeId: string]: object }} */
    #modeInstances = {}; // Pool to store instantiated modes

    /** @type {import('../lib/data/DataPool.mjs').DataPool} */
    _dataPool = null;
    /** @type {SyncDrawingManager | null} */
    syncDrawingManager = null;
    // -- Event Handler References for Cleanup --
    /** @type {function(Event): void | null} */
    _pickedObjectDisplayDataHandler = null;

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

    // get data() {
    //     return this.#data;
    // }

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

    get dataPool() {
        return this._dataPool;
    }
    /**
     * @param {DataPool} dataPool
     */
    set dataPool(dataPool) {
        this._dataPool = dataPool;
    }


    /**
     * Gets the map container HTML element by the current map instance.
     * This abstracts the different methods used by Cesium, Google Maps, and Leaflet.
     * @returns {HTMLElement | null} The map's container element or null if not available.
     */
    get container() {
        if (!this.mapName || !this.map) return null;
        switch (this.mapName) {
            case 'cesium':
                return this.map.container;
            case 'google':
                return this.map.getDiv();
            case 'leaflet':
                return this.map.getContainer();
            default:
                return null;
        }
    }


    async connectedCallback() {
        // Apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];
        // Initialization now depends on map and mapName being set
        if (this.map && this.mapName && !this.#isInitialized) {
            await this._initialise();
        }
    }

    disconnectedCallback() {
        console.log(`${this.constructor.name}: Disconnecting...`);

        // Notify the AnnotationToolbox to clean up this component's resources.
        if (this.app?.map?.annotationToolbox) {
            this.app.map.annotationToolbox.cleanupForMap(this.mapName);
        }

        // Clean up sync drawing manager reference
        this.syncDrawingManager = null;

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

        this.#isInitialized = false;
        console.log(`${this.constructor.name}: Disconnected cleanup complete.`);

        // FIXME: update clean up methods to clean all necessary variables
    }


    /**************
     * INITIALIZE *
     **************/
    async _initialise() {
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
                    this.dragHandler = new CesiumDragHandler(this.map, this.inputHandler, this.emitter, this.dataPool);
                    this.highlightHandler = new CesiumHighlightHandler(this.map, this.inputHandler, this.emitter, this.stateManager);
                    break;
                case "google":
                    this.inputHandler = new GoogleMapsInputHandler(this.map);
                    this.dragHandler = new GoogleDragHandler(this.map, this.inputHandler, this.emitter, this.dataPool);
                    this.highlightHandler = new GoogleHighlightHandler(this.map, this.inputHandler, this.emitter, this.stateManager);
                    break;
                case "leaflet":
                    this.inputHandler = new LeafletInputHandler(this.map);
                    this.dragHandler = new LeafletDragHandler(this.map, this.inputHandler, this.emitter, this.dataPool);
                    this.highlightHandler = new LeafletHighlightHandler(this.map, this.inputHandler, this.emitter, this.stateManager);
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
                id: 'multi-distances',
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
                id: "multi-distances-clamped",
                name: "Multi Distances Clamped",
                icon: multiDClampedIcon,
                mapAvailability: ["cesium"],
                getClass: (type) => (type === 'cesium' ? MultiDistancesClampedCesium : null)
            },
            {
                id: "area",
                name: "Area",
                icon: polygonIcon,
                mapAvailability: ["cesium", "google", "leaflet"],
                roles: ["tester"],  // FIXME: testing for user roles 
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
                id: 'profile-distances',
                name: 'Profile Distances',
                icon: profileDistancesIcon,
                mapAvailability: ['cesium'],
                getClass: (type) => (type === 'cesium' ? ProfileDistancesCesium : null)
            },
            // Add other modes (Curve, MultiDistance, etc.) similarly
        ];

        // --- Filter available modes by user role --
        const userRoles = this.getUserRole(this.app);

        // --- Filter modes available for the current map type and user role ---
        this.availableModeConfigs = allModeConfigs.filter(m =>
            m.mapAvailability.includes(mapName) &&
            (!m.roles || m.roles.some(role => userRoles.includes(role)))
        );

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
            const container = this.container;
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
        // This will also reset the mode internal properties
        // clone mode id 
        const cloneModeId = this.activeModeId;
        this._activateMode(null);
        this._activateMode(cloneModeId);

        // 2. Remove all annotations from the specific map
        this.clearCollections();

        // 3. clean all data in the dataPool by mapName
        this.dataPool.removeDataByMapName(this.mapName);
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

            // Turn on picked object feature when deactivating a mode
            if (typeof this._pickedObjectDisplayData === 'function') {
                // Only create if it doesn't exist to avoid multiple bindings
                if (!this._pickedObjectDisplayDataHandler) {
                    this._pickedObjectDisplayDataHandler = (event) => this._pickedObjectDisplayData(event);
                }
                this.inputHandler.on('leftclick', this._pickedObjectDisplayDataHandler);
                this.highlightHandler.activate();
            }

            return;
        }

        // --- Activate New Mode ---
        try {
            // turn off picked object feature when activating a mode
            if (typeof this._pickedObjectDisplayData === 'function') {
                this.inputHandler.off('leftclick', this._pickedObjectDisplayDataHandler);
                this.highlightHandler.deactivate();
            }

            const instance = this._getOrCreateModeInstance(modeId);
            if (!instance) return;

            instance.activate();
            this.activeModeInstance = instance;
            this.activeModeId = modeId;
            this._updateButtonStates(modeId);

            // Show instructions table and data log table
            // this._showInstructionsTable();
            this._showDataLogTable();
            // Enable dragging for the tables
            requestAnimationFrame(() => {  // ensure DOM is ready
                // this.instructionsTable._enableDragging();   // Enable dragging with built-in resize handling
                this.dataLogTable._enableDragging();   // Enable dragging with built-in resize handling
            });

            return instance; // Return the activated instance
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
            this, this.stateManager, this.emitter, this.#app, this.dataPool
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
    // _showInstructionsTable() {
    //     // Clear reference if element was removed
    //     if (this.instructionsTable && !this.instructionsTable.isConnected) {
    //         this.instructionsTable = null;
    //     }

    //     // Create if doesn't exist
    //     if (!this.instructionsTable) {
    //         this._createInstructionsTable();
    //         this.instructionsTable._updatePositions();
    //     }

    //     this.instructionsTable.modeId = this.activeModeId;
    // }

    // _createInstructionsTable() {
    //     this.instructionsTable = document.createElement("instructions-table");
    //     // set properties for instructions table
    //     const mapContainer = this.container;
    //     this.instructionsTable.container = mapContainer;
    //     this.instructionsTable.modeId = this.activeModeId;

    //     mapContainer.appendChild(this.instructionsTable);
    // }

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
        this.dataLogTable.mapName = this.mapName;
        const mapContainer = this.container;
        this.dataLogTable.container = mapContainer;
        this.dataLogTable.emitter = this.emitter;
        this.dataLogTable.dataPool = this.dataPool; // Pass data pool for log table

        mapContainer.appendChild(this.dataLogTable);
    }

    /**
     * Gets the currently active mode instance.
     * @returns {Object|null} The current active mode instance
     */
    getActiveModeInstance() {
        return this.activeModeInstance; // or however you store the current mode instance
    }

    /**
     * Gets a mode instance by its name.
     * @param {string} modeName - The name of the mode to retrieve.
     * @returns {Object|null} The mode instance or null if not found.
     */
    getModeInstanceByName(modeName) {
        return this.#modeInstances[modeName] || null;
    }

    /**
     * Gets the user role from the application instance.
     * @returns {string[]} An array of user roles.
     */
    getUserRole() {
        // FIXME: replace this method with the project user role get method
        return this.app.currentUser.sessions.navigator.roles;
    }


    /******************************************
     *            ABSTRACT METHODS            *
     * THAT MUST BE IMPLEMENTED BY SUBCLASSES *
     ******************************************/
    _addPointMarker(position, options) {
        throw new Error("_addPointMarker must be implemented by subclass");
    }

    _addPointMarkersFromArray(positions, options) {
        throw new Error("_addPointMarkersFromArray must be implemented by subclass");
    }

    _addPolyline(positions, options) {
        throw new Error("_addPolyline must be implemented by subclass");
    }

    _addPolylinesFromArray(positions, options) {
        throw new Error("_addPolylinesFromArray must be implemented by subclass");
    }

    _addPolygon(positions, options) {
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
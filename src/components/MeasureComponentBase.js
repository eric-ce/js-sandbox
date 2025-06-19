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
import { TwoPointsDistanceCesium, PolygonCesium, ThreePointsCurveCesium, PointInfoCesium, HeightCesium, ProfileCesium, MultiDistanceCesium, MultiDistanceClampedCesium, ProfileDistancesCesium, PointInfoGoogle, TwoPointsDistanceGoogle, PolygonGoogle, MultiDistanceGoogle, PointInfoLeaflet, TwoPointsDistanceLeaflet, PolygonLeaflet, MultiDistanceLeaflet } from "../measure-modes/index.js";


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


    /**********************************************
     * CONNECTEDCALLBACK AND DISCONNECTEDCALLBACK *
     **********************************************/
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
    }


    /*****************
     * OTHER METHODS *
     *****************/
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
        this.toolbar.style.transform = `translate(${120}px, ${-160}px)`;
        this.toolbar.style.zIndex = 400;
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
                id: "multi_distance_clamped",
                name: "Multi Distance Clamped",
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
                e.stopPropagation(); // Prevent map click through button
                // When button is clicked, tell StateManager the desired mode ID
                // check if the button is inactive if so activate it
                // if (btn.classList.contains("active")) {
                //     btn.classList.remove("active");
                //     btn.setAttribute("aria-pressed", "false");
                // }

                // activate the mode
                this._handleModeButtonClick(modeId);
            });

            this._buttonContainer.appendChild(btn);
            this.uiButtons[modeId] = btn;
        });

        this._setupClearButton(this._buttonContainer);
    }

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

    _setupButtonContainer() {
        this._buttonContainer = document.createElement('div');
        this._buttonContainer.classList.add('toolbar-container');
        // The container starts in the fragment and is moved to the toolbar by toggleTools when expanding
        if (this._buttonFragment && this._buttonContainer) {
            this._buttonFragment.appendChild(this._buttonContainer);
        }
    }

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
            if (!isExpanded) toolButton.classList.add('active'); else toolButton.classList.remove('active');
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

    _setupClearButton(container) {
        if (!container) {
            console.error("Clear button setup failed: container is null");
            return;
        }
        const clearButton = document.createElement("button");
        clearButton.className = "clear-button annotate-button animate-on-show hidden"; // Start hidden
        clearButton.innerHTML = `<img src="${clearIcon}" alt="Clear All" style="width: 28px; height: 28px; display: block;">`;
        clearButton.title = "Clear All Measurements";
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
        // // 1. Deactivate any active measurement mode
        // this._activateMode(null);

        // // 2. Remove annotations from the map for data associated with this component/map
        // const dataAssociatedWithThisMap = this.#data.filter(item => item.mapName === this.mapName || !item.mapName);
        // dataAssociatedWithThisMap.forEach(item => {
        //     if (item.annotations) {
        //         this._removeAnnotations(item.annotations); // This uses the abstract _remove... methods
        //     }
        // });

        // // 3. Clear the internal #data array for this component
        // this.#data = this.#data.filter(item => item.mapName !== this.mapName && item.mapName); // Keep data for other maps

        // // 4. Instruct DataPool to remove data for the current mapName
        // // This assumes DataPool is the central source of truth and will emit an event.
        // // If this component is solely responsible for its data, this step might be different.
        // if (dataPool) {
        //     dataPool.removeDataByFilter(item => item.mapName === this.mapName);
        // }

        // // 5. Emit an event indicating measurements were cleared for this component
        // if (this.emitter) {
        //     this.emitter.emit("measurementsCleared", { mapName: this.mapName, component: this });
        // }
        // this.log.info(`${this.constructor.name}: Measurements cleared for map: ${this.mapName}.`);
    }

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
            this._activateMode(null); // Pass null to deactivate
        } else {
            // Clicked a new button - activate the new mode
            this._activateMode(clickedModeId);
        }
    }

    /**
     * Activates a specific measurement mode based on ID and map type.
     * Handles lazy instantiation.
     * @param {string | null} modeId - The id of the mode to activate (e.g., 'distance').
     * @param {string} mapType - 'cesium', 'google', or 'leaflet'.
     * @private
     */
    _activateMode(modeId) {
        const mapType = this.#mapName;
        // console.log(`_activateMode called with modeId: ${modeId}`); // Log entry

        // --- Pre-checks ---
        if (!mapType || (!this.inputHandler && modeId)) {
            console.warn(`${this.constructor.name}: Input handler not ready or mapType missing. Cannot activate mode '${modeId}'.`);
            return;
        }
        // --- End Pre-checks ---

        const currentActiveModeId = this.activeModeId;
        const currentActiveInstance = this.activeModeInstance; // Store ref before potentially changing

        // --- Deactivate existing mode ---
        // Deactivate if:
        // 1. There IS an active instance AND
        // 2. We are activating a DIFFERENT mode (modeId is different from currentActiveModeId) OR we are explicitly deactivating (modeId is null/falsy)
        if (currentActiveInstance && (currentActiveModeId !== modeId || !modeId)) {
            this._deactivateCurrentMode(); // This now only calls deactivate() and clears component's active refs
        }

        // If the request was just to deactivate, update UI and exit
        if (!modeId || modeId === "inactive") {
            Object.values(this.uiButtons).forEach((btn) => {
                btn.classList.remove("active");
                btn.setAttribute("aria-pressed", "false");
            });
            // Ensure the main tool button is also not 'active' if all modes are off
            const toolButton = this.toolbar?.querySelector(".measure-tools");
            if (toolButton && this.stateManager?.getFlagState("isToolsExpanded") === false) {
                // If panel is collapsed and no mode active, tool button might also be non-active
                // toolButton.classList.remove('active'); // This depends on desired UX for the main toggle
            }
            return;
        }

        // Prevent activating the same mode again if it's already active (check ID)
        if (currentActiveModeId === modeId) {
            // console.log(`Mode '${modeId}' is already the active mode. Ensuring button state.`);
            if (this.uiButtons[modeId]) {
                this.uiButtons[modeId].classList.add("active");
                this.uiButtons[modeId].setAttribute("aria-pressed", "true");
            }
            return; // Already active, do nothing more
        }
        // --- End Deactivation Logic ---


        // --- Find Mode Configuration ---
        const config = this.availableModeConfigs.find((m) => m.id === modeId);
        if (!config) {
            console.warn(`${this.constructor.name}: Mode config "${modeId}" not found or not available for map type "${mapType}".`);
            return;
        }
        const ModeClass = config.getClass(mapType);
        if (!ModeClass) {
            console.warn(`${this.constructor.name}: Mode class for "${modeId}" on "${mapType}" is not defined or supported yet.`);
            return;
        }
        // --- End Find Mode ---


        // --- Instantiate (if needed) and Activate New Mode ---
        try {
            let instanceToActivate = this.#modeInstances[modeId]; // Check if instance exists in pool
            if (!instanceToActivate) {
                // Instance doesn't exist, create it
                // console.log(`Instantiating new instance for mode '${modeId}'.`);
                const standardArgs = [
                    this.inputHandler, this.dragHandler, this.highlightHandler, this, this.stateManager, this.emitter
                ];
                let args = standardArgs;
                if (ModeClass.name.includes("Cesium")) {
                    if (!this.#cesiumPkg) throw new Error("Cesium package not available for Cesium mode.");
                    args = [...standardArgs, this.#cesiumPkg];
                }

                instanceToActivate = new ModeClass(...args);
                this.#modeInstances[modeId] = instanceToActivate; // Store the new instance in the pool
            }

            // --- Activate the Instance ---
            if (typeof instanceToActivate.activate !== "function") {
                throw new Error(`Mode instance for ${modeId} does not have an activate method.`);
            }

            instanceToActivate.activate(); // Call activate on the (potentially reused) instance
            // Update component's state to reflect the newly active mode
            this.activeModeInstance = instanceToActivate;
            this.activeModeId = modeId;

            // Update UI Button State
            Object.entries(this.uiButtons).forEach(([id, btn]) => {
                if (id === modeId) {
                    btn.classList.add("active");
                    btn.setAttribute("aria-pressed", "true");
                } else {
                    btn.classList.remove("active");
                    btn.setAttribute("aria-pressed", "false");
                }
            });

        } catch (error) {
            console.error(`Error activating mode ${modeId} for ${mapType}:`, error);
            // Reset component state if activation failed
            this.activeModeInstance = null;
            this.activeModeId = null;
            // Reset UI
            Object.values(this.uiButtons).forEach((btn) => {
                btn.classList.remove("active");
                btn.setAttribute("aria-pressed", "false");
            });
        }
        // --- End Activation ---
    }

    /** Deactivates the currently active mode instance. */
    _deactivateCurrentMode = () => {
        const instance = this.activeModeInstance; // Get current instance
        const modeId = this.activeModeId;
        if (instance) {
            console.log(`${this.constructor.name}: Deactivating mode instance: ${modeId}`);
            try {
                if (typeof instance.deactivate === "function") {
                    instance.deactivate(); // Call deactivate on the instance
                } else {
                    console.warn(`Instance for mode ${modeId} has no deactivate method.`);
                }
            } catch (error) {
                console.error(`Error during deactivation of ${modeId}: `, error);
            } finally {
                // Clear the component's active references, but DO NOT destroy the instance
                // It remains in the #modeInstances pool for reuse
                this.activeModeInstance = null;
                this.activeModeId = null;
                // Reset input handler cursor to default when no mode is active
                this.inputHandler?.setCursor("default");
            }
        } else {
            console.log(`${this.constructor.name}: _deactivateCurrentMode called but no activeModeInstance found.`);
        }
    };

    _initializeMapSpecifics() {
        // Base implementation does nothing, intended for override
        // console.log(`${this.constructor.name}: Base _initializeMapSpecifics called.`);
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
}

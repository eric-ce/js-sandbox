/** @typedef {import('../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../components/CesiumMeasure.js').CesiumMeasure} CesiumMeasure */
/** @typedef {import('../lib/input/GoogleMapsInputHandler.js').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../lib/interaction/GoogleDragHandler.js').GoogleDragHandler} GoogleDragHandler */
/** @typedef {import('../lib/interaction/GoogleHighlightHandler.js').GoogleHighlightHandler} GoogleHighlightHandler */
/** @typedef {import('../components/GoogleMeasure.js').GoogleMeasure} GoogleMeasure */

import { generateIdByTimestamp } from '../lib/helper/helper.js';

/**
 * MeasureModeBase class is to share the common functionality between all mode based classes
 */
class MeasureModeBase {
    // -- Public Fields For Dependencies --
    /** @type {string} Unique identifier for this measurement mode (e.g., "distance", "polygon"). */
    mode;
    /** @type {CesiumInputHandler | GoogleMapsInputHandler} The map input event handler abstraction. */
    inputHandler;
    /** @type {CesiumDragHandler | GoogleDragHandler | null} The drag handler abstraction (can be null). */
    dragHandler;
    /** @type {CesiumHighlightHandler | GoogleHighlightHandler | null} The highlight handler abstraction (can be null). */
    highlightHandler;
    /** @type {CesiumMeasure | GoogleMeasure} The map-specific drawing helper/manager component. */
    drawingHelper;
    /** @type {any} The map instance (e.g., Cesium.Viewer, google.maps.Map). */
    map;
    /** @type {StateManager} The application state manager. */
    stateManager;
    /** @type {EventEmitter} The event emitter instance. */
    emitter;
    /** @type {cesium | google | leaflet} The name of the map */
    mapName;

    // -- Public Fields For state and data --
    /** @type {object} Flags to manage the state of the mode. */
    flags = {
        isActive: false,
    };

    // coords = {
    //     groups: [], // Array to store measurement groups
    //     measureCounter: 0, // Counter for labeling or indexing measurements
    // }

    /** @type {google.map.Marker[] | import('cesium').PointPrimitiveCollection}  */
    pointCollection = []; // Array to store points
    /** @type {google.map.Polyline[] | import('cesium').Primitive[]}  */
    polylineCollection = []; // Array to store lines
    /** @type {google.map.Polygon[] | import('cesium').Primitive[]}  */
    polygonCollection = []; // Array to store polygons
    /** @type {google.map.Marker[] | import('cesium').LabelCollection}  */
    labelCollection = []; // Array to store polygons

    /**
     * 
     * @param {string} modeName - The unique identifier for this measurement mode (e.g., "distance", "area").
     * @param {CesiumInputHandler | GoogleMapsInputHandler} inputHandler - The map input event handler abstraction.
     * @param {CesiumDragHandler | GoogleDragHandler | null} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {CesiumHighlightHandler | GoogleHighlightHandler | null} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {CesiumMeasure | GoogleMeasure} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        // -- Validate Dependencies --
        if (!modeName || typeof modeName !== 'string') {
            throw new Error("MeasureModeBase requires a valid modeName string.");
        }
        if (!inputHandler || !drawingHelper || !stateManager || !emitter) {
            throw new Error("MeasureModeBase requires inputHandler, drawingHelper, stateManager, and emitter.");
        }
        if (!drawingHelper.map) {
            throw new Error("MeasureModeBase requires drawingHelper to have a valid 'map' instance.");
        }
        if (typeof drawingHelper.mapName !== 'string') {
            throw new Error("MeasureModeBase requires drawingHelper to have a valid 'mapName' string.");
        }

        // -- Assign Dependencies --
        this.mode = modeName; // Initialize the mode name (e.g., "distance", "area")
        this.inputHandler = inputHandler;
        this.dragHandler = dragHandler; // Can be null
        this.highlightHandler = highlightHandler; // Can be null
        this.drawingHelper = drawingHelper;
        this.map = drawingHelper.map;
        this.stateManager = stateManager;
        this.emitter = emitter;

        this.mapName = drawingHelper.mapName; // Map name (e.g., "cesium", "google", "leaflet")

        this.pointCollection = this.drawingHelper.pointCollection; // Array to store points
        this.polylineCollection = this.drawingHelper.polylineCollection; // Array to store lines
        this.polygonCollection = this.drawingHelper.polygonCollection; // Array to store polygons
        this.labelCollection = this.drawingHelper.labelCollection; // Array to store polygons
    }

    /**
     * Activates the mode: attaches common listeners, resets state.
     * Subclasses should call super.activate() if overriding.
     */
    activate() {
        if (this.flags.isActive) return; // Prevent double activation

        console.log(`Activating ${this.constructor.name} (mode: ${this.mode}).`);
        this.flags.isActive = true;

        // Reset values before attaching listeners
        this._resetValues();

        // --- Attach Common Input Handlers ---
        // Use arrow functions for handlers to maintain 'this' context
        this.inputHandler.on('leftclick', this.handleLeftClick);
        this.inputHandler.on('mousemove', this.handleMouseMove);
        this.inputHandler.on('rightclick', this.handleRightClick);
        this.inputHandler.on('leftdoubleclick', this.handleLeftDoubleClick); // Optional, if needed
        this.inputHandler.on('middleclick', this.handleMiddleClick);

        // Activate interaction handlers if they exist
        this.dragHandler?.activate(this);
        this.highlightHandler?.activate(this);

        // Set a default cursor (subclasses might override)
        this.inputHandler.setCursor('crosshair');
    }

    /**
     * Deactivates the mode: removes listeners, cleans up temporary graphics.
     * Subclasses should call super.deactivate() if overriding.
     */
    deactivate() {
        if (!this.flags.isActive) return; // Prevent double deactivation

        console.log(`Deactivating ${this.constructor.name} (mode: ${this.mode}).`);

        // --- Remove Common Input Handlers ---
        this.inputHandler.off('leftclick', this.handleLeftClick);
        this.inputHandler.off('mousemove', this.handleMouseMove);
        this.inputHandler.off('rightclick', this.handleRightClick);
        this.inputHandler.off('leftdoubleclick', this.handleLeftDoubleClick);
        this.inputHandler.off('middleclick', this.handleMiddleClick);

        // Deactivate interaction handlers
        this.dragHandler?.deactivate();
        this.highlightHandler?.deactivate();

        // --- Cleanup ---
        // Call abstract methods for map-specific cleanup
        // this._removeMovingAnnotations();
        // this._removePendingAnnotations();

        // Reset common state AFTER cleanup
        this._resetValues();

        this.flags.isActive = false; // Set inactive at the very end

        // Reset cursor
        this.inputHandler.setCursor('default');
    }

    // --- Abstract or Base Event Handlers (to be implemented/overridden by subclasses) ---

    /**
     * Handles left click events. Must be implemented by subclasses.
     * @param {object} eventData - Normalized event data from InputHandler.
     */
    handleLeftClick = async (eventData) => {
        // Base implementation could check if active, otherwise throw error or log warning
        if (!this.flags.isActive) return;
        console.warn(`handleLeftClick not implemented in ${this.constructor.name}`);
        // throw new Error(`handleLeftClick must be implemented by subclass ${this.constructor.name}`);
    }

    /**
     * Handles mouse move events. Must be implemented by subclasses.
     * @param {object} eventData - Normalized event data from InputHandler.
     */
    handleMouseMove = async (eventData) => {
        if (!this.flags.isActive) return;
        // Store the latest coordinate (implementation might be map-specific, consider helper)
        // this.coordinate = this._getCoordinateFromEvent(eventData);
        console.warn(`handleMouseMove not implemented in ${this.constructor.name}`);
        // throw new Error(`handleMouseMove must be implemented by subclass ${this.constructor.name}`);
    }

    handleRightClick = async (eventData) => {
        if (!this.flags.isActive) return;
        console.warn(`handleRightClick not implemented in ${this.constructor.name}`);
        // throw new Error(`handleRightClick must be implemented by subclass ${this.constructor.name}`);
    }

    handleLeftDoubleClick = async (eventData) => {
        if (!this.flags.isActive) return;
        console.warn(`handleDoubleClick not implemented in ${this.constructor.name}`);
        // throw new Error(`handleDoubleClick must be implemented by subclass ${this.constructor.name}`);
    }

    handleMiddleClick = async (eventData) => {
        if (!this.flags.isActive) return;
        console.warn(`handleMiddleClick not implemented in ${this.constructor.name}`);
        // throw new Error(`handleMiddleClick must be implemented by subclass ${this.constructor.name}`);
    }

    /**
     * Removes temporary graphics displayed during mouse movement (e.g., rubber-band line).
     * Must be implemented by map-specific subclasses.
     * @abstract
     */
    _removeMovingAnnotations() {
        // console.warn(`_removeMovingAnnotations not implemented in ${this.constructor.name}`);
        // No-op in base, implementation is map-specific
    }

    /**
     * Removes graphics associated with an incomplete measurement (e.g., first point placed).
     * Must be implemented by map-specific subclasses.
     * @abstract
     */
    _removePendingAnnotations() {
        // console.warn(`_removePendingAnnotations not implemented in ${this.constructor.name}`);
        // No-op in base, implementation is map-specific
    }

    // --- Common Helper Methods ---

    /**
     * Resets the internal state of the mode, excluding completed measurements (`coords.groups`).
     * Subclasses can override and call super._resetValues() to add specific resets.
     */
    _resetValues() {
        this.resetValuesModeSpecific();
    }

    resetValuesModeSpecific() {
        console.warn("resetValuesModeSpecific: needs to override this method in the subclass");
    }

    /**
     * Creates a default, empty measurement group structure.
     * @returns {MeasurementGroup}
     */
    _createDefaultMeasure() {
        // Ensure drawingHelper and mapName are available
        return {
            id: generateIdByTimestamp(),
            mode: this.mode,
            coordinates: [],
            status: "pending",
            _records: [],
            interpolatedPoints: [],
            mapName: this.mapName ?? "unknown",
        };
    }

    // /**
    //  * Finds a measurement group managed by this instance that contains the given coordinate.
    //  * Assumes coordinate is in the map-specific format used in `group.coordinates`.
    //  * @param {object} coordinate - The map-specific coordinate to search for.
    //  * @returns {MeasurementGroup | undefined} - The found group or undefined.
    //  * @protected
    //  */
    // _findMeasureByCoordinate(coordinate) {
    //     if (!coordinate || !Array.isArray(this.coords?.groups)) {
    //         return undefined;
    //     }
    //     return this.coords.groups.find(group =>
    //         group.coordinates.some(cart => this._areCoordinatesEqual(cart, coordinate))
    //     );
    // }

    // // Compares two coordinates to check if they are equal.
    // _areCoordinatesEqual(coordinate1, coordinate2) {
    //     console.warn(`_areCoordinatesEqual not implemented in ${this.constructor.name}`);
    // }
}

export { MeasureModeBase };
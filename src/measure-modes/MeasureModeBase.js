import { areCoordinatesEqual, convertToUniversalCoordinate } from "../lib/helper/helper";

/**
 * MeasureModeBase class is to share the common functionality between all mode based classes
 */
class MeasureModeBase {
    /**
     * 
     * @param {string} modeName - The unique identifier for this measurement mode (e.g., "distance", "area").
     * @param {object} inputHandler - The map input event handler abstraction.
     * @param {object | null} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {object | null} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {object} drawingHelper - The map-specific drawing helper/manager.
     * @param {object} stateManager - The application state manager.
     * @param {object} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        if (!modeName || typeof modeName !== 'string') {
            throw new Error("MeasureModeBase requires a valid modeName string.");
        }
        if (!inputHandler || !drawingHelper || !stateManager || !emitter) {
            throw new Error("MeasureModeBase requires inputHandler, drawingHelper, stateManager, and emitter.");
        }

        // Initialize the mode name (e.g., "distance", "area")
        this.mode = modeName;

        // Common dependencies
        this.inputHandler = inputHandler;
        this.dragHandler = dragHandler; // May be null
        this.highlightHandler = highlightHandler; // May be null
        this.drawingHelper = drawingHelper;
        this.map = drawingHelper.map; // Assuming drawingHelper always has a map reference
        this.stateManager = stateManager;
        this.emitter = emitter;

        // Common flags (initialize with defaults)
        this.flags = {
            isActive: false, // Track if the mode is currently active
            // isDrawing: false, // Track if actively placing points/drawing
            isMeasurementComplete: false, // Track if the current measurement is finished
            isDragMode: false, // Track if a drag operation is in progress
            isShowLabels: true, // Common display flag
            // Add other common flags as needed
        };

        // Common coordinate/state storage
        this.coordinate = null; // Last known coordinate from mouse move, often map-specific format
        this.coords = {
            cache: [], // Temporary storage for coordinates during an operation
            groups: [], // Stores completed or ongoing MeasurementGroups managed by this instance
            measureCounter: 0, // Counter for groups created by this instance
            beforeDragPoint: null, // Stores the position before a drag operation starts
            afterDragPoint: null, // Stores the position after a drag operation ends
            // dragStart: null, // Map-specific coordinate format
            // dragStartToCanvas: null, // {x, y} screen coordinates
        };

        // Current measurement being worked on
        /** @type {MeasurementGroup | null} */
        this.measure = null; // Initialize as null, created when needed

        // Common structure for interactive graphics (subclasses populate with specific types)
        this.interactivePrimitives = {
            // Define common categories, even if empty initially
            // movingPoints: [],
            movingLines: [],
            movingLabels: [],
            // movingPolygons: [], // Example for area modes

            dragPoint: null,
            dragLines: [],
            dragLabels: [],

            hoveredPoint: null,
            hoveredLine: null,
            hoveredLabel: null,
            selectedLines: [], // Example for multi-distance
        };

        // Bind methods to ensure 'this' context if needed, especially if passing directly as callbacks
        // Arrow functions used later avoid this need for handlers like handleLeftClick
    }

    /**
     * Activates the mode: attaches common listeners, resets state.
     * Subclasses should call super.activate() if overriding.
     */
    activate() {
        if (this.flags.isActive) return; // Prevent double activation

        console.log(`Activating ${this.constructor.name} (mode: ${this.mode}).`);
        this.flags.isActive = true;
        // this.flags.isDrawing = false; // Reset drawing state on activation
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset values before attaching listeners
        this._resetValues();

        // --- Attach Common Input Handlers ---
        // Use arrow functions for handlers to maintain 'this' context
        this.inputHandler.on('leftclick', this.handleLeftClick);
        this.inputHandler.on('mousemove', this.handleMouseMove);
        this.inputHandler.on('rightclick', this.handleRightClick);
        this.inputHandler.on('leftdoubleclick', this.handleLeftDoubleClick); // Optional, if needed
        this.inputHandler.on('middleclick', this.handleMiddleClick);

        // Activate drag handler if it exists, passing the mode instance
        this.dragHandler?.activate(this);
        // Activate highlight handler if it exists
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

        // Deactivate drag/highlight handlers
        this.dragHandler?.deactivate();
        this.highlightHandler?.deactivate();

        // --- Cleanup ---
        // Call abstract methods for map-specific cleanup
        this._removeMovingAnnotations();
        this._removePendingAnnotations();

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
        this.coordinate = null; // Reset coordinate

        this.coords = {
            cache: [],                              // Reset temporary coordinates
            groups: this.coords.groups,             // Preserve existing measurement groups
            measureCounter: this.coords.measureCounter, // Preserve the current group counter
            dragStart: null,                        // Reset drag start position
            dragStartToCanvas: null,                // Reset drag start canvas coordinates
        };

        this.measure = this._createDefaultMeasure(); // Reset measurement data

        this.interactivePrimitives = {
            movingPoint: null,                        // Reset moving point primitive
            movingPoints: [],                         // Reset array of moving points
            movingPolylines: [],                      // Reset moving polyline primitives
            movingLabels: [],                         // Reset moving label primitives

            dragPoint: null,                          // Reset currently dragged point primitive
            dragPoints: [],                           // Reset array of dragged points
            dragPolylines: [],                        // Reset dragging polyline primitives
            dragLabels: [],                           // Reset dragging label primitives

            hoveredPoint: null,                       // Reset hovered point
            hoveredLabel: null,                       // Reset hovered label
            hoveredLine: null,                        // Reset hovered line

            selectedLines: this.interactivePrimitives.selectedLines, // Preserve currently selected lines
        };
    }

    /**
     * Creates a default, empty measurement group structure.
     * @returns {MeasurementGroup}
     */
    _createDefaultMeasure() {
        // Ensure drawingHelper and mapName are available
        const mapName = this.drawingHelper?.mapName || 'unknown';
        return {
            id: null, // Will be generated later
            mode: this.mode,
            coordinates: [],
            labelNumberIndex: this.coords.measureCounter, // Use counter for potential labeling
            status: "pending",
            _records: [],
            interpolatedPoints: [],
            mapName: mapName,
        };
    }

    /**
     * Finds a measurement group managed by this instance that contains the given coordinate.
     * Assumes coordinate is in the map-specific format used in `group.coordinates`.
     * @param {object} coordinate - The map-specific coordinate to search for.
     * @returns {MeasurementGroup | undefined} - The found group or undefined.
     * @protected
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate || !Array.isArray(this.coords?.groups)) {
            return undefined;
        }
        return this.coords.groups.find(group =>
            group.coordinates.some(cart => this._areCoordinatesEqual(cart, coordinate))
        );
    }

    // Compares two coordinates to check if they are equal.
    _areCoordinatesEqual(coordinate1, coordinate2) {
        console.warn(`_areCoordinatesEqual not implemented in ${this.constructor.name}`);
    }
}

export { MeasureModeBase };
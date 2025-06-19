import {
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    defined,
} from "cesium";

/**
 * Provide event listener for handling user input events on a Cesium map, like leftClick, mouseMove, etc.
 * Using Cesium.ScreenSpaceEventHandler to manage events
 */
export class CesiumInputHandler {
    /** @type {import('cesium').Viewer} */
    viewer; // Reference to the Cesium viewer instance
    /** @type {import('cesium').Scene} */
    scene; // Reference to the Cesium scene
    /** @type {import('cesium').ScreenSpaceEventHandler} */
    handler; // ScreenSpaceEventHandler instance for managing input events
    /** @type {Map<string, Map<Function, Function>>} */
    listenerRegistry; // Map to store active event listeners, keyed by event type string

    /**
     * Creates an instance of CesiumInputHandler.
     * @param {import('cesium').Viewer} viewer - The Cesium viewer instance.
     */
    constructor(viewer) {
        if (!viewer || !viewer.scene || !viewer.scene.canvas) {
            throw new Error("Cesium Viewer with scene and canvas is required for CesiumInputHandler.");
        }
        this.viewer = viewer;
        this.scene = viewer.scene;
        // Create a dedicated handler instance to avoid conflicts and ensure proper cleanup.
        this.handler = new ScreenSpaceEventHandler(this.scene.canvas);
        /** @type {Map<string, Map<Function, Function>>} */
        this.listenerRegistry = new Map(); // Stores { eventTypeString: Map<originalCallback, handlerAction> }
        console.log("CesiumInputHandler created.");
    }

    /**
     * Maps a generic event type string to a Cesium ScreenSpaceEventType.
     * @param {string} typeString - e.g., 'leftClick', 'mouseMove'
     * @returns {ScreenSpaceEventType | null} - The corresponding ScreenSpaceEventType or null if not found.
     */
    _getEventType(typeString) {
        switch (typeString?.toLowerCase()) {
            case 'leftclick': return ScreenSpaceEventType.LEFT_CLICK;
            case 'mousemove': return ScreenSpaceEventType.MOUSE_MOVE;
            case 'rightclick': return ScreenSpaceEventType.RIGHT_CLICK;
            case 'leftdoubleclick': return ScreenSpaceEventType.LEFT_DOUBLE_CLICK;
            case 'leftdown': return ScreenSpaceEventType.LEFT_DOWN;
            case 'leftup': return ScreenSpaceEventType.LEFT_UP;
            case 'middleclick': return ScreenSpaceEventType.MIDDLE_CLICK;
            // Add other types (MIDDLE_CLICK, PINCH_MOVE, etc.) as needed
            default:
                console.warn(`CesiumInputHandler: Unsupported event type string: ${typeString}`);
                return null;
        }
    }

    /**
     * Attaches an event listener.
     * @param {string} eventType - The type of event (e.g., 'leftClick', 'mouseMove').
     * @param {(eventData: object) => void} callback - The function to call when the event occurs.
     */
    on(eventType, callback) {
        const cesiumEventType = this._getEventType(eventType);

        if (cesiumEventType === null || typeof callback !== 'function') return;

        // Ensure map exists for this type
        if (!this.listenerRegistry.has(eventType)) {
            this.listenerRegistry.set(eventType, new Map());
        }
        const listenersForType = this.listenerRegistry.get(eventType);

        // If this specific callback is already registered for this type, do nothing
        if (listenersForType.has(callback)) {
            console.warn(`CesiumInputHandler: Callback already registered for ${eventType}.`);
            return;
        }

        // If this is the *first* listener for this Cesium event type, set the input action
        if (listenersForType.size === 0) {
            const handlerAction = (movement) => {
                // Get screen position (Cesium provides 'position' for clicks, 'endPosition' for moves)
                const screenPos = movement.position ?? movement.endPosition;

                if (!screenPos) return;

                const mapPoint = this.viewer.scene.pickPosition(screenPos) || null;
                if (!defined(mapPoint)) return;

                // Prepare normalized event data
                const eventData = {
                    mapPoint: mapPoint, // May be null if pick failed
                    screenPoint: { x: screenPos.x, y: screenPos.y },
                    // Cesium movement object doesn't directly expose the DOM event
                    domEvent: undefined,
                    // Result from scene.pick()
                    pickedFeature: this.viewer.scene.drillPick(screenPos, 3, 1, 1) || null
                };

                // Call all registered callbacks for this event type
                const currentListeners = this.listenerRegistry.get(eventType);
                if (currentListeners) {
                    currentListeners.forEach((registeredCallback) => {
                        try {
                            registeredCallback(eventData);
                        } catch (error) {
                            console.error(`CesiumInputHandler: Error in callback for ${eventType}:`, error);
                        }
                    });
                }
            };
            // Store the actual function set on the handler for potential later removal (if needed)
            // For simplicity here, we rely on destroying the handler or removing by type.
            this.handler.setInputAction(handlerAction, cesiumEventType);
            console.log(`CesiumInputHandler: Attached Cesium action for ${eventType}`);
        }

        // Store the original callback reference
        listenersForType.set(callback, callback); // Store original callback
    }

    /**
     * Removes a specific event listener.
     * @param {string} eventType - The type of event (e.g., 'leftClick').
     * @param {Function} callback - The specific callback function to remove.
     */
    off(eventType, callback) {
        const cesiumEventType = this._getEventType(eventType);
        if (!cesiumEventType || typeof callback !== 'function') return;

        const listenersForType = this.listenerRegistry.get(eventType);
        if (listenersForType && listenersForType.has(callback)) {
            listenersForType.delete(callback); // Remove the specific callback mapping
            console.log(`CesiumInputHandler: Removed listener callback for ${eventType}`);

            // If there are NO other listeners remaining for this Cesium Event Type, remove the underlying Cesium action
            if (listenersForType.size === 0) {
                this.handler.removeInputAction(cesiumEventType);
                this.listenerRegistry.delete(eventType); // Clean up the outer map too
                console.log(`CesiumInputHandler: Removed last listener and Cesium action for ${eventType}`);
            }
        }
    }

    /**
     * Sets the mouse cursor style on the Cesium canvas.
     * @param {string} cursorStyle - CSS cursor style (e.g., 'crosshair', 'grab', 'default').
     */
    setCursor(cursorStyle) {
        if (this.scene && this.scene.canvas) {
            this.scene.canvas.style.cursor = cursorStyle || 'default';
        }
    }

    /**
     * Destroys the handler and removes all listeners.
     */
    destroy() {
        if (this.handler && !this.handler.isDestroyed()) {
            this.handler.destroy(); // This removes all input actions
            console.log("CesiumInputHandler: ScreenSpaceEventHandler destroyed.");
        }
        this.handler = null;
        this.listenerRegistry.clear();
        // Reset cursor
        try { // Canvas might be gone if viewer was destroyed elsewhere
            this.setCursor('default');
        } catch (e) { }

        this.viewer = null; // Release reference
        this.scene = null;
        console.log("CesiumInputHandler instance destroyed.");
    }
}
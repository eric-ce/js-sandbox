import L from 'leaflet';

/**
 * Provides a consistent interface for handling user input events on a Leaflet Map,
 * normalizing event data where possible.
 */
export class LeafletInputHandler {
    /** @type {L.Map} */
    map;
    /** @type {HTMLElement | null} */
    _container;
    /** @type {Map<string, Map<Function, Function>>} */
    listenerRegistry; // Stores { eventTypeString: Map<originalCallback, leafletHandlerWrapper> }

    /**
     * Creates an instance of LeafletInputHandler.
     * @param {L.Map} map - The Leaflet map instance.
     */
    constructor(map) {
        if (!map) {
            throw new Error("Leaflet map instance is required for LeafletInputHandler.");
        }
        this.map = map;
        this._container = map.getContainer();
        /** @type {Map<string, Map<Function, Function>>} */
        this.listenerRegistry = new Map();
        console.log("LeafletInputHandler created.");
    }

    /**
     * Maps a generic event type string to a Leaflet event name.
     * @param {string} typeString - e.g., 'leftclick', 'mousemove'
     * @returns {string | null} - The corresponding Leaflet event name or null if not found.
     */
    _getLeafletEventType(typeString) {
        switch (typeString?.toLowerCase()) {
            case 'leftclick': return 'click';
            case 'mousemove': return 'mousemove';
            case 'rightclick': return 'contextmenu'; // Leaflet uses 'contextmenu' for right-click
            case 'leftdoubleclick': return 'dblclick';
            case 'leftdown': return 'mousedown';
            case 'leftup': return 'mouseup';
            case 'middleclick': return 'auxclick'; // Or 'middleclick' depending on browser support/needs
            // Add other Leaflet events as needed (e.g., 'dragstart', 'dragend', 'zoomend')
            default:
                console.warn(`LeafletInputHandler: Unsupported event type string: ${typeString}`);
                return null;
        }
    }

    /**
     * Normalizes Leaflet event data.
     * @param {L.LeafletMouseEvent | L.LeafletEvent} leafletEvent
     * @returns {object} Normalized event data.
     */
    _normalizeEventData(leafletEvent) {
        const eventData = {
            mapPoint: null,
            screenPoint: null,
            domEvent: leafletEvent.originalEvent || undefined, // The original DOM event
            leafletEvent: leafletEvent, // Keep original Leaflet event for specific needs
            target: leafletEvent.target, // What triggered the event (map, marker, etc.)
            layer: leafletEvent.layer // Layer involved (if applicable, e.g., in FeatureGroup events)
        };

        // Add latlng if available (MouseEvent, DragEndEvent, etc.)
        if (leafletEvent.latlng) {
            eventData.mapPoint = { lat: leafletEvent.latlng.lat, lng: leafletEvent.latlng.lng };
        }

        // Add screen coordinates if available (MouseEvent)
        if (leafletEvent.containerPoint) {
            eventData.screenPoint = { x: leafletEvent.containerPoint.x, y: leafletEvent.containerPoint.y };
        } else if (leafletEvent.originalEvent instanceof MouseEvent) {
            // Fallback for events that might not have containerPoint but have mouse coords
            const rect = this._container?.getBoundingClientRect();
            if (rect) {
                eventData.screenPoint = {
                    x: leafletEvent.originalEvent.clientX - rect.left,
                    y: leafletEvent.originalEvent.clientY - rect.top
                };
            }
        }

        return eventData;
    }


    /**
     * Attaches an event listener.
     * @param {string} eventType - The type of event (e.g., 'leftClick', 'mouseMove').
     * @param {(eventData: object) => void} callback - The function to call when the event occurs.
     * @returns {Function | undefined} The attached listener function (wrapper) or undefined if failed.
     */
    on(eventType, callback) {
        const leafletEventName = this._getLeafletEventType(eventType);

        if (!leafletEventName || typeof callback !== 'function') {
            console.warn(`LeafletInputHandler: Invalid event type (${eventType}) or callback.`);
            return undefined;
        }

        // Ensure map exists for this type
        if (!this.listenerRegistry.has(eventType)) {
            this.listenerRegistry.set(eventType, new Map());
        }
        const listenersForType = this.listenerRegistry.get(eventType);

        // If this specific callback is already registered, return the existing wrapper
        if (listenersForType.has(callback)) {
            console.warn(`LeafletInputHandler: Callback already registered for ${eventType}.`);
            return listenersForType.get(callback);
        }

        // Create a wrapper function to normalize event data and call the original callback
        const leafletHandlerWrapper = (leafletEvent) => {
            const normalizedEventData = this._normalizeEventData(leafletEvent);
            try {
                callback(normalizedEventData);
            } catch (error) {
                console.error(`LeafletInputHandler: Error in callback for ${eventType}:`, error);
            }
        };

        // Store the mapping from original callback to the wrapper
        listenersForType.set(callback, leafletHandlerWrapper);

        // Attach the wrapper to the Leaflet map event
        this.map.on(leafletEventName, leafletHandlerWrapper);
        console.log(`LeafletInputHandler: Attached listener for ${eventType} (Leaflet: ${leafletEventName})`);

        return leafletHandlerWrapper;
    }

    /**
     * Removes a specific event listener.
     * @param {string} eventType - The type of event (e.g., 'leftClick').
     * @param {Function} callback - The specific original callback function to remove.
     */
    off(eventType, callback) {
        const leafletEventName = this._getLeafletEventType(eventType);
        if (!leafletEventName || typeof callback !== 'function') return;

        const listenersForType = this.listenerRegistry.get(eventType);
        if (listenersForType && listenersForType.has(callback)) {
            const leafletHandlerWrapper = listenersForType.get(callback);

            // Remove listener from Leaflet map
            this.map.off(leafletEventName, leafletHandlerWrapper);

            // Remove from registry
            listenersForType.delete(callback);
            console.log(`LeafletInputHandler: Removed listener callback for ${eventType} (Leaflet: ${leafletEventName})`);

            // Clean up the outer map if no listeners remain for this type
            if (listenersForType.size === 0) {
                this.listenerRegistry.delete(eventType);
                console.log(`LeafletInputHandler: Removed last listener for ${eventType}`);
            }
        } else {
            console.warn(`LeafletInputHandler: Listener callback not found for removal on ${eventType}.`);
        }
    }

    /**
     * Sets the mouse cursor style on the Leaflet map container.
     * @param {string} cursorStyle - CSS cursor style (e.g., 'crosshair', 'grab', 'default').
     */
    setCursor(cursorStyle) {
        if (this._container) {
            this._container.style.cursor = cursorStyle || 'default';
        }
    }

    /**
     * Destroys the handler and removes all listeners.
     */
    destroy() {
        console.log("LeafletInputHandler: Destroying...");
        // Iterate through the registry and remove all listeners from the map
        this.listenerRegistry.forEach((listenersForType, eventType) => {
            const leafletEventName = this._getLeafletEventType(eventType);
            if (leafletEventName) {
                listenersForType.forEach((leafletHandlerWrapper) => {
                    this.map.off(leafletEventName, leafletHandlerWrapper);
                });
            }
        });

        this.listenerRegistry.clear(); // Clear the registry
        // Reset cursor
        try {
            this.setCursor('default');
        } catch (e) { }

        this.map = null; // Release reference
        this._container = null;
        console.log("LeafletInputHandler instance destroyed.");
    }
}
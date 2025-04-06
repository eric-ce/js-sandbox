// src/lib/input/GoogleMapsInputHandler.js

/**
 * Provides a consistent interface for handling user input events on a Google Map,
 * implementing the IInputEventHandler contract.
 */
export class GoogleMapsInputHandler /* implements IInputEventHandler */ {
    /**
     * Creates an instance of GoogleMapsInputHandler.
     * @param {google.maps.Map} map - The Google Maps map instance.
     */
    constructor(map) {
        if (!map || !google?.maps?.event) {
            throw new Error("Google Map instance and google.maps.event are required.");
        }
        this.map = map;
        /** @type {Map<string, Map<Function, google.maps.MapsEventListener>>} */
        this.listenerRegistry = new Map(); // Stores {eventTypeString: Map<originalCallback, MapsEventListenerRef>}
        console.log("GoogleMapsInputHandler created.");
    }

    /**
     * Maps a generic event type string to a Google Maps event name.
     * @param {string} typeString - e.g., 'leftClick', 'mouseMove'
     * @returns {string | null} The corresponding Google Maps event name or null.
     * @private
     */
    _getEventType(typeString) {
        switch (typeString?.toLowerCase()) {
            case 'leftclick': return 'click';
            case 'mousemove': return 'mousemove';
            case 'rightclick': return 'rightclick';
            case 'leftdoubleclick': return 'dblclick';
            case 'leftdown': return 'mousedown'; // Note: Google Maps uses standard DOM event names here
            case 'leftup': return 'mouseup';
            // Add 'dragstart', 'drag', 'dragend' if needed (usually on markers/shapes)
            default:
                console.warn(`GoogleMapsInputHandler: Unsupported event type string: ${typeString}`);
                return null;
        }
    }

    /**
     * Attaches an event listener to the Google Map.
     * @param {string} eventType - e.g., 'leftClick', 'mouseMove'.
     * @param {(eventData: NormalizedEventData) => void} callback - Function to call.
     */
    on(eventType, callback) {
        const googleEventType = this._getEventType(eventType);
        if (!googleEventType || typeof callback !== 'function') return;

        // Ensure inner map exists for this type
        if (!this.listenerRegistry.has(eventType)) {
            this.listenerRegistry.set(eventType, new Map());
        }
        const listenersForType = this.listenerRegistry.get(eventType);

        // Avoid adding the same callback multiple times
        if (listenersForType.has(callback)) {
            console.warn(`GoogleMapsInputHandler: Callback already registered for ${eventType}.`);
            return;
        }

        const handlerFn = (event) => {
            // Normalize Google Maps MouseEvent
            const latLng = event.latLng;
            const pixel = event.pixel; // Note: pixel coords might not always be available depending on event/context

            const eventData = {
                mapPoint: latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null,
                screenPoint: pixel ? { x: pixel.x, y: pixel.y } : { x: NaN, y: NaN }, // Provide fallback
                domEvent: event.domEvent // Pass original DOM event
            };

            // Call the original callback
            try {
                callback(eventData);
            } catch (error) {
                console.error(`GoogleMapsInputHandler: Error in callback for ${eventType}:`, error);
            }
        };

        // Add the listener using Google Maps API
        const listenerRef = google.maps.event.addListener(this.map, googleEventType, handlerFn);

        // Store the reference using the original callback as the key
        listenersForType.set(callback, listenerRef);
        console.log(`GoogleMapsInputHandler: Attached listener for ${eventType}`);
    }

    /**
     * Removes a specific event listener.
     * @param {string} eventType - e.g., 'leftClick'.
     * @param {Function} callback - The specific callback function to remove.
     */
    off(eventType, callback) {
        const listenersForType = this.listenerRegistry.get(eventType);
        if (listenersForType && listenersForType.has(callback)) {
            const listenerRef = listenersForType.get(callback);
            google.maps.event.removeListener(listenerRef);
            listenersForType.delete(callback);
            console.log(`GoogleMapsInputHandler: Removed listener callback for ${eventType}`);

            // Optional: Clean up outer map if no listeners remain for this type
            if (listenersForType.size === 0) {
                this.listenerRegistry.delete(eventType);
            }
        }
    }

    /**
     * Sets the mouse cursor style on the Google Map container.
     * @param {string} cursorStyle - CSS cursor style (e.g., 'crosshair', 'grab', 'default').
     */
    setCursor(cursorStyle) {
        try {
            // Google Maps often controls the cursor via map options or internal logic.
            // Setting draggableCursor is the most common way.
            this.map.setOptions({ draggableCursor: cursorStyle || null });
            // Fallback: Try setting style on the map's immediate div if needed,
            // but this can be overridden by Google Maps internal styles.
            // this.map.getDiv().style.cursor = cursorStyle || 'default';
        } catch (error) {
            console.error("GoogleMapsInputHandler: Error setting cursor:", error);
        }
    }

    /**
     * Destroys the handler and removes all attached listeners.
     */
    destroy() {
        console.log("GoogleMapsInputHandler: Destroying...");
        this.listenerRegistry.forEach((listenersMap, eventType) => {
            listenersMap.forEach((listenerRef, callback) => {
                google.maps.event.removeListener(listenerRef);
                console.log(`  Removed listener for ${eventType}`);
            });
        });
        this.listenerRegistry.clear();
        // Reset cursor
        this.setCursor(null); // Reset to default via map options
        this.map = null; // Release map reference
        console.log("GoogleMapsInputHandler instance destroyed.");
    }
}
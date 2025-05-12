import { checkOverlayType } from "../helper/googleHelper";

/**
 * @typedef NormalizedEventData
 * @type {Object}
 */
class GoogleHighlightHandler {
    #hoveredObject = null;
    #originalHoverStyle = null;

    constructor(map, inputHandler, emitter, callbacks = {}) {
        this.map = map;
        this.inputHandler = inputHandler;
        this.emitter = emitter;
    }

    activate(modeInstance) {
        // Validate the variables from modeInstance
        if (!modeInstance || typeof modeInstance.mode !== 'string' || typeof modeInstance.flags !== 'object') {
            console.error("CesiumDragHandler activate requires a valid modeInstance with 'mode' and 'flags'.");
            return;
        }

        this.activeModeInstance = modeInstance; // Store the mode instance
    }

    deactivate() {
        this.activeModeInstance = null; // Clear the active mode instance

        // this._resetAllHighlights(); // Reset the dragged object info and flags
    }


    /**
     * Applies hover styling to a Google Maps overlay.
     * This method would be called from a 'mouseover' event listener on the overlay.
     * @param {google.maps.Marker| google.maps.Polyline|google.maps.Polygon} overlay - The overlay object to highlight.
     */
    applyHoverHighlight(overlay) {
        if (!overlay || overlay === this.#hoveredObject) {
            return; // No overlay, or already hovering this one
        }

        // Condition to mode state to prevent hover highlight when during measure, or drag
        if (this.activeModeInstance.flags.isDragMode || (!this.activeModeInstance.flags.isMeasurementComplete && this.activeModeInstance.coordsCache.length > 0)) return;

        // If another object is currently hovered, remove its highlight first
        if (this.#hoveredObject) {
            this.removeHoverHighlight();
        }

        this.#hoveredObject = overlay;
        const overlayType = checkOverlayType(overlay);

        switch (overlayType) {
            case "point":
                this.#originalHoverStyle = { icon: overlay.getIcon() }; // Store original
                overlay.setIcon({ ...overlay.getIcon(), strokeWeight: 2, strokeColor: "rgba(255,255,0,1)" }); // change stroke color to indicate highlight
                break;
            case "label":
                this.#originalHoverStyle = { label: overlay.getLabel(), icon: overlay.getIcon() }; // Store original label and icon
                // const currentLabel = overlay.getLabel();
                // overlay.setLabel({ ...currentLabel, color: 'blue', fontWeight: 'bold' }); // Example: change label color
                // overlay.setIcon(hoverStyles.icon || { /* hover icon for label if different */ });
                overlay.setLabel({ ...overlay.getLabel(), color: "rgba(255,255,0,1)" });

                break;
            case "polyline":
                this.#originalHoverStyle = {
                    strokeColor: overlay.get('strokeColor'),
                    strokeWeight: overlay.get('strokeWeight'),
                    strokeOpacity: overlay.get('strokeOpacity'),
                    zIndex: overlay.get('zIndex')
                };
                overlay.setOptions({ strokeColor: "rgba(255,255,0,1)" });
                break;
            case "polygon":
                this.#originalHoverStyle = {
                    strokeColor: overlay.get('strokeColor'),
                    strokeWeight: overlay.get('strokeWeight'),
                    strokeOpacity: overlay.get('strokeOpacity'),
                    fillColor: overlay.get('fillColor'),
                    fillOpacity: overlay.get('fillOpacity'),
                    zIndex: overlay.get('zIndex')
                };
                overlay.setOptions({ fillColor: "rgba(255,255,0,0.5)", strokeColor: "rgba(255,255,0,1)" });
            default:
                // console.warn("GoogleHighlightHandler: Unknown overlay type for hover highlight", overlay);
                // this.#hoveredObject = null; // Don't keep reference if unknown
                return;
        }
    }

    /**
     * Removes hover styling from the currently hovered Google Maps overlay.
     * This method would be called from a 'mouseout' event listener on the overlay.
     */
    removeHoverHighlight() {
        if (!this.#hoveredObject || !this.#originalHoverStyle) {
            return;
        }

        // Condition to mode state to prevent hover highlight when during measure, or drag
        if (this.activeModeInstance.isDragMode || (this.activeModeInstance.isMeasurementComplete && this.activeModeInstance.coordsCache.length > 0)) return;

        const overlay = this.#hoveredObject;
        const originalStyle = this.#originalHoverStyle;
        const overlayType = checkOverlayType(overlay); // Check type again for safety or store it

        switch (overlayType) {
            case "point":
                overlay.setIcon(originalStyle.icon);
                break;
            case "label":
                overlay.setLabel(originalStyle.label);
                if (originalStyle.icon !== undefined) { // Check if original icon was stored
                    overlay.setIcon(originalStyle.icon);
                }
                break;
            case "polyline":
            case "polygon": // Polygons and Polylines use setOptions
                overlay.setOptions(originalStyle);
                break;
            default:
                // Should not happen if applyHoverHighlight handled it
                break;
        }

        // console.log(`Removed hover from ${overlayType}:`, overlay);

        this.#hoveredObject = null;
        this.#originalHoverStyle = null;
    }

    _resetAllHighlights() {
        this.removeHoverHighlight();
        // this.removeSelectHighlight(); // if you implement selection
    }


    destroy() {
        this.deactivate();
    }
};

export { GoogleHighlightHandler };
import { checkLayerType } from "../helper/leafletHelper";

class LeafletHighlightHandler {
    #hoveredObject = null;
    #originalHoverStyle = null;
    #originalHoverContent = null; // For label tooltip

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

        this._resetAllHighlights(); // Reset the dragged object info and flags
    }


    /**
     * Applies hover styling to a Leaflet Maps layer.
     * This method would be called from a 'mouseover' event listener on the layer.
     * @param {L.Marker|L.Polyline|L.Polygon|L.Tooltip} layer - The layer object to highlight.
     * @returns {void}
     */
    applyHoverHighlight(layer) {
        if (!layer || layer === this.#hoveredObject) {
            return; // No layer, or already hovering this one
        }

        // Condition to mode state to prevent hover highlight when during measure, or drag
        if (this.activeModeInstance?.flags.isDragMode || (!this.activeModeInstance?.flags.isMeasurementComplete && this.activeModeInstance?.coordsCache?.length > 0)) return;

        // If another object is currently hovered, remove its highlight first
        if (this.#hoveredObject) {
            this.removeHoverHighlight();
        }

        this.#hoveredObject = layer;
        const layerType = checkLayerType(layer);


        switch (layerType) {
            case "point":
                // Get teh original style
                this.#originalHoverStyle = { ...layer.options }; // Store original
                // Apply hover style
                layer.setStyle({ weight: 2, color: "rgba(255,255,0,1)" }); // change stroke color to indicate highlight
                break;
            case "label":
                this.#originalHoverContent = layer.getContent(); // Store original content (string or HTMLElement)

                const currentContent = layer.getContent();

                if (currentContent instanceof HTMLElement) {
                    // If content is an HTMLElement, clone it and modify
                    const newContent = currentContent.cloneNode(true);
                    newContent.style.color = "rgba(255,255,0,1)";  // Change color to indicate highlight
                    layer.setContent(newContent);
                }
                break;
            case "polyline":
                // Get teh original style
                this.#originalHoverStyle = { ...layer.options }
                // Apply hover style
                layer.setStyle({ color: "rgba(255,255,0,1)" });
                break;
            case "polygon":
                // Get teh original style
                this.#originalHoverStyle = { ...layer.options }
                // Apply hover style
                layer.setStyle({ fillColor: "rgba(255,255,0,1)", color: "rgba(255,255,0,1)" });
            default:
                // console.warn("GoogleHighlightHandler: Unknown layer type for hover highlight", layer);
                // this.#hoveredObject = null; // Don't keep reference if unknown
                return;
        }
    }

    /**
     * Removes hover styling from the currently hovered Leaflet Maps layer.
     * This method would be called from a 'mouseout' event listener on the layer.
     */
    removeHoverHighlight() {
        if (!this.#hoveredObject) return;

        // Condition to mode state to prevent hover highlight when during measure, or drag
        if (this.activeModeInstance?.isDragMode || (this.activeModeInstance?.isMeasurementComplete && this.activeModeInstance?.coordsCache?.length > 0)) return;

        const layer = this.#hoveredObject;
        const originalStyle = this.#originalHoverStyle;
        const layerType = checkLayerType(layer); // Check type again for safety or store it

        switch (layerType) {
            case "point":
                if (!originalStyle) return; // No original style to revert to
                layer.setStyle(originalStyle);
                break;
            case "label":
                if (!this.#originalHoverContent) return; // No original content to revert to
                layer.setContent(this.#originalHoverContent);
                break;
            case "polyline":
            case "polygon": // Polygons and Polylines use setOptions
                if (!originalStyle) return; // No original style to revert to
                layer.setStyle(originalStyle);
                break;
            default:
                // Should not happen if applyHoverHighlight handled it
                break;
        }

        // console.log(`Removed hover from ${layerType}:`, layer);

        // Reset the hovered object and original style
        this.#hoveredObject = null;
        this.#originalHoverContent = null;
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

export { LeafletHighlightHandler };
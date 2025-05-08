import { getPickedObjectType } from "../helper/cesiumHelper";
import { Color } from "cesium";


/** @typedef {import('cesium').Primitive} Primitive */

/**
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {Cartesian3} mapPoint - The point on the map where the event occurred
 * @property {any[]} pickedFeature - The feature that was picked at the event location
 * @property {Cartesian2} screenPoint - The screen coordinates of the event
 */



class CesiumHighlightHandler {
    viewer;
    inputHandler;
    emitter;

    activeModeInstance = null;
    isSelected = false;
    highlightedObjectInfo = null;

    measure = null;

    // --- State for Hover and Select ---
    originalStylesMap = new Map(); // Stores original styles { primitive: styleObject }
    currentlySelectedPrimitive = null;
    currentSelectType = null;
    currentSelectData = null; // To store measure data for selected object

    currentlyHoveredPrimitive = null;
    currentHoverType = null; // Stores the type of the currently hovered primitive

    // TODO: Features:
    // [] 1. left click to select primitive, and set relevant data;
    // [x] 2. mouse move over to highlight primitive, mouse out to unhighlight primitive

    constructor(map, inputHandler, emitter, callbacks = {}) {
        this.viewer = map;
        this.inputHandler = inputHandler;
        this.emitter = emitter; // Keep emitter if needed for other things
    }

    // get coordinate() {
    //     return this.#coordinate;
    // }

    activate(modeInstance) {
        // Validate the variables from modeInstance
        if (!modeInstance || typeof modeInstance.mode !== 'string' || typeof modeInstance.flags !== 'object') {
            console.error("CesiumDragHandler activate requires a valid modeInstance with 'mode' and 'flags'.");
            return;
        }

        this.activeModeInstance = modeInstance; // Store the mode instance

        // this.pointCollection = this.activeModeInstance.pointCollection; // Store the point collection
        // this.labelCollection = this.activeModeInstance.labelCollection; // Store the label collection
        // this.polylineCollection = this.activeModeInstance.polylineCollection; // Store the polyline collection
        // this.polygonCollection = this.activeModeInstance.polygonCollection; // Store the polygon collection

        this.inputHandler.on('leftclick', this.handleClickToSelect); // Register the click event
        this.inputHandler.on('mousemove', this.handleMoveOverHightlight); // Register the mouse move event
    }

    deactivate() {
        this.inputHandler.off('leftclick', this.handleClickToSelect); // Register the click event
        this.inputHandler.off('mousemove', this.handleMoveOverHightlight); // Register the mouse move event

        this.activeModeInstance = null;

        this._resetAllHighlights(); // Reset the dragged object info and flags

        // this._resetValues(); // Reset the values
    }

    /**
     * Handle mouse move over to highlight and move out to unhighlight the primitive.
     * @param {NormalizedEventData} eventData - The event data from the input handler. 
     * @returns {Promise<void>}
     */
    handleMoveOverHightlight = async (eventData) => {
        // -- Validate dependencies --
        const { pickedFeature } = eventData;
        if (!Array.isArray(pickedFeature)) return; // No picked feature, exit early
        if (pickedFeature.length === 0) {
            // reset highlighting
            this._resetAllHighlights();
        }

        // -- Conditions to PREVENT highlight --
        if (this.activeModeInstance.flags.isDragMode ||
            this.activeModeInstance.flags.isAddMode ||
            (!this.activeModeInstance.flags.isMeasurementComplete && this.activeModeInstance.coordsCache.length > 0)
        ) return;

        // -- Picked object -- 
        const pickedObject = pickedFeature[0];

        const newHoveredPrimitive = pickedObject?.primitive;
        const newHoveredObjectType = getPickedObjectType(pickedObject, this.activeModeInstance.mode);

        const oldHoveredPrimitive = this.currentlyHoveredPrimitive;
        const oldHoveredObjectType = this.currentHoverType;

        // Compare newHoveredPrimitive and oldHoveredPrimitive to see if they are different
        if (newHoveredPrimitive !== oldHoveredPrimitive) {
            // -- Handle reset previous and update current --
            // 1. Handle the old hovered primitive (if it existed)
            if (oldHoveredPrimitive) {
                this.currentlyHoveredPrimitive = null; // Mark as no longer hovered
                this.currentHoverType = null; // Type is still oldHoveredObjectType for the call
                this._updatePrimitiveAppearance(oldHoveredPrimitive, oldHoveredObjectType);
            }

            // 2. Update current hover state to the new primitive
            this.currentlyHoveredPrimitive = newHoveredPrimitive;
            this.currentHoverType = newHoveredObjectType;

            // -- Handle update current -- 
            // 3. Handle the new hovered primitive (if it exists)
            if (newHoveredPrimitive) {
                // Don't apply hover if it's the currently selected item
                if (newHoveredPrimitive !== this.currentlySelectedPrimitive) {
                    this._ensureOriginalStyleStored(newHoveredPrimitive, newHoveredObjectType);
                    this._updatePrimitiveAppearance(newHoveredPrimitive, newHoveredObjectType);
                }
            }
        }
    }

    /**
     * Handle left click to select to highlight the primitive
     * @param {NormalizedEventData} eventData - The event data from the input handler.
     * @returns {Promise<void>}
     */
    handleClickToSelect = (eventData) => {
        // -- Conditions to PREVENT highlight --
        if (this.activeModeInstance.flags.isDragMode ||
            this.activeModeInstance.flags.isAddMode ||
            (!this.activeModeInstance.flags.isMeasurementComplete && this.activeModeInstance.coordsCache.length > 0)
        ) return;

        // TODO: Implement selection logic using this.currentlySelectedPrimitive,
        // this.currentSelectType, this.currentSelectData, and _updatePrimitiveAppearance.
        // Remember to handle unselecting the old primitive and selecting the new one.
        // If a hovered item is clicked, it should become selected, and hover style might be overridden by select style.
        console.log("handleClickToSelect - To be implemented");
    }
    /**
     * Ensure the original style of the primitive is stored in the map.
     * Helper method
     * @param {Primitive} primitive 
     * @param {"label"|"point"|"line"|"polygon"} primitiveType 
     * @returns 
     */
    _ensureOriginalStyleStored(primitive, primitiveType) {
        if (!primitive || this.originalStylesMap.has(primitive)) {
            return;
        }
        const originalStyle = {};
        switch (primitiveType) {
            case "label":
                if (primitive.fillColor) originalStyle.fillColor = primitive.fillColor.clone();
                if (primitive.outlineColor) originalStyle.outlineColor = primitive.outlineColor.clone(); // For labels with outlines
                if (typeof primitive.outlineWidth === 'number') originalStyle.outlineWidth = primitive.outlineWidth;
                // Add other relevant original style properties for labels
                break;
            case "point":
                if (primitive.color) originalStyle.color = primitive.color.clone(); // For PointPrimitive color
                if (primitive.outlineColor) originalStyle.outlineColor = primitive.outlineColor.clone();
                if (typeof primitive.outlineWidth === 'number') originalStyle.outlineWidth = primitive.outlineWidth;
                if (typeof primitive.pixelSize === 'number') originalStyle.pixelSize = primitive.pixelSize;
                break;
            case "line":
            case "polygon":
                if (primitive.material?.uniforms?.color) {
                    originalStyle.materialColor = primitive.material.uniforms.color.clone();
                } else if (primitive.appearance?.material?.uniforms?.color) {
                    originalStyle.materialColor = primitive.appearance.material.uniforms.color.clone();
                }
                // if (primitive.width) originalStyle.width = primitive.width; // For PolylinePrimitive width
                break;
            // case "polygon":
            //     // Handle polygon original style if needed
            //     break;
            default:
                // console.warn(`Unknown primitive type: ${primitiveType}`);
                return; // Unknown type, exit early
        }
        if (Object.keys(originalStyle).length > 0) {
            this.originalStylesMap.set(primitive, originalStyle);
        }
    }

    /**
     * Update the appearance of the primitive based on its type and selection/hover state.
     * @param {Primitive} primitive - The primitive to update.
     * @param {"label"|"point"|"line"|"polygon"} primitiveType - The type of the primitive. 
     * @returns 
     */
    _updatePrimitiveAppearance(primitive, primitiveType) {
        if (!primitive || !this.activeModeInstance) return;

        const originalStyle = this.originalStylesMap.get(primitive);
        // It's possible originalStyle is not yet stored if _ensureOriginalStyleStored hasn't run for it,
        // but for resetting, it must exist. For applying hover/select, it might be the first interaction.
        // If originalStyle is undefined here when trying to reset, it's a logic flaw elsewhere.

        const isSelected = primitive === this.currentlySelectedPrimitive;
        const isHovered = primitive === this.currentlyHoveredPrimitive;

        const selectColorStr = this.activeModeInstance.stateManager.getColorState("select") || "cyan";
        const selectColor = Color.fromCssColorString(selectColorStr);
        const hoverColorStr = this.activeModeInstance.stateManager.getColorState("hover") || "yellow";
        const hoverColor = Color.fromCssColorString(hoverColorStr);

        switch (primitiveType) {
            case "label":
                // const labelOutlineColor = isSelected ? selectColor : (isHovered ? hoverColor : (originalStyle?.outlineColor || primitive.outlineColor));
                const labelFillColor = isSelected ? selectColor : (isHovered ? hoverColor : (originalStyle?.fillColor || primitive.fillColor));
                // const labelOutlineWidth = isSelected ? 2 : (isHovered ? 2 : (originalStyle?.outlineWidth !== undefined ? originalStyle.outlineWidth : primitive.outlineWidth));

                if (primitive.fillColor) primitive.fillColor = labelFillColor;
                // if (primitive.outlineColor) primitive.outlineColor = labelOutlineColor;
                // if (typeof primitive.outlineWidth === 'number') primitive.outlineWidth = labelOutlineWidth;
                break;
            case "point": // Assuming Cesium.PointPrimitive
                // const pointColor = isSelected ? selectColor : (isHovered ? hoverColor : (originalStyle?.color || primitive.color));
                const pointOutlineColor = isSelected ? selectColor : (isHovered ? hoverColor : (originalStyle?.outlineColor || primitive.outlineColor));
                const pointOutlineWidth = isSelected ? 3 : (isHovered ? 2 : (originalStyle?.outlineWidth !== undefined ? originalStyle.outlineWidth : primitive.outlineWidth));
                // const pointPixelSize = isSelected ? 12 : (isHovered ? 10 : (originalStyle?.pixelSize || primitive.pixelSize));

                // if (primitive.color) primitive.color = pointColor;
                if (primitive.outlineColor) primitive.outlineColor = pointOutlineColor;
                if (typeof primitive.outlineWidth === 'number') primitive.outlineWidth = pointOutlineWidth;
                // if(typeof primitive.pixelSize === 'number') primitive.pixelSize = pointPixelSize;
                break;
            case "line":
            case "polygon":
                let targetLineColor = null;
                if (isSelected) {
                    targetLineColor = selectColor;
                } else if (isHovered) {
                    targetLineColor = hoverColor;
                } else if (originalStyle?.materialColor) {
                    targetLineColor = originalStyle.materialColor;
                }

                // Apply the color to the polyline primitive
                if (targetLineColor) {
                    if (primitive.appearance?.material?.uniforms?.color) {
                        primitive.appearance.material.uniforms.color = targetLineColor;
                    } else if (primitive.material?.uniforms?.color) {   // Fallback for other types of primitives that attached material differently
                        primitive.material.uniforms.color = targetLineColor;
                    }
                }
                break;
            default:
                // console.warn(`Unknown primitive type: ${primitiveType}`);
                return; // Unknown type, exit early
        }
    }

    /**
     * Reset the visual highlights for selected and hovered primitives.
     */
    _resetAllHighlights() {
        if (this.currentlyHoveredPrimitive) {
            const prim = this.currentlyHoveredPrimitive;
            const type = this.currentHoverType;
            this.currentlyHoveredPrimitive = null;
            this.currentHoverType = null;
            this._updatePrimitiveAppearance(prim, type);
        }
        if (this.currentlySelectedPrimitive) {
            const prim = this.currentlySelectedPrimitive;
            const type = this.currentSelectType;
            this.currentlySelectedPrimitive = null;
            this.currentSelectType = null;
            this.currentSelectData = null;
            this._updatePrimitiveAppearance(prim, type);
        }
        // this.isSelected = false; // if you use this flag
    }

};

export { CesiumHighlightHandler };
import {
    defined,
    Color,
} from "cesium";
import {
    changeLineColor,
    resetLineColor,
    updatePointerOverlay
} from "../lib/helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Picker extends MeasureModeBase {
    /**
     * Creates a new Picker instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {Object} stateManager - The state manager holding various tool states.
     * @param {Function} logRecordsCallback - Callback function to log records.
     * @param {Function} activateModeCallback - Callback to activate a measurement mode.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, activateModeCallback, cesiumPkg, emitter) {
        super(viewer, handler, stateManager, cesiumPkg);

        // Set the event emitter
        this.emitter = emitter;

        this._button = null;

        // Callback functions
        this.activateModeCallback = activateModeCallback;

        // measure toolbox measure modes
        this._measureModes = this.stateManager.getButtonState("measureModes");

        // Coordinate management and related properties
        this.coordinate = null;

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            hoveredLabel: null,
            hoveredPoint: null,
            hoveredLine: null,
        }
    }

    // Getters and setters
    /**
     * Gets the measure modes.
     *
     * @returns {Object} The current measurement modes.
     */
    get measureModes() {
        return this._measureModes;
    }
    /**
     * Sets the measure modes.
     * @param {Object} value - The new measurement modes.
     */
    set measureModes(value) {
        this._measureModes = value;
    }
    /**
     * Gets the button element.
     * @returns {HTMLElement} The current button element.
     */
    get button() {
        return this._button;
    }
    /**
     * Sets the button element.
     * @param {HTMLElement} value - The new button element.
     */
    set button(value) {
        this._button = value;
    }

    /**
     * Configures input actions for picker mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events for picker mode.
     * Analyzes the picked object's identifier and activates the corresponding measurement mode.
     * @param {Object} movement - The mouse movement event data.
     */
    handleLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (defined(pickedObject) && pickedObject.id && pickedObject.id.startsWith("annotate")) {

            const modeMapping = {
                "annotate_multi_distances_clamped": "multi-distances-clamped", // More specific goes first
                "annotate_multi_distances": "multi-distances",
                "annotate_bookmark": "points",
                "annotate_distance": "distance",
                "annotate_height": "height",
                "annotate_polygon": "polygon",
                "annotate_curve": "curve",
                "annotate_profile_distances": "profile-distances",
                "annotate_profile": "profile",
            };

            const suffixMapping = {
                "point": "_point",
                "line": "_line",
                "label": "_label",
                "polygon": "_polygon"
            };

            // Find the first key in modeMapping that matches the start of pickedObject.id
            let lookupId = Object.keys(modeMapping).find(key => pickedObject.id.startsWith(key));

            if (lookupId) {
                let formattedId = modeMapping[lookupId];

                // Append suffix to formattedId if applicable
                Object.entries(suffixMapping).forEach(([suffix, append]) => {
                    if (pickedObject.id.includes(suffix)) {
                        formattedId += append;
                    }
                });

                // reset highlighting
                super.resetHighlighting();

                // Activate the corresponding mode
                this.activateModeCallback(modeMapping[lookupId]);

                // Log the formatted ID
                // this.logRecordsCallback(formattedId);
                this.emitter.emit("mode:selected", [{ "mode selected": formattedId }]);
            }
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to update the current coordinate, pointer overlay, and highlight primitives.
     * @param {Object} movement - The mouse movement event data.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Highlight the hovered line
        this.handleHoverHighlighting(pickedObjects[0]);
    }


    /**
     * Highlights the primitive under the mouse when hovered over.
     * Determines the type of the picked object and applies hover styles.
     * @param {*} pickedObject - The picked object from the drillPick method.
     */
    handleHoverHighlighting(pickedObject) {
        let pickedObjectType = null;

        if (defined(pickedObject) &&
            pickedObject.id &&
            pickedObject.id.startsWith("annotate_") &&
            !pickedObject.id.includes("moving")) {
            if (pickedObject.id.includes('point')) {
                pickedObjectType = "point"
            } else if (pickedObject.id.includes('line') && !pickedObject.id.includes('outline')) {
                pickedObjectType = "line"
            } else if (pickedObject.id.includes('label')) {
                pickedObjectType = "label"
            } else {
                pickedObjectType = "other"
            }
        }

        // reset highlighting
        super.resetHighlighting();

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "line": // highlight the line when hovering
                const line = pickedObject.primitive;
                if (line) {
                    // Highlight the line
                    changeLineColor(line, hoverColor);
                    this.interactivePrimitives.hoveredLine = line;
                }
                break;
            case "point":  // highlight the point when hovering
                const point = pickedObject.primitive;
                if (point) {
                    point.outlineColor = hoverColor;
                    point.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = point;
                }
                break;
            case "label":   // highlight the label when hovering
                const label = pickedObject.primitive;
                if (label) {
                    label.fillColor = hoverColor;
                    this.interactivePrimitives.hoveredLabel = label;
                }
                break;
            default:
                break;
        }
    }

    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Activates a measurement tool button.
     * @param {HTMLElement} button - The button element to activate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    activateButton(button, toolInstance) {
        button.classList.add("active");
        toolInstance.setupInputActions && toolInstance.setupInputActions();
    }

    /**
     * Deactivates a measurement tool button.
     * @param {HTMLElement} button - The button element to deactivate.
     * @param {Object} toolInstance - The instance of the measurement tool.
     */
    deactivateButton(button, toolInstance) {
        button.classList.remove("active");
        toolInstance.removeInputAction && toolInstance.removeInputAction();
        toolInstance.resetValue && toolInstance.resetValue();
    }

    resetValue() {
        super.resetValue();
    }
}

export { Picker };
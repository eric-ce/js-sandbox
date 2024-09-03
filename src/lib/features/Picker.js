import * as Cesium from "cesium";
import { removeInputActions, updatePointerOverlay } from "../helper/helper.js";

class Picker {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, measureModes, activateModeCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;
        this.logRecordsCallback = logRecordsCallback;
        this.activateModeCallback = activateModeCallback;

        this._measureModes = measureModes;

        this.coordinate = null;
    }

    get measureModes() {
        return this._measureModes;
    }

    set measureModes(value) {
        this._measureModes = value;
    }

    /**
     * Sets up input actions for points mode.
    */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handlePickerLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePickerMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handlePickerLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.startsWith("annotate")) {
            console.log("🚀  pickedObject:", pickedObject);

            const modeMapping = {
                "annotate_multidistance_clamped": "multi-distances-clamped", // More specific goes first
                "annotate_multidistance": "multi-distances",
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

                // Activate the corresponding mode
                this.activateModeCallback(modeMapping[lookupId]);
                // Log the formatted ID
                this.logRecordsCallback(formattedId);
            }
        }
    }

    handlePickerMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)
    }

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
        this.coordinate = null;

        this.pointerOverlay.style.display = "none";

    }
}

export { Picker };
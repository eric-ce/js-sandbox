import * as Cesium from "cesium";
import { changeLineColor, removeInputActions, resetLineColor, updatePointerOverlay } from "../helper/helper.js";

class Picker {
    /**
     * Creates a new Picker instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, activateModeCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        // Callback functions
        this.logRecordsCallback = logRecordsCallback;
        this.activateModeCallback = activateModeCallback;

        // mesaure toolbox measure modes
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
    get measureModes() {
        return this._measureModes;
    }

    set measureModes(value) {
        this._measureModes = value;
    }

    /**
     * Sets up input actions for picker mode.
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
     * Removes input actions for picker mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    handlePickerLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.startsWith("annotate")) {

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


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    handlePickerMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 4, 1, 1);
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Highlight the hovered line
        this.handleHoverHighlighting(pickedObjects[0]);
    }


    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        let pickedObjectType = null;
        if (Cesium.defined(pickedObject) &&
            pickedObject.id &&
            pickedObject.id.startsWith("annotate_") &&
            !pickedObject.id.includes("moving")) {
            if (pickedObject.id.includes(`point`)) {
                pickedObjectType = "point"
            } else if (pickedObject.id.includes(`line`)) {
                pickedObjectType = "line"
            } else if (pickedObject.id.includes(`label`)) {
                pickedObjectType = "label"
            } else {
                pickedObjectType = "other"
            }
        }

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredLine) {
                resetLineColor(this.interactivePrimitives.hoveredLine);
                this.interactivePrimitives.hoveredLine = null;
            }
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();

        switch (pickedObjectType) {
            case "line": // highlight the line when hovering
                const linePrimitive = pickedObject.primitive;

                if (linePrimitive) {
                    // Highlight the line
                    changeLineColor(linePrimitive, Cesium.Color.BLUE);
                    this.interactivePrimitives.hoveredLine = linePrimitive;
                }
                break;
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = Cesium.Color.YELLOW;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = Cesium.Color.YELLOW;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
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
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState('pointer')
        pointer && (pointer.style.display = 'none');

        // reset primitives
        this.interactivePrimitives.hoveredLabel = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLine = null;
    }
}

export { Picker };
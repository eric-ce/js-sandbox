import * as Cesium from "cesium";
import { changeLineColor, getPickedObjectType, removeInputActions, resetLineColor, updatePointerOverlay } from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Picker extends MeasureModeBase {
    /**
     * Creates a new Picker instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, activateModeCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

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
    get measureModes() {
        return this._measureModes;
    }

    set measureModes(value) {
        this._measureModes = value;
    }

    get button() {
        return this._button;
    }

    set button(value) {
        this._button = value;
    }

    /**
     * Sets up input actions for picker mode.
    */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    handleLeftClick(movement) {
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

                // reset highlighting
                this.resetHighlighting();

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
    handleMouseMove(movement) {
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
        this.resetHighlighting();

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "line": // highlight the line when hovering
                const linePrimitive = pickedObject.primitive;

                if (linePrimitive) {
                    // Highlight the line
                    changeLineColor(linePrimitive, hoverColor);
                    this.interactivePrimitives.hoveredLine = linePrimitive;
                }
                break;
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = hoverColor;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = hoverColor;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }

    resetHighlighting() {
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
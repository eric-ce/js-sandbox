import * as Cesium from "cesium";
import { removeInputActions, updatePointerOverlay } from "../helper/helper";

class Picker {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;
        this.logRecordsCallback = logRecordsCallback;

        this.coordinate = null;
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
        if (Cesium.defined(pickedObject)) {
            console.log("🚀  pickedObject:", pickedObject);

            // pick annotations id objects
            if (pickedObject.id && pickedObject.id.startsWith("annotate")) {
                const baseIds = {
                    "annotate_bookmark": "bookmark",
                    "annotate_distance": "distance",
                    "annotate_height": "height",
                    "annotate_polygon": "polygon",
                    "annotate_multidistance": "multidistance",
                    "annotate_multidistance_clamped": "multidistance_clamped",
                    "annotate_curve": "curve",
                    "annotate_profile": "profile",
                    "annotate_profile_distances": "profile_distances"
                };

                const suffixes = {
                    "point": "_point",
                    "line": "_line",
                    "label": "_label",
                    "polygon": "_polygon"
                };

                let formattedId = pickedObject.id;

                for (const [key, value] of Object.entries(baseIds)) {
                    if (pickedObject.id.startsWith(key)) {
                        formattedId = value;
                        break;
                    }
                }

                for (const [key, value] of Object.entries(suffixes)) {
                    if (pickedObject.id.includes(key)) {
                        formattedId += value;
                    }
                }

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

    resetValue() {
        this.coordinate = null;
    }
}

export { Picker };
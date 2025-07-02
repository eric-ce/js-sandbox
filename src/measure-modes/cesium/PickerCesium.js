import {
    Cartesian3,
    defined,
    SceneTransforms,
} from "cesium";
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeCesium } from "./MeasureModeCesium.js";
import { capitalizeString, showCustomNotification } from "../../lib/helper/helper.js";
import { getRankedPickedObjectType } from "../../lib/helper/cesiumHelper.js";

// -- Cesium types --
/** @typedef {import('cesium').Cartesian3} Cartesian3 */


// -- Data types -- 
/**
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {Cartesian3} mapPoint - The point on the map where the event occurred
 * @property {any[]} pickedFeature - The feature that was picked at the event location
 * @property {Cartesian2} screenPoint - The screen coordinates of the event
 */

// -- Dependencies types --
/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/CesiumMeasure.js').CesiumMeasure} CesiumMeasure */


/**
 * Handles picking features for Cesium Map.
 * @extends {MeasureModeCesium}
 */
class PickerCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {HTMLDivElement} - The overlay element for mode selection. */
    #modeOverlay;
    /** @type {Cartesian3} - The coordinate of the picked feature. */
    #coordinate;

    /**
     * @param {CesiumInputHandler} inputHandler 
     * @param {CesiumDragHandler} dragHandler 
     * @param {CesiumHighlightHandler} highlightHandler 
     * @param {CesiumMeasure} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     * @param {*} cesiumPkg 
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, cesiumPkg) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("PickerCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("picker", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        this.cesiumPkg = cesiumPkg;
    }


    /*****************
     * EVENT HANDLER *
     *****************/
    /********************
     * LEFT CLICK EVENT *
     ********************/
    /**
     * Handles left-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleLeftClick = async (eventData) => {
        const { object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature);
        if (!defined(pickedObject)) {
            showCustomNotification(`Not found in annotations tools`, this._container);
            return;
        };

        // Validate that the picked object is an annotation id
        const isAnnotationId = typeof pickedObject.id === 'string' && pickedObject.id.startsWith('annotate_');
        if (!isAnnotationId) return;

        // Extract the mode from the picked object ID
        const pickedObjectMode = pickedObject.id.split('_')[1];

        // validate mode name with available modes
        const isMatchedMode = this.drawingHelper.availableModeConfigs.some(mode => mode.id === pickedObjectMode);
        if (!isMatchedMode) return;

        // Activate the relevant mode using the drawing helper
        this.drawingHelper._activateMode(pickedObjectMode);

        // Notify user about the activation
        showCustomNotification(`Activated ${capitalizeString(pickedObjectMode)} mode`, this._container)
    }

    handleMouseMove = async (eventData) => {
        // Update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.#coordinate = cartesian;

        const { object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature);
        if (!defined(pickedObject)) {
            this._hideModeOverlay();
            return;
        }

        const isAnnotationId = typeof pickedObject.id === 'string' && pickedObject.id.startsWith('annotate_');
        if (!isAnnotationId) {
            this._hideModeOverlay();
            return;
        }

        const pickedObjectMode = pickedObject.id.split('_')[1];
        const isMatchedMode = this.drawingHelper.availableModeConfigs.some(mode => mode.id === pickedObjectMode);
        if (!isMatchedMode) {
            this._hideModeOverlay();
            return;
        }

        // -- Create or Update mode overlay --
        // Create mode overlay if it doesn't exist
        if (!this.#modeOverlay) {
            this.#modeOverlay = this._createModeOverlay();
        }

        // Update mode overlay
        this.updateModeOverlay(pickedObject, cartesian);
    }

    _createModeOverlay() {
        this.#modeOverlay = document.createElement('div');
        this.#modeOverlay.className = 'picker-mode-overlay';
        // Apply styles for the overlay
        Object.assign(this.#modeOverlay.style, {
            position: "absolute",
            pointerEvents: "none",
            padding: "6px 12px",
            display: "none", // Initially hidden
            backgroundColor: "rgba(31, 31, 31, 0.8)", // M3 Dark theme surface color (approx)
            color: "#E2E2E2",             // M3 Dark theme on-surface text color (approx)
            borderRadius: "12px",
            fontFamily: "'Roboto', Arial, sans-serif",
            fontSize: "14px",
            lineHeight: "1.5",
            zIndex: "1001",
            whiteSpace: "pre-line",
            boxShadow: "0px 1px 2px rgba(0,0,0,0.3), 0px 2px 6px 2px rgba(0,0,0,0.15)" // M3 Dark theme elevation 2 shadow (approx)
        });

        this._container.appendChild(this.#modeOverlay);
        return this.#modeOverlay;
    }

    updateModeOverlay(pickedObject, cartesian) {
        if (!this.#modeOverlay || !defined(cartesian)) return null;

        // -- Display content --
        const pickedObjectMode = pickedObject.id.split('_')[1];
        const pickedObjectType = pickedObject.id.split('_')[2];
        this.#modeOverlay.textContent =
            `Picked Mode: ${capitalizeString(pickedObjectMode)}` +
            `\nPicked Type: ${pickedObjectType}`;

        // -- Handle screen position --
        let screenPosition;
        if (SceneTransforms.worldToWindowCoordinates) {
            screenPosition = SceneTransforms.worldToWindowCoordinates(this.map.scene, cartesian);
        } else if (SceneTransforms.wgs84ToWindowCoordinates) {
            screenPosition = SceneTransforms.wgs84ToWindowCoordinates(this.map.scene, cartesian);
        } else {
            console.error("SceneTransforms.worldToWindowCoordinates or SceneTransforms.wgs84ToWindowCoordinates is not available in the current version of Cesium.");
        }

        // -- Set overlay style and position --
        this.#modeOverlay.style.display = 'block';
        this.#modeOverlay.style.left = `${screenPosition.x + 20}px`;
        this.#modeOverlay.style.top = `${screenPosition.y - 20}px`;
    }

    _hideModeOverlay() {
        if (this.#modeOverlay) {
            this.#modeOverlay.style.display = 'none';
            this.#modeOverlay.textContent = '';
        }
    }

    resetValuesModeSpecific() {
        this.#coordinate = null;

        if (this.#modeOverlay) {
            this.#modeOverlay.remove();
            this.#modeOverlay = null;
        }
    }
}

export { PickerCesium };
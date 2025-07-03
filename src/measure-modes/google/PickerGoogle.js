import { showCustomNotification } from "../../lib/helper/cesiumHelper";
import { capitalizeString } from "../../lib/helper/helper";
import { MeasureModeGoogle } from "./MeasureModeGoogle";


/**
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {{lat:number, lng:number}} mapPoint - The point on the map where the event occurred
 * @property {{x:number, y:number}} screenPoint - The screen coordinates of the event
 * @property {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} annotation - The annotation graphics object
 */

class PickerGoogle extends MeasureModeGoogle {
    #coordinate = null;
    #modeInfoOverlay = null;

    /**
     * @param {GoogleMapsInputHandler} inputHandler
     * @param {DragHandler} dragHandler
     * @param {HighlightHandler} highlightHandler
     * @param {MeasureComponentBase} drawingHelper
     * @param {StateManager} stateManager
     * @param {EventEmitter} emitter
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("PickerGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("picker", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

    /**
     * Activates the picker mode and sets up event listeners.
     */
    activate() {
        super.activate();

        this.inputHandler.off('leftclick', this.handleLeftClick);
        this.inputHandler.off('mousemove', this.handleMouseMove);

        // Add emitter listeners only when picker is active
        if (this.emitter) {
            this.emitter.on('annotation-clicked', this.handleLeftClick);
            this.emitter.on('annotation-hovered', this.handleMouseMove);
        }
    }

    /**
     * Deactivates the picker mode and cleans up event listeners.
     */
    deactivate() {
        // Remove emitter listeners when picker is deactivated
        if (this.emitter) {
            this.emitter.off('annotation-clicked', this.handleLeftClick);
            this.emitter.off('annotation-hovered', this.handleMouseMove);
        }

        super.deactivate();
    }


    /******************
     * EVENTS HANDLER *
     ******************/
    /**
     * Handles left clicks, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     * @returns {Promise<void>}
     */
    handleLeftClick = async (eventData) => {
        const { annotation } = eventData;
        if (!annotation) return;

        const { id: pickedObjectId } = annotation;
        if (!pickedObjectId || typeof pickedObjectId !== 'string') return;

        const [annotationType, pickedObjectMode, pickedObjectType] = pickedObjectId.split('_');
        if (!annotationType || annotationType !== 'annotate' || !pickedObjectMode || !pickedObjectType) return;

        // validate mode name with available modes
        const isMatchedMode = this.drawingHelper.availableModeConfigs.some(mode => mode.id === pickedObjectMode);
        if (!isMatchedMode) return;

        // Activate the relevant mode using the drawing helper
        this.drawingHelper._activateMode(pickedObjectMode);

        // Notify user about the activation
        showCustomNotification(`Activated ${capitalizeString(pickedObjectMode)} mode`, this._container);
    }


    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     * @returns {Promise<void>}
     */
    handleMouseMove = async (eventData) => {
        if (!eventData) return;
        const { annotation, screenPoint } = eventData;
        if (!annotation || !screenPoint || !screenPoint.x || !screenPoint.y) {
            this._hideModeOverlay();
            return;
        }

        const { id: pickedObjectId } = annotation;
        if (!pickedObjectId || typeof pickedObjectId !== 'string') {
            this._hideModeOverlay();
            return;
        }
        const [annotate, pickedObjectMode] = pickedObjectId.split('_');
        if (!pickedObjectMode) {
            this._hideModeOverlay();
            return;
        }

        // -- Mode info overlay --
        // Create mode info overlay if it doesn't exist
        if (!this.#modeInfoOverlay) {
            this._createModeOverlay();
        }

        // Update mode info overlay if already exists
        if (this.#modeInfoOverlay) {
            this._updateModeOverlay(pickedObjectId, screenPoint)
        }
    }

    /**
     * Creates the mode overlay element for displaying picked object information.
     * @returns {HTMLDivElement} - The mode overlay element.
     */
    _createModeOverlay() {
        // Validate that the map container is available
        if (!this._container) return null;

        this.#modeInfoOverlay = document.createElement('div');
        this.#modeInfoOverlay.className = 'picker-mode-overlay';
        // Apply styles to the overlay
        Object.assign(this.#modeInfoOverlay.style, {
            position: "absolute",
            pointerEvents: "none",
            padding: "6px 12px",
            display: "none",
            backgroundColor: "rgba(31, 31, 31, 0.8)",
            color: "#E2E2E2",
            borderRadius: "12px",
            fontFamily: "'Roboto', Arial, sans-serif",
            fontSize: "14px",
            lineHeight: "1.5",
            zIndex: "1001",
            whiteSpace: "pre-line", // Preserve line breaks
            boxShadow: "0px 1px 2px rgba(0,0,0,0.3), 0px 2px 6px 2px rgba(0,0,0,0.15)" // M3 Dark theme elevation 2 shadow (approx)
        });

        this._container.appendChild(this.#modeInfoOverlay);
        return this.#modeInfoOverlay;
    }

    /**
     * Updates the mode overlay with the picked measure's information.
     * @param {string} pickedObjectId - The found measurement data.
     * @param {{x: number, y: number}} screenPoint - The screen coordinates.
     */
    _updateModeOverlay(pickedObjectId, screenPoint) {

        if (!this.#modeInfoOverlay) return;

        // -- Display content --
        const [_, pickedObjectMode, pickedObjectType] = pickedObjectId.split('_');
        this.#modeInfoOverlay.textContent =
            `Picked Mode: ${capitalizeString(pickedObjectMode)}` +
            `\nPicked Type: ${pickedObjectType}`;

        // Position overlay using screen coordinates
        const { x, y } = screenPoint;
        Object.assign(this.#modeInfoOverlay.style, {
            display: 'block',
            left: "0px",
            top: "0px",
            transform: `translate(${x + 20}px, ${y - 20}px)`
        });
    }


    /**
     * Hides the mode overlay.
     */
    _hideModeOverlay() {
        if (this.#modeInfoOverlay) {
            this.#modeInfoOverlay.style.display = 'none';
            this.#modeInfoOverlay.textContent = ''; // Clear content
        }
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        this.#coordinate = null;

        if (this.#modeInfoOverlay) {
            this.#modeInfoOverlay.remove();
            this.#modeInfoOverlay = null;
        }
    }
}

export { PickerGoogle };
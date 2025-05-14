import {
    Cartesian3,
    defined,
    SceneTransforms,
} from "cesium";
import { areCoordinatesEqual, convertToCartographicDegrees, editableLabel, getPickedObjectType, updatePointerOverlay } from "../../lib/helper/cesiumHelper";
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeCesium } from "./MeasureModeCesium";

// -- Cesium types --
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
// -- Data types -- 
/** @typedef {{labels: Label[]}} InteractiveAnnotationsState */
/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'| string} mapName - Map provider name ("google")
 */
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
 * Class representing a point information measurement mode in Cesium.
 * @extends {MeasureModeCesium}
 */
class PointInfoCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        labels: []
    };

    /** @type {MeasurementGroup} */
    measure = null;

    /** @type {Cartesian3[]} */
    coordCache = [];

    /** @type {HTMLElement} */ // the overlay to show the coordinate info
    #coordinateInfoOverlay;

    /**
     * 
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
            throw new Error("TwoPointsDistanceCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("pointInfo", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        this.cesiumPkg = cesiumPkg;

        this.coordsCache = [];
        this.measure = super._createDefaultMeasure();
    }


    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }


    /**********************
     *   EVENT HANDLER    *
     * FOR NORMAL MEASURE *
     **********************/
    /********************
     * LEFT CLICK EVENT *
     ********************/
    /**
     * Handles left-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleLeftClick = async (eventData) => {
        // use move position for the position
        const cartesian = this.#coordinate
        if (!defined(cartesian)) return;

        const pickedObject = eventData.pickedFeature[0];
        const pickedObjectType = getPickedObjectType(pickedObject, this.mode);

        // Try to handle click on an existing primitive first
        const handled = this._handleAnnotationClick(pickedObject, pickedObjectType);

        // If the click was not on a handled primitive and not in drag mode, start measuring
        if (!handled && !this.flags.isDragMode) {
            this._startMeasure();
        }
    }

    _handleAnnotationClick(pickedObject, pickedObjectType) {
        // Validate the picked object and type
        if (!pickedObject || !pickedObjectType) {
            return false;
        }

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                // only when it is not during measuring can edit the label. 
                if (this.coordsCache.length === 0) {
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this.map.container, pickedObject.primitive);
                }
                return true;
            case "point":
                this._removePointInfoMarker(pickedObject.primitive);
                return true;
            case "line":
                return false;   // False mean do not handle line click, because it could click on moving line
            default:
                return false;
        }
    }

    /**
     * Initiates the measurement process by creating a new group or adding a point.
     */
    _startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coordsCache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coordsCache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = this._createDefaultMeasure();

            // Establish data relation
            this.measure.coordinates = this.coordsCache; // when cache changed measure data changed, due to reference by address.
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const nearPoint = this._isNearPoint(this.#coordinate);
        if (nearPoint) return; // Do not create a new point if near an existing one


        // -- Handle Point --
        // create a new point primitive
        const pointPrimitive = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
        });
        if (!pointPrimitive) return; // If point creation fails, exit
        pointPrimitive.status = "completed"; // Set status to pending for the point primitive

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);


        // -- Handle Label -- 
        const { cartographicDegrees } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
            status: "completed",
            showBackground: true
        });

        // -- Handle Data --
        this.measure._records.push(cartographicDegrees.latitude, cartographicDegrees.longitude, cartographicDegrees.height);
        this.measure.status = "completed";

        // -- Update Data Pool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Update State --
        this.flags.isMeasurementComplete = true;

        // -- Reset Values --
        // Clean up the current measure state, to prepare for the next measure
        this.coordsCache = [];
        this.#interactiveAnnotations.labels = [];
    }

    _removePointInfoMarker(pointPrimitive) {
        // -- Remove point --
        const pointToRemove = this.pointCollection._pointPrimitives.find(primitive => primitive.id === pointPrimitive.id);
        if (!pointToRemove) return null;
        this.drawingHelper._removePointMarker(pointToRemove);

        // -- Remove label --
        const labelToRemove = this.labelCollection._labels.find(label => areCoordinatesEqual(label.position, pointToRemove.position));
        if (!labelToRemove) return null;
        this.drawingHelper._removeLabel(labelToRemove);

        // -- Remove data --
        const measureId = pointToRemove.id.split("_").slice(-1)[0];
        dataPool.removeMeasureById(measureId);  // Remove data from data pool
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleMouseMove = async (eventData) => {
        // update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.#coordinate = cartesian;

        const pickedObjects = eventData.pickedFeature;
        if (!defined(pickedObjects)) return;

        // update pointerOverlay: the moving dot with mouse
        const pointerElement = this.stateManager.getOverlayState("pointer");
        const pointerOverlay = updatePointerOverlay(this.map, pointerElement, cartesian, pickedObjects)
        this.stateManager.setOverlayState("pointer", pointerOverlay);

        // update coordinateInfoOverlay
        if (this.#coordinateInfoOverlay) {
            this.updateCoordinateInfoOverlay(this.#coordinate);
        } else {
            this.#coordinateInfoOverlay = this._createCoordinateInfoOverlay();
        }
    }


    /******************
     * EVENT HANDLING *
     *    FOR DRAG    *
     ******************/
    /**
     * Handle graphics updates during dragging operation.
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    updateGraphicsOnDrag(measure) { }

    /**
     * Finalize graphics updates for the end of drag operation
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    finalizeDrag(measure) { }


    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * 
     * @param {Cartesian3[]} positions - the positions to create or update the label. 
     * @param {Label[]} labelsArray - the array to store the label primitive reference of the operation not the label collection.
     * @param {object} options - options for label creation or update.
     * @returns 
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { cartographicDegrees: null, labelPrimitive: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            showBackground = true,
        } = options;

        const cartographicDegrees = convertToCartographicDegrees(positions[0]);
        const formattedText =
            `Lat: ${cartographicDegrees.latitude.toFixed(6)}
Lng: ${cartographicDegrees.longitude.toFixed(6)}
Alt: ${cartographicDegrees.height.toFixed(2)}`;

        let labelPrimitive = null;

        // -- Update label if existed--
        if (labelsArray.length > 0) {
            labelPrimitive = labelsArray[0]; // Get reference to the existing label primitive

            if (!labelPrimitive) {
                console.warn("_createOrUpdateLabel: Invalid object found in labelsArray. Attempting to remove and recreate.");
                labelsArray.length = 0; // Clear the array to trigger creation below
            } else {
                // -- Handle Label Visual Update --
                labelPrimitive.position = middlePos;
                labelPrimitive.text = formattedText;
                labelPrimitive.showBackground = showBackground; // Set background visibility
            }
        }

        // -- Create new label (if no label existed in labelsArray or contained invalid object) --
        if (!labelPrimitive) {
            labelPrimitive = this.drawingHelper._addLabel(positions, formattedText, null, {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
            });

            if (!labelPrimitive) {
                console.error("_createOrUpdateLabel: Failed to create new label primitive.");
                return { cartographicDegrees, labelPrimitive: null }; // Return cartographicDegrees but null primitive
            }

            // -- Handle References Update --
            labelsArray.push(labelPrimitive);
        }

        // -- Handle Label Metadata Update --
        labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions
        labelPrimitive.status = status; // Set status

        return { cartographicDegrees, labelPrimitive };
    }

    _createCoordinateInfoOverlay() {
        this.#coordinateInfoOverlay = document.createElement("div");
        this.#coordinateInfoOverlay.className = "coordinate-info-overlay";
        this.#coordinateInfoOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: block;";

        this.map.container.appendChild(this.#coordinateInfoOverlay);
        return this.#coordinateInfoOverlay;
    }

    /**
     * Updates the coordinate info overlay with the current coordinate information.
     * @param {Cartesian3} cartesian - The current Cartesian3 coordinate.
     */
    updateCoordinateInfoOverlay(cartesian) {
        // -- Check if the overlay is defined --
        if (!this.#coordinateInfoOverlay) return null;

        // -- Convert to cartographic degrees --
        const cartographicDegrees = convertToCartographicDegrees(cartesian);
        if (!cartographicDegrees) return null;
        // -- Update overlay content --
        const displayInfo = `Lat: ${cartographicDegrees.latitude.toFixed(6)}<br>Lng: ${cartographicDegrees.longitude.toFixed(6)} <br>Alt: ${cartographicDegrees.height.toFixed(2)}`;
        this.#coordinateInfoOverlay.innerHTML = displayInfo;

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
        this.#coordinateInfoOverlay.style.display = 'block';
        this.#coordinateInfoOverlay.style.left = `${screenPosition.x + 20}px`;
        this.#coordinateInfoOverlay.style.top = `${screenPosition.y - 20}px`;
        this.#coordinateInfoOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.#coordinateInfoOverlay.style.color = 'white';
        this.#coordinateInfoOverlay.style.borderRadius = '4px';
        this.#coordinateInfoOverlay.style.padding = '8px';
        this.#coordinateInfoOverlay.style.fontFamily = 'Roboto, sans-serif';
    }



    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Clear cache
        this.coordsCache = [];

        this.#coordinateInfoOverlay && this.#coordinateInfoOverlay.remove();
    }
}

export { PointInfoCesium };
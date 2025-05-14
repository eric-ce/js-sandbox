import { Cartesian3 } from "cesium";
import { MeasureModeBase } from "../MeasureModeBase.js";
import { areCoordinatesEqual, convertToCartesian3, convertToCartographicDegrees, isCartesian3 } from "../../lib/helper/cesiumHelper.js";
import dataPool from "../../lib/data/DataPool.js";

// Cesium types
/** @typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection */
/** @typedef {import('cesium').LabelCollection} LabelCollection */

// Dependencies types
/** @typedef {import('../../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/CesiumMeasure.js').CesiumMeasure} CesiumMeasure */


/**
 * Shared functionality between modes in Cesium.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `cesiumHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeCesium extends MeasureModeBase {
    /**
     * 
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {CesiumInputHandler} inputHandler - The map input event handler abstraction.
     * @param {CesiumDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {CesiumHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {CesiumMeasure} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to Cesium Cartesian3 object
        const cartesian = convertToCartesian3(coordinate);
        if (!cartesian) return null;

        // Get all measure data from the data pool in Cartesian3 format
        const data = dataPool.getAllMeasures("cartesian");
        if (Array.isArray(data) && data.length === 0) return null;

        // Find the measure that contains the coordinate
        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, cartesian));
        })

        if (!measure) return null;

        // Clone the coordinates to avoid mutating the original data
        const clonedCoordinates = measure.coordinates.map(coord => {
            return Cartesian3.clone(coord);
        });

        // Return a new object with the coordinates cloned
        return { ...measure, coordinates: clonedCoordinates }; // Return a new object with the coordinates cloned
    }

    /**
     * Checks if the given coordinate is near any existing point in the mode.
     * @param {Cartesian3} coordinate - The coordinate to check.
     * @return {boolean} - Returns true if the coordinate is near an existing point, false otherwise.
     */
    _isNearPoint(coordinate) {
        if (!coordinate) {   // Validate input coordinate
            console.warn("Invalid coordinate provided.");
            return false;
        };

        // Get all measure data from the data pool in Cartesian3 format
        const data = dataPool.getAllMeasures("cartesian");

        if (!Array.isArray(data) && data.length === 0) {
            console.warn("No measures available in the data pool.");
            return false; // No measures available}
        }

        // Check if the coordinate is near any existing point in the mode
        return data.some(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => Cartesian3.distance(coord, coordinate) < 0.2);
        });
    }

    removeAnnotationsAndListeners() {
        this.drawingHelper.clearCollections();
    }
}

export { MeasureModeCesium };
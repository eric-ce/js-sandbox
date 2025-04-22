import { Cartesian3, defined } from "cesium";
import { MeasureModeBase } from "../MeasureModeBase.js";
import { isCartesian3 } from "../../lib/helper/cesiumHelper.js";
/**
 * Shared functionality between modes in Cesium.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `cesiumHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeCesium extends MeasureModeBase {
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);


    }


    /**
     * Compare two cartesian coordinates for equality.
     * @param {Cartesian3} coord1 - The first coordinate in Cartesian3 format
     * @param {Cartesian3} coord2 - The second coordinate in Cartesian3 format
     * @returns {boolean} - Returns true if the coordinates are equal, false otherwise
     */
    _areCoordinatesEqual(coord1, coord2) {
        // validate coord1 and coord2
        if (!isCartesian3(coord1) || !isCartesian3(coord2)) {
            console.error("Invalid coordinates provided for comparison.");
            return false;
        }

        return Cartesian3.equals(coord1, coord2);
    }
}

export { MeasureModeCesium };
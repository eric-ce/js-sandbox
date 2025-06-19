import { MeasureModeBase } from "../MeasureModeBase.js";

import dataPool from "../../lib/data/DataPool.js";
import { areCoordinatesEqual, convertToLatLng } from "../../lib/helper/leafletHelper.js";


/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/**
 * Shared functionality between modes in Leaflet Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `leafletHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeLeaflet extends MeasureModeBase {
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

    /**
     * Find and handle the measure data from dataPool
     * @param {Coordinate} coordinate 
     * @return {MeasurementGroup}
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to lat lng object
        const latLng = { ...convertToLatLng(coordinate) };
        if (!latLng) return null;

        const data = dataPool.getAllMeasures("cartographicDegrees");
        if (Array.isArray(data) && data.length === 0) return null;

        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, latLng));
        })
        if (!measure) return null;

        return measure;
    }

}

export { MeasureModeLeaflet };
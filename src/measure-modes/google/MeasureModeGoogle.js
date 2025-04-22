import { MeasureModeBase } from "../MeasureModeBase.js";
import { convertToLatLng } from "../../lib/helper/googleHelper.js";

/**
 * Shared functionality between modes in Google Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `googleHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeGoogle extends MeasureModeBase {
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);



    }


    /**
     * Compare two coordinates for equality.
     * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number} | {lat:number, lon:number}} coord1 
     * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number} | {lat:number, lon:number}} coord2 
     * @returns {boolean} - Returns true if the coordinates are equal, false otherwise
     */
    _areCoordinatesEqual(coord1, coord2) {
        // validate coord1 and coord2
        if (!coord1 || !coord2) {
            console.error("Invalid coordinates provided for comparison.");
            return false;
        }

        const latLng1 = convertToLatLng(coord1);
        const latLng2 = convertToLatLng(coord2);

        // Only compare if both conversions were successful and resulted in valid LatLng objects
        if (latLng1 && latLng2) {
            return latLng1.equals(latLng2);
        }

        // If either conversion failed, consider them not equal
        return false;
    }

}

export { MeasureModeGoogle };
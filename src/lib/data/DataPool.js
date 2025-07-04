import * as cesiumHelper from "../helper/cesiumHelper.js";
import { convertToUniversalCoordinate } from "../helper/helper.js";

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */


/**
 * DataPool holds all measurement records in a unified structure.
 * It uses a shared EventEmitter (set externally) to notify when data is added, updated, or removed.
 */
class DataPool {
    /** @type {Array<MeasurementGroup>} */
    _data = [];
    /** @type {import('events').EventEmitter | null} */
    emitter = null;

    constructor() {
    }

    // Getter and setter for the shared emitter.
    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    get data() {
        return this._data;
    }


    /*******************
     * CRUD OPERATIONS *
     *******************/

    /*******************
     * CREATE FEATURES *
     *******************/
    /**
     * Adds a new measurement record.
     * @param {Object} measure - A measurement record.
     */
    addMeasure(measure) {
        // Validate the input
        if (!measure || typeof measure !== "object") return;

        // Validate the coordinates
        if (!measure.coordinates || measure.coordinates.length === 0) return;

        // Convert coordinates to cartographicDegrees
        measure.coordinates = this._coordToCartographicDegrees(measure.coordinates);

        // Add new data to the data pool
        this._data.push(measure);

        // Emit the new data 
        if (this.emitter) {
            // Emit the new data
            this.emitter.emit("data:updated", measure);
            this.emitter.emit("data", this._data);
        }
    }


    /*******************
     * UPDATE FEATURES *
     *******************/
    /**
     * Update or add a measurement record depends on the existence of the record.
     * @param {Object} measure - A measurement record. 
     */
    updateOrAddMeasure(measure) {
        const existingMeasure = this.getMeasureById(measure.id);
        if (existingMeasure) {
            this.updateMeasureById(measure.id, measure);
        } else {
            this.addMeasure(measure);
        }

        console.log(this._data);
    }

    /**
    * Update a measurement record by its id.
    * @param {Number} id - The id of the measurement record. 
    * @param {Object} newData - The new data to replace the existing record.
    * @returns 
    */
    updateMeasureById(id, newData) {
        const measureIndex = this._data.findIndex(measure => measure.id === id);
        if (measureIndex === -1) {
            console.warn("No measurement found containing the provided id.");
            return;
        }

        // coordinates handling to convert to cartographicDegrees
        newData.coordinates = this._coordToCartographicDegrees(newData.coordinates);

        // Update the entire group with newData (you might also merge instead of replace)
        this._data[measureIndex] = newData;

        if (this.emitter) {
            this.emitter.emit("data:updated", this._data[measureIndex]);
            this.emitter.emit("data", this._data);
        }

        return this._data[measureIndex];
    }

    /**
     * Updates a measurement record that contains a given coordinate.
     * This method finds the measurement group by matching one coordinate (using areCoordinatesEqual).
     * @param {Object} position - A coordinate to match.
     * @param {Object} newData - The new data to replace the existing record.
     */
    updateMeasureByPosition(position, newData) {
        const groupIndex = this._data.findIndex(group =>
            group.coordinates.some(coord => cesiumHelper.areCoordinatesEqual(coord, position))
        );
        if (groupIndex === -1) {
            console.warn("No measurement found containing the provided position.");
            return;
        }

        // Update the entire group with newData (you might also merge instead of replace)
        this._data[groupIndex] = newData;

        if (this.emitter) {
            this.emitter.emit("data:updated", this._data[groupIndex]);
        }
    }

    /*****************
     * READ FEATURES *
     *****************/
    /**
     * 
     * @param {Number} id - The id of the measurement record. 
     * @returns {Object} measurement record
     */
    getMeasureById(id) {
        return this._data.find(measure => measure.id === id);
    }

    /**
     * Retrieves a measurement record by matching one of its coordinates.
     * @param {Object} position - A coordinate to match.
     * @returns {Object|undefined} The matched measurement record or undefined if not found.
     */
    getMeasureByPosition(position) {
        return this._data.find(group =>
            group.coordinates.some(coord => cesiumHelper.areCoordinatesEqual(coord, position))
        );
    }

    /**
     * Get the shallow copy of all measurement records in choose coords types.
     * @param {cartesian|cartographicDegrees|cartographic} coordType - The type of coordinates to return.
     * @returns {Array} Array of measurement records.
     */
    getAllMeasures(coordType) {
        if (!coordType || typeof coordType !== "string") return [];

        if (!this._data || this._data.length === 0) return [];

        // return the data, and its coordinates in cartesian3
        if (coordType === "cartesian") {
            return this._data.map(measure => {
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => cesiumHelper.convertToCartesian3(coord))
                }
            });
        }

        // return data as coordinates in cartographicDegrees
        if (coordType === "cartographicDegrees") {
            return this._data.map(measure => {
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => cesiumHelper.convertToCartographicDegrees(coord))
                }
            });

        }

        // return data as coordinates in cartographic
        if (coordType === "cartographic") {
            return this._data.map(measure => {
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => cesiumHelper.convertToCartographicDegrees(coord))
                }
            });
        }

        return [...this._data]
    }


    /*******************
     * DELETE FEATURES *
     *******************/
    /**
     * Removes a measurement record by its id.
     * @param {number} id - The id of the measurement record. 
     * @returns {Object} The removed measurement record.
     */
    removeMeasureById(id) {
        const measureIndex = this._data.findIndex(measure => measure.id === Number(id));
        if (measureIndex === -1) {
            console.warn("No measurement found containing the provided id.");
            return; // Or return null / undefined explicitly
        }

        // Remove the measurement from the data pool
        const removedMeasure = this._data.splice(measureIndex, 1)[0];

        if (this.emitter) {
            this.emitter.emit("data:removed", removedMeasure);
            this.emitter.emit("data", this._data);
        }
        return removedMeasure; // Explicitly return the removed measure
    }

    /**
     * Removes all measurement records associated with a specific map name.
     * @param {"cesium"|"google"|"leaflet"} mapName - The name of the map to filter the measurements.
     * @returns {void}
     */
    removeDataByMapName(mapName) {
        if (!mapName || typeof mapName !== "string") return;

        const initialLength = this._data.length;
        this._data = this._data.filter(measure => measure.mapName !== mapName);

        if (this.emitter && this._data.length < initialLength) {
            this.emitter.emit("data:removed", { mapName });
            this.emitter.emit("data", this._data);
        }
    }

    destroy() {
        this._data = [];
        if (this.emitter) {
            this.emitter.emit("data:cleared");
        }
        console.log("DataPool: All data cleared.");
    }


    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * Convert an array of coordinates to cartographicDegrees.
     * @param {Array} coordsArray - An array of coordinates.
     * @returns {Array} An array of cartographicDegrees.
     */
    _coordToCartographicDegrees(coordsArray) {
        if (!Array.isArray(coordsArray)) {
            console.warn("DataPool: Input to _coordToCartographicDegrees must be an array.");
            return [];
        }

        return coordsArray.map(coord => {
            if (!coord) return null; // Skip null/undefined coordinates
            return convertToUniversalCoordinate(coord); // Convert to universal coordinate
        }).filter(Boolean);
    }
}

export default new DataPool(); // Export as singleton
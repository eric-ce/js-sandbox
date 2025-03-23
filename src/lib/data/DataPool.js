// src/lib/data/DataPool.js
import { areCoordinatesEqual, cartesian3ToCartographicDegrees, convertToCartesian3, convertToCartographicDegrees } from "../helper/cesiumHelper.js";

/**
 * DataPool holds all measurement records in a unified structure.
 * Each record follows a structure similar to:
 * {
 *   id: timeStamp,
 *   mode: "distance",
 *   coordinates: [{lat, lon, height}, ...],
 *   supportedMaps: [ "cesium", "google", "leaflet" ]
 *   records: [48.141637595853204],
 *   status: "pending"
 * }
 * 
 * It uses a shared EventEmitter (set externally) to notify when data is added, updated, or removed.
 */
class DataPool {
    constructor() {
        this._data = [];      // Holds measurement records
        this._emitter = null; // Shared emitter; to be set via setEmitter()
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
     * 
     * @param {Number} id - The id of the measurement record. 
     * @returns {Object} measurement record
     */
    getMeasureById(id) {
        return this._data.find(measure => measure.id === id);
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
            group.coordinates.some(coord => areCoordinatesEqual(coord, position))
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

    /**
     * Retrieves a measurement record by matching one of its coordinates.
     * @param {Object} position - A coordinate to match.
     * @returns {Object|undefined} The matched measurement record or undefined if not found.
     */
    getMeasureByPosition(position) {
        return this._data.find(group =>
            group.coordinates.some(coord => areCoordinatesEqual(coord, position))
        );
    }

    /**
     * Get the shallow copy of all measurement records in choose coords types.
     * @param {String} coordType - The type of coordinates to return.
     * @returns {Array} Array of measurement records.
     */
    getAllMeasures(coordType) {
        if (!coordType || typeof coordType !== "string") return;

        if (!this._data || this._data.length === 0) return;

        // return the data, and its coordinates in cartesian3
        if (coordType === "cartesian") {
            return this._data.map(measure => {
                console.log(measure)
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => convertToCartesian3(coord))
                }
            });
        }

        // return data as coordinates in cartographicDegrees
        if (coordType === "cartographicDegrees") {
            return this._data.map(measure => {
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => convertToCartographicDegrees(coord))
                }
            });

        }

        // return data as coordinates in cartographic
        if (coordType === "cartographic") {
            return this._data.map(measure => {
                return {
                    ...measure,
                    coordinates: measure.coordinates.map(coord => convertToCartographicDegrees(coord))
                }
            });
        }

        return [...this._data]
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
        return coordsArray.map(coord => convertToCartographicDegrees(coord));
    }
}

export default new DataPool(); // Export as singleton
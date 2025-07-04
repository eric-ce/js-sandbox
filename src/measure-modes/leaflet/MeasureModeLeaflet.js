import { MeasureModeBase } from "../MeasureModeBase.js";
import dataPool from "../../lib/data/DataPool.js";
import { areCoordinatesEqual, convertToLatLng } from "../../lib/helper/leafletHelper.js";

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

/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/LeafletInputHandler.js').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/interaction/LeafletDragHandler.js').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/interaction/LeafletHighlightHandler.js').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/LeafletMeasure.js').LeafletMeasure} LeafletMeasure */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/**
 * Shared functionality between modes in Leaflet Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `leafletHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeLeaflet extends MeasureModeBase {
    /**
     * @param {string} modeName - The name of the mode 
     * @param {LeafletInputHandler} inputHandler 
     * @param {LeafletDragHandler} dragHandler 
     * @param {LeafletHighlightHandler} highlightHandler 
     * @param {LeafletMeasure} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

    /**
     * Find a measure by its ID from the data pool.
     * @param {number} measureId - The ID of the measure to find.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureById(measureId) {
        if (typeof measureId !== "number") {
            console.warn("Invalid measureId provided. It should be a number.");
            return null; // Return null if measureId is not a number
        }

        const measure = dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measure) return; // If no measure found, exit the function

        // Convert cartographic degrees to Google coordinates
        measure.coordinates = measure.coordinates.map(coord => convertToLatLng(coord)); // Ensure coordinates are in Google format
        return measure;
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

    /**
     * Removes all pending annotations in the current mode.
     * This includes points, labels, polylines, and polygons that are not completed.
     * It does not remove completed annotations.
     * @returns {void}
     */
    removePendingAnnotations() {
        const targetId = `annotate_${this.mode}`;

        // Get all layer groups from the drawing helper
        const collections = [
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection
        ].filter(Boolean); // Filter out any null/undefined collections

        collections.forEach(collection => {
            const layersToRemove = [];

            // Iterate through layers to find pending annotations for this mode
            collection.eachLayer(layer => {
                if (layer.id.includes(targetId) && layer.status !== 'completed') {
                    layersToRemove.push(layer);
                }
            });

            // Remove the identified layers
            layersToRemove.forEach(layer => collection.removeLayer(layer));
        });
    }
}

export { MeasureModeLeaflet };
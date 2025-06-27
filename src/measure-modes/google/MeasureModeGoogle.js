import { MeasureModeBase } from "../MeasureModeBase.js";
import { areCoordinatesEqual, convertToLatLng } from "../../lib/helper/googleHelper.js";
import dataPool from "../../lib/data/DataPool.js";


/** @typedef {import('../../lib/input/GoogleMapsInputHandler.js').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../../lib/interaction/GoogleDragHandler.js').GoogleDragHandler} GoogleDragHandler */
/** @typedef {import('../../lib/interaction/GoogleHighlightHandler.js').GoogleHighlightHandler} GoogleHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/GoogleMeasure.js').GoogleMeasure} GoogleMeasure */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */


// Measure data 
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
 * Shared functionality between modes in Google Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `googleHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeGoogle extends MeasureModeBase {
    /**
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {GoogleMapsInputHandler} inputHandler - The map input event handler abstraction.
     * @param {GoogleDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {GoogleHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {GoogleMeasure} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }



    /*******************
     * UTILITY FEATURE *
     *******************/
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
     * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number}} coordinate - The coordinate to find the measure data. 
     * @returns {MeasurementGroup} - returns a cloned measure object with converted google coordinates
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

        const coordinates = measure.coordinates.map(coord => convertToLatLng(coord));

        return { ...measure, coordinates }; // Return a new object with the coordinates converted to Google format
    }

    /**
     * Remove all annotations and listeners from the map.
     * It is intended to be called when the map disconnects. 
     */
    removeAnnotationsAndListeners() {
        this.pointCollection.forEach(marker => {
            google.maps.event.clearInstanceListeners(marker); // Remove all listeners from this marker
            marker.setMap(null); // Remove marker from map
        });
        this.pointCollection = []; // Clear the collection

        this.labelCollection.forEach(label => {
            google.maps.event.clearInstanceListeners(label); // Remove all listeners from this label
            label.setMap(null); // Remove label from map
        })
        this.labelCollection = []; // Clear the collection

        this.polylineCollection.forEach(polyline => {
            google.maps.event.clearInstanceListeners(polyline); // Remove all listeners from this polyline
            polyline.setMap(null); // Remove polyline from map
        });
        this.polylineCollection = []; // Clear the collection

        this.polygonCollection.forEach(polygon => {
            google.maps.event.clearInstanceListeners(polygon); // Remove all listeners from this polygon
            polygon.setMap(null); // Remove polygon from map
        });
    }
}

export { MeasureModeGoogle };
/**
 * Centralize type definitions 
 */

/**
 * @typedef {import('../events/ShareEmitter.mjs').ShareEmitter} ShareEmitter
 * @typedef {import('../state/StateManager.mjs').StateManager} StateManager
 * @typedef {import('../data/DataPool.mjs').DataPool} DataPool
 * @typedef {import('../input/CesiumInputHandler.mjs').CesiumInputHandler} CesiumInputHandler
 * @typedef {import('../input/GoogleMapsInputHandler.mjs').GoogleMapsInputHandler} GoogleMapsInputHandler
 * @typedef {import('../input/LeafletInputHandler.mjs').LeafletInputHandler} LeafletInputHandler
 * @typedef {import('../interaction/CesiumDragHandler.mjs').CesiumDragHandler} CesiumDragHandler
 * @typedef {import('../interaction/GoogleDragHandler.mjs').GoogleDragHandler} GoogleDragHandler
 * @typedef {import('../interaction/CesiumHighlightHandler.mjs').CesiumHighlightHandler} CesiumHighlightHandler
 * @typedef {import('../interaction/GoogleHighlightHandler.mjs').GoogleHighlightHandler} GoogleHighlightHandler
 * @typedef {import('../interaction/LeafletDragHandler.mjs').LeafletDragHandler} LeafletDragHandler
 * @typedef {import('../interaction/LeafletHighlightHandler.mjs').LeafletHighlightHandler} LeafletHighlightHandler
 */

/** 
 * Annotation Components
 * @typedef {import("../../components/AnnotationComponentBase.mjs").AnnotationComponentBase} AnnotationComponentBase
 * @typedef {import("../../components/CesiumAnnotation.mjs").CesiumAnnotation} CesiumAnnotation
 * @typedef {import("../../components/GoogleAnnotation.mjs").GoogleAnnotation} GoogleAnnotation
 * @typedef {import("../../components/leafletAnnotation.mjs").LeafletAnnotation} LeafletAnnotation
 */

/**
 * @typedef MeasurementGroup
 * @property {number} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {Array<{latitude: number, longitude: number, height?: number}|number|string>} _records - Historical coordinate records
 * @property {Array<{latitude: number, longitude: number, height?: number}>|[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} sourceMap - The map where this measurement is sourced from
 * @property {Array<'cesium'|'google'|'leaflet'>} renderedOn - The maps where this measurement is rendered
 */

/**
 * Coordinates
 * @typedef {{lat: number, lng: number}} LatLng
 * @typedef {{lat: number, lng: number, height: number}} LatLngHeight
 * @typedef {{x:number,y:number,z:number}} XYZ
 */

export { };
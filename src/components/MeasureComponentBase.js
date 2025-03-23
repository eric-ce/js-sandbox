/**
 * Base class for all measure components of cesium-measure, google-measure, and leaflet-measure.
 */
import dataPool from "../lib/data/DataPool.js";
import { sharedStyleSheet } from "../styles/sharedStyle.js";

export class MeasureComponentBase extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        // Core component state
        this._isInitialized = false;
        this._data = [];

        // Dependencies
        this._map = null;
        this._app = null;
        this._stateManager = null;
        this._emitter = null;

        // Event handler references for cleanup
        this._dataHandler = null;
    }

    // Getters and setters
    get app() {
        return this._app;
    }

    set app(app) {
        this._app = app;
        this.log = app.log;
    }

    get stateManager() {
        return this._stateManager;
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get data() {
        return this._data;
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    get map() {
        return this._map;
    }

    set map(map) {
        this._map = map;
    }

    get isInitialized() {
        return this._isInitialized;
    }

    async connectedCallback() {
        // Apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        this._initialize();
    }

    disconnectedCallback() {
        // Clean up event listeners
        if (this._dataHandler && this._emitter) {
            this._emitter.off("data", this._dataHandler);
        }

        // Clean up map elements if needed
        if (this._data.length > 0) {
            this._data.forEach(item => {
                if (item.annotations) {
                    this._removeAnnotations(item.annotations);
                }
            });
        }
    }

    _initialize() {
        // Early return with error message if dependencies aren't available
        if (!this.map) {
            console.warn(`${this.constructor.name}: Map is not available for initialization`);
            return;
        }

        if (!this.emitter) {
            console.warn(`${this.constructor.name}: Event emitter is not available for initialization`);
            return;
        }

        // Initialize with existing data if available
        if (dataPool?.data?.length > 0 && !this._isInitialized) {
            this._data = [...dataPool.data];
            this._drawFromDataArray(this._data);
            this._isInitialized = true;
        }

        // Set up event listener with proper cleanup
        const handleData = (data) => {
            this._drawFromDataArray(data);
        };

        this.emitter.on("data", handleData);

        // Store the handler for potential cleanup in disconnectedCallback
        this._dataHandler = handleData;
    }

    /**
     * Draws the measurement data on the map based on the data array of objects.
     * @param {Array} data - The data array containing measurement data. 
     * @returns {void}
     */
    _drawFromDataArray(data) {
        // Use Array.isArray for proper type checking
        if (!Array.isArray(data) || data.length === 0) return;

        // For small datasets, process immediately
        if (data.length <= 20) {
            data.forEach(item => this._drawFromDataObject(item));
            return;
        }

        // For larger datasets, use batching
        this._processBatches(data, item => this._drawFromDataObject(item));
    }

    /**
    * Draws the measurement data on the map based on the data object.
    * @param {Object} data - The data object containing measurement data.
    * @param {string} data.id - Unique identifier for the data object.
    * @param {string} data.mode - Measurement mode
    * @param {Array<{latitude: number, longitude: number}>} data.coordinates - Array of coordinate objects.
    * @returns {void}
    */
    _drawFromDataObject(data) {
        // Validate input data
        if (!data?.coordinates?.length) return;

        const existingIndex = this._data.findIndex(item => item.id === data.id);
        const existingMeasure = existingIndex >= 0 ? this._data[existingIndex] : null;

        // Create empty annotations object
        const annotations = {
            markers: [],
            polylines: [],
            polygon: null,
            labels: [],
        };

        // Initialize records from data
        // IMPORTANT: Always use data._records directly, don't create a separate variable
        console.log(`Drawing data for ID ${data.id}, records:`, data._records);

        // If data existing, check if coordinates changed
        if (existingMeasure) {
            // const coordsEqual = this._areCoordinatesEqual(existingMeasure.coordinates, data.coordinates);
            const coordsEqual = data.coordinates.every((coord, index) => {
                this._areCoordinatesEqual(coord, existingMeasure.coordinates[index]);
            });

            // It means data correctly drawn, coordinates haven't changed and annotations exist, exit early
            if (coordsEqual && existingMeasure.annotations) return;

            // It means data updates, Clean up existing annotations regardless of mode
            this._removeAnnotations(existingMeasure.annotations);
        }

        // Create new annotations based on the mode
        switch (data.mode) {
            case "polygon":
                annotations.polygon = this._addPolygon(data.coordinates);
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.labels = [this._addLabel(data.coordinates, data._records[0])];
                break;
            default:
                annotations.markers = this._addPointMarkersFromArray(data.coordinates);
                annotations.polylines = this._addPolylinesFromArray(data.coordinates);
                annotations.labels = this._addLabelsFromArray(data.coordinates, data._records);
                break;
        }

        // Update data store
        const updatedData = { ...data, annotations };

        if (existingIndex >= 0) {
            // Update existing data
            this._data[existingIndex] = updatedData;
        } else {
            // Add new data
            this._data.push({ ...data, annotations });
        }
    }
    /**
     * Checks if two coordinate objects are equal by comparing only latitude and longitude.
     * Height values are intentionally ignored in the comparison.
     * @param {Object} coord1 - First coordinate object with latitude and longitude properties
     * @param {Object} coord2 - Second coordinate object with latitude and longitude properties
     * @returns {boolean}
     */
    _areCoordinatesEqual(coord1, coord2) {
        // Check if both coordinates have valid latitude and longitude
        if (!coord1 || !coord2) return false;
        if (typeof coord1.latitude !== 'number' || typeof coord1.longitude !== 'number') return false;
        if (typeof coord2.latitude !== 'number' || typeof coord2.longitude !== 'number') return false;

        // Compare only latitude and longitude, ignoring height
        return coord1.latitude === coord2.latitude && coord1.longitude === coord2.longitude;
    }

    /**
     * Process an array of items in batches to avoid UI blocking in order to improve performance.
     * @param {Array} items - Array of items to process
     * @param {Function} processor - Function to call for each item
     * @param {number} [batchSize=20] - Number of items to process per batch
     */
    _processBatches(items, processor, batchSize = 20) {
        let index = 0;

        const processNextBatch = () => {
            // Calculate end index for current batch
            const endIndex = Math.min(index + batchSize, items.length);

            // Process current batch
            for (let i = index; i < endIndex; i++) {
                processor(items[i]);
            }

            // Update index for next batch
            index = endIndex;

            // If more items remain, schedule next batch
            if (index < items.length) {
                requestAnimationFrame(processNextBatch);
            }
        };

        // Start processing the first batch
        processNextBatch();
    }

    /**
     * Removes all annotations in the provided annotations object.
     * @private
     * @param {Object} annotations - Object containing markers, polylines, and polygon
     */
    _removeAnnotations(annotations) {
        if (!annotations) return;

        annotations.markers?.forEach(marker => this._removePointMarker(marker));
        annotations.polylines?.forEach(line => this._removePolyline(line));
        if (annotations.polygon) this._removePolygon(annotations.polygon);
        annotations.labels?.forEach(label => this._removeLabel(label));
    }

    // Abstract methods that must be implemented by subclasses
    _addPointMarker(position, color, options) {
        throw new Error('_addPointMarker must be implemented by subclass');
    }

    _addPointMarkersFromArray(positions, color, options) {
        throw new Error('_addPointMarkersFromArray must be implemented by subclass');
    }

    _addPolyline(positions, color, options) {
        throw new Error('_addPolyline must be implemented by subclass');
    }

    _addPolylinesFromArray(positions, color, options) {
        throw new Error('_addPolylinesFromArray must be implemented by subclass');
    }

    _addPolygon(positions, color, options) {
        throw new Error('_addPolygon must be implemented by subclass');
    }
    _addLabel(positions, text, options) {
        throw new Error('_addLabel must be implemented by subclass');
    }

    _addLabelsFromArray(positions, text, options) {
        throw new Error('_addLabelsFromArray must be implemented by subclass');
    }

    _removePointMarker(marker) {
        throw new Error('_removePointMarker must be implemented by subclass');
    }

    _removePolyline(polyline) {
        throw new Error('_removePolyline must be implemented by subclass');
    }

    _removePolygon(polygon) {
        throw new Error('_removePolygon must be implemented by subclass');
    }

    _removeLabel(label) {
        throw new Error('_removeLabel must be implemented by subclass');
    }
}
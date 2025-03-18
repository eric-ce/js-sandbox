import {
    createCircleMarker,
    createCircleMarkers,
    createPolygon,
    createPolyline,
    createPolylines,
    removeMarker,
    removePolygon,
    removePolyline,
} from "../lib/helper/leafletHelper.js";
import { sharedStyleSheet } from "../styles/sharedStyle.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class LeafLetMeasure extends MeasureComponentBase {
    constructor() {
        super();
        // this.attachShadow({ mode: "open" });

        this._stateManager = null;
        this._emitter = null;

        // navigator app
        this._app = null;

        this._data = [];

        this._map = null;
    }

    get map() {
        return this._map;
    }

    set map(map) {
        this._map = map;
    }

    set app(app) {
        this._app = app;
        this.log = app.log;
    }

    get app() {
        return this._app;
    }

    get stateManager() {
        return this._stateManager;
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    async connectedCallback() {
        // apply style for the web component
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        this._initialize();
    }

    _initialize() {
        if (!this.map || !this.emitter) {
            return;
        }
        // this._createUI();
        this.emitter.on("data:updated", (data) => {
            this._drawFromData(data);
        });
    }

    _drawFromData(data) {
        // Ensure coordinates exist.
        if (!data.coordinates) return;

        let markers = [];
        let polylines = [];
        let polygon = null;

        // Find an existing record with the same id.
        const existingMeasure = this._data.find((item) => item.id === data.id);

        if (!existingMeasure) {
            // create new overlays based on the data mode.
            switch (data.mode) {
                case "polygon":
                    polygon = this._addPolygon(data.coordinates);
                    break;
                default:
                    // New data: create vectors using the class's wrapper methods.
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];
                    polylines = this._addPolyline(data.coordinates) || [];
                    break;
            }

            // Store the new record along with its vectors.
            this._data.push({ ...data, vectors: { markers, polylines, polygon } });
        } else {
            // Check if coordinates have changed.
            const coordsEqual =
                existingMeasure.coordinates.length === data.coordinates.length &&
                existingMeasure.coordinates.every(
                    (pos, i) =>
                        pos.latitude === data.coordinates[i].latitude &&
                        pos.longitude === data.coordinates[i].longitude
                );

            if (coordsEqual) return; // No changes, so exit.

            // Update the vectors based on the data mode.
            switch (data.mode) {
                case "polygon":
                    // Remove old vectors
                    if (existingMeasure.vectors.polygon) {
                        this._removePolygon(existingMeasure.vectors.polygon);
                    }
                    existingMeasure.vectors.markers?.forEach((marker) => this._removePointMarker(marker));

                    // Create new vectors
                    polygon = this._addPolygon(data.coordinates);
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];

                    break;
                default:
                    // Remove old vectors using the class's wrapper removal methods.
                    existingMeasure.vectors.markers?.forEach((marker) => this._removePointMarker(marker));
                    existingMeasure.vectors.polylines?.forEach((line) => this._removePolyline(line));

                    // Create new vectors
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];
                    polylines = this._addPolylinesFromArray(data.coordinates) || [];
                    break;
            }

            // Update the existing record with the new vectors.
            const measureIndex = this._data.findIndex((item) => item.id === data.id);
            this._data[measureIndex] = { ...data, vectors: { markers, polylines, polygon } };
        }
    }

    _addPointMarker(position, color = "#FF0000", options = {}) {
        return createCircleMarker(this.map, position, color, options);
    }

    _addPointMarkersFromArray(positions, color = "#FF0000", options = {}) {
        return createCircleMarkers(this.map, positions, color, options);
    }

    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options);
    }

    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options);
    }

    _addPolygon(positions, color = "#3388ff", options = {}) {
        return createPolygon(this.map, positions, color, options);
    }

    _removePointMarker(marker) {
        removeMarker(marker);
    }

    _removePolyline(polyline) {
        removePolyline(polyline);
    }

    _removePolygon(polygon) {
        removePolygon(polygon);
    }
}

customElements.define("leaflet-measure", LeafLetMeasure);

import { Loader } from "@googlemaps/js-api-loader";
import { sharedStyleSheet } from "../styles/sharedStyle.js";
import {
    createPointMarker,
    createPointMarkers,
    createPolyline,
    createPolylines,
    createPolygon,
    removePointMarker,
    removePolyline,
    removePolygon,
} from "../lib/helper/googleHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";
export default class GoogleMeasure extends MeasureComponentBase {
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

    get map() {
        return this._map;
    }

    set map(map) {
        this._map = map;
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

    // _createUI() {
    //     const button = document.createElement('button');
    //     button.textContent = "Google";
    //     button.style.position = "absolute";
    //     button.style.top = "0";
    //     button.style.left = "0";
    //     button.style.zIndex = "999";
    //     button.addEventListener('click', () => {
    //         console.log(this.data);
    //     })

    //     this.shadowRoot.appendChild(button);
    // }

    /**
     * Processes the updated data to add or update overlays on the map.
     *
     * @param {Object} data - The data object containing overlay information.
     * @param {Array<{latitude: number, longitude: number}>} data.coordinates - Array of coordinate objects.
     * @returns {void}
     */
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
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];
                    polylines = this._addPolylinesFromArray(data.coordinates) || [];
                    break;
            }

            // Store the new record along with its overlays.
            this._data.push({ ...data, overlays: { markers, polylines, polygon } });
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

            // Update the overlays based on the data mode.
            switch (data.mode) {
                case "polygon":
                    // Remove old overlays
                    if (existingMeasure.overlays.polygon) {
                        this._removePolygon(existingMeasure.overlays.polygon);
                    }
                    existingMeasure.overlays.markers?.forEach((marker) => this._removePointMarker(marker));

                    // Create new overlays
                    polygon = this._addPolygon(data.coordinates);
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];

                    break;
                default:
                    // Remove old overlays using the class's wrapper removal methods.
                    existingMeasure.overlays.markers?.forEach((marker) => this._removePointMarker(marker));
                    existingMeasure.overlays.polylines?.forEach((line) => this._removePolyline(line));

                    // Create new overlays
                    markers = this._addPointMarkersFromArray(data.coordinates) || [];
                    polylines = this._addPolylinesFromArray(data.coordinates) || [];
                    break;
            }

            // Update the existing record with the new overlays.
            const measureIndex = this._data.findIndex((item) => item.id === data.id);
            this._data[measureIndex] = { ...data, overlays: { markers, polylines, polygon } };
        }
    }

    _addPointMarker(position, color = "#FF0000", options = {}) {
        return createPointMarker(this.map, position, color, options = {});
    }

    _addPointMarkersFromArray(positions, color = "#FF0000", options = {}) {
        return createPointMarkers(this.map, positions, color, options = {});
    }

    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options = {});
    }

    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options = {});
    }

    _addPolygon(positions, color = "#A52A2A", options = {}) {
        return createPolygon(this.map, positions, color, options = {});
    }

    _removePointMarker(marker) {
        removePointMarker(marker);
    }

    _removePolyline(polyline) {
        removePolyline(polyline);
    }

    _removePolygon(polygon) {
        removePolygon(polygon);
    }
}

customElements.define("google-measure", GoogleMeasure);

import { Loader } from '@googlemaps/js-api-loader';
import { sharedStyleSheet } from '../styles/sharedStyle.js';
import {
    createPointMarker,
    createPointMarkers,
    createPolyline,
    createPolylines,
} from '../lib/helper/googleHelper.js';
export default class GoogleMeasure extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this._stateManager = null;
        this._emitter = null;

        // navigator app
        this._app = null;

        this._data = []; // for testing 

        this._map = null;

        this.overlays = [111];
    }

    set app(app) {
        this._app = app
        this.log = app.log
    }

    get app() {
        return this._app
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
        console.log(this.map, this.emitter)
        if (!this.map || !this.emitter) {
            return;
        }
        // this._createUI();
        this.emitter.on("data:updated", (data) => {
            console.log("🚀 data:", data);

            this._drawFromData(data);
        })

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
  * It uses the class's wrapper methods to create and remove markers and polylines.
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

        // Find an existing record with the same id.
        const existingMeasure = this._data.find(item => item.id === data.id);

        if (!existingMeasure) {
            // New data: create overlays using the class's wrapper methods.
            markers = this._addPointMarkersFromArray(data.coordinates);
            polylines = this._addPolylinesFromArray(data.coordinates);

            // Store the new record along with its overlays.
            this._data.push({ ...data, overlays: { markers, polylines } });
        } else {
            // Check if coordinates have changed.
            const coordsEqual = existingMeasure.coordinates.length === data.coordinates.length &&
                existingMeasure.coordinates.every((pos, i) =>
                    pos.latitude === data.coordinates[i].latitude &&
                    pos.longitude === data.coordinates[i].longitude
                );

            if (coordsEqual) return; // No changes, so exit.

            // Remove old overlays using the class's wrapper removal methods.
            existingMeasure.overlays.markers?.forEach(marker => this._removePointMarker(marker));
            existingMeasure.overlays.polylines?.forEach(line => this._removePolyline(line));

            // Create new overlays.
            markers = this._addPointMarkersFromArray(data.coordinates);
            polylines = this._addPolylinesFromArray(data.coordinates);

            // Update the existing record with the new overlays.
            const measureIndex = this._data.findIndex(item => item.id === data.id);
            this._data[measureIndex] = { ...data, overlays: { markers, polylines } };
        }
    }

    _addPointMarker(position, color = "#FF0000") {
        return createPointMarker(this.map, position, color);
    }

    _addPointMarkersFromArray(positions, color = "#FF0000") {
        return createPointMarkers(this.map, positions, color);
    }

    _addPolyline(positions, color = "#A52A2A") {
        return createPolyline(this.map, positions, color);
    }

    _addPolylinesFromArray(positions, color = "#A52A2A") {
        return createPolylines(this.map, positions, color);
    }

    /**
     * Removes a point marker from the map.
     *
     * @param {(google.maps.marker.AdvancedMarkerElement|google.maps.Marker)} marker - The marker element to remove.
     * @returns {void}
     */
    _removePointMarker(marker) {
        if (!marker) return;
        marker.setMap(null);
        marker = null;
    }

    /**
     * Removes a polyline from the map.
     *
     * @param {google.maps.Polyline} polyline - The polyline to remove.
     * @returns {void}
     */
    _removePolyline(polyline) {
        if (!polyline) return;
        polyline.setMap(null);
        polyline = null;
    }
}

customElements.define('google-measure', GoogleMeasure);
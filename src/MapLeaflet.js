import L from "leaflet";

export default class MapLeaflet extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._map = null;

        this._mapEmitter = null;
        this.type = "map-leaflet";

        this._isListening = true; // Flag to track if the listener is active
    }

    get mapEmitter() {
        return this._mapEmitter;
    }

    set mapEmitter(emitter) {
        this._mapEmitter = emitter;
    }

    async connectedCallback() {
        // apply leaflet style due to shadow dom
        this.leafletStyle = document.createElement("link");
        this.leafletStyle.rel = "stylesheet";
        this.leafletStyle.href = `leaflet/leaflet.css`;
        this.shadowRoot.appendChild(this.leafletStyle);

        this.div = document.createElement("div");
        this.div.id = "leaflet-container";
        this.div.style.width = "100%";
        this.div.style.height = "100%";
        this.shadowRoot.appendChild(this.div);

        await this._initialize();
    }

    async _initialize() {
        this._map = await this._createMap();

        this._mapEmitter.on("camera:changed", ({ mapName, lat, lng, zoom }) => {
            if (mapName === this.type) return;

            // Temporarily remove the moveend listener
            this._removeMapListener();

            this._map.once('moveend', () => {
                // Add the listener back after the animation completes
                setTimeout(() => {
                    this._addMapListener();
                }, 100);
            });

            this._map.flyTo([lat, lng], zoom || 16, {
                duration: 1.5
            });
        });

        this._addMapListener();
    }

    async _createMap() {
        // Set the correct path for marker icons
        L.Icon.Default.imagePath = '/leaflet/images/';

        // Initialize the map centered at a given coordinate with a zoom level.
        const map = L.map(this.div).setView([51.505, -0.09], 13);

        // Add a tile layer from OpenStreetMap.
        const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);

        // Redraw the map to solve the issue of not showing partial map
        map.invalidateSize();

        return map;
    }

    // Handler for map movement
    _handleMapMove = () => {
        const center = this._map.getCenter();
        const zoom = this._map.getZoom();
        this._mapEmitter.emit("camera:changed", {
            mapName: this.type,
            lat: center.lat,
            lng: center.lng,
            zoom
        });
    }

    // Add the map listener
    _addMapListener() {
        if (this._map) {
            this._map.on('moveend', this._handleMapMove);
            this._isListening = true;
        }
    }

    // Remove the map listener
    _removeMapListener() {
        if (this._map) {
            this._map.off('moveend', this._handleMapMove);
            this._isListening = false;
        }
    }
}

customElements.define("map-leaflet", MapLeaflet);
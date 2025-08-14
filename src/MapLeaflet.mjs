import L from "leaflet";
import { mapStyle } from "./styles/mapStyle.mjs";
import { AnnotationToolbox } from "./components/AnnotationToolbox.mjs";
import { MapBase } from "./MapBase.mjs";
export default class MapLeaflet extends MapBase {
    constructor() {
        super();
        this.type = "map-leaflet";
        this._isListening = true; // Leaflet starts with listener active
    }

    async connectedCallback() {
        // Apply the map style
        this.shadowRoot.adoptedStyleSheets = [mapStyle];

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

        try {
            await this._initialiseMap().then(() => {
                this._attachAnnotationToolbox();
                this._setupResizeHandler();
            })
        } catch (error) {
            console.error("Error initializing Leaflet Maps:", error);
        }
    }

    disconnectedCallback() {
        this._removeMapListener();
        this._cleanupResizeHandler();
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
    }

    _setupResizeHandler() {
        // Use ResizeObserver to detect when the container size changes
        if (this.div && this._map) {
            // Debounce the invalidateSize calls to prevent ResizeObserver loops
            let resizeTimeout;
            this._resizeObserver = new ResizeObserver(() => {
                if (this._map) {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(() => {
                        this._map.invalidateSize();
                    }, 16); // ~1 frame delay
                }
            });
            this._resizeObserver.observe(this.div);
        }
    }

    _cleanupResizeHandler() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    async _createMap() {
        // Set the correct path for marker icons
        L.Icon.Default.imagePath = '/leaflet/images/';

        // Initialize the map centered at a given coordinate with a zoom level.
        const map = L.map(this.div).setView([51.505, -0.09], 19);

        // Add a tile layer from OpenStreetMap.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 20
        }).addTo(map);

        // Redraw the map to solve the issue of not showing partial map
        // map.invalidateSize({ animate: true, debounceMoveend: true });

        return map;
    }

    _panTo(bounds) {
        // Add a guard clause to prevent errors if the map is destroyed.
        if (!this._map) {
            return;
        }

        this._map.once('moveend', () => {
            // Add the listener back after the animation completes
            setTimeout(() => {
                this._addMapListener();
            }, 100);
        });

        this._map.flyToBounds([
            [bounds.south, bounds.west],
            [bounds.north, bounds.east]
        ], { duration: 1.0 });
    }

    _getBounds() {
        const bounds = this._map.getBounds();
        return {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };
    }

    // Handler for map movement
    _handleMapMove = () => {
        this._mapEmitter.emit("camera:changed", {
            mapName: this.type,
            bounds: this._getBounds()
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

    _attachAnnotationToolbox() {
        this.annotationToolbox = this.app.map.annotationToolbox;
        if (!this.map || !this.annotationToolbox) return; // Return if map is not initialized

        // Set properties for the annotation toolbox
        this.annotationToolbox.leafletMap = this.map;
        this.annotationToolbox.type = this.type; // Set the type for the toolbox

        // Initialize the toolbox component by mapType
        this.annotationToolbox.initializeToolboxComponent(this.type);
    }
}

customElements.define("map-leaflet", MapLeaflet);
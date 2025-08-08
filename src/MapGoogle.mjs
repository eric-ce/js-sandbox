import { Loader } from "@googlemaps/js-api-loader";
import { mapStyle } from "./styles/mapStyle.mjs";
import { MeasureToolbox } from "./components/MeasureToolbox.mjs";
import { MapBase } from "./MapBase.mjs";

export class MapGoogle extends MapBase {
    constructor() {
        super();
        this.type = "map-google";

        // Use your API key here or pull it from an environment variable
        this._apiKey = "AIzaSyA_zDtdi26FSz1M22tZuyCOxnTAc5r2GyE";
        // Create a Loader instance
        this._loader = new Loader({
            apiKey: this._apiKey,
            version: "weekly",
            libraries: ["geometry", "visualization", "drawing"] // add libraries like "places" if needed
        });
    }

    async connectedCallback() {
        // Apply the map style
        this.shadowRoot.adoptedStyleSheets = [mapStyle];

        // Create container div for the map
        this.div = document.createElement("div");
        this.div.id = "gmaps-viewer";
        this.div.style.width = "100%";
        this.div.style.height = "100%";
        this.shadowRoot.appendChild(this.div);

        // Load the Google Maps API using the Loader
        try {
            await this._loader.load();
            await this._initialize().then(() => {
                this._attachAnnotationToolbox();
            });

        } catch (error) {
            console.error("Error initializing Google Maps:", error);
            this._showErrorMessage();
        }
    }

    disconnectedCallback() {
        this._removeMapListener();
    }

    async _initialize() {
        await super._initialize();
        // Optionally trigger a resize to ensure proper rendering
        setTimeout(() => {
            if (this._map) {
                google.maps.event.trigger(this._map, "resize");
            }
        }, 100);
    }

    async _createMap() {
        // copy from map-google repo setup
        const mapOptions = {
            zoom: 18,
            center: { lat: -33.77, lng: 150.78 },
            options: { gestureHandling: 'greedy' },
            streetViewControl: false,
            mapTypeId: "roadmap", //google.maps.MapTypeId.ROADMAP,
            mapTypeControlOptions: {
                mapTypeIds: ['tile', 'roadmap', 'satellite', 'hybrid', 'terrain'],
                style: 2 //google.maps.MapTypeControlStyle.DROPDOWN_MENU
            }
        };

        const map = new google.maps.Map(this.div, mapOptions);

        return map;
    }

    _panTo(bounds) {
        const googleBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(bounds.south, bounds.west),
            new google.maps.LatLng(bounds.north, bounds.east)
        );
        this._map.fitBounds(googleBounds);

        // Add the listener back after movement is likely complete
        setTimeout(() => {
            this._addMapListener();
        }, 1000); // Google Maps animation typically takes around 500-750ms
    }

    _getBounds() {
        const bounds = this._map.getBounds();
        if (!bounds) return null;
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        return {
            north: ne.lat(),
            south: sw.lat(),
            east: ne.lng(),
            west: sw.lng()
        };
    }

    // Handler for map movement
    _handleMapIdle = () => {
        const bounds = this._getBounds();
        if (bounds) {
            this._mapEmitter.emit("camera:changed", {
                mapName: this.type,
                bounds: bounds
            });
        }
    };

    // Add the map listener
    _addMapListener() {
        if (this._map && !this._mapListener) {
            this._mapListener = google.maps.event.addListener(
                this._map,
                "idle",
                this._handleMapIdle
            );
            this._isListening = true;
        }
    }

    // Remove the map listener
    _removeMapListener() {
        if (this._mapListener) {
            google.maps.event.removeListener(this._mapListener);
            this._mapListener = null;
            this._isListening = false;
        }
    }

    _showErrorMessage() {
        this.div.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; color: #d32f2f;">
                <div>
                    <h3>Unable to load Google Maps</h3>
                    <p>Please check your API key and internet connection.</p>
                </div>
            </div>
        `;
    }

    // initialize measure toolbox for google
    _attachAnnotationToolbox() {
        if (!this.map || !this.annotationToolbox) return; // Return if map is not initialized

        // Set properties for the annotation toolbox
        this.annotationToolbox.googleMap = this.map;
        this.annotationToolbox.type = this.type; // Set the type for the toolbox

        // Initialize the toolbox component by mapType
        this.annotationToolbox.initializeToolboxComponent(this.type);
    }
}

customElements.define("map-google", MapGoogle);
import { Loader } from "@googlemaps/js-api-loader";
import { mapStyle } from "./styles/mapStyle";
import { MeasureToolbox } from "./components/MeasureToolbox";

export class MapGoogle extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._map = null;
        this.type = "map-google";

        // Use your API key here or pull it from an environment variable
        this._apiKey = "AIzaSyA_zDtdi26FSz1M22tZuyCOxnTAc5r2GyE";
        // Create a Loader instance
        this._loader = new Loader({
            apiKey: this._apiKey,
            version: "weekly",
            libraries: ["geometry", "visualization", "drawing"] // add libraries like "places" if needed
        });

        // mimic navigator app variable for user and user roles
        this.app = {
            log: ["testing"],
            currentUser: {
                sessions: {
                    navigator: {
                        roles: ["fireTrail", "developer", "tester", "flyThrough"]
                    }
                }
            }
        }

        this.measureToolbox = null;

        this._mapEmitter = null;

        this._isListening = false; // Flag to track if the listener is active
    }

    /*********************
     * GETTER AND SETTER *
     *********************/
    get mapEmitter() {
        return this._mapEmitter;
    }

    set mapEmitter(emitter) {
        this._mapEmitter = emitter;
    }

    get map() {
        return this._map;
    }

    set map(map) {
        this._map = map;
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
                const googleMeasure = this.shadowRoot.querySelector("google-measure");
                this.measureToolbox = googleMeasure || this.initializeMeasureToolbox();

            })

        } catch (error) {
            console.error("Error initializing Google Maps:", error);
            this._showErrorMessage();
        }
    }

    async _initialize() {
        this.map = await this._createMap();
        // Optionally trigger a resize to ensure proper rendering
        setTimeout(() => {
            if (this._map) {
                google.maps.event.trigger(this._map, "resize");
            }
        }, 100);

        // Set up the camera change event listener
        this._addMapListener();

        // Listen for camera changes from other maps
        this._mapEmitter.on("camera:changed", ({ mapName, lat, lng, zoom }) => {
            if (mapName === this.type) return;

            // Remove listener before programmatic movement
            this._removeMapListener();

            // Move the map
            this._map.panTo({ lat, lng });
            this._map.setZoom(zoom || 16);

            // Add the listener back after movement is likely complete
            setTimeout(() => {
                this._addMapListener();
            }, 1000); // Google Maps animation typically takes around 500-750ms
        });
    }

    async _createMap() {
        // copy from map-google repo setup
        const mapOptions = {
            zoom: 18,
            center: { lat: -33.77, lng: 150.78 },
            options: { gestureHandling: "greedy" },
            streetViewControl: false,
            mapTypeId: "roadmap",
            mapTypeControlOptions: {
                mapTypeIds: ["tile", "roadmap", "satellite", "hybrid", "terrain"],
                style: 2 //google.maps.MapTypeControlStyle.DROPDOWN_MENU
            },
            // mapId: "c4e6833a187fa179"
        };

        // Load the Google Maps library
        // const { Map } = await google.maps.importLibrary("maps");
        // Load the Marker library
        // await google.maps.importLibrary("marker");

        const map = new google.maps.Map(this.div, mapOptions);

        return map;
    }

    // Handler for map movement
    _handleMapIdle = () => {
        const center = this._map.getCenter();
        const zoom = this._map.getZoom();

        this._mapEmitter.emit("camera:changed", {
            mapName: this.type,
            lat: center.lat(),
            lng: center.lng(),
            zoom
        });
    };

    // Add the map listener
    _addMapListener() {
        if (this._map && !this._mapListener) {
            this._mapListener = google.maps.event.addListener(
                this._map,
                "idle",
                this._handleMapIdle
            );
            this._isListening = true; // Set flag consistent with MapLeaflet
        }
    }

    // Remove the map listener
    _removeMapListener() {
        if (this._mapListener) {
            google.maps.event.removeListener(this._mapListener);
            this._mapListener = null;
            this._isListening = false; // Set flag consistent with MapLeaflet
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

    // Resize, panTo, and addMarker methods remain the same
    resize() {
        if (this._map) {
            google.maps.event.trigger(this._map, "resize");
        }
    }

    panTo(lat, lng) {
        if (this._map) {
            this._map.panTo(new google.maps.LatLng(lat, lng));
        }
    }

    addMarker(lat, lng, title = "") {
        if (this._map) {
            return new google.maps.Marker({
                position: { lat, lng },
                map: this._map,
                title
            });
        }
        return null;
    }

    // initialize measure toolbox for cesium
    initializeMeasureToolbox() {
        if (!this.map) return; // Return if map is not initialized

        const measureToolbox = new MeasureToolbox(this.app, this.type);
        measureToolbox.map = this.map;
        return measureToolbox;
    }


    // disconnectedCallback() {
    //     if (this._map) {
    //         google.maps.event.clearInstanceListeners(this._map);
    //         this._map = null;
    //     }
    // }
}

customElements.define("map-google", MapGoogle);
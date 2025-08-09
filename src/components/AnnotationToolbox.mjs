/**
 * Handle initialization of measure toolbox for different map types.
 * It creates individual measure components or depends on the map type
 */
import { StateManager } from "../lib/state/StateManager.mjs";
// import EventEmitter from "eventemitter3";
import sharedEmitter from "../lib/events/ShareEmitter.mjs";
import { CesiumAnnotation } from "./CesiumAnnotation.mjs";
import { GoogleAnnotation } from "./GoogleAnnotation.mjs";
import { LeafletAnnotation } from "./LeafletAnnotation.mjs"
// import { LeafletAnnotation } from "./LeafletAnnotation.mjs";
import dataPool from "../lib/data/DataPool.mjs";
// import { map } from "leaflet";



export class AnnotationToolbox {
    // --- Private Fields ---
    #app;
    #viewer = null;
    #cesiumPkg = null;
    #type;
    #googleMap = null;
    #leafletMap = null;

    // --- Public Fields ---
    log;
    emitter = sharedEmitter; // Initialized directly
    stateManager;
    cesiumAnnotationToolbox = null;
    googleAnnotationToolbox = null;
    leafletAnnotationToolbox = null;

    constructor(app) {
        this.#app = app;
        this.log = app.log;

        // state manager
        this.stateManager = new StateManager(this.emitter);

        // set emitter for data pool
        dataPool.emitter = this.emitter;
    }

    /*********************
     * GETTER AND SETTER *
     *********************/
    get app() {
        // Access the private field
        return this.#app;
    }

    get viewer() {
        // Access the private field
        return this.#viewer;
    }

    set viewer(viewer) {
        // Set the private field
        this.#viewer = viewer;
    }

    get cesiumPkg() {
        // Access the private field
        return this.#cesiumPkg;
    }

    set cesiumPkg(pkg) {
        // Set the private field
        this.#cesiumPkg = pkg;
    }

    get googleMap() {
        // Access the private field
        return this.#googleMap;
    }

    set googleMap(map) {
        // Set the private field
        this.#googleMap = map;
    }

    get leafletMap() {
        // Access the private field
        return this.#leafletMap;
    }

    set leafletMap(map) {
        // Set the private field
        this.#leafletMap = map;
    }

    get type() {
        // Access the private field
        return this.#type;
    }

    set type(type) {
        // Set the private field
        this.#type = type;
    }


    /**********************
     * TOOLBOX COMPONENTS *
     **********************/
    // Initialize toolbox, determines which map needs to initialize based on opened map
    initializeToolboxComponent(mapType) {
        if (!mapType) return;

        switch (mapType) {
            case 'map-cesium':
                this.initializeCesiumAnnotation();
                break;

            case 'map-google':
                this.initializeGoogleAnnotation();
                break;

            case 'map-leaflet':
                this.initializeLeafletAnnotation();
                break;

            default:
                console.error(`Invalid map type: ${this.#type}`);
                break;
        }
    }

    // Initialize cesium annotation
    initializeCesiumAnnotation() {
        // Use getters which access private fields
        if (!this.viewer || !this.cesiumPkg) return;

        // If already exists and is in DOM, don't recreate
        if (this.cesiumAnnotationToolbox && this.cesiumAnnotationToolbox.isConnected) return;

        this.cesiumAnnotationToolbox = document.createElement("cesium-annotation");
        this.cesiumAnnotationToolbox.map = this.viewer; // Use getter
        this.cesiumAnnotationToolbox.mapName = "cesium";
        this.cesiumAnnotationToolbox.cesiumPkg = this.cesiumPkg; // Use getter
        this.cesiumAnnotationToolbox.app = this.app; // Use getter
        this.cesiumAnnotationToolbox.emitter = this.emitter;
        this.cesiumAnnotationToolbox.stateManager = this.stateManager;

        const mapCesium = document.querySelector("map-cesium");
        mapCesium.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapCesium) return;
        mapCesium.shadowRoot.appendChild(this.cesiumAnnotationToolbox);
    }

    // Initialize google annotation
    initializeGoogleAnnotation() {
        // Use getter
        if (!this.googleMap) return;

        if (this.googleAnnotationToolbox && this.googleAnnotationToolbox.isConnected) return;

        this.googleAnnotationToolbox = document.createElement("google-annotation");
        this.googleAnnotationToolbox.map = this.googleMap; // Use getter
        this.googleAnnotationToolbox.mapName = "google";
        this.googleAnnotationToolbox.app = this.app; // Use getter
        this.googleAnnotationToolbox.emitter = this.emitter;
        this.googleAnnotationToolbox.stateManager = this.stateManager;

        const mapGoogle = document.querySelector("map-google");
        mapGoogle.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapGoogle) return;
        mapGoogle.shadowRoot.appendChild(this.googleAnnotationToolbox);
    }

    // Initialize leaflet annotation
    initializeLeafletAnnotation() {
        // Use getter
        if (!this.leafletMap) return;

        if (this.leafletAnnotationToolbox && this.leafletAnnotationToolbox.isConnected) return;

        this.leafletAnnotationToolbox = document.createElement("leaflet-annotation");
        this.leafletAnnotationToolbox.map = this.leafletMap; // Use getter
        this.leafletAnnotationToolbox.mapName = "leaflet";
        this.leafletAnnotationToolbox.app = this.app; // Use getter
        this.leafletAnnotationToolbox.emitter = this.emitter;
        this.leafletAnnotationToolbox.stateManager = this.stateManager;

        const mapLeaflet = document.querySelector("map-leaflet");
        mapLeaflet.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapLeaflet) return;
        mapLeaflet.shadowRoot.appendChild(this.leafletAnnotationToolbox);
    }
}

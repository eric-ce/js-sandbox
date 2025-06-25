/**
 * Handle initialization of measure toolbox for different map types.
 * It creates individual measure components or depends on the map type
 */
import { StateManager } from "../lib/state/StateManager.js";
// import EventEmitter from "eventemitter3";
import sharedEmitter from "../lib/events/ShareEmitter.js";
import { CesiumMeasure } from "./CesiumMeasure.js";
import { GoogleMeasure } from "./GoogleMeasure.js";
import { LeafletMeasure } from "./LeafletMeasure.js";
import dataPool from "../lib/data/DataPool.js";
// import { map } from "leaflet";



export class MeasureToolbox {
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
    cesiumMeasure = null;
    googleMeasure = null;
    leafletMeasure = null;

    constructor(app, type) {
        this.#app = app;
        this.#type = type;
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
        // Use the private field in the call
        this.initializeMeasureToolbox(this.#type);
    }

    get cesiumPkg() {
        // Access the private field
        return this.#cesiumPkg;
    }

    set cesiumPkg(pkg) {
        // Set the private field
        this.#cesiumPkg = pkg;
        // Use the private field in the call
        this.initializeMeasureToolbox(this.#type);
    }

    get googleMap() {
        // Access the private field
        return this.#googleMap;
    }

    set googleMap(map) {
        // Set the private field
        this.#googleMap = map;
        // Use the private field in the call
        this.initializeMeasureToolbox(this.#type);
    }

    get leafletMap() {
        // Access the private field
        return this.#leafletMap;
    }

    set leafletMap(map) {
        // Set the private field
        this.#leafletMap = map;
        // Use the private field in the call
        this.initializeMeasureToolbox(this.#type);
    }

    get type() {
        // Access the private field
        return this.#type;
    }

    /************
     * FEATURES *
     ************/
    // Initialize toolbox, determines which map needs to initialize based on opened map
    initializeMeasureToolbox(mapType) {
        if (!mapType) return;

        switch (mapType) {
            case 'map-cesium':
                this.initializeCesiumMeasure();
                break;  // Add this break

            case 'map-google':
                this.initializeGoogleMeasure();
                break;  // Add this break

            case 'map-leaflet':
                this.initializeLeafletMeasure();
                break;  // Add this break

            default:
                console.error(`Invalid map type: ${this.#type}`);
                break;
        }
    }

    // Initialize cesium measure
    initializeCesiumMeasure() {
        // Use getters which access private fields
        if (!this.viewer || !this.cesiumPkg) return;

        // If already exists and is in DOM, don't recreate
        if (this.cesiumMeasure && this.cesiumMeasure.isConnected) return;

        this.cesiumMeasure = document.createElement("cesium-measure");
        this.cesiumMeasure.map = this.viewer; // Use getter
        this.cesiumMeasure.mapName = "cesium";
        this.cesiumMeasure.cesiumPkg = this.cesiumPkg; // Use getter
        this.cesiumMeasure.app = this.app; // Use getter
        this.cesiumMeasure.emitter = this.emitter;
        this.cesiumMeasure.stateManager = this.stateManager;

        const mapCesium = document.querySelector("map-cesium");
        mapCesium.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapCesium) return;
        mapCesium.shadowRoot.appendChild(this.cesiumMeasure);
    }
    // Initialize google measure
    initializeGoogleMeasure() {
        // Use getter
        if (!this.googleMap) return;

        if (this.googleMeasure && this.googleMeasure.isConnected) return;

        this.googleMeasure = document.createElement("google-measure");
        this.googleMeasure.map = this.googleMap; // Use getter
        this.googleMeasure.mapName = "google";
        this.googleMeasure.app = this.app; // Use getter
        this.googleMeasure.emitter = this.emitter;
        this.googleMeasure.stateManager = this.stateManager;

        const mapGoogle = document.querySelector("map-google");
        mapGoogle.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapGoogle) return;
        mapGoogle.shadowRoot.appendChild(this.googleMeasure);
    }

    // Initialize leaflet measure
    initializeLeafletMeasure() {
        // Use getter
        if (!this.leafletMap) return;

        if (this.leafletMeasure && this.leafletMeasure.isConnected) return;

        this.leafletMeasure = document.createElement("leaflet-measure");
        this.leafletMeasure.map = this.leafletMap; // Use getter
        this.leafletMeasure.mapName = "leaflet";
        this.leafletMeasure.app = this.app; // Use getter
        this.leafletMeasure.emitter = this.emitter;
        this.leafletMeasure.stateManager = this.stateManager;

        const mapLeaflet = document.querySelector("map-leaflet");
        mapLeaflet.style.position = "relative"; // !important: Ensure the map has a relative position
        if (!mapLeaflet) return;
        mapLeaflet.shadowRoot.appendChild(this.leafletMeasure);
    }
}

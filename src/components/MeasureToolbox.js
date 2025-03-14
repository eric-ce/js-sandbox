
import { StateManager } from "../lib/state/StateManager.js";
// import EventEmitter from "eventemitter3";
import sharedEmitter from "../lib/events/ShareEmitter.js";
import { CesiumMeasure } from "./CesiumMeasure.js";
import { GoogleMeasure } from "./GoogleMeasure.js";
import { LeafletMeasure } from "./LeafletMeasure.js";
import dataPool from "../lib/data/DataPool.js";

export class MeasureToolbox {
    constructor(app, type) {
        this._app = app;
        this.log = app.log;

        // cesium variables
        this._viewer = null;
        this._cesiumPkg = null;

        // event emitter: to sync measure data between different maps 
        this.emitter = sharedEmitter;

        // state manager
        this.stateManager = new StateManager(this.emitter);

        // cesium measure
        this.cesiumMeasure = null;

        // set emitter for data pool
        dataPool.emitter = this.emitter;

        // the type of the map. e.g. map-cesium, map-google, map-leaflet
        this._type = type;

        // google map
        this._googleMap = null;

        // leaflet map
        this._leafletMap = null;
    }

    /*********************
     * GETTER AND SETTER *
     *********************/
    get app() {
        return this._app
    }

    get viewer() {
        return this._viewer;
    }

    set viewer(viewer) {
        this._viewer = viewer;

        this.initializeMeasureToolbox(this.type);
    }

    get cesiumPkg() {
        return this._cesiumPkg;
    }

    set cesiumPkg(pkg) {
        this._cesiumPkg = pkg;

        this.initializeMeasureToolbox(this.type);
    }

    get googleMap() {
        return this._googleMap;
    }

    set googleMap(map) {
        this._googleMap = map;

        this.initializeMeasureToolbox(this.type);
    }

    get leafletMap() {
        return this._leafletMap;
    }

    set leafletMap(map) {
        this._leafletMap = map;

        this.initializeMeasureToolbox(this.type);
    }

    get type() {
        return this._type;
    }

    /************
     * FEATURES *
     ************/
    // Initialize toolbox, determines which map needs to initialize based on opened map
    initializeMeasureToolbox(mapType) {
        switch (mapType) {
            case 'map-cesium':
                this.initializeCesiumMeasure(this.viewer, this.cesiumPkg);
                break;  // Add this break

            case 'map-google':
                this.initializeGoogleMeasure(this.googleMap);
                break;  // Add this break

            case 'map-leaflet':
                this.initializeLeafletMeasure(this.leafletMap);
                break;  // Add this break

            default:
                console.error('Invalid map type');
                break;
        }
    }

    // Initialize cesium measure
    initializeCesiumMeasure(viewer, cesiumPkg) {
        if (!this.viewer || !this.cesiumPkg) return; // error handling: check if viewer and cesium package is available

        // create html element for cesium measure
        this.cesiumMeasure = document.createElement("cesium-measure");

        // set properties for cesium measure
        this.cesiumMeasure.viewer = viewer;
        this.cesiumMeasure.cesiumPkg = cesiumPkg;
        this.cesiumMeasure.app = this.app;
        this.cesiumMeasure.emitter = this.emitter;
        this.cesiumMeasure.stateManager = this.stateManager;

        // append cesium measure to map-cesium shadow root
        const mapCesium = document.querySelector("map-cesium");
        if (!mapCesium) return;
        mapCesium.shadowRoot.appendChild(this.cesiumMeasure);
    }

    // Initialize google measure
    initializeGoogleMeasure(map) {
        // create html element for google measure
        this.googleMeasure = document.createElement("google-measure");
        this.googleMeasure.map = map;
        this.googleMeasure.app = this.app;
        this.googleMeasure.emitter = this.emitter;
        this.googleMeasure.stateManager = this.stateManager;
        // append google measure to map-cesium shadow root
        const mapGoogle = document.querySelector("map-google");
        if (!mapGoogle) return;
        mapGoogle.shadowRoot.appendChild(this.googleMeasure);
    }

    // Initialize leaflet measure
    initializeLeafletMeasure(map) {
        // create html element for leaflet measure
        this.leafletMeasure = document.createElement("leaflet-measure");
        this.leafletMeasure.map = map;
        this.leafletMeasure.app = this.app;
        this.leafletMeasure.emitter = this.emitter;
        this.leafletMeasure.stateManager = this.stateManager;
        // append google measure to map-cesium shadow root
        const mapLeaflet = document.querySelector("map-leaflet");
        if (!mapLeaflet) return;
        mapLeaflet.shadowRoot.appendChild(this.leafletMeasure);
    }
}

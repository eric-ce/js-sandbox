
import { StateManager } from "../lib/state/StateManager.js";
import EventEmitter from "eventemitter3";
import { CesiumMeasure } from "./CesiumMeasure.js";
import dataPool from "../lib/data/DataPool.js";

export class MeasureToolbox {
    constructor(app, viewer, cesiumPkg) {
        this._app = app;
        this.log = app.log;

        // cesium variables
        this._viewer = viewer;
        this._cesiumPkg = cesiumPkg;

        // event emitter
        this.emitter = new EventEmitter();

        // state manager
        this.stateManager = new StateManager(this.emitter);

        // cesium measure
        this.cesiumMeasure = null;

        // initialize map
        this.initializeMap();

        // set emitter for data pool
        dataPool.emitter = this.emitter;
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

    get cesiumPkg() {
        return this._cesiumPkg;
    }


    /************
     * FEATURES *
     ************/
    // Initialize map, determines which map needs to initialize based on opened map
    initializeMap() {
        this.initializeCesiumMeasure();
    }

    // Initialize cesium measure
    initializeCesiumMeasure() {
        // create html element for cesium measure
        this.cesiumMeasure = document.createElement("cesium-measure");

        // set properties for cesium measure
        this.cesiumMeasure.viewer = this.viewer;
        this.cesiumMeasure.cesiumPkg = this.cesiumPkg;
        this.cesiumMeasure.app = this.app;
        this.cesiumMeasure.emitter = this.emitter;
        this.cesiumMeasure.stateManager = this.stateManager;

        // append cesium measure to map-cesium shadow root
        const mapCesium = document.querySelector("map-cesium");
        if (!mapCesium) return;
        mapCesium.shadowRoot.appendChild(this.cesiumMeasure);
    }

    // Initialize google measure
    initializeGoogleMeasure() {

    }

    // Initialize leaflet measure
    initializeLeafletMeasure() {

    }
}

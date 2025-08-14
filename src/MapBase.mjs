import { AnnotationToolbox } from "./components/AnnotationToolbox.mjs";

export class MapBase extends HTMLElement {
    static type = "map-base";

    app;
    div = null;
    _map = null;
    _mapEmitter = null;
    annotationToolbox = null;
    _isListening = false; // Flag to track if the listener is active

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    get mapEmitter() {
        return this._mapEmitter;
    }

    set mapEmitter(emitter) {
        this._mapEmitter = emitter;
    }

    get map() {
        return this._map;
    }

    set map(mapInstance) {
        this._map = mapInstance;
    }

    get app() {
        return this._app;
    }
    set app(app) {
        this._app = app;
    }

    // Abstract methods to be implemented by subclasses
    async _createMap() {
        console.warn("Need to override by specific createMap() method");
        return;
    }

    _addMapListener() {
        throw new Error("Subclasses must implement _addMapListener()");
    }

    _removeMapListener() {
        throw new Error("Subclasses must implement _removeMapListener()");
    }

    _panTo(bounds) {
        throw new Error("Subclasses must implement _panTo()");
    }

    // _loadAnnotationInstance() {
    //     this.annotationToolbox = new AnnotationToolbox(this.app);
    // }

    async _initialiseMap() {
        this.map = await this._createMap();

        this._mapEmitter.on("camera:changed", ({ mapName, bounds }) => {
            if (mapName === this.type) return;

            this._removeMapListener();

            this._panTo(bounds);
        });

        this._addMapListener();

        // this._loadAnnotationInstance();
    }


}
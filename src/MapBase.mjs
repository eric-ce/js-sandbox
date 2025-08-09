import { AnnotationToolbox } from "./components/AnnotationToolbox.mjs";

export class MapBase extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        this.div = null;
        this._map = null;
        this._mapEmitter = null;
        this.annotationToolbox = null;
        this._isListening = false; // Flag to track if the listener is active
        this.type = "map-base";

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
        };
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

    // Abstract methods to be implemented by subclasses
    _createMap() {
        throw new Error("Subclasses must implement _createMap()");
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

    _loadAnnotationInstance() {
        this.annotationToolbox = new AnnotationToolbox(this.app);
    }

    async _initialize() {
        this.map = await this._createMap();

        this._mapEmitter.on("camera:changed", ({ mapName, bounds }) => {
            if (mapName === this.type) return;

            this._removeMapListener();

            this._panTo(bounds);
        });

        this._addMapListener();

        this._loadAnnotationInstance();
    }
}
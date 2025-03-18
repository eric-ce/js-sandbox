/**
 * Base class for all measure components of cesium-measure, google-measure, and leaflet-measure.
 */

export class MeasureComponentBase extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        // Common properties
        this._app = null;
        this._emitter = null;
        this._stateManager = null;
    }

    get app() {
        return this._app;
    }

    get emitter() {
        return this._emitter;
    }

}
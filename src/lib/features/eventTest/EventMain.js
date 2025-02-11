import EventEmitter from "eventemitter3";
import * as Cesium from "cesium";

class EmitterClass extends EventEmitter {
    constructor() {
        super();
    }
}

class CesiumTools {
    constructor() {
        this.coordinate = null;
        this._emitter = null;
        this.counter = 0;
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    initiateCoordinate() {

    }

    counterIncrementTil20() {
        this.counter = 0;
        for (let i = 0; i < 20; i++) {
            this.counter++;
            this.emitter.emit("counterReached20", this.counter);
        }
    }

    convertCart3ToCartDegrees(cartesian3) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian3);
        const cartographicDegrees = {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: cartographic.height
        };
        return cartographicDegrees;
    }
}

class ListenerClass {
    constructor() {
        this._emitter = null;
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;

        this.initialize();
    }

    initialize() {
        this.setupListener();
    }

    setupListener() {
        this.emitter.on('coordinatesTest', (data) => console.log("catch msg", data));
        this.emitter.on('counterReached20', (count) => console.log(`Counter has reached: ${count}`));
    }
}

const emitter = new EmitterClass();


const cesiumTools = new CesiumTools();
cesiumTools.emitter = emitter;

const listener = new ListenerClass();
listener.emitter = emitter;

cesiumTools.counterIncrementTil20();

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

        this.emitter = new EmitterClass();

        const listener = new ListenerClass();
        listener.emitter = this.emitter

        this.groupData = [
            { id: 1, name: "Group 1" },
            { id: 2, name: "Group 2" },
            { id: 3, name: "Group 3" },
        ]

        this.initializeData();

        setTimeout(() => {
            this.initializeData2();
            this.emitter.emit("initializeData", this.groupData);
        }, 1000);
    }

    get emitter() {
        return this._emitter;
    }

    set emitter(emitter) {
        this._emitter = emitter;
    }

    initializeData() {
        this.emitter.emit("initializeData", this.groupData);
    }

    initializeData2() {
        this.groupData.push({ id: 4, name: "Group 4" });
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
        this.emitter.on('initializeData', (data) => console.log("catch msg", data));
    }
}

const cesiumTools = new CesiumTools();
// cesiumTools.emitter = emitter;

// const listener = new ListenerClass();
// listener.emitter = emitter;

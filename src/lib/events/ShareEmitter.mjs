import EventEmitter from "eventemitter3";

/**
 * Event Emitter for the tool, it manages all events communication in here
 */
export class ShareEmitter extends EventEmitter {
    constructor() {
        super();
    }

    onDataChange(callback) {
        this.on("data", callback);
    }

    onDataUpdate(callback) {
        this.on("data:updated", callback);
    }

    onDataRemove(callback) {
        this.on("data:removed", callback);
    }

    onGoogleContextMenu(callback) {
        this.on('annotation-contextmenu-google', callback);
    }

    onGoogleHovered(callback) {
        this.on('annotation-hovered-google', callback);
    }

    onGoogleClicked(callback) {
        this.on('annotation-clicked-google', callback);
    }

    onLeafletContextMenu(callback) {
        this.on('annotation-contextmenu-leaflet', callback);
    }

    onLeafletHovered(callback) {
        this.on('annotation-hovered-leaflet', callback);
    }

    onLeafletClicked(callback) {
        this.on('annotation-clicked-leaflet', callback);
    }
}
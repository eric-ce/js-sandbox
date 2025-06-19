import EventEmitter from "eventemitter3";

// Create a singleton emitter that can be imported by all components
const sharedEmitter = new EventEmitter();

export default sharedEmitter;
import { Color } from "cesium";
/**
 * Manages the global state for measurement tools.
 */
export class StateManager {
    constructor(emitter) {
        // set event emitter
        this.emitter = emitter;

        // Initialize the state with your specified structure
        this._state = {
            button: {
                activeButton: null,
                clearButton: null,
                activeTool: null,
                measureModes: [],
                toggleHelpBoxButton: null,
                toggleLogBoxButton: null,
                labelButton: null,
            },
            flags: {
                isMeasurementComplete: false,
                isDragMode: false,
                isAddMode: false,
                isToolsExpanded: false,
            },
            element: {
                helpBox: null,
                logBox: null,
                toolbar: null,
            },
            position: {
                logBox: { top: "280px", right: "0px" },
                helpBox: { top: "70px", right: "0px" },
            },
            overlay: {
                pointer: null,
                button: null,
            },
            color: {
                add: Color.YELLOW,
                default: Color.YELLOWGREEN,
                hover: Color.KHAKI,
                hoverChatPoint: Color.ALICEBLUE,
                layerColor: null,
                line: Color.YELLOWGREEN,
                lineCacheColor: null,
                move: Color.YELLOW,
                pointColor: Color.RED,
                polygon: Color.GREEN.withAlpha(0.8),
                polygonOutline: Color.YELLOW,
                random: Color.fromRandom({ alpha: 1.0 }),
                select: Color.BLUE,
                submitted: Color.DARKGREEN
            }
        };
    }

    // FLAG STATE METHODS
    getFlagState(key) {
        if (key) {
            if (key in this._state.flags) {
                return this._state.flags[key];
            } else {
                console.warn(`Property '${key}' does not exist in flags state.`);
                return undefined;
            }
        }
        return { ...this._state.flags };
    }

    setFlagState(key, value) {
        if (key in this._state.flags) {
            this._state.flags[key] = value;
            // Emit state change event using the shared emitter
            this.emitter.emit("stateChange", { section: "flags", key, value });
        } else {
            console.warn(`Property '${key}' does not exist in flags state.`);
        }
    }

    // BUTTON STATE METHODS
    getButtonState(key) {
        if (key) {
            if (key in this._state.button) {
                return this._state.button[key];
            } else {
                console.warn(`Property '${key}' does not exist in button state.`);
                return undefined;
            }
        }
        return { ...this._state.button };
    }

    setButtonState(key, value) {
        if (key in this._state.button) {
            this._state.button[key] = value;
            this.emitter.emit("stateChange", { section: "button", key, value });
        } else {
            console.warn(`Property '${key}' does not exist in button state.`);
        }
    }

    // ELEMENT STATE METHODS
    getElementState(key) {
        if (key) {
            if (key in this._state.element) {
                return this._state.element[key];
            } else {
                console.warn(`Property '${key}' does not exist in element state.`);
                return undefined;
            }
        }
        return { ...this._state.element };
    }

    setElementState(key, value) {
        if (key in this._state.element) {
            this._state.element[key] = value;
            this.emitter.emit("stateChange", { section: "element", key, value });
        } else {
            console.warn(`Property '${key}' does not exist in element state.`);
        }
    }

    // POSITION STATE METHODS
    getPositionState(key) {
        if (key) {
            if (key in this._state.position) {
                return this._state.position[key];
            } else {
                console.warn(`Property '${key}' does not exist in position state.`);
                return undefined;
            }
        }
        return { ...this._state.position };
    }

    setPositionState(key, value) {
        if (key in this._state.position) {
            if (typeof value === "object" && value !== null) {
                this._state.position[key] = { ...value };
                this.emitter.emit("stateChange", { section: "position", key, value });
            } else {
                console.warn(
                    `Invalid value for ${key}: expected object, got ${typeof value}`
                );
            }
        } else {
            console.warn(`Property '${key}' does not exist in position state.`);
        }
    }

    // OVERLAY STATE METHODS
    getOverlayState(key) {
        if (key) {
            if (key in this._state.overlay) {
                return this._state.overlay[key];
            } else {
                console.warn(`Property '${key}' does not exist in overlay state.`);
                return undefined;
            }
        }
        return { ...this._state.overlay };
    }

    setOverlayState(key, value) {
        if (key in this._state.overlay) {
            this._state.overlay[key] = value;
            this.emitter.emit("stateChange", { section: "overlay", key, value });
        } else {
            console.warn(`Property '${key}' does not exist in overlay state.`);
        }
    }

    // COLOR STATE METHODS
    getColorState(key) {
        if (key) {
            if (key in this._state.color) {
                return this._state.color[key];
            } else {
                console.warn(`Property '${key}' does not exist in color state.`);
                return undefined;
            }
        }
        return { ...this._state.color };
    }

    setColorState(key, value) {
        if (key in this._state.color) {
            this._state.color[key] = value;
            this.emitter.emit("stateChange", { section: "color", key, value });
        } else {
            console.warn(`Property '${key}' does not exist in color state.`);
        }
    }
}

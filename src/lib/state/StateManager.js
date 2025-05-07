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
            activeModeId: null,
            button: {
                activeButton: null,
                clearButton: null,
                activeTool: null,
                measureModes: [],
                labelButton: null,
                activeButtonElementRef: null,
            },
            flags: {
                isMeasurementComplete: false,
                isDragMode: false,
                isAddMode: false,
                isToolsExpanded: false,
            },
            element: {
                helpTable: null,
                logTable: null,
                toolbar: null,
            },
            // position: {
            //     logBox: { top: "280px", right: "0px" },
            //     helpBox: { top: "70px", right: "0px" },
            // },
            overlay: {
                pointer: null,
                button: null,
            },
            color: {
                add: "rgba(255, 255, 0, 1)",        // Cesium.Color.YELLOW
                // default: "rgba(154, 205, 50, 1)",   // Cesium.Color.YELLOWGREEN
                hover: "rgba(240, 230, 140, 1)",   // Cesium.Color.KHAKI
                hoverChatPoint: "rgba(240, 248, 255, 1)", // Cesium.Color.ALICEBLUE
                // layerColor: null,
                line: "rgba(154, 205, 50, 1)",      // Cesium.Color.YELLOWGREEN
                // lineCacheColor: null,
                move: "rgba(255, 255, 0, 1)",        // Cesium.Color.YELLOW
                pointColor: "rgba(255, 0, 0, 1)",     // Cesium.Color.RED
                polygon: "rgba(0, 128, 0, 0.8)",    // Cesium.Color.GREEN.withAlpha(0.8)
                polygonOutline: "rgba(255, 255, 0, 1)", // Cesium.Color.YELLOW
                select: "rgba(0, 0, 255, 1)",       // Cesium.Color.BLUE
                submitted: "rgba(0, 100, 0, 1)",      // Cesium.Color.DARKGREEN
            },
        };
    }
    // Active Mode Methods
    /**
     * Sets the currently active measurement mode ID.
     * Emits an 'activeModeChanged' event via the internal emitter.
     * @param {string | null} modeId - The identifier of the mode (e.g., 'distance', 'polygon') or null/'inactive'.
     */
    setActiveMode(modeId) {
        const newModeId = (modeId === 'inactive' || !modeId) ? null : modeId; // Normalize 'inactive' to null
        if (this._state.activeModeId !== newModeId) {
            const oldModeId = this._state.activeModeId;
            this._state.activeModeId = newModeId;
            console.log(`StateManager: Active mode changed from '${oldModeId}' to '${newModeId}'`);
            // Emit specific event that MeasureComponentBase will listen for
            this.emitter.emit('activeModeChanged', newModeId, oldModeId);
            // Emit generic state change as well
            this.emitter.emit('stateChange', { section: 'state', key: 'activeModeId', value: newModeId, oldValue: oldModeId });
        }
    }

    /**
     * Gets the ID of the currently active measurement mode.
     * @returns {string | null} The active mode ID or null if inactive.
     */
    getActiveMode() {
        return this._state.activeModeId;
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

    // // POSITION STATE METHODS
    // getPositionState(key) {
    //     if (key) {
    //         if (key in this._state.position) {
    //             return this._state.position[key];
    //         } else {
    //             console.warn(`Property '${key}' does not exist in position state.`);
    //             return undefined;
    //         }
    //     }
    //     return { ...this._state.position };
    // }

    // setPositionState(key, value) {
    //     if (key in this._state.position) {
    //         if (typeof value === "object" && value !== null) {
    //             this._state.position[key] = { ...value };
    //             this.emitter.emit("stateChange", { section: "position", key, value });
    //         } else {
    //             console.warn(
    //                 `Invalid value for ${key}: expected object, got ${typeof value}`
    //             );
    //         }
    //     } else {
    //         console.warn(`Property '${key}' does not exist in position state.`);
    //     }
    // }

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

    // --- NEW: Event Listener Proxy Methods ---
    /**
     * Registers an event listener directly on the StateManager's emitter
     * for specific state manager events (like 'activeModeChanged').
     * @param {string} eventName - The name of the event (e.g., 'activeModeChanged').
     * @param {Function} listener - The callback function.
     */
    on(eventName, listener) {
        this.emitter.on(eventName, listener);
    }

    /**
     * Removes an event listener directly from the StateManager's emitter.
     * @param {string} eventName - The name of the event.
     * @param {Function} listener - The callback function to remove.
     */
    off(eventName, listener) {
        this.emitter.off(eventName, listener);
    }
    // --- End Event Listener Proxy Methods ---

    /**
     * Helper to update help text content if the helpTable element exists.
     * @param {string} text - The text to display.
     */
    updateHelpContent(text) {
        const helpTable = this.getElementState('helpTable');
        // Check if helpTable has an updateContent method (duck typing)
        if (helpTable && typeof helpTable.updateContent === 'function') {
            helpTable.updateContent(text);
        } else if (helpTable) {
            // Fallback if no method exists, just set textContent
            helpTable.textContent = text;
        }
    }
}

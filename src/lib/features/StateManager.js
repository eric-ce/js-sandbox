export class StateManager {
    constructor() {
        // Initialize the state with your specified structure
        this._state = {
            button: {
                activeButton: null,
                clearButton: null,
                activeTool: null,
                measureModes: [],
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
                toolsContainer: null,
            },
            position: {
                logBox: { top: "280px", right: "0px" },
                helpBox: { top: "70px", right: "0px" },
            },
            overlay: {
                pointer: null,
                button: null,
            }
        };

        // Optional: Initialize listeners for state changes
        this._listeners = [];
    }

    // Get a specific flag state property or the entire flags state
    getFlagState(key) {
        if (key) {
            if (key in this._state.flags) {
                return this._state.flags[key];
            } else {
                console.warn(`Property '${key}' does not exist in flags state.`);
                return undefined;
            }
        } else {
            // Return a shallow copy to prevent direct mutations
            return { ...this._state.flags };
        }
    }

    // Set a specific flag state property
    setFlagState(key, value) {
        if (key in this._state.flags) {
            this._state.flags[key] = value;
            this._notifyListeners('flags', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in flags state.`);
        }
    }

    // Get a specific button state property or the entire button state
    getButtonState(key) {
        if (key) {
            if (key in this._state.button) {
                return this._state.button[key];
            } else {
                console.warn(`Property '${key}' does not exist in button state.`);
                return undefined;
            }
        } else {
            return { ...this._state.button };
        }
    }

    // Set a specific button state property
    setButtonState(key, value) {
        if (key in this._state.button) {
            this._state.button[key] = value;
            this._notifyListeners('button', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in button state.`);
        }
    }

    // Get a specific element state property or the entire element state
    getElementState(key) {
        if (key) {
            if (key in this._state.element) {
                return this._state.element[key];
            } else {
                console.warn(`Property '${key}' does not exist in element state.`);
                return undefined;
            }
        } else {
            return { ...this._state.element };
        }
    }

    // Set a specific element state property
    setElementState(key, value) {
        if (key in this._state.element) {
            this._state.element[key] = value;
            this._notifyListeners('element', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in element state.`);
        }
    }

    // Get a specific position state property or the entire position state
    getPositionState(key) {
        if (key) {
            if (key in this._state.position) {
                return this._state.position[key];
            } else {
                console.warn(`Property '${key}' does not exist in position state.`);
                return undefined;
            }
        } else {
            return { ...this._state.position };
        }
    }

    // Set a specific position state property
    setPositionState(key, value) {
        if (key in this._state.position) {
            if (typeof value === 'object' && value !== null) {
                this._state.position[key] = { ...value };
                this._notifyListeners('position', key, value);
            } else {
                console.warn(`Invalid value for ${key}: expected object, got ${typeof value}`);
            }
        } else {
            console.warn(`Property '${key}' does not exist in position state.`);
        }
    }

    // Get a specific overlay state property or the entire overlay state
    getOverlayState(key) {
        if (key) {
            if (key in this._state.overlay) {
                return this._state.overlay[key];
            } else {
                console.warn(`Property '${key}' does not exist in overlay state.`);
                return undefined;
            }
        } else {
            return { ...this._state.overlay };
        }
    }

    // Set a specific overlay state property
    setOverlayState(key, value) {
        if (key in this._state.overlay) {
            this._state.overlay[key] = value;
            this._notifyListeners('overlay', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in overlay state.`);
        }
    }

    // Optional: Subscribe to state changes
    subscribe(listener) {
        if (typeof listener === 'function') {
            this._listeners.push(listener);
        }
    }

    // Optional: Notify listeners of state changes
    _notifyListeners(section, key, value) {
        for (const listener of this._listeners) {
            listener(section, key, value);
        }
    }
}

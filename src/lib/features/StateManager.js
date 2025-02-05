import { Color } from "cesium";
/**
 * Manages the global state for measurement tools.
 */
export class StateManager {
    constructor() {
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

        // Optional: Initialize listeners for state changes
        this._listeners = [];
    }

    /**
     * Gets a specific flag state property or the entire flags state.
     *
     * @param {string} [key] - The key of the flag state property.
     * @returns {*} The flag state value for the specified key, or a shallow copy of all flags.
     */
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

    /**
     * Sets a specific flag state property.
     *
     * @param {string} key - The key of the flag state property.
     * @param {*} value - The new value to assign.
     */
    setFlagState(key, value) {
        if (key in this._state.flags) {
            this._state.flags[key] = value;
            this._notifyListeners('flags', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in flags state.`);
        }
    }

    /**
     * Gets a specific button state property or the entire button state.
     *
     * @param {string} [key] - The key of the button state property.
     * @returns {*} The button state value for the specified key, or a shallow copy of all button states.
     */
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

    /**
     * Updates the state of a specific button and notifies listeners.
     *
     * @param {string} key - The identifier for the button state property.
     * @param {*} value - The new value to assign.
     *
     * @example
     * setButtonState("labelButton", labelButtonElement);
     */
    setButtonState(key, value) {
        if (key in this._state.button) {
            this._state.button[key] = value;
            this._notifyListeners('button', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in button state.`);
        }
    }

/**
 * Gets a specific element state property or the entire element state.
 *
 * @param {string} [key] - The key of the element state property.
 * @returns {*} The element state value for the specified key, or a shallow copy of all element states.
 */    getElementState(key) {
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

    /**
     * Sets a specific element state property.
     *
     * @param {string} key - The key of the element state property.
     * @param {*} value - The new value to assign.
     */
    setElementState(key, value) {
        if (key in this._state.element) {
            this._state.element[key] = value;
            this._notifyListeners('element', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in element state.`);
        }
    }

    /**
     * Gets a specific position state property or the entire position state.
     *
     * @param {string} [key] - The key of the position state property.
     * @returns {*} The position state value for the specified key, or a shallow copy of all position states.
     */
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

    /**
     * Sets a specific position state property.
     *
     * @param {string} key - The key of the position state property.
     * @param {Object} value - The new value to assign.
     */
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

    /**
     * Gets a specific overlay state property or the entire overlay state.
     *
     * @param {string} [key] - The key of the overlay state property.
     * @returns {*} The overlay state value for the specified key, or a shallow copy of all overlay states.
     */
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

    /**
     * Sets a specific overlay state property.
     *
     * @param {string} key - The key of the overlay state property.
     * @param {*} value - The new value to assign.
     */
    setOverlayState(key, value) {
        if (key in this._state.overlay) {
            this._state.overlay[key] = value;
            this._notifyListeners('overlay', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in overlay state.`);
        }
    }

    /**
     * Gets a specific color state property or the entire color state.
     *
     * @param {string} [key] - The key of the color state property.
     * @returns {*} The color state value for the specified key, or a shallow copy of all color states.
     */
    getColorState(key) {
        if (key) {
            if (key in this._state.color) {
                return this._state.color[key];
            } else {
                console.warn(`Property '${key}' does not exist in color state.`);
                return undefined;
            }
        } else {
            return { ...this._state.color };
        }
    }

    /**
     * Sets a specific color state property.
     *
     * @param {string} key - The key of the color state property.
     * @param {*} value - The new value to assign.
     */
    setColorState(key, value) {
        if (key in this._state.color) {
            this._state.color[key] = value;
            this._notifyListeners('color', key, value);
        } else {
            console.warn(`Property '${key}' does not exist in color state.`);
        }
    }

    /**
     * Subscribes a listener function to state changes.
     *
     * @param {Function} listener - The function to be called on state changes.
     */
    subscribe(listener) {
        if (typeof listener === 'function') {
            this._listeners.push(listener);
        }
    }

    /**
     * Notifies all subscribed listeners of a state change.
     *
     * @param {string} section - The section of the state that changed.
     * @param {string} key - The key of the changed property.
     * @param {*} value - The new value of the property.
     * @private
     */
    _notifyListeners(section, key, value) {
        for (const listener of this._listeners) {
            listener(section, key, value);
        }
    }
}

import * as Cesium from "cesium";
import { createLineArrowPrimitive, createPointPrimitive, generateId, removeInputActions } from "../../helper/helper.js";
import { handleRecordScreen, resumeOrPauseRecording } from "./recordScreen.js";
import { editFlyPath } from "./editFlyPath.js";

class FlyThrough {
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.pointerOverlay = this.stateManager.getOverlayState("pointer");

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        this.setupInputActions();

        // find and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(
            (p) => p.id && p.id.startsWith("annotate_point_collection")
        );
        this.labelCollection = this.viewer.scene.primitives._primitives.find(
            (p) => p.id && p.id.startsWith("annotate_label_collection")
        );

        // flags to control the state of the tool
        this.flags = {
            isRecording: false,
            isScreenRecording: false,
            isDragMode: false,
        };

        this.buttons = {
            recordScreenButton: null,
            replayButton: null,
            flyButton: null,
            editFlyPathButton: null,
            importKmlButton: null,
            exportKmlButton: null,
            pauseResumeButton: null,
        };

        this.coords = {
            _flyRecords: [],    // [{positions: {x: 0, y: 0, z: 0}, hpr: {heading: 0, pitch: 0, roll: 0}}]; // fly-through data
            _mockFlyRecords: [
                {
                    position: {
                        x: 1216112.9570234974,
                        y: -4736576.765693975,
                        z: 4081200.1481931447,
                    },
                    hpr: {
                        heading: 0.13000450388900298,
                        pitch: -0.3625899685123126,
                        roll: 0.000004638299138548518,
                    },
                },
                {
                    position: {
                        x: 1216149.8221629532,
                        y: -4736602.9220574815,
                        z: 4081452.05891825,
                    },
                    hpr: {
                        heading: 0.05783204009360077,
                        pitch: -1.3214516649608017,
                        roll: 0.000017948732042860627,
                    },
                },
                {
                    position: {
                        x: 1216231.817715611,
                        y: -4737091.234564315,
                        z: 4081695.533198552,
                    },
                    hpr: {
                        heading: 0.057832040093592774,
                        pitch: -1.3214516649608137,
                        roll: 0.000017948732044636984,
                    },
                },
                {
                    position: {
                        x: 1216214.812668742,
                        y: -4736968.679816875,
                        z: 4081895.7453294657,
                    },
                    hpr: {
                        heading: 6.226051845613029,
                        pitch: -1.5347377349911553,
                        roll: 0,
                    },
                },
                {
                    position: {
                        x: 1216404.8079792114,
                        y: -4737868.763048155,
                        z: 4082919.5627028756,
                    },
                    hpr: {
                        heading: 6.2260518456130285,
                        pitch: -1.5347377349911953,
                        roll: 0,
                    },
                },
                {
                    position: {
                        x: 1216701.9791077161,
                        y: -4738017.830972404,
                        z: 4080125.5256115044,
                    },
                    hpr: {
                        heading: 6.169643854213871,
                        pitch: -0.15128947599652376,
                        roll: 0.000010379170224616985,
                    },
                },
            ],
            _flyCache: [{ position: null, hpr: null }], // cache the position and orientation before editing
        };

        this.coordinate = null;

        this.interactivePrimitives = {
            hoveredLine: null,
            hoveredPoint: null,
            dragPoint: null,
            dragLine: null,
            selectedPoint: null,
        };

        this.stateColor = {
            default: Cesium.Color.YELLOWGREEN,
            hover: Cesium.Color.YELLOW,
            selected: Cesium.Color.BLUE,
            editLine: null,
        }

        // Screen recording variables
        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
        this.pipVideo = null;  // pip preview for screen recording

        // Initialize the moveEndListener as null
        this.moveEndListener = null;

        this.setupButtons();
    }

    /**
     * Sets up input actions for flyThrough mode.
    */
    setupInputActions() {
        removeInputActions(this.handler);
    }

    setupButtons() {
        // Define button configurations
        const buttonsConfig = [
            {
                key: 'fly',
                text: 'Fly',    // TODO: change to icon img
                className: 'fly',
                onClick: this.handleFly.bind(this),
                left: 45 * 13, // 45px each button * #13th buttons
                top: 0, // the bottom button in the toolbar
            },
            {
                key: 'replay',
                text: 'Replay',
                className: 'replay',
                onClick: this.handleReplay.bind(this),
                left: 45 * 13, // 45px each button width * #13th buttons
                top: -40 * 1, // -40px each button height * #1st buttons
            },
            {
                key: 'editFlyPath',
                text: 'Edit',
                className: 'edit-fly-path',
                onClick: editFlyPath.bind(this), // Ensure this method exists
                left: 45 * 13, // 45px each button * #13th buttons
                top: -40 * 2, // -40px each button * #2nd buttons
            },
            {
                key: 'importKml',
                text: 'Import',
                className: 'import-kml',
                onClick: this.importKml.bind(this),
                left: 45 * 13, // 45px each button * #13th buttons
                top: -40 * 3, // -40px each button * #3rd buttons
            },
            {
                key: 'exportKml',
                text: 'Export',
                className: 'export-kml',
                onClick: this.exportKml.bind(this),
                left: 45 * 13, // 45px each button * #13th buttons
                top: -40 * 4, // -40px each button * #4th buttons
            },
            {
                key: 'recordScreen',
                text: 'Record',
                className: 'record-screen',
                onClick: handleRecordScreen.bind(this),
                left: 45 * 14, // 45px each button * #14th buttons
                top: 0, // the bottom button in the toolbar
            },
            {
                key: 'pauseResume',
                text: 'Pause',
                className: 'disabled-button', // Initially disabled until recording starts
                onClick: resumeOrPauseRecording.bind(this),
                left: 45 * 14, // Adjust positioning as needed
                top: -40, // Adjust positioning as needed
                disabled: true, // Initially disabled until recording starts
            },
        ];

        // Create buttons and store them in this.buttons
        buttonsConfig.forEach(config => {
            const button = document.createElement("button");
            button.textContent = config.text;
            if (config.disabled) {
                button.classList.add(config.className);
            } else {
                button.classList.add("cesium-button", config.className);
            }
            button.addEventListener("click", config.onClick);
            button.style.position = "absolute";
            button.style.left = `${config.left}px`;
            button.style.top = `${config.top}px`;
            this.buttons[`${config.key}Button`] = button;
        });

        // Find the measureToolbox element within the mapCesium shadow DOM
        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium?.shadowRoot?.querySelector("cesium-measure");

        if (!measureToolbox) {
            console.warn("measureToolbox element not found.");
            return;
        }

        const appendButtons = () => {
            const toolbar = measureToolbox.shadowRoot.querySelector(".measure-toolbar");
            const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

            if (!toolbar || !measureToolButton) {
                console.warn("Toolbar or Measure Tool Button not found.");
                return;
            }

            // Append each button if not already appended
            buttonsConfig.forEach(config => {
                const button = this.buttons[`${config.key}Button`];
                if (!toolbar.contains(button)) {
                    toolbar.appendChild(button);
                }
            });

            // Define a function to toggle button visibility based on measureToolButton's active class
            const toggleButtonVisibility = () => {
                const shouldDisplay = measureToolButton.classList.contains('active');
                buttonsConfig.forEach(config => {
                    const button = this.buttons[`${config.key}Button`];
                    if (shouldDisplay) {
                        setTimeout(() => {
                            button.style.display = 'block';
                        }, 625);
                    } else {
                        button.style.display = 'none';
                    }
                });
            };

            // Initial visibility check
            toggleButtonVisibility();

            // Observe class changes on measureToolButton to toggle visibility
            const classObserver = new MutationObserver(toggleButtonVisibility);
            classObserver.observe(measureToolButton, { attributes: true, attributeFilter: ["class"] });
        };

        // Check if toolbar and measureToolButton already exist
        const toolbar = measureToolbox.shadowRoot.querySelector(".measure-toolbar");
        const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

        if (toolbar && measureToolButton) {
            appendButtons();
        } else {
            // Observe changes in the measureToolbox shadow DOM for child list changes
            const observer = new MutationObserver((_, obs) => {
                const toolbar = measureToolbox.shadowRoot.querySelector(".measure-toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (toolbar && measureToolButton) {
                    appendButtons();
                    obs.disconnect(); // Stop observing once the buttons are appended
                }
            });

            // Start observing the measureToolbox shadow DOM for child list changes
            observer.observe(measureToolbox.shadowRoot, { childList: true, subtree: true });
        }
    }

    /**
     * Handles the fly-through recording functionality.
     * Toggles the recording state and updates the UI accordingly.
     * Adds or removes the camera movement event listener based on the recording state.
     */
    handleFly() {
        // Toggle the recording state
        this.flags.isRecording = !this.flags.isRecording;
        const button = this.buttons.flyButton;

        // Update the button's active state class
        button.classList.toggle("active", this.flags.isRecording);

        // Update the button text based on the recording state
        button.innerHTML = this.flags.isRecording ? "Stop" : "Fly";

        if (!this.flags.isRecording) {
            // If recording is being stopped, remove the event listener
            if (this.moveEndListener) {
                this.viewer.camera.moveEnd.removeEventListener(this.moveEndListener);
                this.moveEndListener = null;
                console.log("Stopped recording camera movements.");
            }
        } else {
            // If recording is starting, add the event listener
            if (!this.moveEndListener) {
                this.moveEndListener = this.cameraMoveRecord();
                console.log("Started recording camera movements.");
            }
        }

        // Update the state manager with the active button
        const activeButton = this.stateManager.getButtonState("activeButton", button);
        if (activeButton === button) {
            this.stateManager.setButtonState("activeButton", button);
        }
    }

    /**
     * Records the camera's position and orientation whenever the camera movement ends.
     * @returns {Function} The event listener function for camera movement end.
     */
    cameraMoveRecord() {
        const listener = () => {
            console.log(this.viewer.camera);
            const position = this.viewer.camera.positionWC;
            const heading = this.viewer.camera.heading;
            const pitch = this.viewer.camera.pitch;
            const roll = this.viewer.camera.roll;
            this.coords._flyRecords.push({
                position: { ...position },
                hpr: { heading, pitch, roll },
            });
            console.log(this.coords._flyRecords);
        };

        // Add the event listener for camera movement end
        this.viewer.camera.moveEnd.addEventListener(listener);
        return listener;
    }

    /**
     * Handles the replay functionality.
     * Initiates the fly-through sequence if not currently recording.
     */
    handleReplay() {
        if (!this.flags.isRecording) {
            this.flyTo(0, this.coords._flyRecords, 3);
        } else {
            alert("Please stop recording before replaying.");
        }
    }

    /**
     * Recursively flies the camera to each recorded position and orientation.
     * @param {number} index - The current index in the fly records.
     * @param {Array} data - The array of recorded fly-through data.
     * @param {number} [duration=3] - The duration of each fly-to action.
     */
    flyTo(index, data, duration = 3) {
        if (index >= data.length) {
            console.log("flyComplete");
            return;
        }

        const position = data[index].position;
        const nextIndex = index + 1;

        // flyToBoundingSphere approach
        const pointBoundingSphere = new Cesium.BoundingSphere(position, 100);
        this.viewer.camera.flyToBoundingSphere(pointBoundingSphere, {
            offset: new Cesium.HeadingPitchRange(
                data[index].hpr.heading,
                data[index].hpr.pitch,
                100
            ),
            duration: duration,
            easingEffects: Cesium.EasingFunction.QUADRATIC_IN_OUT,
            flyOverLongitude: Cesium.Cartographic.fromCartesian(position).longitude,
            flyOverLongitudeWeight: 0.5,
            complete: () => {
                // Recursively fly to the next point after a delay
                setTimeout(() => {
                    this.flyTo(nextIndex, this.coords._flyRecords, 3);
                }, 1000);
            },
            cancel: () => {
                console.log("Fly-through was canceled.");
            },
        });
    }

    importKml() {
        console.log("importKml");
    }

    exportKml() {
        console.log("exportKml");
    }


    /******************
     * HELPER METHODS *
     ******************/

    resetValue() {
        this.coordinate = null;

        this.flags.isComplete = false;
    }
}

export { FlyThrough };

// flyTo(index, data, duration = 3) {
//     console.log("🚀  data:", data);

//     if (index >= data.length) {
//         console.log("flyComplete");
//         return;
//     }

//     console.log(this.flags.isComplete)
//     const position = data[index].position;
//     const direction = data[index].direction;
//     const up = data[index].up;
//     const right = data[index].right;
//     const hpr = new Cesium.HeadingPitchRoll(data[index].hpr.heading, data[index].hpr.pitch, data[index].hpr.roll);
//     const nextIndex = index + 1;

// flyTo approach
// this.viewer.camera.flyTo({
//     destination: position,
//     orientation: {
//         heading: data[index].hpr.heading,
//         pitch: data[index].hpr.pitch,
//         roll: data[index].hpr.roll
//     },
//     duration: 3, // Duration in seconds
//     complete: () => {
//         // this.viewer.camera.moveBackward(70);
//         setTimeout(() => {
//             flyToNextPoint(nextIndex); // Recursively fly to the next point
//         }, 3000);
//     },
//     cancel: () => {
//         console.log('Fly-through was canceled.');
//     },
//     easingEffects: Cesium.EasingFunction.LINEAR_NONE
// })
// flyToBoundingSphere approach
//     const pointBoundingSphere = new Cesium.BoundingSphere(position, 100);
//     this.viewer.camera.flyToBoundingSphere(pointBoundingSphere, {
//         offset: new Cesium.HeadingPitchRange(data[index].hpr.heading,
//             data[index].hpr.pitch, 100),
//         duration: duration,
//         easingEffects: Cesium.EasingFunction.QUADRATIC_IN_OUT,
//         flyOverLongitude: Cesium.Cartographic.fromCartesian(position).longitude,
//         flyOverLongitudeWeight: 0.5,
//         complete: () => {
//             // this.viewer.camera.moveBackward(70);
//             setTimeout(() => {
//                 this.flyTo(nextIndex, this.coords._flyRecords, 3); // Recursively fly to the next point
//             }, 1000);
//         },
//         cancel: () => {
//             console.log('Fly-through was canceled.');
//         },
//     })
// }

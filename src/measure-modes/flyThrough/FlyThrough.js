import * as Cesium from "cesium";
import {
    makeDraggable,
    removeInputActions,
    showCustomNotification
} from "../../lib/helper/helper.js";
import { handleRecordScreen, resumeOrPauseRecording } from "./recordScreen.js";
import { createFlyPathPrimitives, editFlyPath, removePrimitives } from "./editFlyPath.js";
import { sharedStyleSheet } from "../../styles/sharedStyle.js";

export class FlyThrough extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        // App variables
        this._app = null;

        // Cesium variables
        this._viewer = null;
        this._handler = null;
        this._cesiumPkg = null;

        // Cesium primitives collections
        this.pointCollection = null;
        this.labelCollection = null;

        this.pointerOverlay = null;

        this.coordinate = null;

        // flags to control the state of the tool
        this.flags = {
            isRecordingFly: false,
            isScreenRecording: false,
            isDragMode: false,
            isShowFlyPath: false,
            isRotating: false,
            isEditing: false,
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

        // Initialize the camera rotation interval as null
        this.cameraRotationInterval = null;
    }

    connectedCallback() {
        // apply shared style
        this.shadowRoot.adoptedStyleSheets = [sharedStyleSheet];

        if (this.viewer) {
            this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
            this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

            this.initialize();
        }
    }

    /*********************
     * GETTER AND SETTER *
     *********************/
    set app(app) {
        this._app = app
        this.log = app.log
    }

    get app() {
        return this._app
    }

    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }

    get stateManager() {
        return this._stateManager;
    }

    set stateManager(stateManager) {
        this._stateManager = stateManager;
    }

    get cesiumPkg() {
        return this._cesiumPkg;
    }

    set cesiumPkg(cesiumPkg) {
        this._cesiumPkg = cesiumPkg;
    }

    initialize() {
        // if screenSpaceEventHandler existed use it, if not create a new one
        if (this.viewer.screenSpaceEventHandler) {
            this.handler = this.viewer.screenSpaceEventHandler;
        } else {
            this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        }

        // setup buttons
        this.setupButtons();

        // setup pointer overlay
        this.pointerOverlay = this.stateManager.getOverlayState("pointer");

        this.setupInputActions();
    }

    /**
     * Sets up input actions for flyThrough mode.
    */
    setupInputActions() {
        removeInputActions(this.handler);
    }

    /**
     * Sets up and configures buttons for the interface.
     * This function creates buttons based on predefined configurations, assigns event listeners, and adds them to the specified DOM elements.
     */
    setupButtons() {
        // Define button configurations
        const buttonsConfig = [
            // fly path buttons
            {
                key: 'fly',
                text: 'Fly',    // TODO: change to icon img
                className: 'fly',
                onClick: this.handleFly.bind(this),
            },
            {
                key: 'replay',
                text: 'Replay',
                className: 'replay',
                onClick: this.handleReplayFly.bind(this),
                disabled: true, // Initially disabled until fly data is available
            },
            {
                key: 'editFlyPath',
                text: 'Edit',
                className: 'edit-fly-path',
                onClick: editFlyPath.bind(this), // Ensure this method exists
                disabled: true, // Initially disabled until fly data is available
            },
            {
                key: 'showFlyPath',
                text: 'Show',
                className: 'show-fly-path',
                onClick: this.handleShowFlyPath.bind(this), // Ensure this method exists
                disabled: true, // Initially disabled until fly data is available
            },
            // kml buttons
            {
                key: 'importKml',
                text: 'Import',
                className: 'import-kml',
                onClick: this.importKml.bind(this),
            },
            {
                key: 'exportKml',
                text: 'Export',
                className: 'export-kml',
                onClick: this.exportKml.bind(this),
            },
            // screen recording buttons
            {
                key: 'recordScreen',
                text: 'Record',
                className: 'record-screen',
                onClick: handleRecordScreen.bind(this),
            },
            {
                key: 'pauseResume',
                text: 'Pause',
                className: 'pause-resume', // Initially disabled until recording starts
                onClick: resumeOrPauseRecording.bind(this),
                disabled: true, // Initially disabled until recording starts
            },
        ];

        // Create buttons and store them in this.buttons
        const createButtons = (buttonsConfig) => {
            let buttons = [];
            buttonsConfig.forEach(config => {
                const button = document.createElement("button");
                button.innerHTML = config.text;

                // set button style
                const styleList = [config.className, "annotate-button", "animate-on-show", "visible"];
                if (config.disabled) {
                    styleList.push("disabled-button");
                }
                button.classList.add(...styleList);

                // set button attributes
                button.setAttribute("type", "button");
                button.setAttribute("aria-label", `${config.key} Tool`);
                button.setAttribute("aria-pressed", "false"); // For toggle behavior

                // add event listener
                button.addEventListener("click", config.onClick);
                this.buttons[`${config.key}Button`] = button;

                buttons.push(button);
            });
            return buttons;
        }

        // setup fly through container
        this.flyThroughContainer = document.createElement("div");
        this.flyThroughContainer.classList.add("fly-through-container");
        this.shadowRoot.appendChild(this.flyThroughContainer);
        makeDraggable(this.flyThroughContainer, this.viewer.container);

        // fly path container
        const flyPathContainer = document.createElement("div");
        flyPathContainer.classList.add("fly-path-container");
        this.flyThroughContainer.appendChild(flyPathContainer);
        // fly path buttons
        const flyPathButtonsConfig = buttonsConfig.filter(button => button.key === "fly" || button.key === "replay" || button.key === "editFlyPath" || button.key === "showFlyPath");
        const flyPathButtons = createButtons(flyPathButtonsConfig);
        flyPathButtons.forEach(button => flyPathContainer.appendChild(button));


        // kml container
        const kmlContainer = document.createElement("div");
        kmlContainer.classList.add("kml-container");
        this.flyThroughContainer.appendChild(kmlContainer);
        // kml buttons
        const kmlButtonsConfig = buttonsConfig.filter(button => button.key === "importKml" || button.key === "exportKml");
        const kmlButtons = createButtons(kmlButtonsConfig);
        kmlButtons.forEach(button => kmlContainer.appendChild(button));

        // screen recording container
        const screenRecordingContainer = document.createElement("div");
        screenRecordingContainer.classList.add("screen-recording-container");
        this.flyThroughContainer.appendChild(screenRecordingContainer);
        // screen recording buttons
        const screenRecordingButtonsConfig = buttonsConfig.filter(button => button.key === "recordScreen" || button.key === "pauseResume");
        const screenRecordingButtons = createButtons(screenRecordingButtonsConfig);
        screenRecordingButtons.forEach(button => screenRecordingContainer.appendChild(button));

        this.setupButtonOverlay();

        // mouse move event listener for button overlay
        // this.updateButtonOverlay(this.buttons.replayButton, "Replay fly path");
        // this.updateButtonOverlay(this.buttons.flyButton, "Record fly path");
        // this.updateButtonOverlay(this.buttons.editFlyPathButton, "Edit fly path");
        // this.updateButtonOverlay(this.buttons.showFlyPathButton, "Show/Hide fly path");
        // this.updateButtonOverlay(this.buttons.importKmlButton, "Import KML file");
        // this.updateButtonOverlay(this.buttons.exportKmlButton, "Export KML file");
        // this.updateButtonOverlay(this.buttons.recordScreenButton, "Record screen");
        // this.updateButtonOverlay(this.buttons.pauseResumeButton, "Pause/Resume recording");
    }

    /**
     * update the button overlay with the overlay text
     */
    setupButtonOverlay() {
        const dictionary = {
            "fly": "Record fly path",
            "replay": "Replay fly path",
            "edit-fly-path": "Edit fly path",
            "show-fly-path": "Show/Hide fly path",
            "import-kml": "Import KML",
            "export-kml": "Export KML",
            "record-screen": "Record screen",
            "pause-resume": "Pause/Resume recording",
        };

        // Store timeout ID
        let tooltipTimeout;
        const TOOLTIP_DELAY = 800; // 0.8 seconds in milliseconds

        this.shadowRoot.querySelectorAll(".annotate-button").forEach((button) => {
            button.addEventListener("mouseover", (e) => {
                // Clear any existing timeout
                clearTimeout(tooltipTimeout);

                // Set new timeout
                tooltipTimeout = setTimeout(() => {
                    const cesiumRect = this.viewer.container.getBoundingClientRect();
                    const buttonOverlay = this.stateManager.getOverlayState("button");

                    // set overlay to display
                    buttonOverlay.style.opacity = "0.95";

                    // set description of the button using first className in style of a button
                    const buttonClass = button.classList[0];
                    const description = dictionary[buttonClass] ? dictionary[buttonClass] : buttonOverlay.style.opacity = "0";
                    buttonOverlay.innerHTML = description;

                    // set position of the overlay
                    buttonOverlay.style.left = e.pageX - cesiumRect.x + "px";
                    buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
                }, TOOLTIP_DELAY);
            });

            button.addEventListener("mouseout", () => {
                // set overlay to not display
                clearTimeout(tooltipTimeout);
                const buttonOverlay = this.stateManager.getOverlayState("button");
                buttonOverlay.style.opacity = "0";
            });
        });
    }

    /**
     * Handles the fly-through recording functionality.
     * Toggles the recording state and updates the UI accordingly.
     * Adds or removes the camera movement event listener based on the recording state.
     */
    handleFly() {
        // Toggle the recording state
        this.flags.isRecordingFly = !this.flags.isRecordingFly;
        const button = this.buttons.flyButton;

        // Update the button's active state class
        button.classList.toggle("active", this.flags.isRecordingFly);

        // Update the button text based on the recording state
        button.innerHTML = this.flags.isRecordingFly ? "Stop" : "Fly";

        if (!this.flags.isRecordingFly) {
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

    handleShowFlyPath() {
        // Check if there are any fly path records
        if (this.coords._flyRecords.length === 0) {
            alert("No recorded fly path data available");
            return;
        }

        // Toggle the visibility flag
        this.flags.isShowFlyPath = !this.flags.isShowFlyPath;

        // Shows the fly path by remove and create the primitives
        // Because fly path does not have as much as primitives that measure mode has, fly path can use remove and create the primitives
        if (this.flags.isShowFlyPath) {
            this.buttons.showFlyPathButton.innerHTML = "Hide";  // Update the button text
            createFlyPathPrimitives.call(this); // remove and create the fly path primitives
        } else {
            this.buttons.showFlyPathButton.innerHTML = "Show"; // Update the button text
            removePrimitives.call(this);    // remove the fly path primitives
        }
    }

    /**
     * Records the camera's position and orientation whenever the camera movement ends.
     * @returns {Function} The event listener function for camera movement end.
     */
    cameraMoveRecord() {
        const listener = () => {
            // Log the current camera state for debugging purposes
            console.log(this.viewer.camera);

            // Get the current camera position and orientation
            const position = this.viewer.camera.positionWC;
            const heading = this.viewer.camera.heading;
            const pitch = this.viewer.camera.pitch;
            const roll = this.viewer.camera.roll;

            // Record the current camera state in the fly records array
            this.coords._flyRecords.push({
                position: { ...position },
                hpr: { heading, pitch, roll },
            });

            // Log the updated fly records for debugging purposes
            console.log(this.coords._flyRecords);

            // Show a notification with the number of recorded waypoints
            showCustomNotification(`Record waypoints ${this.coords._flyRecords.length}`, this.viewer.container);

            // Update the state of the replay and edit buttons based on the number of recorded waypoints
            const updateButtons = () => {
                if (this.coords._flyRecords.length > 0) {
                    this.buttons.replayButton.disabled = false;
                    this.buttons.replayButton.classList.remove("disabled-button");
                    // this.buttons.replayButton.classList.add("cesium-button");

                    this.buttons.editFlyPathButton.disabled = false;
                    this.buttons.editFlyPathButton.classList.remove("disabled-button");
                    // this.buttons.editFlyPathButton.classList.add("cesium-button");

                    this.buttons.showFlyPathButton.disabled = false;
                    this.buttons.showFlyPathButton.classList.remove("disabled-button");
                    // this.buttons.showFlyPathButton.classList.add("cesium-button");
                }
            }
            updateButtons();

            // Return the current camera state
            return { position: { ...position }, hpr: { heading, pitch, roll } };
        };

        // Add the event listener for camera movement end
        this.viewer.camera.moveEnd.addEventListener(listener);

        // Return the event listener function for potential removal later
        return listener;
    }

    /**
     * Handles the replay of a recorded flight path.
     * This function is called when the user attempts to replay a flight. It checks whether a flight is currently being recorded and acts accordingly.
     */
    handleReplayFly() {
        // Check if a flight is currently being recorded
        if (!this.flags.isRecordingFly) {
            if (this.coords._flyRecords.length === 0) {
                alert("No recorded fly path data available");
                return;
            }

            // If not recording, call flyTo method to replay the recorded flight path
            this.flyTo(0, this.coords._flyRecords, 3);
        } else {
            // If currently recording, show an alert to inform the user to stop recording first
            alert("Please stop recording fly before replaying.");
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

    /**
     * update the button overlay with the overlay text
     * @param { HTMLElement } button - the button element
     * @param {String} overlayText - the overlay text
     * @returns {HTMLElement} - the button overlay element
     */
    updateButtonOverlay(button, overlayText) {
        const buttonOverlay = this.stateManager.getOverlayState("button");

        button.addEventListener("mouseover", (e) => {
            const cesiumRect = this.viewer.container.getBoundingClientRect();
            buttonOverlay.style.display = "block";
            buttonOverlay.innerHTML = `${overlayText}`;
            buttonOverlay.style.left = e.pageX - cesiumRect.x + "px";
            buttonOverlay.style.top = e.pageY - cesiumRect.y - 40 + "px";
        });

        button.addEventListener("mouseout", () => {
            buttonOverlay.style.display = "none";
        });
    }

    /******************
     * HELPER METHODS *
     ******************/

    resetValue() {
        // reset flags
        this.flags.isRecordingFly = false;
        this.flags.isScreenRecording = false;
        this.flags.isDragMode = false;
        this.flags.isShowFlyPath = false;
        this.flags.isRotating = false;
        this.flags.isEditing = false;

        // reset coords
        this.coords._flyRecords = [];
        this.coords._mockFlyRecords = [];
        this.coords._flyCache = [];

        // reset interactive primitives
        this.interactivePrimitives.hoveredLine = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragLine = null;
        this.interactivePrimitives.selectedPoint = null;
    }
}

// Define the custom element
customElements.define('fly-through-mode', FlyThrough);

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
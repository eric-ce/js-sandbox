import * as Cesium from "cesium";
import { createPointPrimitive, generateId, removeInputActions } from "../helper/helper.js";

class FlyThrough {
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.pointerOverlay = this.stateManager.getOverlayState("pointer");

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isRecording: false,
            isScreenRecording: false,
        };

        this.buttons = {
            recordScreenButton: null,
            replayButton: null,
        };
        this.setupButtons();

        this.coords = {
            _flyRecords: [],
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
        };

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(
            (p) => p.id && p.id.startsWith("annotate_point_collection")
        );
        this.labelCollection = this.viewer.scene.primitives._primitives.find(
            (p) => p.id && p.id.startsWith("annotate_label_collection")
        );

        // Screen recording variables
        this.stream = null;
        this.mediaRecorder = null;
        this.chunks = [];
    }

    /**
     * Sets up input actions for multi-distance clamped mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);
    }

    setupButtons() {
        const createButton = (text, className, onClick) => {
            const button = document.createElement("button");
            button.textContent = text;
            button.classList.add("cesium-button", className);
            button.addEventListener("click", onClick);
            button.style.position = "absolute";
            return button;
        };

        // Create the replay button
        const replayButton = createButton("Replay", "replay", this.setupReplayButton.bind(this));
        this.buttons.replayButton = replayButton;

        // Create the record screen button
        const recordScreenButton = createButton(
            "Record",
            "record-screen",
            this.handleRecordScreen.bind(this)
        );
        this.buttons.recordScreenButton = recordScreenButton;

        // find measureToolbox tag and append the buttons
        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium?.shadowRoot?.querySelector("cesium-measure");

        if (measureToolbox) {
            const observer = new MutationObserver((_, obs) => {
                const flyThrough = measureToolbox.shadowRoot.querySelector(".fly-through");
                const toolbar = measureToolbox.shadowRoot.querySelector(".toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (flyThrough && toolbar && measureToolButton) {
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    replayButton.style.left = `${BUTTON_WIDTH * 11}px`;
                    replayButton.style.top = "-40px";
                    recordScreenButton.style.left = `${BUTTON_WIDTH * 11}px`;
                    recordScreenButton.style.top = "-80px";

                    // Append the buttons to the toolbar
                    toolbar.appendChild(replayButton);
                    toolbar.appendChild(recordScreenButton);

                    obs.disconnect(); // Stop observing once the button is appended

                    const toggleButtonVisibility = () => {
                        const shouldDisplay = flyThrough.classList.contains("active") && measureToolButton.classList.contains('active');
                        replayButton.style.display = shouldDisplay ? 'block' : 'none';
                        recordScreenButton.style.display = shouldDisplay ? 'block' : 'none';
                    };

                    // Initial visibility check
                    toggleButtonVisibility();

                    // Observe class changes for visibility toggling
                    const classObserver = new MutationObserver(toggleButtonVisibility);
                    classObserver.observe(flyThrough, { attributes: true, attributeFilter: ['class'] });
                    classObserver.observe(measureToolButton, { attributes: true, attributeFilter: ["class"] });
                }
            });

            // Start observing the measureToolbox shadow DOM for child list changes
            observer.observe(measureToolbox.shadowRoot, { childList: true, subtree: true });
        }
    }

    handleRecordFly() {
        let moveEndListener;
        this.button.addEventListener("click", () => {
            this.flags.isRecording = !this.flags.isRecording;
            button.classList.toggle("active", this.flags.isRecording);

            // Update the icon based on the recording state
            button.innerHTML = this.flags.isRecording ? "stop" : recordIcon

            if (this.flags.isRecording) {
                if (this.activeButton?.current === button) {
                    this.activeButton = { current: button };
                }
                moveEndListener = this.cameraMoveRecord();
            } else {
                if (moveEndListener) {
                    this.viewer.camera.moveEnd.removeEventListener(moveEndListener);
                    moveEndListener = null;
                }
            }
        })
    }

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

        this.viewer.camera.moveEnd.addEventListener(listener);
        return listener;
    }

    handleReplay() {
        if (!this.flags.isRecording) {
            this.flyTo(0, this.coords._flyRecords, 3);
        } else {
            alert("Please stop recording before replaying.");
        }
    }

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
                // this.viewer.camera.moveBackward(70);
                setTimeout(() => {
                    this.flyTo(nextIndex, this.coords._flyRecords, 3); // Recursively fly to the next point
                }, 1000);
            },
            cancel: () => {
                console.log("Fly-through was canceled.");
            },
        });
    }



    async handleRecordScreen() {
        this.flags.isScreenRecording = !this.flags.isScreenRecording;
        button.classList.toggle("active", this.flags.isScreenRecording);

        // Update the icon based on the recording state
        button.innerHTML = `<img src="${this.flags.isScreenRecording ? stopIcon : recordIcon
            }" alt="${this.flags.isScreenRecording ? "Stop" : "Record"
            }" style="width: 30px; height: 30px;"/>`;

        if (this.flags.isScreenRecording) {
            // Start screen recording
            if (this.activeButton?.current === button) {
                this.activeButton = { current: button };
            }
            await this.recordScreen(button);
        } else {
            // Stop screen recording
            this.stopScreenRecording();
        }
    }

    async recordScreen(button) {
        try {
            // Request screen capture
            const displayMediaOptions = {
                video: {
                    displaySurface: "browser",
                    frameRate: { ideal: 60, max: 60 }, // Request higher frame rate
                    height: { ideal: 1080 }, // Set ideal height for 1080p resolution
                    width: { ideal: 1920 }, // Set ideal width for 1080p resolution
                },
                audio: false,
                preferCurrentTab: true,
            };
            this.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // Create a new MediaRecorder instance with WebM format
            const options = { mimeType: "video/webm; codecs=vp8" };
            this.mediaRecorder = new MediaRecorder(this.stream, options);

            this.chunks = [];

            // Create a video element to display the live recording
            this.liveVideo = document.createElement("video");
            this.liveVideo.srcObject = this.stream;
            this.liveVideo.style.position = "absolute";
            this.liveVideo.style.bottom = "10px";
            this.liveVideo.style.right = "10px";
            this.liveVideo.style.width = "300px";
            this.liveVideo.style.height = "200px";
            this.liveVideo.autoplay = true;
            this.liveVideo.controls = true;
            document.body.appendChild(this.liveVideo);

            // Listen for data events to collect video chunks
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.chunks.push(event.data);
                }
            };

            // When recording stops, create a downloadable WebM file
            this.mediaRecorder.onstop = () => {
                // Combine all recorded chunks into a single Blob
                const blob = new Blob(this.chunks, { type: "video/webm" });
                this.chunks = [];

                // Create a download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.style.display = "none";
                a.href = url;
                a.download = "screen-recording.webm";
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
            };

            // Start recording
            this.mediaRecorder.start();
            console.log("Recording started");

            // Add a listener to stop the recording if the user stops sharing the screen
            this.stream.getVideoTracks()[0].addEventListener("ended", () => {
                this.flags.isScreenRecording = false;
                this.stopScreenRecording();
            });
        } catch (err) {
            console.error("Error accessing screen capture:", err);
            // reset state and button
            this.flags.isScreenRecording = false;
            button.classList.toggle("active", this.flags.isScreenRecording);
            button.innerHTML = `<img src="${recordIcon}" alt="Record Screen" style="width: 30px; height: 30px;"/>`;
        }
    }

    stopScreenRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
            console.log("Recording stopped");
        }
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
        }
        if (this.liveVideo) {
            if (this.stream && this.stream.active === false) {
                document.body.removeChild(this.liveVideo);
                this.liveVideo = null;
            }
        }
    }

    /******************
     * HELPER METHODS *
     ******************/

    resetValue() {
        this.coordinate = null;

        this.flags.isComplete = true;
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

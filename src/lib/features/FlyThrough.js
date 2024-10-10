import * as Cesium from "cesium";
import { createPointPrimitive, generateId, removeInputActions } from "../helper/helper.js";
import playIcon from "../../assets/play-icon.svg";
import stopIcon from "../../assets/stop-icon.svg";

class FlyThrough {
    constructor(viewer, handler, pointerOverlay, activeButton, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.activeButton = activeButton;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isComplete: false,
            isReplay: false,
        }

        this.coords = {
            _flyRecords: [],
            _mockFlyRecords: [
                {
                    "position": {
                        "x": 1216112.9570234974,
                        "y": -4736576.765693975,
                        "z": 4081200.1481931447
                    },
                    "hpr": {
                        "heading": 0.13000450388900298,
                        "pitch": -0.3625899685123126,
                        "roll": 0.000004638299138548518
                    }
                },
                {
                    "position": {
                        "x": 1216149.8221629532,
                        "y": -4736602.9220574815,
                        "z": 4081452.05891825
                    },
                    "hpr": {
                        "heading": 0.05783204009360077,
                        "pitch": -1.3214516649608017,
                        "roll": 0.000017948732042860627
                    }
                },
                {
                    "position": {
                        "x": 1216231.817715611,
                        "y": -4737091.234564315,
                        "z": 4081695.533198552
                    },
                    "hpr": {
                        "heading": 0.057832040093592774,
                        "pitch": -1.3214516649608137,
                        "roll": 0.000017948732044636984
                    }
                },
                {
                    "position": {
                        "x": 1216214.812668742,
                        "y": -4736968.679816875,
                        "z": 4081895.7453294657
                    },
                    "hpr": {
                        "heading": 6.226051845613029,
                        "pitch": -1.5347377349911553,
                        "roll": 0
                    }
                },
                {
                    "position": {
                        "x": 1216404.8079792114,
                        "y": -4737868.763048155,
                        "z": 4082919.5627028756
                    },
                    "hpr": {
                        "heading": 6.2260518456130285,
                        "pitch": -1.5347377349911953,
                        "roll": 0
                    }
                },
                {
                    "position": {
                        "x": 1216701.9791077161,
                        "y": -4738017.830972404,
                        "z": 4080125.5256115044
                    },
                    "hpr": {
                        "heading": 6.169643854213871,
                        "pitch": -0.15128947599652376,
                        "roll": 0.000010379170224616985
                    }
                }
            ]
        }

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        this.cameraMoveRecord();
        this.flyThroughReplay();
    }

    cameraMoveRecord() {
        if (this.flags.isComplete) {
            this.flags.isComplete = false;
        }

        if (!this.flags.isComplete) {
            // add event listener to the camera to log all camera changes
            this.viewer.camera.moveEnd.addEventListener(() => {
                if (this.activeButton?.current === this.button) {
                    console.log(this.viewer.camera);
                    const position = this.viewer.camera.positionWC;
                    const heading = this.viewer.camera.heading;
                    const pitch = this.viewer.camera.pitch;
                    const roll = this.viewer.camera.roll;
                    this.coords._flyRecords.push({ position: { ...position }, hpr: { heading, pitch, roll } });
                    console.log(this.coords._flyRecords)
                }
            })
        }
    }

    flyThroughReplay() {
        // const createPointPrimitiveForFly = () => {
        //     this.coords._flyRecords.forEach((position) => {
        //         const point = createPointPrimitive(position.position, Cesium.Color.RED);
        //         point.id = generateId(position.position, "fly_through_point");
        //         this.pointCollection.add(point);
        //     });
        // }
        // createPointPrimitiveForFly();
        this.setupReplayButton(this.coords._flyRecords);
    }

    setupReplayButton() {
        const button = document.createElement("button");
        button.className = "cesium-button replay-button";
        button.innerHTML = `<img src="${playIcon}" alt="Play" style="width: 30px; height: 30px;"/>`;
        button.style.position = "absolute";

        button.addEventListener("click", () => {
            console.log(this.flags.isComplete)
            this.flyTo(0);
        });

        const mapCesium = document.querySelector("map-cesium");
        const measureToolbox = mapCesium && mapCesium.shadowRoot.querySelector("cesium-measure");

        if (measureToolbox) {
            // Set up a MutationObserver to watch for the presence of required elements
            const observer = new MutationObserver((_, obs) => {
                const multiDClamped = measureToolbox.shadowRoot.querySelector(".fly-through");
                const toolbar = measureToolbox.shadowRoot.querySelector(".toolbar");
                const measureToolButton = measureToolbox.shadowRoot.querySelector(".measure-tools");

                if (multiDClamped && toolbar && measureToolButton) {
                    const BUTTON_INDEX = 11; // 11th button
                    const BUTTON_WIDTH = 45; // Width of each button in pixels
                    button.style.left = `${BUTTON_WIDTH * BUTTON_INDEX}px`; // 7th button, each button width is 45px
                    button.style.top = "-40px";
                    toolbar.appendChild(button);

                    obs.disconnect(); // Stop observing once the button is appended

                    // Add event listener to toggle button visibility based on multi-distances-clamped button state
                    const toggleButtonVisibility = () => {
                        const shouldDisplay =
                            // multiDClamped.classList.contains('active') &&
                            measureToolButton.classList.contains('active');
                        if (shouldDisplay) {
                            setTimeout(() => {
                                button.style.display = 'block'
                            }, 500);
                        } else {
                            button.style.display = 'none';
                        }
                    };

                    // Initial visibility check
                    toggleButtonVisibility();

                    // Set up another MutationObserver to watch class changes for visibility toggling
                    const classObserver = new MutationObserver(toggleButtonVisibility);
                    classObserver.observe(multiDClamped, { attributes: true, attributeFilter: ['class'] });
                    classObserver.observe(measureToolButton, { attributes: true, attributeFilter: ['class'] });
                }
            });
            // Start observing the measureToolbox shadow DOM for child list changes
            observer.observe(measureToolbox.shadowRoot, { childList: true, subtree: true });
        }
    }

    flyTo(index) {
        if (index >= this.coords._flyRecords.length) {
            console.log("flyComplete");
            return;
        }

        console.log(this.flags.isComplete)
        const position = this.coords._flyRecords[index].position;
        const direction = this.coords._flyRecords[index].direction;
        const up = this.coords._flyRecords[index].up;
        const right = this.coords._flyRecords[index].right;
        const hpr = new Cesium.HeadingPitchRoll(this.coords._flyRecords[index].hpr.heading, this.coords._flyRecords[index].hpr.pitch, this.coords._flyRecords[index].hpr.roll);
        const nextIndex = index + 1;

        // flyTo approach
        // this.viewer.camera.flyTo({
        //     destination: position,
        //     orientation: {
        //         heading: this.coords._flyRecords[index].hpr.heading,
        //         pitch: this.coords._flyRecords[index].hpr.pitch,
        //         roll: this.coords._flyRecords[index].hpr.roll
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
        const pointBoundingSphere = new Cesium.BoundingSphere(position, 100);
        this.viewer.camera.flyToBoundingSphere(pointBoundingSphere, {
            offset: new Cesium.HeadingPitchRange(this.coords._flyRecords[index].hpr.heading,
                this.coords._flyRecords[index].hpr.pitch, 100),
            duration: 3,
            easingEffects: Cesium.EasingFunction.QUADRATIC_IN_OUT,
            flyOverLongitude: Cesium.Cartographic.fromCartesian(position).longitude,
            flyOverLongitudeWeight: 0.5,
            complete: () => {
                // this.viewer.camera.moveBackward(70);
                setTimeout(() => {
                    this.flyTo(nextIndex); // Recursively fly to the next point
                }, 1000);
            },
            cancel: () => {
                console.log('Fly-through was canceled.');
            },
        })
    }

    resetValue() {
        this.coordinate = null;

        this.flags.isComplete = true;


    }

}

export { FlyThrough };
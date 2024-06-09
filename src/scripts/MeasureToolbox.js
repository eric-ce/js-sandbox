import * as Cesium from "cesium/Cesium";
import { TwoPointsDistance } from "./twoPointsDistance.js";
import { Points } from "./points.js";

export class MeasureToolbox extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        this.toolsContainer = null;
        this.nameOverlay = null;

        this.handler = null;

        // Use a Promise to wait for the viewer to be set
        this.viewerPromise = new Promise((resolve) => {
            this.viewerResolve = resolve;
        });

        this.viewerPromise.then(async (viewer) => {
            this.viewer = viewer;

            this.handler = new Cesium.ScreenSpaceEventHandler(
                viewer.scene.canvas
            );

            await this.initializeMeasureModes(this.viewer, this.handler, this.nameOverlay);
        });

    }

    // initialize all the measure modes, including its UI, and event listeners
    async initializeMeasureModes(viewer, handler, nameOverlay) {
        this.buttonsSetup(this.viewer, this.shadowRoot, this.handler);

        const twoPointsDistance = new TwoPointsDistance(viewer, handler, nameOverlay);
        twoPointsDistance.initializeMeasurement();

        const points = new Points(viewer, handler, nameOverlay);
        points.initializeMeasurement();
    }

    buttonsSetup(viewer, shadowRoot, handler) {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        this.toolsContainer = toolsContainer;

        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = "Tools";
        toolsContainer.appendChild(toolButton);

        this.nameOverlay = document.createElement("div");
        this.nameOverlay.style.display = "none";
        this.nameOverlay.className = "backdrop";
        this.nameOverlay.style.position = "absolute";
        this.nameOverlay.style.top = "0";
        this.nameOverlay.style.left = "0";
        this.nameOverlay.style["pointer-events"] = "none";
        this.nameOverlay.style.padding = "4px";
        document.querySelector(".cesium-viewer").appendChild(this.nameOverlay);

        this.clearAll(viewer, handler)


        const style = document.createElement("style");
        style.textContent = `
            .toolbar{ 
                position:absolute;
                bottom: 120px;
                transform: translateX(180px);
                display: flex;
                }
            .toolbar button{
                font-family: "work sans", sans-serif;
                font-size: 14px;
                height: 2.45rem;
                padding: 0.5rem 1.472rem;
                margin: 0 5px;
                border-radius: 6rem;
                cursor: pointer;
            }
            .toolbar button.active {
                color: #000;
                fill: #000;
                background: #adf;
                border-color: #fff;
                box-shadow: 0 0 8px #fff;
            }
            .collapsible-buttons {
                /* Hide the buttons by default */
                display: none;
                opacity: 0;
                position: relative;
            }
            .collapsible-buttons.show {
                /* Show the buttons when the "tool" button is clicked */
                display: block;
                opacity: 1;
            }
            `;

        shadowRoot.appendChild(style);
        shadowRoot.appendChild(toolsContainer);
    }

    // createButton(className, text, parent, callback) {
    //     const button = document.createElement("button");
    //     button.className = `${className}`;
    //     button.innerHTML = text;
    //     parent.appendChild(button);
    //     button.addEventListener("click", callback);
    //     return button;
    // }

    clearAll(viewer, handler, clearPrimitive = true) {
        handler.setInputAction(
            () => {
                viewer.entities.removeAll();
            },
            Cesium.ScreenSpaceEventType.RIGHT_CLICK
        );
    }

    /**
     * Setter for the Cesium viewer. Also triggers the promise resolution if it was waiting for
     * a viewer to be set.
     *
     * @param {Cesium.Viewer} viewer - The Cesium viewer instance.
     */
    set viewer(viewer) {
        this._viewer = viewer;
        this.viewerResolve(viewer);
    }

    /**
     * Getter for the Cesium viewer.
     *
     * @returns {Cesium.Viewer} The current Cesium viewer instance.
     */
    get viewer() {
        return this._viewer;
    }
}

customElements.define("measure-toolbox", MeasureToolbox);
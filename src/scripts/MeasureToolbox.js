import * as Cesium from "cesium";
import { TwoPointsDistance } from "./twoPointsDistance.js";
import { Points } from "./points.js";
import { ThreePointsCurve } from "./threePointsCurve.js";

class MeasureToolbox extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });

        this.toolsContainer = null;
        this.nameOverlay = null;

        this.handler = null;

        this.clearButton = null;
        // Use a Promise to wait for the viewer to be set
        this.viewerPromise = new Promise((resolve) => {
            this.viewerResolve = resolve;
        });

        this.viewerPromise.then(async (viewer) => {
            this.viewer = viewer;

            this.handler = new Cesium.ScreenSpaceEventHandler(
                viewer.scene.canvas
            );

            // add cesium style to the shadowRoot for this web component
            this.addCesiumStyle()

            // initialize all the measure modes, including its UI, and event listeners
            await this.initializeMeasureModes(this.viewer, this.handler, this.nameOverlay);
        });

    }

    // add cesium style to the shadowRoot for this web component
    addCesiumStyle() {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/Widgets/widgets.css';
        this.shadowRoot.appendChild(link);
    }

    // initialize all the measure modes, including its UI, and event listeners
    async initializeMeasureModes(viewer, handler, nameOverlay) {
        this.buttonsSetup(this.viewer, this.shadowRoot, this.handler);

        const twoPointsDistance = new TwoPointsDistance(viewer, handler, nameOverlay);
        twoPointsDistance.initializeMeasurement();

        const points = new Points(viewer, handler, nameOverlay);
        points.initializeMeasurement();

        const threePointsCurve = new ThreePointsCurve(viewer, handler, nameOverlay);
        threePointsCurve.initializeMeasurement();

        this.clearButtonSetup(viewer, handler, nameOverlay);
    }

    buttonsSetup(viewer, shadowRoot, handler) {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        this.toolsContainer = toolsContainer;

        // initialize tool button to control collapse/expand for buttons
        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = "Tools";
        toolsContainer.appendChild(toolButton);

        // initialize style of nameOverlay, the moving dot
        this.nameOverlay.style.display = "none";
        this.nameOverlay.className = "backdrop";
        this.nameOverlay.style.position = "absolute";
        this.nameOverlay.style.top = "0";
        this.nameOverlay.style.left = "0";
        this.nameOverlay.style["pointer-events"] = "none";
        this.nameOverlay.style.padding = "4px";

        // right click action to clear all entities
        handler.setInputAction(
            () => {
                viewer.entities.removeAll();
            },
            Cesium.ScreenSpaceEventType.RIGHT_CLICK
        );

        // add style to the shadowRoot for this web component
        const style = document.createElement("style");
        style.textContent = `
            .toolbar{ 
                position:absolute;
                bottom: 6rem;
                left: 10rem;
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

    // clear button setup 
    clearButtonSetup(viewer, handler, nameOverlay) {
        this.clearButton = document.createElement("button");
        this.clearButton.className = "clear-button cesium-button";
        this.clearButton.innerHTML = "Clear";

        this.toolsContainer.appendChild(this.clearButton);

        this.clearButton.addEventListener("click", () => {
            viewer.entities.removeAll();
            this.removeAllInputActions(handler);
            nameOverlay.style.display = "none";
        });

    }

    // remove all input actions of handler
    removeAllInputActions(handler) {
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOWN);
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
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
export { MeasureToolbox };
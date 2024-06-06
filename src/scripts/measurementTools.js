import * as Cesium from "cesium/Cesium";

export class MeasureToolbox extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        // Use a Promise to wait for the viewer to be set
        this.viewerPromise = new Promise((resolve) => {
            this.viewerResolve = resolve;
        });

        this.viewerPromise.then((viewer) => {
            this.viewer = viewer;

            const handler = new Cesium.ScreenSpaceEventHandler(
                viewer.scene.canvas
            );
            this.handler = handler;

            this.buttonsSetup(viewer, this.shadowRoot, handler);

            // this.initComponents();
        })
    }

    // async initComponents() {
    //     // Dynamically import the module
    //     await import('./twoPointsDistance.js');

    //     // Create an instance of TwoPointsDistance using document.createElement
    //     this.twoPointsDistance = document.createElement('two-points-distance');
    //     this.toolsContainer.appendChild(this.twoPointsDistance);
    // }

    buttonsSetup(viewer, shadowRoot, handler) {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "toolbar";

        this.toolsContainer = toolsContainer;

        const toolButton = document.createElement("button");
        toolButton.className = "measure-tools cesium-button";
        toolButton.innerHTML = "Tools";
        toolsContainer.appendChild(toolButton);

        const nameOverlay = document.createElement("div");
        nameOverlay.style.display = "none";
        nameOverlay.className = "backdrop";
        nameOverlay.style.position = "absolute";
        nameOverlay.style.bottom = "0";
        nameOverlay.style.left = "0";
        nameOverlay.style["pointer-events"] = "none";
        nameOverlay.style.padding = "4px";
        toolsContainer.appendChild(nameOverlay);

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
        // console.log("🚀  viewer", viewer);

        // Resolve the promise when the viewer is set
        if (this.viewerResolve) {
            this.viewerResolve(viewer);
        }
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
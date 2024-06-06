import * as Cesium from "cesium/Cesium";
import { MeasureToolbox } from "./measurementTools.js";

export class TwoPointsDistance extends MeasureToolbox {
    constructor() {
        super();  // Call the parent class's constructor
        // Initialize specific properties for MeasureDistanceTwoPoints
        // console.log(this.viewer);
        this.pointA = null;
        this.pointB = null;
        this.setupUI();
    }

    setupUI() {
        this.button = document.createElement("button");
        this.button.className = "distance cesium-button"
        this.button.innerHTML = "Distance";
        this.shadowRoot.appendChild(this.button);
        // this.toolsContainer.appendChild(this.button);
    }

}
customElements.define("two-points-distance", TwoPointsDistance);
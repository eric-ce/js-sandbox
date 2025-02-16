import * as Cesium from "cesium";
import { MeasureToolbox } from "./components/MeasureToolbox.js";
import {
    PointPrimitiveCollection,
    Primitive,
    LabelCollection,
    GroundPolylinePrimitive,
    PolylineCollection,
} from "cesium";

export class MapCesium extends HTMLElement {
    constructor() {
        super();

        this.attachShadow({ mode: "open" });
        this.div = document.createElement("div");
        this.div.style.width = "100%";
        this.div.style.height = "100%";
        this.shadowRoot.appendChild(this.div);

        this._viewer = null;
        // this.measureToolbox = null;

        this.app = {
            log: ["testing"],
            currentUser: {
                sessions: {
                    navigator: {
                        roles: ["fireTrail", "developer", "tester", "flyThrough"]
                    }
                }
            }
        }

        this.measureToolbox = null;
    }

    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }

    connectedCallback() {
        if (this.viewer) {
            this.measureToolbox = this.initializeMeasureToolbox();
        }
    }

    initializeMeasureToolbox() {
        // this.measureToolbox = document.createElement("cesium-measure");
        // this.measureToolbox.viewer = this.viewer;
        // this.measureToolbox.cesiumPkg = {
        //     PointPrimitiveCollection,
        //     Primitive,
        //     LabelCollection,
        //     GroundPolylinePrimitive,
        //     PolylineCollection,
        // }
        // this.measureToolbox.app = this.app;
        // this.shadowRoot.appendChild(this.measureToolbox);
        const cesiumPkg = {
            PointPrimitiveCollection,
            Primitive,
            LabelCollection,
            GroundPolylinePrimitive,
            PolylineCollection,
        }
        return new MeasureToolbox(this.app, this.viewer, cesiumPkg);
    }
}

customElements.define("map-cesium", MapCesium);
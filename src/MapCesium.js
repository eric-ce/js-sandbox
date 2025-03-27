import * as Cesium from "cesium";

import "cesiumStyle";

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
        this.div = null;

        this._viewer = null;

        // mimic navigator app variable for user and user roles
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

        // !Important: Do not copy emitter: for sync view features only
        this._mapEmitter = null;

        this.type = "map-cesium";

        this._isListening = false; // Flag to track if the listener is active
    }

    get mapEmitter() {
        return this._mapEmitter;
    }

    set mapEmitter(emitter) {
        this._mapEmitter = emitter;
    }
    /*********************
     * GETTER AND SETTER *
     *********************/
    set viewer(viewer) {
        this._viewer = viewer;
    }

    get viewer() {
        return this._viewer;
    }


    /*************************************************
     *             DO NOT COPY BELOW             *
     * AS IT HAS BEEN SETUP ELSEWHERE IN THE PROJECT *
     *************************************************/
    async connectedCallback() {
        // apply cesium style due to shadow dom
        this.cesiumStyle = document.createElement("link");
        this.cesiumStyle.rel = "stylesheet";
        this.cesiumStyle.href = `/Widgets/widgets.css`;
        this.shadowRoot.appendChild(this.cesiumStyle);

        this._cesiumContainerSetup();
        this.viewer = this._setViewer();

        if (this.viewer && this.viewer instanceof Cesium.Viewer) {
            this._setCesiumLocation(this.viewer);
            await this._loadTileset(this.viewer);

            const cesiumMeasure = this.shadowRoot.querySelector("cesium-measure");
            this.measureToolbox = cesiumMeasure ? cesiumMeasure : this.initializeMeasureToolbox();
        }

        this._mapEmitter.on("camera:changed", ({ mapName, lat, lng, zoom }) => {
            if (mapName === this.type) return;

            // Remove the listener before programmatically moving the camera
            this._removeMapListener();

            this.viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lng, lat, this.convertZoomToHeight(zoom) || 1000),
                orientation: {
                    heading: 0.0,
                    pitch: -Cesium.Math.PI_OVER_TWO,
                    roll: 0.0
                },
                complete: () => {
                    // Add the listener back after animation completes
                    setTimeout(() => {
                        this._addMapListener();
                    }, 100);
                },
                duration: 1.5
            });
        });

        this._addMapListener();
    }



    _cesiumContainerSetup() {
        this.div = document.createElement("div");
        this.div.id = "map-cesium-base";
        this.div.style.width = "100%";
        this.div.style.height = "100%";
        this.div.style.position = "relative";
        this.div.style.border = "1px solid gray";

        this.shadowRoot.appendChild(this.div);
    }

    _setViewer() {
        return new Cesium.Viewer(this.div, {
            terrain: Cesium.Terrain.fromWorldTerrain({
                requestVertexNormals: true,
                requestWaterMask: true,
            }),
        });
    }

    async _initializeCesium(viewer) {
        this._setCesiumLocation(viewer);
        await this._loadTileset(viewer);
    }

    async _loadTileset(viewer) {
        try {
            // Load the 3D tileset using the ion asset ID
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(40866);

            // Set the point size for the tileset style
            tileset.style = new Cesium.Cesium3DTileStyle();
            // tileset.style.pointSize = "5";

            // Add the loaded tileset to the Cesium viewer's scene primitives
            viewer.scene.primitives.add(tileset);
        } catch (error) {
            console.error(`Error loading tileset: ${error}`);
        }
    }

    _setCesiumLocation(viewer) {
        viewer.scene.camera.setView({
            destination: new Cesium.Cartesian3(
                1216336.9241197142,
                -4736486.465150575,
                4081238.2047158927
            ),
            orientation: new Cesium.HeadingPitchRoll(
                0.13000450343722036,
                -0.36258995940353334,
                0.000004639572851239393
            ),
        });
    }

    // Handler for camera movement
    _handleCameraChanged = () => {
        const position = this.viewer.scene.camera.positionCartographic;
        this._mapEmitter.emit("camera:changed", {
            mapName: this.type,
            lat: Cesium.Math.toDegrees(position.latitude),
            lng: Cesium.Math.toDegrees(position.longitude),
            zoom: this.convertHeightToZoom(position.height)
        });
    };

    // Add the map listener - use consistent method name with MapLeaflet
    _addMapListener() {
        if (this.viewer) {
            this.viewer.scene.camera.moveEnd.addEventListener(this._handleCameraChanged);
            this._isListening = true;
        }
    }

    // Remove the map listener - use consistent method name with MapLeaflet
    _removeMapListener() {
        if (this.viewer) {
            this.viewer.scene.camera.moveEnd.removeEventListener(this._handleCameraChanged);
            this._isListening = false;
        }
    }

    convertZoomToHeight(zoom) {
        return 40000000 / Math.pow(2, zoom - 1);
    }

    convertHeightToZoom(height) {
        const zoom = Math.log2(40000000 / height) + 1;
        return Math.round(zoom);
    }

    /*********************
     * DO NOT COPY ABOVE *
     *********************/

    // initialize measure toolbox for cesium
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
        const measureToolbox = new MeasureToolbox(this.app, this.type);
        measureToolbox.viewer = this.viewer;
        measureToolbox.cesiumPkg = cesiumPkg;
        return measureToolbox;
    }
}

customElements.define("map-cesium", MapCesium);
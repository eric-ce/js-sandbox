import * as Cesium from "cesium";
import "cesiumStyle";
import { MeasureToolbox } from "./components/MeasureToolbox.mjs";
import {
    PointPrimitiveCollection,
    Primitive,
    LabelCollection,
    GroundPolylinePrimitive,
    PolylineCollection,
} from "cesium";

import CesiumNavigation from "cesium-navigation-es6";
import { MapBase } from "./MapBase.mjs";

export class MapCesium extends MapBase {
    constructor() {
        super();
        this.type = "map-cesium";
    }

    get viewer() {
        return this._map; // Use the base class _map property
    }

    set viewer(viewer) {
        this._map = viewer;
    }

    async connectedCallback() {
        // apply cesium style due to shadow dom
        this.cesiumStyle = document.createElement("link");
        this.cesiumStyle.rel = "stylesheet";
        this.cesiumStyle.href = `/Widgets/widgets.css`;
        this.shadowRoot.appendChild(this.cesiumStyle);

        this._cesiumContainerSetup();

        await this._initialize();

        if (this.viewer && this.viewer instanceof Cesium.Viewer) {
            // Attach navigation controls
            this._attachNavigation();

            // Attach annotation toolbox
            this._attachAnnotationToolbox();
        }
    }

    disconnectedCallback() {
        this._removeMapListener();
        if (this.viewer && !this.viewer.isDestroyed()) {
            this.viewer.destroy();
            this._map = null;
        }
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

    _attachNavigation() {
        this.navigationStyle = document.createElement("link");
        this.navigationStyle.rel = "stylesheet";
        this.navigationStyle.href = `/styles/cesium-navigation.css`;
        this.shadowRoot.appendChild(this.navigationStyle);

        new CesiumNavigation(this.viewer, {
            enableCompass: true,
            enableZoomControls: true,
            enableDistanceLegend: true,
            enableCompassOuterRing: true,
        });
    }

    _attachAnnotationToolbox() {
        if (!this.app || !this.annotationToolbox) return;

        const cesiumPkg = {
            PointPrimitiveCollection,
            Primitive,
            LabelCollection,
            GroundPolylinePrimitive,
            PolylineCollection,
        }

        // Set properties for the annotation toolbox
        this.annotationToolbox.viewer = this.viewer;
        this.annotationToolbox.cesiumPkg = cesiumPkg;
        this.annotationToolbox.type = this.type;

        // Initialize the toolbox component by mapType
        this.annotationToolbox.initializeToolboxComponent(this.type);
    }


    async _createMap() {
        const viewer = new Cesium.Viewer(this.div, {
            terrain: Cesium.Terrain.fromWorldTerrain({
                requestVertexNormals: true,
                requestWaterMask: true,
            }),
        });
        this._setCesiumLocation(viewer);
        await this._loadTileset(viewer);
        return viewer;
    }

    _panTo(bounds) {
        const rectangle = Cesium.Rectangle.fromDegrees(
            bounds.west,
            bounds.south,
            bounds.east,
            bounds.north
        );

        this.viewer.camera.flyTo({
            destination: rectangle,
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
    }

    _getBounds() {
        const rect = this.viewer.camera.computeViewRectangle();
        if (!rect) return null;
        return {
            north: Cesium.Math.toDegrees(rect.north),
            south: Cesium.Math.toDegrees(rect.south),
            east: Cesium.Math.toDegrees(rect.east),
            west: Cesium.Math.toDegrees(rect.west)
        };
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
        const bounds = this._getBounds();
        if (bounds) {
            this._mapEmitter.emit("camera:changed", {
                mapName: this.type,
                bounds: bounds
            });
        }
    };

    // Add the map listener
    _addMapListener() {
        if (this.viewer) {
            this.viewer.scene.camera.moveEnd.addEventListener(this._handleCameraChanged);
            this._isListening = true;
        }
    }

    // Remove the map listener
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
}

customElements.define("map-cesium", MapCesium);
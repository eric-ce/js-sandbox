import * as Cesium from "cesium";
import 'mainStyle';
import "cesiumStyle";
// import { MeasureToolbox } from "./MeasureToolbox.js";
import { MapCesium } from "./MapCesium.js";
import { PointPrimitiveCollection, Primitive, LabelCollection, GroundPolylinePrimitive } from "cesium";
class Navigator {
    constructor() {
        this.cesiumDivSetup();

        this.viewer = new Cesium.Viewer("cesiumContainer", {
            terrain: Cesium.Terrain.fromWorldTerrain({
                requestVertexNormals: true,
                requestWaterMask: true,
            }),
        });
    }

    cesiumDivSetup() {
        this.div = document.createElement("div");
        this.div.id = "cesiumContainer";
        document.body.appendChild(this.div);
        this.div.style.width = "90%";
        this.div.style.height = "auto";
        this.div.style.margin = "auto";
        this.div.style.position = "relative";
        this.div.style.border = "1px solid gray";
    }

    viewSetup(viewer) {
        viewer.scene.camera.setView({
            destination: new Cesium.Cartesian3(
                1216356.033078094,
                -4736402.278325668,
                4081270.375520902
            ),
            orientation: new Cesium.HeadingPitchRoll(
                0.08033365594766728,
                -0.29519015695063455,
                0.00027759141518046704
            ),
        });
    }

    async loadTileset(viewer) {
        try {
            // Load the 3D tileset using the ion asset ID
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(40866);

            // Set the point size for the tileset style
            tileset.style = new Cesium.Cesium3DTileStyle();
            // tileset.style.pointSize = "5";

            // Add the loaded tileset to the Cesium viewer's scene primitives
            viewer.scene.primitives.add(tileset);
        } catch (error) {
            console.log(`Error loading tileset: ${error}`);
        }
    }

    async initialMap() {
        this.viewSetup(this.viewer);
        await this.loadTileset(this.viewer);

        const mapCesium = document.createElement("map-cesium");
        mapCesium.viewer = this.viewer;
        this.div.appendChild(mapCesium);
    }
}

const navigator = new Navigator();
navigator.initialMap();


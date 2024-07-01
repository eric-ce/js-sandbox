import * as Cesium from "cesium";
import 'mainStyle';
import "cesiumStyle";
import { MeasureToolbox } from "./MeasureToolbox.js";

class CesiumMap {
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
        this.div.style.width = "85%";
        this.div.style.height = "auto";
        this.div.style.margin = "auto";
        this.div.style.position = "relative";
        this.div.style.border = "1px solid gray";
    }

    viewSetup(viewer) {
        viewer.scene.camera.setView({
            destination: new Cesium.Cartesian3(
                4401744.644145314,
                225051.41078911052,
                4595420.374784433
            ),
            orientation: new Cesium.HeadingPitchRoll(
                5.646733805039757,
                -0.276607153839886,
                6.281110875400085
            ),
        });
    }

    async loadTileset(viewer) {
        try {
            // Load the 3D tileset using the ion asset ID
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(16421);

            // Set the point size for the tileset style
            tileset.style = new Cesium.Cesium3DTileStyle();
            tileset.style.pointSize = "5";

            // Add the loaded tileset to the Cesium viewer's scene primitives
            viewer.scene.primitives.add(tileset);
        } catch (error) {
            console.log(`Error loading tileset: ${error}`);
        }
    }

    async initialMap() {
        this.viewSetup(this.viewer);
        await this.loadTileset(this.viewer);

        // const measureToolBox = new MeasureToolbox(this.viewer);
        // this.div.appendChild(measureToolBox);

        const measureToolBox = document.createElement("measure-toolbox");
        measureToolBox.viewer = this.viewer;
        this.div.appendChild(measureToolBox);
    }
}

const map = new CesiumMap();
map.initialMap();


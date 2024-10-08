import * as Cesium from "cesium";
import { createPointPrimitive, generateId, removeInputActions } from "../helper/helper.js";

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
        }

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));


        this.cameraMove();
    }

    cameraMove() {
        if (!this.flags.isComplete) {
            // add event listener to the camera to log all camera changes
            this.viewer.camera.moveEnd.addEventListener(() => {
                console.log("🚀  this.activeButton:", this.activeButton.current);
                console.log(this.button)
                if (
                    this.activeButton.current &&
                    this.activeButton.current === this.button
                ) {
                    const position = this.viewer.camera.positionWC;
                    const direction = this.viewer.camera.directionWC;
                    this.coords._flyRecords.push({ position: { ...position }, direction: { ...direction } });
                    console.log(this.coords._flyRecords);
                } else {
                    return;
                }
            })
        }

    }

    resetValue() {
        this.coordinate = null;

    }

}

export { FlyThrough };
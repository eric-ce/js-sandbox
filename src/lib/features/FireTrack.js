import * as Cesium from "cesium";
import { createLineGeometryInstance, createLinePrimitive, createPointPrimitive, generateId, removeInputActions } from "../helper/helper.js";

class FireTrack {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // cesium primitives
        // point primitives
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);

        // fly data mock
        this.trackData = this.loadTrackData();
        if (this.trackData.length > 0) {
            this.trackData.forEach((_, idx) => {
                if (idx === this.trackData.length - 1) {
                    return;
                }
                const lineGeometryInstance = createLineGeometryInstance([this.trackData[idx], this.trackData[idx + 1]], "fire_track_line");
                const linePrimitive = createLinePrimitive(lineGeometryInstance, Cesium.Color.RED, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(linePrimitive);
            });
        }

        this.selectedPolyline = null;
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleFireTackLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleFireTackMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleFireTackLeftClick(movement) {


    }

    handleFireTackMouseMove(movement) {
        // const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        // if (Cesium.defined(cartesian)) {
        //     this.coordinate = cartesian;
        // }

        const pickedObject = this.viewer.scene.pick(movement.endPosition);
        console.log("🚀  pickedObject:", pickedObject);

        if (!Cesium.defined(pickedObject)) return;

        if (pickedObject.id && pickedObject.id.includes("fire_track_line")) {
            if (this.selectedPolyline !== pickedObject.primitive) {
                this.resetHighlightedPolyline();
                this.selectedPolyline = pickedObject.primitive;

                this.highlightPolyline(this.selectedPolyline)
                console.log("🚀  this.selectedPolyline:", this.selectedPolyline);
            } else {
                this.resetHighlightedPolyline();
            }

            // linePositions = linePrimitive.geometryInstances.geometry._positions;
            // console.log("🚀  linePositions:", linePositions);

        }


    }

    loadTrackData() {
        let positionArray = [];
        const pt1 = new Cesium.Cartesian3(4401562.886717393, 225246.10648519278, 4595518.14798431);
        const pt2 = new Cesium.Cartesian3(4401541.690621404, 225270.47641689502, 4595533.261946663);
        const pt3 = new Cesium.Cartesian3(4401501.974991431, 225295.62235235822, 4595565.953207925);
        const pt4 = new Cesium.Cartesian3(4401463.6864656145, 225317.52456706297, 4595604.4916294385);
        const pt5 = new Cesium.Cartesian3(4401489.255786863, 225371.25566399848, 4595580.979378097);
        const pt6 = new Cesium.Cartesian3(4401507.737535874, 225421.46254576897, 4595561.67362487);
        positionArray = [pt1, pt2, pt3, pt4, pt5, pt6];

        return positionArray;
    }

    highlightPolyline(linePrimitive, color = Cesium.Color.YELLOW) {
        linePrimitive.appearance = new Cesium.PolylineMaterialAppearance({
            material: new Cesium.Material.fromType('Color', {
                color: color
            })
        });
        linePrimitive.depthFailMaterial = new Cesium.PolylineMaterialAppearance({
            material: new Cesium.Material.fromType('Color', {
                color: color
            })
        });
    }

    resetHighlightedPolyline() {
        if (this.selectedPolyline) {
            const polylines = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances?.id?.includes("line"));
            const originalPolyline = polylines.find(p => p === this.selectedPolyline);

            if (originalPolyline) {
                this.selectedPolyline.appearance = new Cesium.PolylineMaterialAppearance({
                    material: new Cesium.Material.fromType('Color', {
                        color: Cesium.Color.RED
                    })
                });
                this.selectedPolyline.depthFailMaterial = new Cesium.PolylineMaterialAppearance({
                    material: new Cesium.Material.fromType('Color', {
                        color: Cesium.Color.RED
                    })
                });
            }

            this.selectedPolyline = null;
        }
    }

    resetValue() {
        this.coordinate = null;
    }

}

export { FireTrack };
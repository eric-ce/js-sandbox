import * as Cesium from "cesium";
import { createPointPrimitive, generateId, removeInputActions } from "../helper/helper.js";

class FlyThrough {
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
        this.flyData = this.loadFlyData();
        if (this.flyData.length > 0) {
            this.flyData.forEach((position) => {
                const point = createPointPrimitive(position, Cesium.Color.RED);
                point.id = generateId(position, "fly_through_point");
                this.pointCollection.add(point);
            });
        }
        this.goData = this.loadGoData();
        if (this.goData.length > 0) {
            this.goData.forEach((position) => {
                const point = createPointPrimitive(position, Cesium.Color.BLUE);
                point.id = generateId(position, "fly_through_point");
                this.pointCollection.add(point);
            });
        }
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handleFlyThroughLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handleFlyThroughMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handleFlyThroughLeftClick(movement) {
        console.log(`${this.coordinate.x}, ${this.coordinate.y}, ${this.coordinate.z}`);
        const pickedObject = this.viewer.scene.pick(movement.position);
        console.log("🚀  pickedObject:", pickedObject);

        if (Cesium.defined(pickedObject) && pickedObject.id.includes("fly_through_point")) {
            const pickedPointPosition = pickedObject.primitive._position;

            // const findPoint = this.flyData.find(() => Cesium.Cartesian3.equals(pickedPointPosition, ));
            const findPointInFlyData = this.flyData.find((point) => Cesium.Cartesian3.equals(pickedPointPosition, point));
            const findPointInGoData = this.goData.find((point) => Cesium.Cartesian3.equals(pickedPointPosition, point));

            if (findPointInFlyData) {
                this.startFlyThrough(this.flyData);
            }
            if (findPointInGoData) {
                this.startFlyThrough(this.goData);
            }
        }
        // const findFlyPoint = this.flyData.find((point) => {})

    }

    // fly through the position in this.flyData one by one
    startFlyThrough(positionArray) {
        const flyToNextPoint = (index) => {
            if (index >= positionArray.length) {
                console.log('Completed fly-through.');
                return; // Exit if we've visited all points
            }
            console.log(this.viewer.camera)
            const position = positionArray[index];
            const nextIndex = index + 1;
            // const offsetPosition = Cesium.Cartographic.fromCartesian(position);
            // const offsetHeight = offsetPosition.height + 100;
            // const offsetCartesian = Cesium.Cartesian3.fromRadians(offsetPosition.longitude, offsetPosition.latitude, offsetHeight);

            // this.viewer.camera.flyTo({
            //     destination: position,
            //     orientation: {
            //         heading: Cesium.Math.toRadians(0),
            //         pitch: Cesium.Math.toRadians(-80),
            //         roll: 0
            //     },
            //     duration: 3, // Duration in seconds
            //     complete: () => {
            //         this.viewer.camera.moveBackward(70);
            //         setTimeout(() => {
            //             flyToNextPoint(nextIndex); // Recursively fly to the next point
            //         }, 3000);
            //     },
            //     cancel: () => {
            //         console.log('Fly-through was canceled.');
            //     },
            //     easingEffects: Cesium.EasingFunction.LINEAR_NONE
            // });

            const pointBoundingSphere = new Cesium.BoundingSphere(position, 100);
            this.viewer.camera.flyToBoundingSphere(pointBoundingSphere, {
                offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-20), 100),
                duration: 3,
                easingEffects: Cesium.EasingFunction.QUADRATIC_IN_OUT,
                complete: () => {
                    // this.viewer.camera.moveBackward(70);
                    setTimeout(() => {
                        flyToNextPoint(nextIndex); // Recursively fly to the next point
                    }, 2000);
                },
                cancel: () => {
                    console.log('Fly-through was canceled.');
                },
            })

        };

        flyToNextPoint(0); // Start flying from the first point
    }

    handleFlyThroughMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
            this.coordinate = cartesian;
        }

    }

    loadFlyData() {
        let positionArray = [];
        const point5 = new Cesium.Cartesian3(4401705.162737345, 225012.0238664261, 4595438.351982967);
        const point4 = new Cesium.Cartesian3(4405463.140258043, 228299.7151527145, 4591813.162198005);
        const point3 = new Cesium.Cartesian3(4407396.398454112, 222462.57970319863, 4590117.920558546);
        const point2 = new Cesium.Cartesian3(4402377.298390903, 217044.0988035, 4595014.426903738);
        const point1 = new Cesium.Cartesian3(4399015.383050317, 226727.06596455685, 4597879.00690766);
        positionArray = [point1, point2, point3, point4, point5];

        return positionArray;
    }

    loadGoData() {
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

    resetValue() {
        this.coordinate = null;
    }

}

export { FlyThrough };
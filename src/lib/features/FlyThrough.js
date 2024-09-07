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
        const pickedObject = this.viewer.scene.pick(movement.position);
        console.log("🚀  pickedObject:", pickedObject);

        if (Cesium.defined(pickedObject) && pickedObject.id.includes("fly_through_point")) {
            const pickedPointPosition = pickedObject.primitive._position;
            console.log("🚀  pickedPointPosition:", pickedPointPosition);

            // const findPoint = this.flyData.find(() => Cesium.Cartesian3.equals(pickedPointPosition, ));
            const findPoint = this.flyData.find((point) => Cesium.Cartesian3.equals(pickedPointPosition, point));

            if (findPoint) {
                this.startFlyThrough();
            }
        }
        // const findFlyPoint = this.flyData.find((point) => {})

    }

    // fly through the position in this.flyData one by one
    startFlyThrough() {
        const flyToNextPoint = (index) => {
            if (index >= this.flyData.length - 2) {
                console.log('Completed fly-through.');
                return; // Exit if we've visited all points
            }
            console.log(this.viewer.camera)
            const position = this.flyData[index];
            const nextIndex = index + 1;
            const offsetPosition = Cesium.Cartographic.fromCartesian(position);
            const offsetHeight = offsetPosition.height + 100;
            const offsetCartesian = Cesium.Cartesian3.fromRadians(offsetPosition.longitude, offsetPosition.latitude, offsetHeight);

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
                easingEffects: Cesium.EasingFunction.LINEAR_NONE,
                complete: () => {
                    // this.viewer.camera.moveBackward(70);
                    setTimeout(() => {
                        flyToNextPoint(nextIndex); // Recursively fly to the next point
                    }, 3000);
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

    resetValue() {
        this.coordinate = null;
    }

}

export { FlyThrough };
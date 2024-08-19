import * as Cesium from "cesium";
import {
    createPointEntity,
    createDistanceLabel,
    createPolygonEntity,
    removeInputActions,
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    createPolygonGeometryInstance,
    createPolygonPrimitive,
    createPolygonOutlinePrimitive,
    createPolygonOutlineGeometryInstance
} from "../helper/helper.js";

class PolygonP {
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.isPolygonEnd = false; // flag to check if the polygon is finished
        this.isDragMode = false;

        // Cesium Primitives
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.movingPoint = null;

        // polygon
        this.polygon = null;
        this.polygonOutline = null;
        this.movingPolygon = null;
        this.movingPolygonOutline = null;

        // label primitive
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);

        this.movingLabelPrimitive = this.labelCollection.add(
            createLabelPrimitive(Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO, 0)
        );
        this.movingLabelPrimitive.show = false;
        this.labelPrimitive = this.labelCollection.add(
            createLabelPrimitive(Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO, 0)
        );
        this.labelPrimitive.show = false;

        // dragging feature variables
        this.draggingPrimitive = null;
        this.beforeDragPosition = null;

        // coordinates orientated data: use for identify points, lines, labels
        this.coordinateDataCache = [];
        // all the click coordinates 
        this.groupCoords = [];

        this._areaRecords = [];
    }

    /**
     * Sets up input actions for three points curve mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handlePolygonLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handlePolygonRightClick(movement);
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

        // this.handler.setInputAction((movement) => {
        //     this.handlePolygonDragStart(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        // this.handler.setInputAction((movement) => {
        //     this.handlePolygonDragEnd(movement)
        // }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handlePolygonLeftClick(movement) {
        // Check if the measurement has ended
        // if pick the label entity, make the label entity editable
        // use move position for the position
        const cartesian = this.coordinate;

        if (!Cesium.defined(cartesian)) return;

        // editable label features
        if (this.isPolygonEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // If picked object is a label primitive, make it editable
            if (
                Cesium.defined(pickedObject) &&
                pickedObject?.id?.startsWith("annotate") &&
                pickedObject?.id?.includes("label")
            ) {
                editableLabel(this.viewer.container, pickedObject.primitive);
                return; // Exit the function after making the label editable
            }

            // reset variables
            this._areaRecords.length = 0;
            this.isPolygonEnd = false;
        }

        if (!this.isPolygonEnd) {
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;

            // create point entity
            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const point = createPointPrimitive(this.coordinate, color);
            point.id = generateId(this.coordinate, "polygon_point");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coordinateDataCache.push(this.coordinate);

            // If three points create the polygon primitive
            if (this.coordinateDataCache.length > 2) {
                // create polygon primitive
                if (this.polygon) this.viewer.scene.primitives.remove(this.polygon);
                if (this.polygonOutline) this.viewer.scene.primitives.remove(this.polygonOutline);
                const polygonGeometry = createPolygonGeometryInstance(this.coordinateDataCache, "polygon");
                const polygonPrimitive = createPolygonPrimitive(polygonGeometry, this.cesiumPkg.Primitive);
                this.polygon = this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline primitive
                const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coordinateDataCache, "polygon_outline");
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                this.polygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const polygonArea = this.computePolygonArea(this.coordinateDataCache);
                const midPoint = Cesium.Cartesian3.midpoint(
                    this.coordinateDataCache[0],
                    this.coordinateDataCache[this.coordinateDataCache.length - 1],
                    new Cesium.Cartesian3()
                );
                this.labelPrimitive.position = midPoint;
                this.labelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
                this.labelPrimitive.id = generateId(midPoint, "polygon_label");
                this.labelPrimitive.show = true;
            }
        }
    }

    handlePolygonMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(
            movement.endPosition
        );

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay : the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

        if (this.isMultiDistanceEnd) return;

        if (this.coordinateDataCache.length > 2) {
            if (this.movingPoint) this.pointCollection.remove(this.movingPoint);
            const movingPoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            movingPoint.id = generateId(cartesian, "polygon_moving_point");
            this.movingPoint = this.pointCollection.add(movingPoint);

            // remove and create the polygon primitive
            if (this.polygon) this.viewer.scene.primitives.remove(this.polygon);
            if (this.polygonOutline) this.viewer.scene.primitives.remove(this.polygonOutline);
            if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
            if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
            const movingCoordinateDataCache = [...this.coordinateDataCache, cartesian];
            const polygonGeometry = createPolygonGeometryInstance(movingCoordinateDataCache, "polygon_moving");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, this.cesiumPkg.Primitive);
            this.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingCoordinateDataCache, "polygon_moving_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            const polygonArea = this.computePolygonArea(movingCoordinateDataCache);
            const midPoint = Cesium.Cartesian3.midpoint(
                movingCoordinateDataCache[0],
                movingCoordinateDataCache[movingCoordinateDataCache.length - 1],
                new Cesium.Cartesian3()
            );
            this.movingLabelPrimitive.position = midPoint;
            this.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
            this.movingLabelPrimitive.id = generateId(midPoint, "polygon_moving_label");
            this.movingLabelPrimitive.show = true;

            //     const pointsPosition = this.pointEntities.values.map(
            //         (pointEntity) =>
            //             pointEntity.position.getValue(Cesium.JulianDate.now())
            //     );

            //     // Update the polygon entity
            //     const dynamicPolygonHierarchy = new Cesium.CallbackProperty(() => {
            //         return new Cesium.PolygonHierarchy([
            //             ...pointsPosition,
            //             cartesian,
            //         ]);
            //     }, false);

            //     this.polygonEntity.polygon.hierarchy = dynamicPolygonHierarchy

            //     // Update the polygon label
            //     const polygonArea = this.computePolygonArea([...pointsPosition, cartesian]);
            //     if (this.labelEntities.values.length > 0) {
            //         this.removeEntities(this.labelEntities);
            //     }
            //     const polygonLabel = createDistanceLabel(
            //         pointsPosition[0],
            //         pointsPosition[pointsPosition.length - 1],
            //         polygonArea
            //     );
            //     polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
            //     polygonLabel.label.text = `Total:${polygonArea.toFixed(2)} m²`;
            //     const polygonLabelEntity =
            //         this.viewer.entities.add(polygonLabel);
            //     this.labelEntities.add(polygonLabelEntity);
        }
    }

    handlePolygonRightClick(movement) {
        if (!this.isPolygonEnd) {
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;
            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const point = createPointPrimitive(this.coordinate, color);
            point.id = generateId(this.coordinate, "polygon_point");
            this.pointCollection.add(point);

            // // update the last point for the middle click
            // const pointsPosition = this.pointEntities.values.map(
            //     (pointEntity) =>
            //         pointEntity.position.getValue(Cesium.JulianDate.now())
            // );

            // // create polygon entity
            // // this.removeEntity(this.polygonEntity)
            // // this.polygonEntity = this.viewer.entities.add(
            // //     createPolygonEntity(pointsPosition)
            // // );
            // // update polygon entity
            // if (this.polygonEntity) {
            //     this.polygonEntity.polygon.hierarchy = new Cesium.CallbackProperty(() => {
            //         return new Cesium.PolygonHierarchy(pointsPosition);
            //     }, false);
            // }

            // // create label entity
            // if (this.labelEntities.values.length > 0) {
            //     this.removeEntities(this.labelEntities);
            // }
            // const polygonArea = this.computePolygonArea(pointsPosition);
            // const polygonLabel = createDistanceLabel(
            //     pointsPosition[0],
            //     pointsPosition[pointsPosition.length - 1],
            //     polygonArea
            // );
            // polygonLabel.pixelOffset = new Cesium.Cartesian2(0, 20);
            // polygonLabel.label.text = `Total:${polygonArea.toFixed(2)} m²`;
            // const polygonLabelEntity = this.viewer.entities.add(polygonLabel);
            // this.labelEntities.add(polygonLabelEntity);

            // // log area records
            // this._areaRecords.push(polygonArea);
            // this.logRecordsCallback(polygonArea);

            //set flag to the end drawing of polygon
            this.isPolygonEnd = true;
        }
    }

    resetValue() {
        this.isPolygonEnd = false;
        this.coordinate = new Cesium.Cartesian3();
    }

    computePolygonArea(cartesianArray) {
        let hierarchy = new Cesium.PolygonHierarchy(cartesianArray);

        // let hierarchy = polygon.polygon.hierarchy._value;
        let indices = Cesium.PolygonPipeline.triangulate(hierarchy.positions, hierarchy.holes);

        let area = 0;
        for (let i = 0; i < indices.length; i += 3) {
            let vector1 = hierarchy.positions[indices[i]];
            let vector2 = hierarchy.positions[indices[i + 1]];
            let vector3 = hierarchy.positions[indices[i + 2]];
            let vectorC = Cesium.Cartesian3.subtract(vector2, vector1, new Cesium.Cartesian3());
            let vectorD = Cesium.Cartesian3.subtract(vector3, vector1, new Cesium.Cartesian3());
            let areaVector = Cesium.Cartesian3.cross(vectorC, vectorD, new Cesium.Cartesian3());
            area += Cesium.Cartesian3.magnitude(areaVector) / 2.0;
        }
        return area;
    }
}

export { PolygonP };

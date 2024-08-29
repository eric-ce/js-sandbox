import * as Cesium from "cesium";
import {
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

class Polygon {
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
        // point collection
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.movingPoint = null;
        // polygon
        this.movingPolygon = null;
        this.movingPolygonOutline = null;
        // label primitive
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.labelCollection);
        this.movingLabelPrimitive = null;

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

        this.handler.setInputAction((movement) => {
            this.handlePolygonDragStart(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction((movement) => {
            this.handlePolygonDragEnd(movement)
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }

    /**
     * Removes input actions for height measurement mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handlePolygonLeftClick(movement) {
        // use mouse move position for the position
        const cartesian = this.coordinate;

        if (!Cesium.defined(cartesian)) return;

        // Check if the measurement has ended
        if (this.isPolygonEnd) {
            const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);

            // editable label features: If picked object is a label primitive, make it editable
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
                if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
                if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
                const polygonGeometry = createPolygonGeometryInstance(this.coordinateDataCache, "polygon");
                const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
                this.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline primitive
                const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coordinateDataCache, "polygon_outline");
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                this.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const polygonArea = this._computePolygonArea(this.coordinateDataCache);
                const midPoint = Cesium.Cartesian3.midpoint(
                    this.coordinateDataCache[0],
                    this.coordinateDataCache[this.coordinateDataCache.length - 1],
                    new Cesium.Cartesian3()
                );
                if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
                this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(this.coordinateDataCache[0], this.coordinateDataCache[this.coordinateDataCache.length - 1], polygonArea));
                this.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
                this.movingLabelPrimitive.id = generateId(midPoint, "polygon_label");
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

        if (this.isPolygonEnd) return;

        if (this.coordinateDataCache.length > 2) {
            if (this.movingPoint) this.pointCollection.remove(this.movingPoint);
            const movingPoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            movingPoint.id = generateId(cartesian, "polygon_moving_point");
            this.movingPoint = this.pointCollection.add(movingPoint);

            // remove and create the polygon primitive
            if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
            if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
            const movingCoordinateDataCache = [...this.coordinateDataCache, cartesian];
            const polygonGeometry = createPolygonGeometryInstance(movingCoordinateDataCache, "polygon_moving");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingCoordinateDataCache, "polygon_moving_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            const polygonArea = this._computePolygonArea(movingCoordinateDataCache);
            const midPoint = Cesium.Cartesian3.midpoint(
                movingCoordinateDataCache[0],
                movingCoordinateDataCache[movingCoordinateDataCache.length - 1],
                new Cesium.Cartesian3()
            );
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(movingCoordinateDataCache[0], movingCoordinateDataCache[movingCoordinateDataCache.length - 1], polygonArea));
            this.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
            this.movingLabelPrimitive.id = generateId(midPoint, "polygon_moving_label");
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

            // update coordinate data cache
            this.coordinateDataCache.push(this.coordinate);
            this.groupCoords.push([...this.coordinateDataCache]);

            // remove moving point
            if (this.movingPoint) this.pointCollection.remove(this.movingPoint);

            // remove and create the polygon primitive
            if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
            if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
            const polygonGeometry = createPolygonGeometryInstance(this.coordinateDataCache, "polygon");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coordinateDataCache, "polygon_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            const polygonArea = this._computePolygonArea(this.coordinateDataCache);
            const midPoint = Cesium.Cartesian3.midpoint(
                this.coordinateDataCache[0],
                this.coordinateDataCache[this.coordinateDataCache.length - 1],
                new Cesium.Cartesian3()
            );
            const label = createLabelPrimitive(midPoint, midPoint, 0);
            label.text = `${polygonArea.toFixed(2)} m²`;
            label.id = generateId(midPoint, "polygon_label");
            this.labelCollection.add(label);

            // log area records
            // this._areaRecords.push(polygonArea);
            this.logRecordsCallback(polygonArea.toFixed(2));

            //set flag to the end drawing of polygon
            this.isPolygonEnd = true;

            // reset variables
            this.coordinateDataCache.length = 0;
        }
    }

    handlePolygonDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.groupCoords.length > 0) {
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

            const pointPrimitive = pickedObjects.find(p => {
                if (typeof p.primitive?.id !== 'string') {
                    return false;
                }
                return p.primitive.id.startsWith("annotate_polygon_point") &&
                    !p.primitive.id.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(pointPrimitive)) {
                console.error("No point primitives found");
                return;
            }

            this.viewer.scene.screenSpaceCameraController.enableInputs = false;
            this.isDragMode = true;

            this.draggingPrimitive = pointPrimitive.primitive;
            this.beforeDragPosition = pointPrimitive.primitive.position.clone();



            // set label not show
            const group = this.groupCoords.find(g => g.some(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition)));
            const midPoint = Cesium.Cartesian3.midpoint(group[0], group[group.length - 1], new Cesium.Cartesian3());

            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);

            const targetLabelPrimitive = this.labelCollection._labels.find(label => Cesium.Cartesian3.equals(label.position, midPoint) && !label.id.includes("moving"));
            targetLabelPrimitive.show = false;

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handlePolygonDrag(movement, this.draggingPrimitive, group);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }

    }
    handlePolygonDrag(movement, pointEntity, group) {
        this.pointerOverlay.style.display = "none";

        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;
        this.coordinate = cartesian;

        // update point entity to dragging position
        pointEntity.position = cartesian;

        // moving coordinate data
        // const group = this.groupCoords.find(g => g.some(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition)));
        const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition));
        const movingCoordinateData = [...group]
        movingCoordinateData[positionIndex] = cartesian;

        // update polygon and label primitive
        if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
        if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
        // remove the polygon
        const polygonPrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id.startsWith("annotate") && p.geometryInstances.id.includes("polygon") && !p.geometryInstances.id.includes("moving"));
        if (polygonPrimitives.length > 0) {
            const targetPolygonPrimitiveSet = polygonPrimitives.filter(p => p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition)));
            if (targetPolygonPrimitiveSet.length > 0) {
                targetPolygonPrimitiveSet.forEach(p => {
                    this.viewer.scene.primitives.remove(p);
                });
            }
        }
        // create polygon primitive
        const polygonGeometry = createPolygonGeometryInstance(movingCoordinateData, "polygon_moving");
        const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
        this.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

        // create polygon outline primitive
        const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingCoordinateData, "polygon_moving_outline");
        const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
        this.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

        // update moving label primitive
        if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
        const polygonArea = this._computePolygonArea(movingCoordinateData);
        const midPoint = Cesium.Cartesian3.midpoint(
            movingCoordinateData[0],
            movingCoordinateData[movingCoordinateData.length - 1],
            new Cesium.Cartesian3()
        );
        this.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(movingCoordinateData[0], movingCoordinateData[movingCoordinateData.length - 1], polygonArea));
        this.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
        this.movingLabelPrimitive.id = generateId(midPoint, "polygon_moving_label");
    }

    handlePolygonDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.draggingPrimitive && this.isDragMode) {
            const groupIndex = this.groupCoords.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.beforeDragPosition)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.groupCoords[groupIndex];
            // polygon and label primitives
            const polygonPrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id.startsWith("annotate") && p.geometryInstances.id.includes("polygon") && !p.geometryInstances.id.includes("moving"));

            // remove the polygon primitive
            if (this.movingPolygon) this.viewer.scene.primitives.remove(this.movingPolygon);
            if (this.movingPolygonOutline) this.viewer.scene.primitives.remove(this.movingPolygonOutline);
            if (polygonPrimitives.length > 0) {
                const targetPolygonPrimitiveSet = polygonPrimitives.filter(p => p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition)));
                if (targetPolygonPrimitiveSet.length > 0) {
                    targetPolygonPrimitiveSet.forEach(p => {
                        this.viewer.scene.primitives.remove(p);
                    });
                }
            }

            // find the label primitive
            let targetLabelPrimitive = null;
            const midPoint = Cesium.Cartesian3.midpoint(group[0], group[group.length - 1], new Cesium.Cartesian3());
            targetLabelPrimitive = this.labelCollection._labels.find(label =>
                label.id &&
                label.id?.startsWith("annotate") &&
                label.id?.includes("label") &&
                !label.id?.includes("moving") &&
                Cesium.Cartesian3.equals(label.position, midPoint)
            );

            // update group coordinates
            const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.beforeDragPosition));
            this.groupCoords[groupIndex][positionIndex] = this.coordinate;

            // create polygon primitive
            const polygonGeometry = createPolygonGeometryInstance(this.groupCoords[groupIndex], "polygon");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonPrimitive);
            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.groupCoords[groupIndex], "polygon_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // update label primitive
            if (this.movingLabelPrimitive) this.labelCollection.remove(this.movingLabelPrimitive);
            if (targetLabelPrimitive) {
                targetLabelPrimitive.show = true;
                const polygonArea = this._computePolygonArea(this.groupCoords[groupIndex]);
                const newMidPoint = Cesium.Cartesian3.midpoint(
                    this.groupCoords[groupIndex][0],
                    this.groupCoords[groupIndex][this.groupCoords[groupIndex].length - 1],
                    new Cesium.Cartesian3()
                );
                targetLabelPrimitive.position = newMidPoint;
                targetLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
                targetLabelPrimitive.id = generateId(midPoint, "polygon_label");

                // log area records
                // this._areaRecords.push(polygonArea);
                this.logRecordsCallback(polygonArea.toFixed(2));
            }

            // reset dragging primitive and flags
            this.draggingPrimitive = null;
            this.isDragMode = false;
        }
        // set back to default polygon mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    /**
     * To compute the area of the polygon
     * @param {Cesium.Cartesian3[]} cartesianArray - array of cartesian coordinates of the polygon 
     * @returns {Number} - area of the polygon
     */
    _computePolygonArea(cartesianArray) {
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

    resetValue() {
        this.coordinate = new Cesium.Cartesian3();

        this.pointerOverlay.style.display = 'none';

        this.isPolygonEnd = false;
        this.isDragMode = false;

        this.draggingPrimitive = null;
        this.beforeDragPosition = null;
    }
}

export { Polygon };

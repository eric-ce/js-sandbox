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

        // flags to control the state of the tool
        this.flags = {
            isPolygonEnd: false,   // flag to check if the polygon is finished
            isDragMode: false      // flag to check if the polygon is in dragging mode
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],      // Stores temporary coordinates during operations
            groups: [],     // Tracks all coordinates involved in operations
            dragStart: null // Stores the initial position before a drag begins
        };

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.viewer.scene.primitives.add(this.pointCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolygon: null,
            movingPolygonOutline: null,
            movingLabelPrimitive: null, // Label that updates during moving or dragging
            movingPoint: null,
            draggingPoint: null         // Currently dragged point primitive
        };

        this._areaRecords = [];
    }

    /**
     * Sets up input actions for polygon mode.
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
     * Removes input actions for polygon mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

    handlePolygonLeftClick(movement) {
        // use mouse move position for the position
        const cartesian = this.coordinate;

        if (!Cesium.defined(cartesian)) return;

        // Check if the measurement has ended
        if (this.flags.isPolygonEnd) {
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
            this.flags.isPolygonEnd = false;
        }

        if (!this.flags.isPolygonEnd) {
            const cartesian = this.coordinate;
            this.coords.cache.push(cartesian);

            // create point entity
            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            // check if the current position is very close to coordinate in groups, if yes then don't create new point
            const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
            if (!isNearPoint) {
                const point = createPointPrimitive(this.coordinate, color);
                point.id = generateId(this.coordinate, "polygon_point_pending");
                this.pointCollection.add(point);
            }

            // If three points create the polygon primitive
            if (this.coords.cache.length > 2) {
                // create polygon primitive
                if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
                if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
                const polygonGeometry = createPolygonGeometryInstance(this.coords.cache, "polygon");
                const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
                this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline primitive
                const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.cache, "polygon_outline");
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const polygonArea = this._computePolygonArea(this.coords.cache);
                const midPoint = Cesium.Cartesian3.midpoint(
                    this.coords.cache[0],
                    this.coords.cache[this.coords.cache.length - 1],
                    new Cesium.Cartesian3()
                );
                if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
                this.interactivePrimitives.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(this.coords.cache[0], this.coords.cache[this.coords.cache.length - 1], polygonArea));
                this.interactivePrimitives.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
                this.interactivePrimitives.movingLabelPrimitive.id = generateId(midPoint, "polygon_label");
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

        if (this.flags.isPolygonEnd) return;

        if (this.coords.cache.length > 2) {
            if (this.interactivePrimitives.movingPoint) this.pointCollection.remove(this.interactivePrimitives.movingPoint);
            const movingPoint = createPointPrimitive(cartesian, Cesium.Color.RED);
            movingPoint.id = generateId(cartesian, "polygon_moving_point");
            this.interactivePrimitives.movingPoint = this.pointCollection.add(movingPoint);

            // remove and create the polygon primitive
            if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
            if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
            const movingCoordinateDataCache = [...this.coords.cache, cartesian];
            const polygonGeometry = createPolygonGeometryInstance(movingCoordinateDataCache, "polygon_moving");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingCoordinateDataCache, "polygon_moving_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            const polygonArea = this._computePolygonArea(movingCoordinateDataCache);
            const midPoint = Cesium.Cartesian3.midpoint(
                movingCoordinateDataCache[0],
                movingCoordinateDataCache[movingCoordinateDataCache.length - 1],
                new Cesium.Cartesian3()
            );
            if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
            this.interactivePrimitives.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(movingCoordinateDataCache[0], movingCoordinateDataCache[movingCoordinateDataCache.length - 1], polygonArea));
            this.interactivePrimitives.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
            this.interactivePrimitives.movingLabelPrimitive.id = generateId(midPoint, "polygon_moving_label");
        }
    }

    handlePolygonRightClick(movement) {
        if (!this.flags.isPolygonEnd) {
            const cartesian = this.coordinate;

            if (!Cesium.defined(cartesian)) return;
            const color = Cesium.Color.fromRandom({ alpha: 1.0 });
            const point = createPointPrimitive(this.coordinate, color);
            point.id = generateId(this.coordinate, "polygon_point");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);
            this.coords.groups.push([...this.coords.cache]);

            // update pending point id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            if (pendingPoints && pendingPoints.length > 0) {
                pendingPoints.forEach(p => p.id = p.id.replace("_pending", ""));
            }

            // remove moving point
            if (this.interactivePrimitives.movingPoint) this.pointCollection.remove(this.interactivePrimitives.movingPoint);

            // remove and create the polygon primitive
            if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
            if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
            const polygonGeometry = createPolygonGeometryInstance(this.coords.cache, "polygon");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.cache, "polygon_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
            const polygonArea = this._computePolygonArea(this.coords.cache);
            const midPoint = Cesium.Cartesian3.midpoint(
                this.coords.cache[0],
                this.coords.cache[this.coords.cache.length - 1],
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
            this.flags.isPolygonEnd = true;

            // reset variables
            this.coords.cache.length = 0;
        }
    }

    handlePolygonDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0) {
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
            this.flags.isDragMode = true;

            this.interactivePrimitives.draggingPoint = pointPrimitive.primitive;
            this.coords.dragStart = pointPrimitive.primitive.position.clone();



            // set label not show
            const group = this.coords.groups.find(g => g.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart)));
            const midPoint = Cesium.Cartesian3.midpoint(group[0], group[group.length - 1], new Cesium.Cartesian3());

            if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);

            const targetLabelPrimitive = this.labelCollection._labels.find(label => Cesium.Cartesian3.equals(label.position, midPoint) && !label.id.includes("moving"));
            targetLabelPrimitive.show = false;

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handlePolygonDrag(movement, this.interactivePrimitives.draggingPoint, group);
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
        // const group = this.coords.groups.find(g => g.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart)));
        const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
        const movingCoordinateData = [...group]
        movingCoordinateData[positionIndex] = cartesian;

        // update polygon and label primitive
        if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
        if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
        // remove the polygon
        const polygonPrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id.startsWith("annotate") && p.geometryInstances.id.includes("polygon") && !p.geometryInstances.id.includes("moving"));
        if (polygonPrimitives.length > 0) {
            const targetPolygonPrimitiveSet = polygonPrimitives.filter(p => p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart)));
            if (targetPolygonPrimitiveSet.length > 0) {
                targetPolygonPrimitiveSet.forEach(p => {
                    this.viewer.scene.primitives.remove(p);
                });
            }
        }
        // create polygon primitive
        const polygonGeometry = createPolygonGeometryInstance(movingCoordinateData, "polygon_moving");
        const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
        this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

        // create polygon outline primitive
        const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingCoordinateData, "polygon_moving_outline");
        const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
        this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

        // update moving label primitive
        if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
        const polygonArea = this._computePolygonArea(movingCoordinateData);
        const midPoint = Cesium.Cartesian3.midpoint(
            movingCoordinateData[0],
            movingCoordinateData[movingCoordinateData.length - 1],
            new Cesium.Cartesian3()
        );
        this.interactivePrimitives.movingLabelPrimitive = this.labelCollection.add(createLabelPrimitive(movingCoordinateData[0], movingCoordinateData[movingCoordinateData.length - 1], polygonArea));
        this.interactivePrimitives.movingLabelPrimitive.text = `${polygonArea.toFixed(2)} m²`;
        this.interactivePrimitives.movingLabelPrimitive.id = generateId(midPoint, "polygon_moving_label");
    }

    handlePolygonDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.draggingPoint && this.flags.isDragMode) {
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) {
                console.error("No group coordinates found");
                return;
            }
            const group = this.coords.groups[groupIndex];
            // polygon and label primitives
            const polygonPrimitives = this.viewer.scene.primitives._primitives.filter(p => p.geometryInstances && p.geometryInstances.id.startsWith("annotate") && p.geometryInstances.id.includes("polygon") && !p.geometryInstances.id.includes("moving"));

            // remove the polygon primitive
            if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
            if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
            if (polygonPrimitives.length > 0) {
                const targetPolygonPrimitiveSet = polygonPrimitives.filter(p => p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart)));
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
            const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
            this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // create polygon primitive
            const polygonGeometry = createPolygonGeometryInstance(this.coords.groups[groupIndex], "polygon");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonPrimitive);
            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.groups[groupIndex], "polygon_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // update label primitive
            if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
            if (targetLabelPrimitive) {
                targetLabelPrimitive.show = true;
                const polygonArea = this._computePolygonArea(this.coords.groups[groupIndex]);
                const newMidPoint = Cesium.Cartesian3.midpoint(
                    this.coords.groups[groupIndex][0],
                    this.coords.groups[groupIndex][this.coords.groups[groupIndex].length - 1],
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
            this.interactivePrimitives.draggingPoint = null;
            this.flags.isDragMode = false;
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
        this.coordinate = null;

        this.pointerOverlay.style.display = 'none';

        this.flags.isPolygonEnd = false;
        this.flags.isDragMode = false;

        this.interactivePrimitives.draggingPoint = null;
        this.coords.dragStart = null;

        this.coords.cache = [];

        // remove the moving primitives
        if (this.interactivePrimitives.movingLabelPrimitive) this.labelCollection.remove(this.interactivePrimitives.movingLabelPrimitive);
        if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
        if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
        if (this.interactivePrimitives.movingPoint) this.pointCollection.remove(this.interactivePrimitives.movingPoint);

        // remove pending point
        this.pointCollection._pointPrimitives.filter(p => p?.id?.includes("pending")).forEach(p => this.pointCollection.remove(p));
    }
}

export { Polygon };

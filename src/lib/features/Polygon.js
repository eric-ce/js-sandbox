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
    createPolygonOutlineGeometryInstance,
    formatArea,
    getPickedObjectType
} from "../helper/helper.js";

class Polygon {
    /**
     * Creates a new Polygon instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.stateManager = stateManager;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,   // flag to check if the polygon is finished
            isDragMode: false      // flag to check if the polygon is in dragging mode
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            dragStart: null,    // Stores the initial position before a drag begins
            _areaRecords: [],   // Stores the area records of the polygon
        };

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPoint: null,              // Point primitive that updates during moving or dragging
            movingLabel: null,              // Label that updates during moving or dragging
            movingPolygon: null,            // Polygon primitive that updates during moving
            movingPolygonOutline: null,     // Polygon outline primitive that updates during moving
            dragPoint: null,                // Currently dragged point primitive
            dragPolygon: null,              // Currently dragged polygon primitive
            dragPolygonOutline: null,       // Currently dragged polygon outline primitive
            hoveredPoint: null,             // Hovered point primitive
            hoveredLabel: null,             // Hovered label primitive
        };
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


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    handlePolygonLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!Cesium.defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "polygon");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.flags.isMeasurementComplete) {
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            default:
                if (!this.flags.isDragMode) {
                    if (this.flags.isMeasurementComplete) {
                        this.flags.isMeasurementComplete = false;
                    }
                    // Initiate cache if it is empty, start a new group and assign cache to it
                    if (this.coords.cache.length === 0) {
                        // link both cache and groups to the same group
                        // when cache changed groups will be changed due to reference by address
                        const newGroup = [];
                        this.coords.groups.push(newGroup);
                        this.coords.cache = newGroup;
                    }

                    // create point primitive
                    const color = Cesium.Color.fromRandom({ alpha: 1.0 });
                    // check if the current position is very close to coordinate in groups, if yes then don't create new point
                    const isNearPoint = this.coords.groups.flat().some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.5); // doesn't matter with the first point, it mainly focus on the continue point
                    if (!isNearPoint) {
                        const point = createPointPrimitive(this.coordinate, color);
                        point.id = generateId(this.coordinate, "polygon_point_pending");
                        this.pointCollection.add(point);

                        // update coordinate data cache
                        this.coords.cache.push(this.coordinate);
                    }

                    // If three points create the polygon primitive
                    if (this.coords.cache.length > 2) {

                        // remove the moving polygon and polygon outline primitives
                        if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
                        this.interactivePrimitives.movingPolygon = null;
                        if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
                        this.interactivePrimitives.movingPolygonOutline = null;

                        // create polygon primitive
                        const polygonGeometry = createPolygonGeometryInstance(this.coords.cache, "polygon_pending");
                        const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
                        this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

                        // create polygon outline primitive
                        const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.cache, "polygon_outline_pending");
                        const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                        this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);
                    }
                }
                break;
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    handlePolygonMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!Cesium.defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        pickedObjects && updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        const isMeasuring = this.coords.cache.length > 2 && !this.flags.isMeasurementComplete;
        // const isMeasurementComplete = this.coords.groups.length > 0 && this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                if (this.interactivePrimitives.movingPoint) this.pointCollection.remove(this.interactivePrimitives.movingPoint);
                const movingPoint = createPointPrimitive(cartesian, Cesium.Color.RED);
                movingPoint.id = generateId(cartesian, "polygon_moving_point");
                this.interactivePrimitives.movingPoint = this.pointCollection.add(movingPoint);

                // remove and create the polygon primitive
                if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
                this.interactivePrimitives.movingPolygon = null;
                if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
                this.interactivePrimitives.movingPolygonOutline = null;

                // moving coordinate data
                const movingDataCache = [...this.coords.cache, cartesian];

                // create polygon primitive
                const polygonGeometry = createPolygonGeometryInstance(movingDataCache, "polygon_moving");
                const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
                this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline primitive
                const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(movingDataCache, "polygon_outline_moving");
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const polygonArea = this._computePolygonArea(movingDataCache);
                const midPoint = Cesium.Cartesian3.midpoint(movingDataCache[0], cartesian, new Cesium.Cartesian3());
                if (this.interactivePrimitives.movingLabel) {
                    this.interactivePrimitives.movingLabel.position = midPoint;
                    this.interactivePrimitives.movingLabel.text = formatArea(polygonArea);
                    this.interactivePrimitives.movingLabel.id = generateId(midPoint, "polygon_label_moving");
                    this.interactivePrimitives.movingLabel.showBackground = false;
                    this.interactivePrimitives.movingLabel.show = true;
                } else {
                    const label = createLabelPrimitive(movingDataCache[0], cartesian, polygonArea);
                    label.id = generateId(midPoint, "polygon_label_moving");
                    label.text = formatArea(polygonArea);
                    label.showBackground = false;
                    this.interactivePrimitives.movingLabel = this.labelCollection.add(label);
                }
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);  // highlight the line when hovering
                break;
        }
    }

    /**
     * Hover to the clamped line to highlight it when the mouse move over it
     * @param {*} pickedObjects - the picked objects from the drillPick method
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "polygon");

        // reset highlighting
        const resetHighlighting = () => {
            if (this.interactivePrimitives.hoveredPoint) {
                this.interactivePrimitives.hoveredPoint.outlineColor = Cesium.Color.RED;
                this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
                this.interactivePrimitives.hoveredPoint = null;
            }
            if (this.interactivePrimitives.hoveredLabel) {
                this.interactivePrimitives.hoveredLabel.fillColor = Cesium.Color.WHITE;
                this.interactivePrimitives.hoveredLabel = null;
            }
        };
        resetHighlighting();

        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = Cesium.Color.YELLOW;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = Cesium.Color.YELLOW;
                    this.interactivePrimitives.hoveredLabel = labelPrimitive;
                }
                break;
            default:
                break;
        }
    }


    /************************
     * RIGHT CLICK FEATURES *
     ************************/
    handlePolygonRightClick(movement) {
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!Cesium.defined(cartesian)) return;

            // update pending point id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(p => p.id && p.id.includes("pending"));
            pendingPoints.forEach(p => { p.id = p.id.replace("_pending", "") });
            // update pending label id
            const pendingLabels = this.labelCollection._labels.filter(l => l.id && l.id.includes("pending"));
            pendingLabels.forEach(l => { l.id = l.id.replace("_pending", "") });

            // remove moving point, polygon and polygon outline primitives
            if (this.interactivePrimitives.movingPoint) this.pointCollection.remove(this.interactivePrimitives.movingPoint);
            this.interactivePrimitives.movingPoint = null;
            if (this.interactivePrimitives.movingLabel) this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            this.interactivePrimitives.movingLabel = null;
            if (this.interactivePrimitives.movingPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygon);
            this.interactivePrimitives.movingPolygon = null;
            if (this.interactivePrimitives.movingPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.movingPolygonOutline);
            this.interactivePrimitives.movingPolygonOutline = null;

            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_multidistance_clamped_point") &&
                    !primitiveId.includes("moving");
            });

            if (!isPoint) {
                // create point
                const color = Cesium.Color.fromRandom({ alpha: 1.0 });
                const point = createPointPrimitive(this.coordinate, color);
                point.id = generateId(this.coordinate, "polygon_point");
                this.pointCollection.add(point);

                // update coordinate data cache
                this.coords.cache.push(this.coordinate);

                // create polygon 
                const polygonGeometry = createPolygonGeometryInstance(this.coords.cache, "polygon");
                const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline 
                const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.cache, "polygon_outline");
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
                this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const polygonArea = this._computePolygonArea(this.coords.cache);
                const midPoint = Cesium.Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cesium.Cartesian3());
                const label = createLabelPrimitive(midPoint, midPoint, polygonArea);
                label.text = formatArea(polygonArea);
                label.id = generateId(midPoint, "polygon_label");
                this.labelCollection.add(label);


                // log area result
                this.coords._areaRecords.push(polygonArea);
                this.logRecordsCallback(polygonArea.toFixed(2));
            }
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }
    }



    /*****************
     * DRAG FEATURES *
     *****************/
    handlePolygonDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.coords.groups.length > 0 && this.coords.cache.length === 0) { // when the measure is ended and with at least one completed measure
            const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
            const isPoint = pickedObjects.find(p => {
                const primitiveId = p.primitive.id;
                return typeof primitiveId === 'string' &&
                    primitiveId.startsWith("annotate_polygon_point") &&
                    !primitiveId.includes("moving");
            });

            // error handling: if no point primitives found then early exit
            if (!Cesium.defined(isPoint)) return;

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // Set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handlePolygonDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }
    }

    handlePolygonDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point no show, polygon and polygon outline primitive to remove 
            selectedPoint.primitive.show = false;
            const existedPolygon = this.viewer.scene.primitives._primitives.find(p =>
                p.geometryInstances &&
                p.geometryInstances.id.startsWith("annotate") &&
                p.geometryInstances.id.includes("polygon") &&
                !p.geometryInstances.id.includes("moving") &&
                p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart))
            );
            if (existedPolygon) {
                const existedPolygonPosition = existedPolygon.geometryInstances.geometry._polygonHierarchy.positions.slice();
                const existedLabel = this.labelCollection._labels.find(label =>
                    label.id &&
                    label.id.startsWith("annotate") &&
                    label.id.includes("label") &&
                    !label.id.includes("moving") &&
                    Cesium.Cartesian3.equals(label.position, Cesium.Cartesian3.midpoint(existedPolygonPosition[0], existedPolygonPosition[existedPolygonPosition.length - 1], new Cesium.Cartesian3()))
                );
                existedLabel.show = false;
                this.viewer.scene.primitives.remove(existedPolygon);
            }
            const existedPolygonOutline = this.viewer.scene.primitives._primitives.find(p =>
                p.geometryInstances &&
                p.geometryInstances.id.startsWith("annotate") &&
                p.geometryInstances.id.includes("polygon_outline") &&
                !p.geometryInstances.id.includes("moving") &&
                p.geometryInstances.geometry._polygonHierarchy.positions.some(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart))
            );
            if (existedPolygonOutline) this.viewer.scene.primitives.remove(existedPolygonOutline);

            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "polygon_point_moving");
            } else {      // if dragging point not existed, create a new point
                const color = Cesium.Color.fromRandom({ alpha: 1.0 });
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), color);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "polygon_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // moving coordinate data
            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];
            const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
            const dragDataCache = [...group];
            dragDataCache[positionIndex] = cartesian;

            // recreate the moving polygon and polygon outline primitives
            // remove the moving polygon and polygon outline primitives
            if (this.interactivePrimitives.dragPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygon);
            this.interactivePrimitives.dragPolygon = null;
            if (this.interactivePrimitives.dragPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygonOutline);
            this.interactivePrimitives.dragPolygonOutline = null;


            // create polygon primitive
            const polygonGeometry = createPolygonGeometryInstance(dragDataCache, "polygon_moving");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.interactivePrimitives.dragPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(dragDataCache, "polygon_outline_moving");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.interactivePrimitives.dragPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create or update drag label primitive
            const polygonArea = this._computePolygonArea(dragDataCache);
            const midPoint = Cesium.Cartesian3.midpoint(dragDataCache[0], dragDataCache[dragDataCache.length - 1], new Cesium.Cartesian3());
            if (this.interactivePrimitives.dragLabel) {
                this.interactivePrimitives.dragLabel.position = midPoint;
                this.interactivePrimitives.dragLabel.text = formatArea(polygonArea);
                this.interactivePrimitives.dragLabel.id = generateId(midPoint, "polygon_label_moving");
                this.interactivePrimitives.dragLabel.showBackground = false;
                this.interactivePrimitives.dragLabel.show = true
            } else {
                const label = createLabelPrimitive(dragDataCache[0], dragDataCache[dragDataCache.length - 1], polygonArea);
                label.id = generateId(midPoint, "polygon_label_moving");
                label.text = formatArea(polygonArea);
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label);
            }
        }
    }

    handlePolygonDragEnd(movement) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            const groupIndex = this.coords.groups.findIndex(group => group.some(cart => Cesium.Cartesian3.equals(cart, this.coords.dragStart)));
            if (groupIndex === -1) return;
            const group = this.coords.groups[groupIndex];

            // remove and reset drag point polygon, polygon outline and label primitives 
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            if (this.interactivePrimitives.dragPolygon) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygon);
            this.interactivePrimitives.dragPolygon = null;
            if (this.interactivePrimitives.dragPolygonOutline) this.viewer.scene.primitives.remove(this.interactivePrimitives.dragPolygonOutline);
            this.interactivePrimitives.dragPolygonOutline = null;
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;

            // update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p => p.id && p.id.includes("polygon_point") && Cesium.Cartesian3.equals(p.position, this.coords.dragStart));
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "polygon_point");
            }

            // find and update existed label primitive
            const existedMidPoint = Cesium.Cartesian3.midpoint(group[0], group[group.length - 1], new Cesium.Cartesian3());
            const existedLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.startsWith("annotate") &&
                label.id.includes("label") &&
                !label.id.includes("moving") &&
                Cesium.Cartesian3.equals(label.position, existedMidPoint)
            );

            // update this.coords.groups data
            const positionIndex = group.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
            this.coords.groups[groupIndex][positionIndex] = this.coordinate;

            // update existed label primitive
            const polygonArea = this._computePolygonArea(group);
            const newMidPoint = Cesium.Cartesian3.midpoint(group[0], group[group.length - 1], new Cesium.Cartesian3());
            if (existedLabel) {
                existedLabel.show = true;
                existedLabel.position = newMidPoint;
                existedLabel.text = formatArea(polygonArea);
                existedLabel.id = generateId(existedMidPoint, "polygon_label");
            }

            // create polygon primitive
            const polygonGeometry = createPolygonGeometryInstance(this.coords.groups[groupIndex], "polygon");
            const polygonPrimitive = createPolygonPrimitive(polygonGeometry, Cesium.Color.GREEN.withAlpha(0.8), this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonPrimitive);
            // create polygon outline primitive
            const polygonOutlineGeometry = createPolygonOutlineGeometryInstance(this.coords.groups[groupIndex], "polygon_outline");
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(polygonOutlineGeometry, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // update log records
            this.coords._areaRecords.push(polygonArea);
            this.logRecordsCallback(polygonArea.toFixed(2));

            // reset flag
            this.flags.isDragMode = false;
        }
        // set back to default polygon mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handlePolygonMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * To compute the area of the polygon
     * THIS METHOD IS PROVIDED BY CESIUM
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

        const pointer = this.stateManager.getOverlayState('pointer')
        pointer && (pointer.style.display = 'none');

        // reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        // reset coords
        this.coords.cache = [];
        this.coords.dragStart = null;
        this.coords.dragStartToCanvas = null;
        this.coords._areaRecords = [];

        // reset interactive primitives
        this.interactivePrimitives.movingPoint = null;
        this.interactivePrimitives.movingLabel = null;
        this.interactivePrimitives.movingPolygon = null;
        this.interactivePrimitives.movingPolygonOutline = null;
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragPolygon = null;
        this.interactivePrimitives.dragPolygonOutline = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}

export { Polygon };

import {
    Cartesian2,
    Cartesian3,
    defined,
    ScreenSpaceEventType,
    PolygonHierarchy,
    PolygonPipeline
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    createPolygonPrimitive,
    createPolygonOutlinePrimitive,
    formatArea,
    getPickedObjectType,
    generateIdByTimestamp,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";

class Polygon extends MeasureModeBase {
    /**
     * Creates a new Polygon instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {Object} stateManager - The state manager holding various tool states.
     * @param {Function} logRecordsCallback - Callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,   // flag to check if the polygon is finished
            isDragMode: false      // flag to check if the polygon is in dragging mode
        }

        // Coordinate management and related properties
        this.coords = {
            cache: [],          // Stores temporary coordinates during operations
            groups: [],         // Tracks all coordinates involved in operations
            groupCounter: 0,        // Counter for the number of groups
            dragStart: null,    // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
            _records: []                // Stores the area records
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPoint: null,              // Point primitive that updates during moving or dragging
            movingLabels: [],               // Array of moving labels
            movingPolygon: null,            // Polygon primitive that updates during moving
            movingPolygonOutline: null,     // Polygon outline primitive that updates during moving
            dragPoint: null,                // Currently dragged point primitive
            dragPolygon: null,              // Currently dragged polygon primitive
            dragPolygonOutline: null,       // Currently dragged polygon outline primitive
            dragLabels: [],                 // Array of dragging labels
            hoveredPoint: null,             // Hovered point primitive
            hoveredLabel: null,             // Hovered label primitive
        };
    }

    /**
     * Configures input actions for the polygon mode.
     */
    setupInputActions() {
        super.setupInputActions();
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place or remove points.
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement event.
     */
    handleLeftClick(movement) {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "polygon");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                if (this.coords.cache.length === 0) { // only when it is not during measuring can edit the label. 
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                break;
            default:
                if (!this.flags.isDragMode) {
                    this.startMeasure();
                }
                break;
        }
    }

    /**
     * Initiates the measurement process by starting a new group (if needed) and adding a point primitive.
     */
    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
        }
        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // link both cache and groups to the same group
            // when cache changed groups will be changed due to reference by address
            const newGroup = {
                id: generateIdByTimestamp(),
                coordinates: [],
                labelNumberIndex: this.coords.groupCounter,
            };
            this.coords.groups.push(newGroup);
            this.coords.cache = newGroup.coordinates;
            this.coords.groupCounter++;
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("random"), "polygon_point_pending");
        this.pointCollection.add(point);

        // Update the coordinate cache
        this.coords.cache.push(this.coordinate);

        // If three points create the polygon primitive
        if (this.coords.cache.length > 2) {
            // Remove the moving polygon and polygon outline primitives
            super.removeMovingPrimitives({ removeLines: false, removeLabels: false, removePolygon: true });

            // Create polygon primitive
            const polygonPrimitive = createPolygonPrimitive(this.coords.cache, "polygon_pending", this.stateManager.getColorState("polygon"), this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // Create polygon outline primitive
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(this.coords.cache, "polygon_outline_pending", this.stateManager.getColorState("polygonOutline"), this.cesiumPkg.Primitive);
            this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to update the current coordinate, pointer overlay, and interactives.
     *
     * @param {{endPosition: Cesium.Cartesian2}} movement - The mouse movement event.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!defined(cartesian)) return;
        // update coordinate
        this.coordinate = cartesian;

        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects)

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coords.cache.length > 2 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                super.removeMovingPrimitives({ removePoint: true, removeLines: false, removeLabels: false, removePolygon: true });

                const movingPoint = createPointPrimitive(cartesian, this.stateManager.getColorState("pointColor"), "polygon_point_moving");
                this.interactivePrimitives.movingPoint = this.pointCollection.add(movingPoint);


                // moving coordinate data
                const movingDataCache = [...this.coords.cache, cartesian];

                // create polygon primitive
                const polygonPrimitive = createPolygonPrimitive(
                    movingDataCache,
                    "polygon_moving",
                    this.stateManager.getColorState("polygon"),
                    this.cesiumPkg.Primitive
                );
                this.interactivePrimitives.movingPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

                // create polygon outline primitive
                const polygonOutlinePrimitive = createPolygonOutlinePrimitive(
                    movingDataCache,
                    "polygon_outline_moving",
                    this.stateManager.getColorState("polygonOutline"),
                    this.cesiumPkg.Primitive
                );
                this.interactivePrimitives.movingPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

                // create label primitive
                const area = this._computePolygonArea(movingDataCache);
                const midPoint = Cartesian3.midpoint(movingDataCache[0], cartesian, new Cartesian3());
                const labelPrimitive = this.interactivePrimitives.movingLabels[0];
                if (labelPrimitive) {
                    labelPrimitive.position = midPoint;
                    labelPrimitive.text = formatArea(area);
                    labelPrimitive.id = generateId(midPoint, "polygon_label_moving");
                    labelPrimitive.showBackground = false;
                    labelPrimitive.show = true;
                } else {
                    const label = createLabelPrimitive(movingDataCache[0], cartesian, area);
                    label.id = generateId(midPoint, "polygon_label_moving");
                    label.text = formatArea(area);
                    label.showBackground = false;
                    const labelPrimitive = this.labelCollection.add(label);
                    labelPrimitive.positions = movingDataCache; // store the positions in the primitive
                    this.interactivePrimitives.movingLabels.push(labelPrimitive);
                }
                break;
            default:
                this.handleHoverHighlighting(pickedObjects[0]);  // highlight the line when hovering
                break;
        }
    }

    /**
     * Highlights primitives (point or label) when the mouse hovers over them.
     * @param {*} pickedObject - The picked object from the drillPick method.
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "polygon");

        // reset highlighting
        // const resetHighlighting = () => {
        //     if (this.interactivePrimitives.hoveredPoint) {
        //         this.interactivePrimitives.hoveredPoint.outlineColor = Color.RED;
        //         this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
        //         this.interactivePrimitives.hoveredPoint = null;
        //     }
        //     if (this.interactivePrimitives.hoveredLabel) {
        //         this.interactivePrimitives.hoveredLabel.fillColor = Color.WHITE;
        //         this.interactivePrimitives.hoveredLabel = null;
        //     }
        // };
        // resetHighlighting();
        super.resetHighlighting();

        const hoverColor = this.stateManager.getColorState("hover");

        switch (pickedObjectType) {
            case "point":  // highlight the point when hovering
                const pointPrimitive = pickedObject.primitive;
                if (pointPrimitive) {
                    pointPrimitive.outlineColor = hoverColor;
                    pointPrimitive.outlineWidth = 2;
                    this.interactivePrimitives.hoveredPoint = pointPrimitive;
                }
                break;
            case "label":   // highlight the label when hovering
                const labelPrimitive = pickedObject.primitive;
                if (labelPrimitive) {
                    labelPrimitive.fillColor = hoverColor;
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
    /**
     * Handles right-click events to finalize the polygon measurement.
     *
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement event.
     */
    handleRightClick(movement) {
        if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.coordinate;
            if (!defined(cartesian)) return;

            // Update pending points id
            const pendingPoints = this.pointCollection._pointPrimitives.filter(
                p => p.id && p.id.includes("pending")
            );
            pendingPoints.forEach(p => {
                p.id = p.id.replace("_pending", "");
            });

            // Update pending labels id
            const pendingLabels = this.labelCollection._labels.filter(l =>
                l.id && l.id.includes("pending")
            );
            pendingLabels.forEach(l => {
                l.id = l.id.replace("_pending", "")
            });

            // remove moving point, labels, polygon and polygon outline primitives
            super.removeMovingPrimitives({ removePoint: true, removeLines: false, removeLabels: true, removePolygon: true });

            // Check if the last point is near any existing point
            const isNearPoint = this.coords.groups
                .flatMap(group => group.coordinates)
                .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);

            if (isNearPoint) return;

            // create point
            const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("random"), "polygon_point");
            this.pointCollection.add(point);

            // update coordinate data cache
            this.coords.cache.push(this.coordinate);

            // create polygon 
            const polygonPrimitive = createPolygonPrimitive(
                this.coords.cache,
                "polygon",
                this.stateManager.getColorState("polygon"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(polygonPrimitive);

            // create polygon outline 
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(
                this.coords.cache,
                "polygon_outline",
                this.stateManager.getColorState("polygonOutline"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // create label primitive
            const area = this._computePolygonArea(this.coords.cache);
            const midPoint = Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cartesian3());
            const label = createLabelPrimitive(midPoint, midPoint, area);
            label.text = formatArea(area);
            label.id = generateId(midPoint, "polygon_label");
            const labelPrimitive = this.labelCollection.add(label);
            labelPrimitive.positions = this.coords.cache; // store the positions in the primitive

            // log area result
            this.updateLogRecords(area);

            // set flags
            this.flags.isMeasurementComplete = true;

            // Clear cache
            this.coords.cache = [];
        }
    }



    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates the drag action for a polygon point.
     *
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement event at drag start.
     */
    handleDragStart(movement) {
        super._initializeDragStart(movement, "polygon");
    }

    /**
     * Processes the drag action, updating polygon and related primitives dynamically.
     * @param {{endPosition: Cesium.Cartesian2}} movement - The mouse movement event.
     * @param {Object} selectedPoint - The point primitive being dragged.
     */
    handleDragMove(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point no show, polygon and polygon outline primitive to remove 
            selectedPoint.primitive.show = false;

            // Find and remove existed polygon primitive
            const existedPolygon = this.viewer.scene.primitives._primitives.find(p =>
                p.id &&
                p.id.startsWith("annotate_polygon") &&
                !p.id.includes("moving") &&
                p.positions.some(pos => Cartesian3.equals(pos, this.coords.dragStart))
            );
            existedPolygon && this.viewer.scene.primitives.remove(existedPolygon);

            // Find and remove existed polygon outline primitive
            const existedPolygonOutline = this.viewer.scene.primitives._primitives.find(p =>
                p.id &&
                p.id.startsWith("annotate") &&
                p.id.includes("polygon_outline") &&
                !p.id.includes("moving") &&
                p.positions.some(pos => Cartesian3.equals(pos, this.coords.dragStart))
            );
            existedPolygonOutline && this.viewer.scene.primitives.remove(existedPolygonOutline);

            // Find the group data that is being dragged
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)));
            if (!group) return;

            // Find existed label and set it to no show
            const oldMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[group.coordinates.length - 1], new Cartesian3());
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_polygon_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, oldMidPoint)
            )
            if (existedLabel) existedLabel.show = false;


            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = "none";

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;

            // create or update dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("move");
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "polygon_point_moving");
            } else {      // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), this.stateManager.getColorState("random"), "polygon_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // Remove the drag moving polygon and polygon outline primitives
            super.removeDragMovingPrimitives({ removeLines: false, removeLabels: false, removePolygon: true });

            // Set moving coordinate data
            const positionIndex = group.coordinates.findIndex(pos => Cartesian3.equals(pos, this.coords.dragStart));
            const dragMovingData = [...group.coordinates];  // Shallow copy of the group coordinates; DO NOT update the original group coordinates yet
            dragMovingData[positionIndex] = cartesian;

            // Create drag moving polygon primitive
            const polygonPrimitive = createPolygonPrimitive(
                dragMovingData,
                "polygon_moving",
                this.stateManager.getColorState("polygon"),
                this.cesiumPkg.Primitive
            );
            this.interactivePrimitives.dragPolygon = this.viewer.scene.primitives.add(polygonPrimitive);

            // Create drag moving polygon outline primitive
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(
                dragMovingData,
                "polygon_outline_moving",
                this.stateManager.getColorState("polygonOutline"),
                this.cesiumPkg.Primitive
            );
            this.interactivePrimitives.dragPolygonOutline = this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // Create or update drag moving  label primitive
            const polygonArea = this._computePolygonArea(dragMovingData);
            const newMidPoint = Cartesian3.midpoint(dragMovingData[0], dragMovingData[dragMovingData.length - 1], new Cartesian3());
            const labelPrimitive = this.interactivePrimitives.dragLabels[0];
            if (labelPrimitive) {
                labelPrimitive.position = newMidPoint;
                labelPrimitive.text = formatArea(polygonArea);  // update label text using format area because default using format distance
                labelPrimitive.id = generateId(newMidPoint, "polygon_label_moving");
                labelPrimitive.showBackground = false;
                labelPrimitive.show = true
            } else {
                const label = createLabelPrimitive(dragMovingData[0], dragMovingData[dragMovingData.length - 1], polygonArea);
                label.id = generateId(newMidPoint, "polygon_label_moving");
                label.text = formatArea(polygonArea);   // update label text using format area because default using format distance
                label.showBackground = false;
                const labelPrimitive = this.labelCollection.add(label);
                labelPrimitive.positions = dragMovingData; // store the positions in the primitive
                this.interactivePrimitives.dragLabels.push(labelPrimitive);
            }
        }
    }

    /**
     * Concludes the drag action by finalizing positions and updating primitives.
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement event at drag end.
     */
    handleDragEnd(movement) {
        // Enable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const groupIndex = this.coords.groups.findIndex(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)))
            if (groupIndex === -1) return; // Error handling: no group found
            const group = this.coords.groups[groupIndex];

            // Remove dragging point, dragging lines and labels
            super.removeDragMovingPrimitives({ removePoint: true, removeLines: false, removeLabels: true, removePolygon: true });

            // Update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.includes("polygon_point") &&
                Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "polygon_point");
            }


            // Find the existed label primitive
            const oldMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[group.coordinates.length - 1], new Cartesian3());
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_polygon_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, oldMidPoint)
            );

            // Update this.coords.groups data
            const positionIndex = group.coordinates.findIndex(pos => Cartesian3.equals(pos, this.coords.dragStart));
            group.coordinates[positionIndex] = this.coordinate;

            // create polygon primitive
            const polygonPrimitive = createPolygonPrimitive(
                group.coordinates,
                "polygon",
                this.stateManager.getColorState("polygon"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(polygonPrimitive);
            // create polygon outline primitive
            const polygonOutlinePrimitive = createPolygonOutlinePrimitive(
                group.coordinates,
                "polygon_outline",
                this.stateManager.getColorState("polygonOutline"),
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(polygonOutlinePrimitive);

            // Update existed label primitive
            const area = this._computePolygonArea(group.coordinates);
            const newMidPoint = Cartesian3.midpoint(group.coordinates[0], group.coordinates[group.coordinates.length - 1], new Cartesian3());
            if (existedLabel) {
                existedLabel.show = true;
                existedLabel.showBackground = true;
                existedLabel.position = newMidPoint;
                existedLabel.text = formatArea(area); // update label text using format area because default using format distance
                existedLabel.id = generateId(newMidPoint, "polygon_label");
            }

            // update log records
            this.updateLogRecords(area);

            // reset flag
            this.flags.isDragMode = false;
        }
        // set back to default polygon mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, ScreenSpaceEventType.MOUSE_MOVE);
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Computes the area of the polygon based on Cartesian3 coordinates.
     * THIS METHOD IS PROVIDED BY CESIUM
     *
     * @param {Cartesian3[]} cartesianArray - Array of Cartesian3 coordinates defining the polygon.
     * @returns {Number} The area of the polygon.
     */
    _computePolygonArea(cartesianArray) {
        let hierarchy = new PolygonHierarchy(cartesianArray);

        // let hierarchy = polygon.polygon.hierarchy._value;
        let indices = PolygonPipeline.triangulate(hierarchy.positions, hierarchy.holes);

        let area = 0;
        for (let i = 0; i < indices.length; i += 3) {
            let vector1 = hierarchy.positions[indices[i]];
            let vector2 = hierarchy.positions[indices[i + 1]];
            let vector3 = hierarchy.positions[indices[i + 2]];
            let vectorC = Cartesian3.subtract(vector2, vector1, new Cartesian3());
            let vectorD = Cartesian3.subtract(vector3, vector1, new Cartesian3());
            let areaVector = Cartesian3.cross(vectorC, vectorD, new Cartesian3());
            area += Cartesian3.magnitude(areaVector) / 2.0;
        }
        return area;
    }

    /**
     * Updates the log records with the area of the polygon.
     * @param {Number} area - The area of the polygon.
     * @returns {Number} The area of the polygon.
     */
    updateLogRecords(area) {
        // update log records in logBox
        this.logRecordsCallback(area.toFixed(2));

        // update this.coords._records
        this.coords._records.push(area);

        return area;
    }

    resetValue() {
        super.resetValue();
    }
}

export { Polygon };

// import * as Cesium from "cesium";
import {
    Cartesian3,
    Cartesian2,
    defined,
    ScreenSpaceEventType,
    SceneTransforms,
} from "cesium";
import {
    cartesian3ToCartographicDegrees,
    updatePointerOverlay,
    generateId,
    createPointPrimitive,
    getPickedObjectType,
    createLabelPrimitive,
    editableLabel,
    generateIdByTimestamp,
} from "../helper/helper.js";
import MeasureModeBase from "./MeasureModeBase.js";


/**
 * @typedef {Object} Group
 * @property {string|number} id - Group identifier
 * @property {Cartesian3[]} coordinates - Array of position coordinates
 * @property {number} labelNumber - Label counter for the group
 */


class Points extends MeasureModeBase {
    /**
     * Creates a new Points instance.
     * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
     * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {Object} stateManager - The state manager holding various tool states.
     * @param {Function} logRecordsCallback - The callback function to log records.
     * @param {Object} cesiumPkg - The Cesium package object.
     */
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        super(viewer, handler, stateManager, logRecordsCallback, cesiumPkg);

        this.coordinateInfoOverlay = this.createCoordinateInfoOverlay();

        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
        };

        // Coordinate management and related properties
        this.coords = {
            cache: [],                  // Stores temporary coordinates during operations
            groups: [],                 // Stores temporary coordinates during operations
            groupCounter: 0,            // Counter for the number of groups
            dragStart: null,            // Stores the initial position before a drag begins
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
        };

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            dragPoint: null,        // Currently dragged point primitive
            dragLabels: [],         // Array of dragging labels 
            hoveredPoint: null,     // Point that is currently hovered
            hoveredLabel: null      // Label that is currently hovered
        }
    }

    /**
     * Configures input actions for the points bookmark mode.
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
        const pickedObjectType = getPickedObjectType(pickedObject, "bookmark");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                editableLabel(this.viewer.container, pickedObject.primitive);
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                const primitiveToRemove = this.pointCollection._pointPrimitives.find(primitive => primitive.id === pointPrimitive.id);

                if (primitiveToRemove) {
                    // remove the point
                    this.pointCollection.remove(primitiveToRemove);

                    // remove the label
                    const labelToRemove = this.labelCollection._labels.find(label => Cartesian3.equals(label.position, primitiveToRemove.position));
                    if (labelToRemove) this.labelCollection.remove(labelToRemove);

                    // Find the group of the point
                    const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, primitiveToRemove.position)));
                    if (!group) return; // Error handling: group not found early exit

                    // remove the point position from group coordinates
                    const positionIndex = group.coordinates.findIndex(pos => Cartesian3.equals(pos, primitiveToRemove.position));
                    if (positionIndex !== -1) group.coordinates.splice(positionIndex, 1);

                    // log the points records
                    this.updateLogRecords(primitiveToRemove.position, "remove");
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
     * Starts the measurement process by creating a new group if needed,
     * adding a point primitive, and logging the record.
     */
    startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
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

        // create point primitive
        const point = createPointPrimitive(this.coordinate, this.stateManager.getColorState("pointColor"), "bookmark_point");
        this.pointCollection.add(point);

        // update the coords cache
        this.coords.cache.push(this.coordinate);

        // Find the group
        const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coordinate)));

        // Create label primitive
        const labelString = `Point ${group.labelNumberIndex + 1}`;
        const label = createLabelPrimitive(this.coordinate, this.coordinate, labelString)
        label.id = generateId(this.coordinate, "bookmark_label");
        this.labelCollection.add(label);

        // log the points records
        this.updateLogRecords(this.coordinate, "add");

        // set flag that the measure has ended
        this.flags.isMeasurementComplete = true;
        this.coords.cache = [];
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to update the moving pointer and coordinate overlay.
     * @param {{endPosition: Cesium.Cartesian2}} movement - The mouse movement event.
     */
    handleMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
        if (!defined(cartesian)) return;

        // update coordinate
        this.coordinate = cartesian;

        // pick objects
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects);

        this.handleHoverHighlighting(pickedObjects[0]);

        // update coordinateInfoOverlay
        this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
    }

    /**
     * Highlights the primitive under the mouse based on the picked object type.
     * @param {*} pickedObject - The object picked by the drillPick method.
     */
    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "bookmark");

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
        // }
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

    /*****************
     * DRAG FEATURES *
     *****************/
    /**
     * Initiates the drag action for a point.
     * @param {{position: Cesium.Cartesian2}} movement - The mouse movement event at drag start.
     */
    handleDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        // pick the point primitive
        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);

        const isPoint = pickedObjects.find(p => {
            const primitiveId = p.primitive.id;
            return typeof primitiveId === 'string' &&
                primitiveId.startsWith("annotate_bookmark_point") &&
                !primitiveId.includes("moving");
        });

        // Error handling: if no point primitives found then early exit
        if (!defined(isPoint)) return;

        // Disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;

        // Set drag start position
        this.coords.dragStart = isPoint.primitive.position.clone();
        this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

        // set move event for dragging
        this.handler.setInputAction((movement) => {
            this.handleDrag(movement, isPoint);
        }, ScreenSpaceEventType.MOUSE_MOVE);
    };

    /**
     * Processes the drag action by updating the dragging point and label primitives.
     * @param {Object} movement - The mouse movement event data.
     * @param {Object} selectedPoint - The point primitive being dragged.
     */
    handleDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_bookmark_label") &&
                !l.id.includes("moving") &&
                Cartesian3.equals(l.position, this.coords.dragStart)
            );
            if (existedLabel) existedLabel.show = false;
            selectedPoint.primitive.show = false;

            // Set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = 'none';

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!defined(cartesian)) return;
            this.coordinate = cartesian;    // update coordinate

            // Update or create dragging point primitive
            if (this.interactivePrimitives.dragPoint) {     // if dragging point existed, update the point
                // highlight the point primitive
                this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("move");
                this.interactivePrimitives.dragPoint.outlineWidth = 2;
                // update moving point primitive
                this.interactivePrimitives.dragPoint.position = cartesian;
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "bookmark_point_moving");
            } else {    // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), this.stateManager.getColorState("pointColor"), "bookmark_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // create or update dragging label primitive
            // const positionIndex = this.coords.groups.findIndex(pos => Cartesian3.equals(pos, this.coords.dragStart));

            // const labelPrimitive = this.interactivePrimitives.dragLabels[0];
            // if (labelPrimitive) {    // if dragging label existed, update the label
            //     labelPrimitive.id = generateId(cartesian, "bookmark_label_moving");
            //     labelPrimitive.position = cartesian;
            //     labelPrimitive.showBackground = false;
            // } else {    // if dragging label not existed, create a new label
            //     const labelString = `Point`;
            //     const label = createLabelPrimitive(cartesian, cartesian, "Point")
            //     label.id = generateId(cartesian, "bookmark_label_moving");
            //     label.showBackground = false;
            //     const labelPrimitive = this.labelCollection.add(label);
            //     this.interactivePrimitives.dragLabels.push(labelPrimitive);
            // }

            // update coordinateInfoOverlay
            this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
        }
    };

    /**
     * Concludes the drag action by updating primitives and the coordinates cache.
     */
    handleDragEnd() {
        // Enable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // Find the group containing the dragged point
            const group = this.coords.groups.find(group => group.coordinates.some(cart => Cartesian3.equals(cart, this.coords.dragStart)))
            if (!group) return;     // Error handling: no group found

            // Remove dragging point, and dragging labels
            super.removeDragMovingPrimitives({ removePoint: true, removeLines: false, removeLabel: true });

            // Update existed point primitive
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.startsWith("annotate_bookmark_point") &&
                Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.position = this.coordinate;
                existedPoint.id = generateId(this.coordinate, "bookmark_point");
            }

            // Find and update the existing label primitive
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_bookmark_label") &&
                Cartesian3.equals(l.position, this.coords.dragStart)
            );
            if (existedLabel) {
                existedLabel.id = generateId(this.coordinate, "bookmark_label");
                existedLabel.position = this.coordinate;
                existedLabel.show = true;
                existedLabel.showBackground = true;
            }

            // Update the coordinate data
            const positionIndex = group.coordinates.findIndex(cart => Cartesian3.equals(cart, this.coords.dragStart));
            if (positionIndex !== -1) {
                group.coordinates[positionIndex] = this.coordinate;
            }

            // log the points records
            this.updateLogRecords(this.coordinate, "update");

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handleMouseMove(movement);
        }, ScreenSpaceEventType.MOUSE_MOVE);
    };


    /******************
     * OTHER FEATURES *
     ******************/
    /**
     * Creates the coordinate info overlay element.
     * @returns {HTMLElement} The created coordinate info overlay element.
     */
    createCoordinateInfoOverlay() {
        this.coordinateInfoOverlay = document.createElement("div");
        this.coordinateInfoOverlay.className = "coordinate-info-overlay";
        this.viewer.container.appendChild(this.coordinateInfoOverlay);
        this.coordinateInfoOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        return this.coordinateInfoOverlay;
    }

    /**
     * Updates the coordinate info overlay with the current coordinate information.
     * @param {Cesium.Cartesian3} cartesian - The current Cartesian3 coordinate.
     */
    updateCoordinateInfoOverlay(cartesian) {
        const cartographicDegrees = cartesian3ToCartographicDegrees(cartesian);
        const displayInfo = `Lat: ${cartographicDegrees.latitude.toFixed(6)}<br>Lon: ${cartographicDegrees.longitude.toFixed(6)} <br>Alt: ${cartographicDegrees.height.toFixed(2)}`;
        this.coordinateInfoOverlay.innerHTML = displayInfo;

        let screenPosition;
        if (SceneTransforms.worldToWindowCoordinates) {
            screenPosition = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, cartesian);
        } else if (SceneTransforms.wgs84ToWindowCoordinates) {
            screenPosition = SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, cartesian);
        } else {
            console.error("SceneTransforms.worldToWindowCoordinates or SceneTransforms.wgs84ToWindowCoordinates is not available in the current version of Cesium.");
        }
        this.coordinateInfoOverlay.style.display = 'block';
        this.coordinateInfoOverlay.style.left = `${screenPosition.x + 20}px`;
        this.coordinateInfoOverlay.style.top = `${screenPosition.y - 20}px`;
        this.coordinateInfoOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.coordinateInfoOverlay.style.color = 'white';
        this.coordinateInfoOverlay.style.borderRadius = '4px';
        this.coordinateInfoOverlay.style.padding = '8px';
        this.coordinateInfoOverlay.style.fontFamily = 'Roboto, sans-serif';
    }


    /********************
     * HELPER FUNCTIONS *
     ********************/
    /**
     * Updates the bookmark log records with the provided coordinate information.
     * @param {Cesium.Cartesian3} cartesian - The Cartesian3 coordinate.
     * @param {string} action - The action type (e.g., "add", "remove", or "update").
     */
    updateLogRecords(cartesian, action) {
        const cartographicDegrees = cartesian3ToCartographicDegrees(cartesian);
        this.logRecordsCallback({ [action]: this._formatCartographicDegrees(cartographicDegrees) });
    }

    /**
     * Formats the cartographic degrees into a structured object.
     * @param {{latitude: number, longitude: number, height: number}} cartographicDegrees - The cartographic degrees.
     * @returns {{ "lat, lon": string }} An object containing the formatted latitude and longitude.
     */
    _formatCartographicDegrees(cartographicDegrees) {
        const { longitude, latitude } = cartographicDegrees;
        if (!longitude || !latitude) return;
        return {
            "lat, lon": `${latitude.toFixed(6)},${longitude.toFixed(6)} `,
        }
    }

    resetValue() {
        super.resetValue();
        this.coordinateInfoOverlay.style.display = 'none';
    }
}

export { Points };
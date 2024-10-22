import * as Cesium from "cesium";
import {
    removeInputActions,
    cartesian3ToCartographicDegrees,
    updatePointerOverlay,
    generateId,
    createPointPrimitive,
    getPickedObjectType,
    createLabelPrimitive,
    editableLabel,
} from "../helper/helper.js";

/**
 * Represents points bookmark tool in Cesium.
 * @class
 * @param {Cesium.Viewer} viewer - The Cesium Viewer instance.
 * @param {Cesium.ScreenSpaceEventHandler} handler - The event handler for screen space.
 * @param {HTMLElement} pointerOverlay - The HTML element for displaying names.
 * @param {Function} logRecordsCallback - The callback function to log records.
 */
class Points {
    /**
     * Creates a new Point instance.
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
        this.coordinateInfoOverlay = this.createCoordinateInfoOverlay();

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        // flags
        this.flags = {
            isDragMode: false
        };

        // Coordinate management and related properties
        this.coords = {
            groups: [],      // Stores temporary coordinates during operations
            dragStart: null // Stores the initial position before a drag begins
        }

        // lookup and set Cesium primitives collections
        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            dragPoint: null,    // Currently dragged point primitive
            dragLabel: null,    // Currently dragged label primitive
            hoveredPoint: null,
            hoveredLabel: null
        }
    }

    /**
     * Sets up input actions for points mode.
     */
    setupInputActions() {
        removeInputActions(this.handler);

        this.handler.setInputAction((movement) => {
            this.handlePointsLeftClick(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction((movement) => {
            this.handlePointsMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction((movement) => {
            this.handlePointsDragStart(movement);
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        this.handler.setInputAction(() => {
            this.handlePointsDragEnd();
        }, Cesium.ScreenSpaceEventType.LEFT_UP);
    }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points, if selected point existed remove the point
     * @param {{position: Cesium.Cartesian2}} movement - The movement event from the mouse.
     */
    handlePointsLeftClick(movement) {
        const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
        const pickedObjectType = getPickedObjectType(pickedObject, "bookmark");

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                editableLabel(this.viewer.container, pickedObject.primitive);
                break;
            case "point":
                const pointPrimitive = pickedObject.primitive;
                const primtiveToRemove = this.pointCollection._pointPrimitives.find(primitive => primitive.id === pointPrimitive.id);

                if (primtiveToRemove) {
                    // remove the point
                    this.pointCollection.remove(primtiveToRemove);

                    // remove the label
                    const labelToRemove = this.labelCollection._labels.find(label => Cesium.Cartesian3.equals(label.position, primtiveToRemove.position));
                    if (labelToRemove) this.labelCollection.remove(labelToRemove);

                    // remove the point position from cache
                    const positionIndex = this.coords.groups.findIndex(pos => Cesium.Cartesian3.equals(pos, primtiveToRemove.position))
                    if (positionIndex !== -1) this.coords.groups.splice(positionIndex, 1);

                    // log the points records
                    this._updateBookmarkLogRecords(primtiveToRemove.position, "remove");
                }
                break;
            default:
                // use mouse move position to control only one pickPosition is used
                const cartesian = this.coordinate;
                if (!Cesium.defined(cartesian)) return;

                // create point primitive
                const point = createPointPrimitive(cartesian, Cesium.Color.RED);
                point.id = generateId(cartesian, "bookmark_point");
                this.pointCollection.add(point);

                // update the coords cache
                this.coords.groups.push(cartesian);

                // create label primitive
                const positionIndex = this.coords.groups.findIndex(pos => Cesium.Cartesian3.equals(pos, cartesian));
                const labelString = `Point ${positionIndex + 1}`;
                const label = createLabelPrimitive(cartesian, cartesian, labelString)
                label.id = generateId(cartesian, "bookmark_label");
                this.labelCollection.add(label);

                // log the points records
                this._updateBookmarkLogRecords(cartesian, "add");
                break;
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handlePointsMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        // update pointerOverlay: the moving dot with mouse
        const pointer = this.stateManager.getOverlayState("pointer");
        updatePointerOverlay(this.viewer, pointer, cartesian, pickedObjects);

        this.handleHoverHighlighting(pickedObjects[0]);

        // update coordinateInfoOverlay
        this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
    }

    handleHoverHighlighting(pickedObject) {
        const pickedObjectType = getPickedObjectType(pickedObject, "bookmark");

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
        }
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


    /*****************
     * DRAG FEATURES *
     *****************/
    handlePointsDragStart(movement) {
        // initialize camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        // pick the point primitive
        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
        // const pointPrimitive = pickedObjects.find(pickedObject => pickedObject.id && typeof pickedObject.id === 'string' && pickedObject.id.startsWith("annotate_bookmark"));
        const isPoint = pickedObjects.find(p => {
            const primitiveId = p.primitive.id;
            return typeof primitiveId === 'string' &&
                primitiveId.startsWith("annotate_bookmark_point") &&
                !primitiveId.includes("moving");
        });
        if (Cesium.defined(isPoint)) {
            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handlePointsDrag(movement, isPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }

    };

    handlePointsDrag(movement, selectedPoint) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // set existed point, label primitives to no show
            selectedPoint.primitive.show = false;
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_bookmark_label") &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, this.coords.dragStart)
            );
            if (existedLabel) existedLabel.show = false;

            // set point overlay no show
            const pointer = this.stateManager.getOverlayState("pointer");
            pointer.style.display = 'none';

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
                this.interactivePrimitives.dragPoint.id = generateId(cartesian, "bookmark_point_moving");
            } else {    // if dragging point not existed, create a new point
                const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
                pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "bookmark_point_moving");
                this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
            }

            // create or update dragging label primitive
            const positionIndex = this.coords.groups.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));

            if (this.interactivePrimitives.dragLabel) {    // if dragging label existed, update the label
                this.interactivePrimitives.dragLabel.id = generateId(cartesian, "bookmark_label_moving");
                this.interactivePrimitives.dragLabel.position = cartesian;
                this.interactivePrimitives.dragLabel.showBackground = false;
            } else {    // if dragging label not existed, create a new label
                const labelString = `Point ${positionIndex + 1}`;
                const label = createLabelPrimitive(cartesian, cartesian, labelString)
                label.id = generateId(cartesian, "bookmark_label_moving");
                label.showBackground = false;
                this.interactivePrimitives.dragLabel = this.labelCollection.add(label)
            }

            // update coordinateInfoOverlay
            this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
        }
    };

    handlePointsDragEnd() {
        // update the drag primitive to the finish position;
        if (this.interactivePrimitives.dragPoint && this.flags.isDragMode) {
            // reset dragging point style
            this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.dragPoint.outlineWidth = 0;

            // remove the dragging point and label
            if (this.interactivePrimitives.dragPoint) this.pointCollection.remove(this.interactivePrimitives.dragPoint);
            this.interactivePrimitives.dragPoint = null;
            if (this.interactivePrimitives.dragLabel) this.labelCollection.remove(this.interactivePrimitives.dragLabel);
            this.interactivePrimitives.dragLabel = null;

            // update existed point
            const existedPoint = this.pointCollection._pointPrimitives.find(p =>
                p.id &&
                p.id.startsWith("annotate_bookmark_point") &&
                Cesium.Cartesian3.equals(p.position, this.coords.dragStart)
            );
            if (existedPoint) {
                existedPoint.show = true;
                existedPoint.id = generateId(this.coordinate, "bookmark_point");
                existedPoint.position = this.coordinate;
            }

            // update existed label 
            const existedLabel = this.labelCollection._labels.find(l =>
                l.id &&
                l.id.startsWith("annotate_bookmark_label") &&
                Cesium.Cartesian3.equals(l.position, this.coords.dragStart)
            );
            if (existedLabel) {
                existedLabel.show = true;
                existedLabel.id = generateId(this.coordinate, "bookmark_label");
                existedLabel.position = this.coordinate;
                existedLabel.showBackground = true;
            }

            // update the cache position
            const positionIndex = this.coords.groups.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
            if (positionIndex > -1) {
                this.coords.groups[positionIndex] = this.coordinate;
            }

            // log the points records
            this._updateBookmarkLogRecords(this.coordinate, "update");

            // reset dragging primitive and flags
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handlePointsMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };


    /******************
     * OTHER FEATURES *
     ******************/
    createCoordinateInfoOverlay() {
        this.coordinateInfoOverlay = document.createElement("div");
        this.coordinateInfoOverlay.className = "coordinate-info-overlay";
        this.viewer.container.appendChild(this.coordinateInfoOverlay);
        this.coordinateInfoOverlay.style.cssText =
            "position: absolute; top: 0; left: 0; pointer-events: none; padding: 4px; display: none;";
        return this.coordinateInfoOverlay;
    }

    updateCoordinateInfoOverlay(cartesian) {
        const cartographicDegress = cartesian3ToCartographicDegrees(cartesian);
        const displayInfo = `Lat: ${cartographicDegress.latitude.toFixed(6)}<br>Lon: ${cartographicDegress.longitude.toFixed(6)} <br>Alt: ${cartographicDegress.height.toFixed(2)}`;
        this.coordinateInfoOverlay.innerHTML = displayInfo;

        let screenPosition;
        if (Cesium.SceneTransforms.worldToWindowCoordinates) {
            screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, cartesian);
        } else if (Cesium.SceneTransforms.wgs84ToWindowCoordinates) {
            screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(this.viewer.scene, cartesian);
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
     * Update the bookmark log records.
     * @param {Cesium.Cartesian3} cartesian - The Cartesian3 coordinate.
     * @param {String} action - The action type.
     */
    _updateBookmarkLogRecords(cartesian, action) {
        const cartographicDegrees = cartesian3ToCartographicDegrees(cartesian);
        this.logRecordsCallback({ [action]: this._formatCartographicDegrees(cartographicDegrees) });
    }

    /**
     * To format the cartographic degrees.
     * @param {{latitude: number, longitude: number, height: number}} cartographicDegrees - The cartographic degrees. 
     * @returns {{lat, lon: string}} - The formatted cartographic degrees.
     */
    _formatCartographicDegrees(cartographicDegrees) {
        const { longitude, latitude } = cartographicDegrees;
        if (!longitude || !latitude) return;
        return {
            "lat, lon": `${latitude.toFixed(6)},${longitude.toFixed(6)} `,
        }
    }

    // /**
    //  * Gets the points records.
    //  * @returns {Array} The points records.
    //  */
    // get pointsRecords() {
    //     return this._pointsRecords.map(cartesian3ToCartographicDegrees);
    // }

    resetValue() {
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState('pointer')
        pointer && (pointer.style.display = 'none');
        this.coordinateInfoOverlay.style.display = 'none';

        // reset flags
        this.flags.isDragMode = false;

        // reset and remove moving primitives
        this.interactivePrimitives.dragPoint = null;
        this.interactivePrimitives.dragLabel = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;
    }
}

export { Points };
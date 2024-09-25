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
    constructor(viewer, handler, pointerOverlay, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;
        this.pointerOverlay = pointerOverlay;
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
            cache: [],      // Stores temporary coordinates during operations
            dragStart: null // Stores the initial position before a drag begins
        }

        // Initialize Cesium primitives collections
        this.pointCollection = new this.cesiumPkg.PointPrimitiveCollection();
        this.labelCollection = new this.cesiumPkg.LabelCollection();
        this.pointCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, perforamnce improve 2x
        this.labelCollection.blendOption = Cesium.BlendOption.TRANSLUCENT; // choose either OPAQUE or TRANSLUCENT, perforamnce improve 2x
        this.viewer.scene.primitives.add(this.pointCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            draggingPoint: null,    // Currently dragged point primitive
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

    /**
     * Removes input actions for points mode.
     */
    removeInputAction() {
        removeInputActions(this.handler);
    }

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
                const primtiveToRemove = this.pointCollection._pointPrimitives.find(primitive => primitive.id === pickedObject.id);
                if (primtiveToRemove) {
                    // remove the point
                    this.pointCollection.remove(primtiveToRemove);

                    // remove the label
                    const labelToRemove = this.labelCollection._labels.find(label => Cesium.Cartesian3.equals(label.position, primtiveToRemove.position));
                    if (labelToRemove) {
                        this.labelCollection.remove(labelToRemove);
                    }

                    // remove the point position from cache
                    const positionIndex = this.coords.cache.findIndex(pos => Cesium.Cartesian3.equals(pos, primtiveToRemove.position))
                    if (positionIndex > -1) {
                        this.coords.cache.splice(positionIndex, 1);
                    }
                    // log the points records
                    this._updateBookmarkLogRecords(primtiveToRemove.position, "remove");
                }
                break;
            default:
                // use mouse move position to control only one pickPosition is used
                const cartesian = this.coordinate;

                // primitive way to add point
                if (Cesium.defined(cartesian)) {
                    const point = createPointPrimitive(cartesian, Cesium.Color.RED);
                    point.id = generateId(cartesian, "bookmark_point");
                    this.pointCollection.add(point);

                    // update the points position cache
                    this.coords.cache.push(cartesian);

                    const positionIndex = this.coords.cache.findIndex(pos => Cesium.Cartesian3.equals(pos, cartesian));
                    const labelString = `Point ${positionIndex + 1}`;
                    const label = createLabelPrimitive(cartesian, cartesian, labelString)
                    label.id = generateId(cartesian, "bookmark_label");
                    this.labelCollection.add(label);


                    // log the points records
                    this._updateBookmarkLogRecords(cartesian, "add");
                }
                break;
        }
    }

    /**
     * Handles mouse move events to display moving dot with mouse.
     * @param {{endPosition: Cesium.Cartesian2}} movement
     */
    handlePointsMouseMove(movement) {
        const cartesian = this.viewer.scene.pickPosition(movement.endPosition);

        if (!Cesium.defined(cartesian)) return;

        this.coordinate = cartesian;

        // update pointerOverlay: the moving dot with mouse
        const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);
        updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects)

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
            // set point overlay no show
            this.pointerOverlay.style.display = 'none';

            // disable camera movement
            this.viewer.scene.screenSpaceCameraController.enableInputs = false;

            // set the dragging point
            this.interactivePrimitives.draggingPoint = isPoint.primitive;
            this.coords.dragStart = isPoint.primitive.position.clone();
            this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

            // set move event for dragging
            this.handler.setInputAction((movement) => {
                this.handlePointsDrag(movement, this.interactivePrimitives.draggingPoint);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        }

    };

    handlePointsDrag(movement, pointPrimitive) {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
        if (moveDistance > dragThreshold) {
            this.flags.isDragMode = true
        };

        if (this.flags.isDragMode) {
            // highlight the point primitive
            pointPrimitive.outlineColor = Cesium.Color.YELLOW;
            pointPrimitive.outlineWidth = 2;

            const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
            if (!Cesium.defined(cartesian)) return;
            this.coordinate = cartesian;

            // remove the existed label
            const labelToRemove = this.labelCollection._labels.find(label => Cesium.Cartesian3.equals(label.position, pointPrimitive.position));
            const labelTORemoveText = labelToRemove && labelToRemove.text;
            if (labelToRemove) {
                this.labelCollection.remove(labelToRemove);
            }

            // update point primitive to dragging position
            pointPrimitive.position = cartesian;

            // create moving label primitive
            if (this.interactivePrimitives.movingLabel) {
                this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            }
            const label = createLabelPrimitive(cartesian, cartesian, labelTORemoveText)
            label.id = generateId(cartesian, "bookmark_moving_label");
            label.showBackground = false;
            this.interactivePrimitives.movingLabel = this.labelCollection.add(label);

            // update coordinateInfoOverlay
            this.coordinateInfoOverlay && this.updateCoordinateInfoOverlay(this.coordinate);
        }
    };

    handlePointsDragEnd() {
        // update the drag primitive to the finish position;
        if (this.interactivePrimitives.draggingPoint && this.flags.isDragMode) {
            // update the cache position
            const positionIndex = this.coords.cache.findIndex(pos => Cesium.Cartesian3.equals(pos, this.coords.dragStart));
            if (positionIndex > -1) {
                this.coords.cache[positionIndex] = this.coordinate;
            }

            // reset dragging point style
            this.interactivePrimitives.draggingPoint.outlineColor = Cesium.Color.RED;
            this.interactivePrimitives.draggingPoint.outlineWidth = 0;

            // update the label
            if (this.interactivePrimitives.movingLabel) {
                this.labelCollection.remove(this.interactivePrimitives.movingLabel);
            }
            const labelString = `Point ${positionIndex + 1}`;
            const label = createLabelPrimitive(this.interactivePrimitives.draggingPoint.position, this.interactivePrimitives.draggingPoint.position, labelString)
            label.id = generateId(this.interactivePrimitives.draggingPoint.position, "bookmark_label");
            this.labelCollection.add(label);

            // log the points records
            this._updateBookmarkLogRecords(this.coordinate, "update");

            // reset dragging primitive and flags
            this.interactivePrimitives.draggingPoint = null;
            this.flags.isDragMode = false;
        }
        // set back to default multi distance mouse moving actions
        this.handler.setInputAction((movement) => {
            this.handlePointsMouseMove(movement);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    };

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

        this.pointerOverlay.style.display = 'none';
        this.coordinateInfoOverlay.style.display = 'none';

        // reset flags
        this.flags.isDragMode = false;

        // remove moving primitives
        if (this.interactivePrimitives.movingLabel) {
            this.labelCollection.remove(this.interactivePrimitives.movingLabel);
        }
        this.interactivePrimitives.movingLabel = null;

        // reset interactive primitives
        this.interactivePrimitives.draggingPoint = null;
        this.interactivePrimitives.hoveredPoint = null;
        this.interactivePrimitives.hoveredLabel = null;

    }
}

export { Points };
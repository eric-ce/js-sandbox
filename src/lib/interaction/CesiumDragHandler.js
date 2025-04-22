import { Cartesian2, Cartesian3, Color, defined } from "cesium";
import dataPool from "../data/DataPool.js";
import { formatDistance, getPrimitiveByPointPosition } from "../helper/cesiumHelper";

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'| string} mapName - Map provider name ("google")
 */

/**
 * Handles dragging events in Cesium.
 */
class CesiumDragHandler {
    /**
     * Creates an instance of CesiumDragHandler.
     * @param {Viewer} viewer - The Cesium viewer instance
     * @param {import('../input/CesiumInputHandler')} inputHandler 
     * @param {import('eventemitter3').EventEmitter} emitter 
     * @param {function} callbacks 
     */
    constructor(viewer, inputHandler, emitter, callbacks = {}) {
        this.viewer = viewer;
        this.inputHandler = inputHandler;
        this.emitter = emitter; // Keep emitter if needed for other things
        this.callbacks = callbacks; // Callbacks provided by the mode

        this.activeModeInstance = null; // To store the reference to the active mode
        this.isDragging = false;        // Internal state to track dragging, local state is more efficient during high frequency events 

        // Internal state to track the dragged object and its related info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo(); // Initialize the dragged object info

        /**@type {Cartesian3} */
        this.coordinate = null // The temporary coordinate for moving position, faster responds


        this.measure = null; // temporary measure data for reference

        this.pointCollection = null;
        this.labelCollection = null;
    }

    activate(modeInstance) {
        // Validate the variables from modeInstance
        if (!modeInstance || typeof modeInstance.mode !== 'string' || typeof modeInstance.flags !== 'object') {
            console.error("CesiumDragHandler activate requires a valid modeInstance with 'mode' and 'flags'.");
            return;
        }

        this.activeModeInstance = modeInstance; // Store the mode instance

        this.pointCollection = this.activeModeInstance.pointCollection; // Store the point collection
        this.labelCollection = this.activeModeInstance.labelCollection; // Store the label collection

        // Attach event listener, use sequential approach to optimize performance 
        this.inputHandler.on('leftdown', this._handleDragStart);
    }

    deactivate() {
        // Remove event listeners
        this.inputHandler.off('leftdown', this._handleDragStart);
        this.inputHandler.off('mousemove', this._handleDrag);
        this.inputHandler.off('leftup', this._handleDragEnd);

        // Reset the variables
        this.activeModeInstance = null;
        this.isDragging = false;
        this.draggedObjectInfo = null;
    }

    _handleDragStart = async (eventData) => {
        // initialize camera movement, default camera moving
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        // Validate active instance and check dragging state
        if (!this.activeModeInstance || this.isDragging) return;

        const pickedObjects = eventData.pickedFeature;
        if (!Array.isArray(pickedObjects) && pickedObjects.length === 0) {
            return;
        }

        // Custom callbacks added by activeModeInstance
        if (typeof this.callbacks.onDragBegin === 'function') {
            this.callbacks.onDragBegin(eventData);
        }

        // Get the picked point primitive and check if it belongs to the current mode
        const isPoint = pickedObjects.find(po => {
            const primitiveId = po.primitive.id;
            return typeof primitiveId === 'string' &&
                primitiveId.startsWith(`annotate_${this.activeModeInstance.mode}_point`) &&
                !primitiveId.includes("moving");
        });

        if (!defined(isPoint)) return; // No point found, exit the function

        // Disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;

        // Store the dragged point primitive
        this.draggedObjectInfo.beginPoint = isPoint;
        // Store the dragged point position and screen position
        this.draggedObjectInfo.beginPosition = isPoint.primitive.position.clone();
        this.draggedObjectInfo.beginScreenPoint = this.viewer.scene.cartesianToCanvasCoordinates(this.draggedObjectInfo.beginPosition); // store the screen position

        // find the measure data and update the status and update data pool
        const measure = this.activeModeInstance._findMeasureByCoordinate(this.draggedObjectInfo.beginPosition);
        if (!measure) return;

        // Store the measure data for reference
        this.measure = measure;

        // Set status to pending
        this.measure.status = "pending";

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...measure });

        // Set events for dragging
        this.inputHandler.on('mousemove', this._handleDrag);
        this.inputHandler.on('leftup', this._handleDragEnd);
    }

    _handleDrag = async (eventData) => {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.draggedObjectInfo.beginScreenPoint, eventData.screenPoint);
        if (moveDistance > dragThreshold) {
            this.isDragging = true
            this.activeModeInstance.flags.isDragMode = true; // Set the flag to true
        };

        if (!this.isDragging) return; // Only proceed if drag mode is active

        const pickedObjects = eventData.pickedFeature;
        if (!Array.isArray(pickedObjects) && pickedObjects.length === 0) {
            return;
        }
        this.coordinate = eventData.mapPoint;
        if (!defined(this.coordinate)) {
            return;
        }

        // -- Handle the existing primitives --
        const dragRelatedPrimitives = getPrimitiveByPointPosition(
            this.draggedObjectInfo.beginPosition,
            `annotate_${this.activeModeInstance.mode}`,
            this.viewer.scene,
            this.activeModeInstance.pointCollection,
            this.activeModeInstance.labelCollection
        )
        dragRelatedPrimitives.linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        // dragRelatedPrimitives.labelPrimitives.forEach(l => l.show = false);
        // -- End handle existing primitives --

        // -- Handle dragging point --
        // update the dragged point
        if (this.draggedObjectInfo.beginPoint) {
            // hightlight the dragged point
            this.draggedObjectInfo.beginPoint.primitive.outlineColor = Color.fromCssColorString('yellow');
            this.draggedObjectInfo.beginPoint.primitive.outlineWidth = 2;
            // update the position of the dragged point
            this.draggedObjectInfo.beginPoint.primitive.position = this.coordinate;
            this.draggedObjectInfo.beginPoint.primitive.positions = [this.coordinate]; // store custom position for reference
            this.draggedObjectInfo.beginPoint.primitive.status = "moving";
        }
        // -- End handle dragging point --

        // -- Handle dragging line--
        // case 1: update line by remove and recreate for single line - modes: distance, curve, profile, bookmark
        // remove moving line if exists
        if (this.draggedObjectInfo.movingLines && this.draggedObjectInfo.movingLines.length > 0) {
            this.draggedObjectInfo.movingLines.forEach(line => this.viewer.scene.primitives.remove(line));
            this.draggedObjectInfo.movingLines = []; // Reset the moving line reference
        }
        // create moving line 
        const otherPosition = this.measure.coordinates.find(cart => !Cartesian3.equals(cart, this.draggedObjectInfo.beginPosition));
        if (!defined(otherPosition)) return;
        const movingLinePrimitive = this.activeModeInstance.drawingHelper._addPolyline(
            [otherPosition, this.coordinate],
            {
                color: Color.fromCssColorString('yellow'),
                id: "annotate_distance_line"
            }
        )
        movingLinePrimitive.status = "moving"; // Set status to moving for the line primitive
        this.draggedObjectInfo.movingLines.push(movingLinePrimitive); // Store the moving line primitive
        // case 2: update line for two lines - modes: distance, curve, profile, bookmark

        // -- End handle dragging line --

        // -- Handle dragging label --
        // case 1: update label for single label - modes: distance, curve, profile, bookmark
        if (dragRelatedPrimitives.labelPrimitives.length === 1) {
            const dragLabelPrimitive = dragRelatedPrimitives.labelPrimitives[0];
            this.draggedObjectInfo.movingLabels = [dragLabelPrimitive]; // Store the moving label primitive
        }

        if (this.draggedObjectInfo.movingLabels && this.draggedObjectInfo.movingLabels.length > 0) {
            const dragLabelPrimitive = this.draggedObjectInfo.movingLabels[0]; // Get the moving label primitive
            const distance = formatDistance(Cartesian3.distance(otherPosition, this.coordinate));

            if (dragLabelPrimitive) { // if label exists, update relevant info and style
                dragLabelPrimitive.position = Cartesian3.midpoint(otherPosition, this.coordinate, new Cartesian3());
                dragLabelPrimitive.text = distance;
                dragLabelPrimitive.status = "moving"; // Set status to moving for the label primitive
                dragLabelPrimitive.show = this.activeModeInstance.flags.isShowLabels ?? true;
                dragLabelPrimitive.showBackground = false;
                dragLabelPrimitive.positions = [otherPosition, this.coordinate]; // store custom position for reference
            } else {
                // fallback to create a new label
                const labelPrimitive = this.activeModeInstance.drawingHelper._addLabel(
                    [otherPosition, this.coordinate],
                    distance,
                    "meter",
                    {
                        id: "annotate_distance_label",
                        showBackground: false,
                        show: this.activeModeInstance.flags.isShowLabels ?? true,
                    }
                );
                labelPrimitive.status = "moving";
                this.draggedObjectInfo.movingLabels = [labelPrimitive];
            }
        }
        // case 2: update label for two labels


        // -- End handle dragging label --

        // Custom callbacks added by activeModeInstance
        if (typeof this.callbacks.onDrag === 'function') {
            this.callbacks.onDrag(eventData);
        }
    }

    _handleDragEnd = async (eventData) => {
        this.inputHandler.off('mousemove', this._handleDrag); // Remove the mouse move event listener

        // Enable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (!this.isDragging || !this.measure) return; // Only proceed if drag mode is active

        // -- Handle dragging line --
        if (this.draggedObjectInfo.movingLines && this.draggedObjectInfo.movingLines.length > 0) {
            this.draggedObjectInfo.movingLines.forEach(line => this.viewer.scene.primitives.remove(line));
            this.draggedObjectInfo.movingLines = []; // Reset the moving line reference
        }

        // -- Handle point --
        // reset dragging point style
        this.draggedObjectInfo.beginPoint.primitive.outlineColor = Color.fromCssColorString('red');
        this.draggedObjectInfo.beginPoint.primitive.outlineWidth = 0;

        // update the position of the dragged point
        this.draggedObjectInfo.beginPoint.primitive.position = this.coordinate;
        this.draggedObjectInfo.beginPoint.primitive.positions = [this.coordinate]; // store custom position for reference
        this.draggedObjectInfo.beginPoint.primitive.status = "completed";

        // -- Handle line --
        const otherPosition = this.measure.coordinates.find(cart => !Cartesian3.equals(cart, this.draggedObjectInfo.beginPosition));
        const linePrimitive = this.activeModeInstance.drawingHelper._addPolyline(
            [otherPosition, this.coordinate],
            {
                color: Color.YELLOWGREEN,
                id: "annotate_distance_line"
            }
        );
        linePrimitive.status = "completed"; // Set status to completed for the line primitive

        // -- Handle label --
        let dragEndLabelPrimitive = null;
        let distance = null;
        if (this.draggedObjectInfo.movingLabels && this.draggedObjectInfo.movingLabels.length === 1) {
            const labelPrimitive = this.draggedObjectInfo.movingLabels[0]; // Get the moving label primitive

            distance = formatDistance(Cartesian3.distance(otherPosition, this.coordinate));
            if (labelPrimitive) {
                labelPrimitive.position = Cartesian3.midpoint(otherPosition, this.coordinate, new Cartesian3());
                labelPrimitive.text = distance;
                labelPrimitive.status = "completed"; // Set status to completed for the label primitive
                labelPrimitive.showBackground = true;
                labelPrimitive.show = this.activeModeInstance.flags.isShowLabels ?? true;
                labelPrimitive.positions = [otherPosition, this.coordinate]; // store custom position for reference
                dragEndLabelPrimitive = labelPrimitive;
            } else {
                // fallback to create new label to prevent undefined error
                const labelPrimitive = this.activeModeInstance.drawingHelper._addLabel(
                    [otherPosition, this.coordinate],
                    distance,
                    "meter",
                    {
                        id: "annotate_distance_label",
                        showBackground: true,
                        show: this.activeModeInstance.flags.isShowLabels ?? true,
                    }
                );
                labelPrimitive.status = "completed";
                this.draggedObjectInfo.movingLabels = [labelPrimitive];
                dragEndLabelPrimitive = labelPrimitive;
            }
        }

        // -- Handle data --
        // Store dragEnd data
        this.draggedObjectInfo.endPosition = this.coordinate.clone(); // Store the drag end position
        this.draggedObjectInfo.endPoint = this.draggedObjectInfo.beginPoint; // Store the dragged point primitive
        this.draggedObjectInfo.endLines = [linePrimitive];
        this.draggedObjectInfo.endLabels = [dragEndLabelPrimitive]; // Store the dragged label primitive

        // Set measure data status to completed
        this.measure.status = "completed";
        this.measure.coordinates = [otherPosition, this.coordinate];
        this.measure._records = [distance];
        // Update activeInstance measure data
        let measureData = this.activeModeInstance.coords.groups.find(measure => measure.id === this.measure.id) ?? null;
        if (measureData) {
            measureData = this.measure;
        }

        // Update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });
        // -- End handle data --

        // Custom callbacks added by activeModeInstance
        if (typeof this.callbacks.onDragEnd === 'function') {
            this.callbacks.onDragEnd(eventData);
        }


        this.emitter.emit("drag-end", {
            measureData: { ...this.measure },
            draggedObjectInfo: { ...this.draggedObjectInfo },
        })

        // Reset values
        this._resetValue(); // Reset the dragged object info and flags
        // Reset activeModeInstance value
        this.activeModeInstance.flags.isDragMode = false; // Reset the flag to false
    }

    _createDefaultDraggedObjectInfo() {
        return {
            /** @type {PointPrimitive} */
            beginPoint: null, // The point being dragged
            /** @type {Cartesian3} */
            beginPosition: null, // The position where dragging started
            /** @type {Cartesian2} */
            beginScreenPoint: null, // The screen position where dragging started
            /** @type {Primitive[]} */
            movingLines: [],
            /** @type {LabelPrimitive[]} */
            movingLabels: [],
            /** @type {Cartesian3} */
            endPosition: null, // The position where dragging ended
            /** @type {PointPrimitive} */
            endPoint: null, // The point where dragging ended
            /** @type {Primitive[]} */
            endLines: [], // The line where dragging ended
            /** @type {LabelPrimitive[]} */
            endLabels: [], // The label where dragging ended
        };
    }

    _resetValue() {
        // Reset flags
        this.isDragging = false; // Reset the dragging state

        // Reset coordinate
        this.coordinate = null; // Reset the coordinate reference

        // Reset the dragged object info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo(); // Reset the dragged object info
        this.measure = null; // Reset the measure reference
    }

    destroy() {
        this.deactivate(); // Ensure listeners are removed
    }
};

export { CesiumDragHandler };
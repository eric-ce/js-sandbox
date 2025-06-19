import { Cartesian2, Cartesian3, Color, defined } from "cesium";
import dataPool from "../data/DataPool.js";
import { convertToCartesian3, getPrimitiveByPointPosition } from "../helper/cesiumHelper";


// --Cesium types --
/** @typedef {import('cesium').Viewer} Viewer */
/** @typedef {import('cesium').PointPrimitive} PointPrimitive */
/** @typedef {import('cesium').Label} Label */
/** @typedef {import('cesium').Primitive} Primitive */
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
/** @typedef {import('cesium').Cartesian2} Cartesian2 */


// -- Dependencies types --
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../input/CesiumInputHandler.js')} CesiumInputHandler */

// -- Data types --
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
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {Cartesian3} mapPoint - The point on the map where the event occurred
 * @property {any[]} pickedFeature - The feature that was picked at the event location
 * @property {Cartesian2} screenPoint - The screen coordinates of the event
 */

/**
 * Handles dragging events in Cesium.
 */
class CesiumDragHandler {
    // -- Public fields: dependencies --
    /** @type {Viewer} */
    viewer;
    /** @type {CesiumInputHandler} */
    inputHandler;
    /** @type {EventEmitter} */
    emitter;

    // -- Public fields: variables --
    activeModeInstance = null;
    isDragging = false;
    draggedObjectInfo = null;
    /** @type {MeasurementGroup} */
    measure = null;

    pointCollection;
    labelCollection;
    polylineCollection;
    polygonCollection;

    // -- Private Fields: variables --
    #coordinate = null;

    /**
     * Creates an instance of CesiumDragHandler.
     * @param {Viewer} viewer - The Cesium viewer instance
     * @param {import('../input/CesiumInputHandler')} inputHandler 
     * @param {import('eventemitter3').EventEmitter} emitter 
     * @param {function} callbacks 
     */
    constructor(map, inputHandler, emitter, callbacks = {}) {
        this.viewer = map;
        this.inputHandler = inputHandler;
        this.emitter = emitter; // Keep emitter if needed for other things

        // Internal state to track the dragged object and its related info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo(); // Initialize the dragged object info
    }

    get coordinate() {
        return this.#coordinate;
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
        this.polylineCollection = this.activeModeInstance.polylineCollection; // Store the polyline collection
        this.polygonCollection = this.activeModeInstance.polygonCollection; // Store the polygon collection

        // Attach event listener, use sequential approach to optimize performance 
        this.inputHandler.on('leftdown', this._handleDragStart);
    }

    deactivate() {
        // Remove event listeners
        this.inputHandler.off('leftdown', this._handleDragStart);
        this.inputHandler.off('mousemove', this._handleDrag);
        this.inputHandler.off('leftup', this._handleDragEnd);

        this.activeModeInstance = null;

        this._resetValue(); // Reset the dragged object info and flags
    }

    /**
     * Handles the drag start event.
     * @param {NormalizedEventData} eventData - The event data from the input handler
     * @returns {Promise<void>}
     */
    _handleDragStart = async (eventData) => {
        // initialize camera movement, default camera moving
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        // Validate active instance and check dragging state
        if (!this.activeModeInstance || this.isDragging) return;

        const pickedObjects = eventData.pickedFeature;
        if (!Array.isArray(pickedObjects) && pickedObjects.length === 0) {
            return;
        }

        // Get the picked point primitive and check if it belongs to the current mode
        const isPoint = pickedObjects.find(po => {
            const primitiveId = po.primitive.id;
            return typeof primitiveId === 'string' &&
                primitiveId.startsWith(`annotate_${this.activeModeInstance.mode}_point`) &&
                po.primitive.status === "completed"  // Check if the point is completed
        });
        if (!defined(isPoint)) return; // No point found, exit the function

        // Disable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;

        // -- Store reference for the dragging process --
        // Store the dragged point primitive
        this.draggedObjectInfo.beginPoint = isPoint;
        // Store the dragged point position and screen position
        this.draggedObjectInfo.beginPosition = isPoint.primitive.position.clone();
        this.draggedObjectInfo.beginScreenPoint = this.viewer.scene.cartesianToCanvasCoordinates(this.draggedObjectInfo.beginPosition); // store the screen position


        // -- Handle Measure Data --
        // find the measure data and update the status and update data pool
        const measureId = Number(isPoint.primitive.id.split('_').slice(-1)[0]); // Extract the measure ID from the point primitive ID
        this.measure = this.activeModeInstance._findMeasureById(measureId); // Find the measure data by ID
        if (!this.measure) return;
        // Update status to pending
        this.measure.status = "pending";

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Store position reference --
        // Store the bottom point relative to the dragged point - ONLY for height mode
        if (typeof this.activeModeInstance?.findAnchorPoint === 'function') {
            const anchorPoint = this.activeModeInstance?.findAnchorPoint(this.measure);
            this.draggedObjectInfo.points = [this.draggedObjectInfo.beginPoint, anchorPoint];
        }

        // -- Store primitives reference --
        // Store the dragged related point, line, label, and polygon primitives by the dragged point position
        const { linePrimitives, labelPrimitives, polygonPrimitives } = getPrimitiveByPointPosition(
            this.draggedObjectInfo.beginPosition,
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection,
        )
        this.draggedObjectInfo.lines = linePrimitives; // Store the line primitives
        this.draggedObjectInfo.labels = labelPrimitives; // Store the label primitives
        this.draggedObjectInfo.polygons = polygonPrimitives; // Store the polygon primitives

        // -- Store total label primitive reference --
        const LabelLen = this.labelCollection.length;
        for (let i = 0; i < LabelLen; ++i) {
            const label = this.labelCollection.get(i);
            if (label.id === `annotate_${this.activeModeInstance.mode}_total_label_${this.measure.id}`) {
                this.draggedObjectInfo.totalLabels = [label]; // Store the total label primitive
            }
        }

        // -- Set event for dragging --
        this.inputHandler.on('mousemove', this._handleDrag);
        this.inputHandler.on('leftup', this._handleDragEnd);
    }

    /**
     * Handles the drag event.
     * @param {NormalizedEventData} eventData - The event data from the input handler
     * @returns {Promise<void>}
     */
    _handleDrag = async (eventData) => {
        // Set drag flag by moving distance threshold
        const dragThreshold = 5;
        const moveDistance = Cartesian2.distance(this.draggedObjectInfo.beginScreenPoint, eventData.screenPoint);
        if (moveDistance > dragThreshold) {
            this.isDragging = true
            this.activeModeInstance.flags.isDragMode = true; // Set the flag to true
        };

        if (!this.isDragging || !eventData.mapPoint || !this.draggedObjectInfo.beginPoint) return; // Only proceed if drag mode is active

        const pickedObjects = eventData.pickedFeature;
        if (!Array.isArray(pickedObjects) && pickedObjects.length === 0) {
            return;
        }
        // Use moving point as coordinate
        this.#coordinate = eventData.mapPoint;
        if (!defined(this.#coordinate)) {
            return;
        }

        // -- Handle dragging point --
        // Update dragging point style and visual position
        this.draggedObjectInfo.beginPoint.primitive.outlineColor = Color.fromCssColorString('yellow');
        this.draggedObjectInfo.beginPoint.primitive.outlineWidth = 2;
        this.draggedObjectInfo.beginPoint.primitive.position = this.#coordinate;
        // update dragging point metadata
        this.draggedObjectInfo.beginPoint.primitive.positions = [this.#coordinate]; // store custom position for reference
        this.draggedObjectInfo.beginPoint.primitive.status = "moving";

        // -- Handle graphics update --
        // let activeModeInstance to handle the graphics update, each mode has its own way to update the graphics
        // this will handle the graphics visual updates and update reference in this class instance    
        if (typeof this.activeModeInstance?.updateGraphicsOnDrag === 'function') {
            this.activeModeInstance?.updateGraphicsOnDrag(this.measure);
        }
    }

    /**
     * Handles the drag end event.
     * @param {NormalizedEventData} eventData - The event data from the input handler
     * @returns {Promise<void>}
     */
    _handleDragEnd = async (eventData) => {
        this.inputHandler.off('mousemove', this._handleDrag);

        // Re-enable camera movement
        this.viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (!this.isDragging || !this.measure) {
            this._resetValue(); // Ensure reset even if something went wrong: consider it as exit dragging
            return;
        }

        // -- Handle point --
        // reset dragging point style
        this.draggedObjectInfo.beginPoint.primitive.outlineColor = Color.fromCssColorString('red');
        this.draggedObjectInfo.beginPoint.primitive.outlineWidth = 0;

        // Final update of the dragged point
        this.draggedObjectInfo.beginPoint.primitive.position = this.#coordinate;
        this.draggedObjectInfo.beginPoint.primitive.positions = [this.#coordinate]; // store custom position for reference
        this.draggedObjectInfo.beginPoint.primitive.status = "completed";

        // -- Handle graphics update --
        // let activeModeInstance to handle the graphics update, each mode has its own way to update the graphics
        if (typeof this.activeModeInstance?.finalizeDrag === 'function') {
            this.activeModeInstance?.finalizeDrag(this.measure);
        }

        // -- Update draggedObjectInfo --
        this.draggedObjectInfo.endPosition = Cartesian3.clone(this.#coordinate); // Store the end position
        // this.draggedObjectInfo.endPoint = this.draggedObjectInfo.beginPoint; // Store the end point

        // Update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });
        // -- End handle data --

        this.emitter.emit("drag-end", {
            measureData: { ...this.measure },
            draggedObjectInfo: { ...this.draggedObjectInfo },
        })

        // Reset values
        this.activeModeInstance?.resetValuesModeSpecific(); // Call mode specific reset values
        this._resetValue(); // Reset the dragged object info and flags
    }

    /**
     * Creates a default dragged object info object.
     * @returns {object} - Default dragged object info
     */
    _createDefaultDraggedObjectInfo() {
        return {
            /** @type {PointPrimitive} */
            beginPoint: null, // The point being dragged
            /** @type {Cartesian3} */
            beginPosition: null, // The position where dragging started
            /** @type {Cartesian2} */
            beginScreenPoint: null, // The screen position where dragging started
            /** @type {PointPrimitive} */
            anchorPoint: null, // The anchor position for height mode
            points: [],
            /** @type {Primitive[]} */
            lines: [],
            /** @type {Label[]} */
            labels: [],
            /** @type {Label[]} */
            totalLabels: [],
            /** @type {Primitive[]} */
            polygons: [],
            /** @type {Cartesian3} */
            endPosition: null, // The position where dragging ended
        };
    }

    /**
     * Resets the dragged object info and flags.
     */
    _resetValue() {
        // Reset flags
        this.isDragging = false; // Reset the dragging state
        if (this.activeModeInstance) { // Check if instance exists before accessing flags
            this.activeModeInstance.flags.isDragMode = false;
        }

        // Reset coordinate
        this.#coordinate = null; // Reset the coordinate reference

        // Reset the dragged object info
        this.draggedObjectInfo = this._createDefaultDraggedObjectInfo(); // Reset the dragged object info
        this.measure = null; // Reset the measure reference

        // Remove drag event listeners
        this.inputHandler.off('mousemove', this._handleDrag);
        this.inputHandler.off('leftup', this._handleDragEnd); // Remove the mouse up event listener
    }

    /**
     * Destroys the CesiumDragHandler instance and removes all event listeners.
     */
    destroy() {
        this.deactivate(); // Ensure listeners are removed
    }
};

export { CesiumDragHandler };
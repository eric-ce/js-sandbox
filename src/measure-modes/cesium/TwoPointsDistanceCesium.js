import {
    Cartesian2,
    Cartesian3,
    defined,
    ScreenSpaceEventHandler,
} from "cesium";
import {
    calculateDistance,
    editableLabel,
    updatePointerOverlay,
    getPickedObjectType,
    generateIdByTimestamp,
    changeLineColor,
    convertToCartographicDegrees,
} from "../../lib/helper/cesiumHelper.js";
import dataPool from "../../lib/data/DataPool.js";
import { CesiumDragHandler } from '../../lib/interaction/CesiumDragHandler.js';
import { MeasureModeCesium } from "./MeasureModeCesium.js";

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

class TwoPointsDistanceCesium extends MeasureModeCesium {
    /**
     * Creates a new TwoPointsDistance instance.
     * @param {Viewer} viewer - The Cesium Viewer instance.
     * @param {ScreenSpaceEventHandler} handler - The event handler for screen space.
     * @param {StateManager} stateManager - The state manager instance.
     * @param {Object} cesiumPkg - The Cesium package object.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, cesiumPkg) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("TwoPointsDistanceGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // Updated Constructor Arguments
        this.inputHandler = inputHandler;
        this.drawingHelper = drawingHelper;
        this.viewer = drawingHelper.map;
        this.stateManager = stateManager;
        this.emitter = emitter;
        this.cesiumPkg = cesiumPkg;

        // Coordinate management and related properties
        this.coords = {
            /** @type {Cartesian3[]} */
            cache: [],                  // Stores temporary coordinates during operations
            /** @type {MeasurementGroup[]} */
            groups: [],                 // Tracks all coordinates involved in operations
            measureCounter: 0,            // Counter for the number of groups
            /** @type {Cartesian3} */
            dragStart: null,            // Stores the initial position before a drag begins
            /** @type {{x: number, y: number}} */
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
        };

        // Flags to control the state of the tool
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isShowLabels: true
        };

        this.coordinate = null;

        /** @type {MeasurementGroup} */
        this.measure = super._createDefaultMeasure();

        // Interactive primitives for dynamic actions
        this.interactivePrimitives = {
            movingPolylines: [],      // Array of moving polylines
            movingLabels: [],         // Array of moving labels

            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels

            hoveredPoint: null,       // Point that is currently hovered
            hoveredLine: null,        // Line that is currently hovered
            hoveredLabel: null        // Label that is currently hovered
        };

        this.pointCollection = this.drawingHelper.pointCollection;
        this.labelCollection = this.drawingHelper.labelCollection;
    }

    // /**
    //  * Sets up input actions for two points distance mode.
    //  */
    // setupInputActions() {
    //     super.setupInputActions();
    // }


    /***********************
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events to place points and initiate distance measurement.
     * @param {{position: Cartesian2}} movement - The mouse movement event.
     */
    handleLeftClick = async (eventData) => {
        // use move position for the position
        const cartesian = this.coordinate
        if (!defined(cartesian)) return;

        const pickedObject = eventData.pickedFeature[0];
        const pickedObjectType = getPickedObjectType(pickedObject, this.mode);

        // Try to handle click on an existing primitive first
        const handled = this._handleAnnotationClick(pickedObject, pickedObjectType);


        // If the click was not on a handled primitive and not in drag mode, start measuring
        if (!handled && !this.flags.isDragMode) {
            this._startMeasure();
        }
    }

    /**
     * Initiates the measurement process by creating a new group or adding a point.
     */
    _startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = super._createDefaultMeasure();

            // Set values for the new measure
            this.measure.id = generateIdByTimestamp();
            this.measure.mode = this.mode;
            this.measure.labelNumberIndex = this.coords.measureCounter;
            // this.measure.mapName = this.drawingHelper.mapName;
            this.measure.status = "pending";

            // Establish data relation
            this.coords.groups.push(this.measure);
            this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
            this.coords.measureCounter++;
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return; // Do not create a new point if near an existing one

        // create a new point primitive
        const pointPrimitive = this.drawingHelper._addPointMarker(this.coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: "annotate_distance_point"
        });
        pointPrimitive.positions = [this.coordinate];
        pointPrimitive.status = "pending"; // Set status to pending for the point primitive

        // Update the this.coords cache and this.measure coordinates
        this.coords.cache.push(this.coordinate);
        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // create line and label
        if (this.coords.cache.length === 2) {
            // Update points status 
            this.pointCollection._pointPrimitives.map(p => {
                if (p?.id.includes(this.mode) && p?.status === "pending") {
                    p.status = "completed"
                }
            });

            // Remove moving line and label primitives
            this._removeMovingAnnotations();

            // create line primitive
            const linePrimitive = this.drawingHelper._addPolyline(
                this.coords.cache,
                {
                    color: this.stateManager.getColorState("line"),
                    id: "annotate_distance_line"
                }
            )
            linePrimitive.status = "completed"; // Set status to completed for the line primitive

            // create label primitive
            const distance = calculateDistance(this.coords.cache[0], this.coords.cache[1]);
            const labelPrimitive = this.drawingHelper._addLabel(
                [this.coords.cache[0], this.coords.cache[1]],
                distance,
                "meter",
                {
                    id: "annotate_distance_label"
                }
            )
            labelPrimitive.positions = [this.coords.cache[0], this.coords.cache[1]]; // store positions data in label primitive
            labelPrimitive.status = "completed"; // Set status to completed for the label primitive

            // Update this.measure
            this.measure._records.push(distance);
            this.measure.status = "completed";

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });
            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }

    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events to draw a moving line, update label, and display a moving pointer.
     * @param {{endPosition: Cartesian2}} movement - The mouse movement event.
     */
    handleMouseMove = async (eventData) => {
        // update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.coordinate = cartesian;

        const pickedObjects = eventData.pickedFeature;
        if (!defined(pickedObjects)) return;

        // update pointerOverlay: the moving dot with mouse
        const pointerElement = this.stateManager.getOverlayState("pointer");
        const pointerOverlay = updatePointerOverlay(this.viewer, pointerElement, cartesian, pickedObjects)
        this.stateManager.setOverlayState("pointer", pointerOverlay);

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete

        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length === 1) {
                    // Remove existing moving primitives
                    this._removeMovingAnnotations();

                    // Create current line primitive
                    const movingLinePrimitive = this.drawingHelper._addPolyline(
                        [this.coords.cache[0], this.coordinate],
                        {
                            color: this.stateManager.getColorState("move"),
                            id: "annotate_distance_line"
                        }
                    );
                    movingLinePrimitive.status = "moving"; // Set status to moving for the line primitive
                    this.interactivePrimitives.movingPolylines.push(movingLinePrimitive);

                    // Create or update label primitive
                    const distance = calculateDistance(this.coords.cache[0], cartesian);
                    // const midPoint = Cartesian3.midpoint(this.coords.cache[0], cartesian, new Cartesian3());
                    const labelPrimitive = this.drawingHelper._addLabel(
                        [this.coords.cache[0], cartesian],
                        distance,
                        "meter",
                        {
                            showBackground: false,
                            id: "annotate_distance_label"
                        }
                    );
                    labelPrimitive.show = this.flags.isShowLabels;
                    labelPrimitive.positions = [this.coords.cache[0], cartesian]; // store positions data in label primitive
                    labelPrimitive.status = "moving"; // Set status to moving for the label primitive
                    this.interactivePrimitives.movingLabels.push(labelPrimitive);
                }
                break;
            default:
                // this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    _handleAnnotationClick(pickedObject, pickedObjectType) {
        // Validate the picked object and type
        if (!pickedObject || !pickedObjectType) {
            return false;
        }

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                // only when it is not during measuring can edit the label. 
                if (this.coords.cache.length === 0) {
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this.viewer.container, pickedObject.primitive);
                }
                return true;
            case "point":
                return true;
            case "line":
                return true;
            default:
                return false;
        }
    }

    /*******************
     * HELPER FEATURES *
     *******************/
    resetValue() {
        super.resetValue();
    }

    _removePendingAnnotations() {
        // Remove pending annotations
        const pendingPoints = this.pointCollection._pointPrimitives.filter(point => point.status === "pending");
        if (Array.isArray(pendingPoints) && pendingPoints.length > 0) {
            pendingPoints.forEach(point => this.drawingHelper._removePointMarker(point));
        }

        const pendingLines = this.viewer.scene.primitives._primitives.filter(line => line && line.status === "pending");
        if (Array.isArray(pendingLines) && pendingLines.length > 0) {
            pendingLines.forEach(line => this.drawingHelper._removePolyline(line));
        }

        const pendingLabels = this.labelCollection._labels.filter(label => label && label.status === "pending");
        if (Array.isArray(pendingLabels) && pendingLabels.length > 0) {
            pendingLabels.forEach(label => this.drawingHelper._removeLabel(label));
        }
    }

    _removeMovingAnnotations() {
        // Remove moving annotations
        if (Array.isArray(this.interactivePrimitives.movingPolylines) && this.interactivePrimitives.movingPolylines.length > 0) {
            this.interactivePrimitives.movingPolylines.forEach((line) => {
                this.drawingHelper._removePolyline(line);
            });
            this.interactivePrimitives.movingPolylines.length = 0;
        }

        if (Array.isArray(this.interactivePrimitives.movingLabels) && this.interactivePrimitives.movingLabels.length > 0) {
            this.interactivePrimitives.movingLabels.forEach((label) => {
                this.drawingHelper._removeLabel(label);
            });
            this.interactivePrimitives.movingLabels.length = 0;
        }
    }

    createDragHandler() {
        // Return a Cesium-specific dragHandler with the appropriate callbacks
        const dragHandler = new CesiumDragHandler(this.viewer, this.inputHandler, {
            onDragBegin: this.handleCesiumDragStart.bind(this),
            onDrag: this.handleCesiumDrag.bind(this),
            onDragEnd: this.handleCesiumDragEnd.bind(this)
        });

        return dragHandler;
    }

    handleCesiumDragStart(eventData) {
        // console.log("down triggered")
        // console.log('Cesium drag started', eventData);
        // Cesium-specific logic for drag start
    }

    handleCesiumDrag(eventData) {
        // console.log('Cesium dragging', eventData);
        // Cesium-specific logic for drag in progress
    }

    handleCesiumDragEnd(eventData) {
        // console.log("up triggered")
        // console.log('Cesium drag ended', eventData);
        // Cesium-specific logic for drag end
    }
}

export { TwoPointsDistanceCesium };
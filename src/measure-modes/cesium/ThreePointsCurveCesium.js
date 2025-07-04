import {
    Cartesian3,
    defined,
    CatmullRomSpline
} from "cesium";
import {
    calculateDistance,
    editableLabel,
    updatePointerOverlay,
    formatDistance,
    areCoordinatesEqual,
    calculateMiddlePos,
    getRankedPickedObjectType,
} from "../../lib/helper/cesiumHelper.js";
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeCesium } from "./MeasureModeCesium.js";

// -- Cesium types --
/** @typedef {import('cesium').Primitive} Primitive */
/** @typedef {import('cesium').Label} Label*/
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
/** @typedef {import('cesium').Cartesian2} Cartesian2 */

// -- Data types -- 
/** @typedef {{polylines: Primitive[], labels: Label[]}} InteractiveAnnotationsState */
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

// -- Dependencies types --
/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/CesiumInputHandler.js').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../../lib/interaction/CesiumDragHandler.js').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../../lib/interaction/CesiumHighlightHandler.js').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/CesiumMeasure.js').CesiumMeasure} CesiumMeasure */


class ThreePointsCurveCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        polylines: [],
        labels: []
    };

    /** @type {MeasurementGroup} */
    measure = null;

    /** @type {Cartesian3[]} */
    coordCache = [];

    /**
    * 
    * @param {CesiumInputHandler} inputHandler 
    * @param {CesiumDragHandler} dragHandler 
    * @param {CesiumHighlightHandler} highlightHandler 
    * @param {CesiumMeasure} drawingHelper 
    * @param {StateManager} stateManager 
    * @param {EventEmitter} emitter 
    * @param {*} cesiumPkg 
    */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, cesiumPkg) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("ThreePointsCurveCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("curve", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        this.cesiumPkg = cesiumPkg;

        this.coordsCache = [];
        this.measure = super._createDefaultMeasure();
    }


    /**********
     * GETTER *
     **********/
    get interactiveAnnotations() {
        return this.#interactiveAnnotations;
    }


    /**********************
     *   EVENT HANDLER    *
     * FOR NORMAL MEASURE *
     **********************/
    /********************
     * LEFT CLICK EVENT *
     ********************/
    /**
     * Handles left-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleLeftClick = async (eventData) => {
        // use move position for the position
        const cartesian = this.#coordinate
        if (!defined(cartesian)) return;

        const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature, this.mode);

        // Try to handle click on an existing primitive first
        const handled = this._handleAnnotationClick(pickedObject, pickedObjectType);

        // If the click was not on a handled primitive and not in drag mode, start measuring
        if (!handled && !this.flags.isDragMode) {
            this._startMeasure();
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
                if (this.coordsCache.length === 0) {
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this._container, pickedObject.primitive);
                }
                return true;
            case "point":
                return false;   // False mean do not handle point click 
            case "line":
                return false;   // False mean do not handle line click, because it could click on moving line
            default:
                return false;
        }
    }

    /**
     * Initiates the measurement process by creating a new group or adding a point.
     */
    _startMeasure() {
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coordsCache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coordsCache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = this._createDefaultMeasure();

            // Establish data relation
            this.measure.coordinates = this.coordsCache; // when cache changed measure data changed, due to reference by address.
        }

        // Check if the current coordinate is near any existing point (distance < 0.3)
        const nearPoint = this._isNearPoint(this.#coordinate);
        if (nearPoint) return; // Do not create a new point if near an existing one

        // create a new point primitive
        const pointPrimitive = this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
        });
        if (!pointPrimitive) return; // If point creation fails, exit
        pointPrimitive.status = "pending"; // Set status to pending for the point primitive

        // Update the this.coords cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });


        // -- Handle Finishing the measure --
        if (this.coordsCache.length === 3) {
            // -- Update annotations status --
            // update points status
            // Using Cesium recommended public API way to update it instead of accessing via _pointPrimitives
            const collectionLength = this.pointCollection.length;
            for (let i = 0; i < collectionLength; i++) {
                const pointPrimitive = this.pointCollection.get(i);
                // pointPrimitive is guaranteed to be a valid primitive object here
                if (pointPrimitive.id?.includes(`annotate_${this.mode}`)) { // The check for pointPrimitive itself is less critical here
                    pointPrimitive.status = "completed";
                }
            }


            // -- Handle polyline
            this._createOrUpdateLine(this.coordsCache, this.#interactiveAnnotations.polylines, {
                status: "completed",
                color: this.stateManager.getColorState("line")
            });

            // -- Handle label --
            const { distance, curvePositions } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                showBackground: true
            });

            // -- Handle Data --
            this.measure._records.push(distance);
            this.measure.interpolatedPoints = curvePositions.map(pos => ({ ...pos })); // Store interpolated points
            this.measure.status = "completed";

            // -- Update Data Pool --
            dataPool.updateOrAddMeasure({ ...this.measure });

            // -- Update State --
            this.flags.isMeasurementComplete = true;

            // -- Reset Values --
            // Clean up the current measure state, to prepare for the next measure
            this.coordsCache = [];
            this.#interactiveAnnotations.polylines = []; // Clear the interactive polylines
            this.#interactiveAnnotations.labels = []; // Clear the interactive labels
        }
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Void}
     */
    handleMouseMove = async (eventData) => {
        // update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.#coordinate = cartesian;

        const pickedObjects = eventData.pickedFeature;
        if (!defined(pickedObjects)) return;

        // update pointerOverlay: the moving dot with mouse
        const pointerElement = this._setupPointerOverlay();
        if (pointerElement) {
            const pointerOverlay = updatePointerOverlay(this.map, pointerElement, cartesian, pickedObjects)
            this.stateManager.setOverlayState("pointer", pointerOverlay);
        }

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete
        switch (true) {
            case isMeasuring:
                // moving coordinate data
                const positions = [...this.coordsCache, this.#coordinate];

                // Moving line: remove if existed, create if not existed
                this._createOrUpdateLine(positions, this.#interactiveAnnotations.polylines, {
                    status: "moving",
                    color: this.stateManager.getColorState("move")
                });

                // Moving label: update if existed, create if not existed
                this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                    status: "moving",
                    showBackground: false
                });
                break;
            default:
                // this.handleHoverHighlighting(pickedObjects[0]);
                break;
        }
    }

    /******************
    * EVENT HANDLING *
    *    FOR DRAG    *
    ******************/
    /**
     * Handle graphics updates during dragging operation.
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    updateGraphicsOnDrag(measure) {
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // -- Handle polyline --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "moving",
            color: this.stateManager.getColorState("move")
        });

        // -- Handle label --
        this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            showBackground: false
        });
    }

    /**
     * Finalize graphics updates for the end of drag operation
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    finalizeDrag(measure) {
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // -- Finalize Line Graphics --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Finalize Label Graphics --
        const { distance, curvePositions } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });

        // --- Update Measure Data ---
        measure._records = [distance]; // Update new distance record
        measure.interpolatedPoints = curvePositions.map(pos => ({ ...pos })); // Store interpolated points
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.status = "completed"; // Update the measure status

        return measure;
    }


    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * Updates line primitive by removing the existing one and creating a new one.
     * @param {Cartesian3[]} positions - Array of positions to create or update the line.
     * @param {Primitive[]} polylinesArray - Array to store the line primitive reference. Caution: it is not the polyline collection.
     * @param {object} options - Options for line creation or update.
     * @returns {void}
     */
    _createOrUpdateLine(positions, polylinesArray, options = {}) {
        // default options
        const {
            status = null,
            color = this.stateManager.getColorState("line")
        } = options

        // -- Check for and remove existing polyline --
        if (Array.isArray(polylinesArray) && polylinesArray.length > 0) {
            const existingLinePrimitive = polylinesArray[0]; // Get reference to the existing primitive
            if (existingLinePrimitive) {
                this.drawingHelper._removePolyline(existingLinePrimitive);
            }
            // Clear the array passed by reference. This modifies the original array (e.g., this.#interactiveAnnotations.polylines)
            polylinesArray.length = 0;
        }

        // -- Create new polyline --
        // if positions length more than 2 then use curve interpolation, else use the original positions
        const linePositions = positions.length > 2 ? this._computeCurveInterpolatedPoints(positions, 20) : positions;

        // Create the new polyline primitive
        const newLinePrimitive = this.drawingHelper._addPolyline(linePositions, {
            color,
            id: `annotate_${this.mode}_line_${this.measure.id}` // Consider making ID more specific if needed (e.g., adding status)
        });

        // If creation failed, exit
        if (!newLinePrimitive) {
            console.error("Failed to create new polyline primitive.");
            return; // Explicitly return
        }

        // -- Handle Metadata Update --
        newLinePrimitive.status = status; // Set status on the new primitive

        // -- Handle References Update --
        // Push the new primitive into the array passed by reference.
        if (Array.isArray(polylinesArray)) {
            polylinesArray.push(newLinePrimitive);
        } else {
            console.warn("_createOrUpdateLine: polylinesArray argument is not an array. Cannot store new primitive reference.");
        }
    }

    /**
     * Creates or updates a label primitive based on the provided positions.
     * @param {Cartesian3[]} positions - the positions to create or update the label. 
     * @param {Label[]} labelsArray - the array to store the label primitive reference. Caution: it is not the label collection.
     * @param {object} options - options for label creation or update.
     * @returns {void}
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distance: null, labelPrimitive: null }; // Validate input positions
        }

        // default options
        const {
            status = null,
            showBackground = true,
        } = options;

        // Compute the curve interpolation points
        let curvePositions = [];
        if (positions.length > 2) {
            const [start, middle, end] = positions;
            const numberInterpolationPoints = Math.max(
                Math.round(Cartesian3.distance(start, middle) + Cartesian3.distance(middle, end)) * 5, 20
            );
            curvePositions = this._computeCurveInterpolatedPoints(positions, numberInterpolationPoints)
        } else {
            curvePositions = positions;
        }

        const distance = curvePositions.length > 2 ? this._measureCurveDistance(curvePositions) : calculateDistance(positions[0], positions[1]);
        const formattedText = formatDistance(distance);
        const middlePos = calculateMiddlePos(positions);

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { distance, labelPrimitive: null }; // Return distance but null primitive
        }

        let labelPrimitive = null;

        // -- Update label if existed--
        if (labelsArray.length > 0) {
            labelPrimitive = labelsArray[0]; // Get reference to the existing label primitive

            if (!labelPrimitive) {
                console.warn("_createOrUpdateLabel: Invalid object found in labelsArray. Attempting to remove and recreate.");
                labelsArray.length = 0; // Clear the array to trigger creation below
            } else {
                // -- Handle Label Visual Update --
                labelPrimitive.position = middlePos;
                labelPrimitive.text = formattedText;
                labelPrimitive.showBackground = showBackground; // Set background visibility
            }
        }

        // -- Create new label (if no label existed in labelsArray or contained invalid object) --
        if (!labelPrimitive) {
            labelPrimitive = this.drawingHelper._addLabel(curvePositions, distance, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
            });

            if (!labelPrimitive) {
                console.error("_createOrUpdateLabel: Failed to create new label primitive.");
                return { distance, labelPrimitive: null }; // Return distance but null primitive
            }

            // -- Handle References Update --
            labelsArray.push(labelPrimitive);
        }

        // -- Handle Label Metadata Update --
        labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions
        labelPrimitive.status = status; // Set status

        return { distance, labelPrimitive, curvePositions };
    }

    /**
      * Creates an array of interpolated curve points between three specified points.
      * @param {Cartesian3[]} cartesianArray - An array of three Cartesian3 points representing the start, middle, and end points of the curve.
      * @param {number} numInterpolationPoints - The number of interpolation points to generate.
      * @returns {Cartesian3[]} An array of Cartesian3 points representing the curve.
      */
    _computeCurveInterpolatedPoints(cartesianArray, numInterpolationPoints) {
        if (!Array.isArray(cartesianArray) || cartesianArray.length !== 3) return [];

        // Deconstruct the array into three points
        const [startPoint, middlePoint, endPoint] = cartesianArray;

        const spline = new CatmullRomSpline({
            times: [0, 0.5, 1],
            points: [startPoint, middlePoint, endPoint],
        });

        const interpolatedPoints = Array.from({ length: numInterpolationPoints }, (_, i) =>
            spline.evaluate(i / (numInterpolationPoints - 1))
        );

        // Ensure the start, middle, and end points are included
        if (!Cartesian3.equals(interpolatedPoints[0], startPoint)) {
            interpolatedPoints.unshift(startPoint);
        }
        if (!Cartesian3.equals(interpolatedPoints[Math.floor(numInterpolationPoints / 2)], middlePoint)) {
            interpolatedPoints.splice(Math.floor(numInterpolationPoints / 2), 0, middlePoint);
        }
        if (!Cartesian3.equals(interpolatedPoints[interpolatedPoints.length - 1], endPoint)) {
            interpolatedPoints.push(endPoint);
        }

        return interpolatedPoints;
    }

    /**
     * Calculates the total distance along a curve defined by an array of points.
     * @param {Cartesian3[]} curvePoints - The points along the curve.
     * @returns {number} The total distance of the curve.
     */
    _measureCurveDistance(curvePoints) {
        if (!Array.isArray(curvePoints) && curvePoints.length === 0) return null;

        const distance = curvePoints.reduce(
            (acc, point, i, arr) =>
                i > 0
                    ? acc + Cartesian3.distance(arr[i - 1], point)
                    : acc,
            0
        );
        return distance;
    }

    /**
     * Resets values specific to the mode.
     */
    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset variables
        this.coordsCache = [];
        this.#coordinate = null;
        this.#interactiveAnnotations.polylines = [];
        this.#interactiveAnnotations.labels = [];

        // Reset the measure data
        this.measure = super._createDefaultMeasure();
    }
}

export { ThreePointsCurveCesium };
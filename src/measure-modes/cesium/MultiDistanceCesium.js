import {
    Cartesian3,
    defined,
} from "cesium";
import {
    calculateDistance,
    editableLabel,
    updatePointerOverlay,
    formatDistance,
    areCoordinatesEqual,
    calculateMiddlePos,
    getNeighboringValues,
    getPrimitiveByPointPosition,
    convertToCartesian3,
    showCustomNotification,
    getRankedPickedObjectType
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



/**
 * Handles multiple distance measurement specifically for Cesium Map.
 * @extends {MeasureModeCesium}
 */
class MultiDistanceCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        polylines: [],
        labels: [],
        totalLabels: [],
        addModeLines: [],
    };

    /** @type {MeasurementGroup} */
    measure = null;

    /** @type {Cartesian3[]} */
    coordCache = [];

    #distances = [];

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
            throw new Error("TwoPointsDistanceCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("multi_distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        this.flags.isAddMode = false;
        this.flags.isReverse = false;

        this.cesiumPkg = cesiumPkg;

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
     **********************/
    /********************
     * LEFT CLICK EVENT *
     ********************/
    /**
     * Handles left-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Promise<void>}
     */
    handleLeftClick = async (eventData) => {
        // use move position for the position
        const cartesian = this.#coordinate
        if (!defined(cartesian)) return;

        // -- Handle Picked Object Priority -- 
        const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature, this.mode);

        // -- Handle interactive event --
        const handled = this._handleAnnotationClick(pickedObject, pickedObjectType);

        // -- Normal Measure --
        // If the click was not on a handled primitive and not in drag mode, start normal measuring
        if (!handled && !this.flags.isDragMode && !this.flags.isAddMode) {
            this._startMeasure();
        }

        // -- Add Mode --
        if (!handled && this.flags.isAddMode) {
            this._addAction();
        }
    }

    _handleAnnotationClick(pickedObject, pickedObjectType) {
        // Validate the picked object and type
        if (!pickedObject) {
            return false;
        }

        // Handle different scenarios based on the clicked primitive type and the state of the tool
        switch (pickedObjectType) {
            case "label":
                // only when it is not during measuring can edit the label. 
                if (this.coordsCache.length === 0) {
                    // DO NOT use the flag isMeasurementComplete because reset will reset the flag
                    editableLabel(this.map.container, pickedObject.primitive);
                }
                return true;
            case "point":
                const point = pickedObject.primitive;

                // this._selectAction(pickedObject.primitive);

                // if it is during measuring 
                if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) {
                    const pointIndex = this.coordsCache.findIndex(coordinate => areCoordinatesEqual(coordinate, point.position));
                    if (pointIndex === -1) return false;
                    const isFirstPoint = pointIndex === 0;

                    // if it click on the first point then forms perimeter
                    if (isFirstPoint) {
                        // -- Feature: forms perimeter --
                        this._formsPerimeter(point);
                    }
                }
                // if it is not measuring
                else {
                    // -- Feature: resume measure --
                    // if click on the first or last point then resume measure
                    this._resumeMeasure(point);
                }
                return true;   // False mean do not handle point click 
            case "line":
                if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) {
                    this._setAddModeByLine(pickedObject.primitive); // Set the add mode by line primitive
                    return true;
                }
                // this._selectAction(pickedObject.primitive);

                return false;   // False mean do not handle line click, because it could click on moving line
            default:
                return false;
        }
    }

    _formsPerimeter(point) {
        const pointPosition = point.position;

        // const positions = [this.coordsCache[this.coordsCache.length - 1], pointPosition];
        this.coordsCache.push(pointPosition); // Add the point to the cache

        this._finalizeMeasure(); // Finalize the measurement
    }

    _resumeMeasure(point) {
        // Find the measure data
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return;

        // Confirm the resume action
        const confirmResume = window.confirm(`Do you want to resume this measure? id: ${measureId}`);
        if (!confirmResume) return;

        // -- Handle Measure Data --
        // Get the measure data from the data pool
        const measureData = dataPool.getMeasureById(measureId);
        if (!measureData) return;

        // convert measure data coordinates from cartographic degrees to Cartesian3
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToCartesian3(cartographicDegrees));
        this.measure = measureData;
        this.measure.status = "pending"; // Set the measure status to pending

        // Find the index of the point in the measure coordinates
        const pointIndex = this.measure.coordinates.findIndex(coordinate => areCoordinatesEqual(coordinate, point.positions[0]));

        // -- Resume Measure --
        // Resume measure only when the point is the first or last point
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === this.measure.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            // Set variables and flags to resume measuring
            this.coordsCache = this.measure.coordinates;

            this.flags.isMeasurementComplete = false; // reset the flag to continue measuring
            this.flags.isReverse = isFirstPoint; // If the point is the first point, set the reverse flag to true

            // Resume start the measurement process
            this._startMeasure(); // Start the measurement process
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

        // Update the coordsCache based on the measurement direction
        if (this.flags.isReverse) {
            this.coordsCache.unshift(this.#coordinate);
        } else {
            this.coordsCache.push(this.#coordinate);
        }

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });

        if (this.coordsCache.length > 1) {
            // Determine the indices of the previous and current points based on the measurement direction
            const [prevIndex, currIndex] = this.flags.isReverse
                ? [0, 1] // If reversing, use the first two points
                : [this.coordsCache.length - 2, this.coordsCache.length - 1]; // Otherwise, use the last two points

            const positions = [this.coordsCache[prevIndex], this.coordsCache[currIndex]];

            // -- Create Annotations --
            // Create the line
            this._createOrUpdateLine(positions, this.#interactiveAnnotations.polylines, {
                status: "pending",
                color: this.stateManager.getColorState("line")
            });

            // Create the label
            const { distances } = this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                status: "pending",
                showBackground: true
            });

            // -- Handle Distances record --
            this.#distances.push(...distances); // Store the distance in the cache

            // Create the total label
            const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
                status: "pending",
                showBackground: false
            });

            // -- Update current measure data --
            this.measure.status = "pending";
            if (this.#distances.length > 0 && typeof totalDistance === "number") {
                const record = { distances: [...this.#distances], totalDistance };
                this.measure._records[0] = record // Update distances record
            }

            // Update dataPool with the measure data
            dataPool.updateOrAddMeasure({ ...this.measure });
        }
    }

    _addAction() {
        const line = this.#interactiveAnnotations.polylines[0];
        if (!line || line.status === "moving") {
            console.warn("No valid line to add a point to.");
            return;
        }

        // -- Update this.coordsCache --
        const linePositions = line.positions;
        const linePos1Index = this.coordsCache.findIndex(pos => areCoordinatesEqual(pos, linePositions[0]));
        const linePos2Index = this.coordsCache.findIndex(pos => areCoordinatesEqual(pos, linePositions[1]));
        if (linePos1Index === -1 || linePos2Index === -1) return; // If positions are not found, exit
        const minIndex = Math.min(linePos1Index, linePos2Index);
        this.coordsCache.splice(minIndex + 1, 0, this.#coordinate); // Insert the new coordinate after the first position of the line

        // -- Create new point --
        this.drawingHelper._addPointMarker(this.#coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            status: "completed"
        });

        const newPositions = [[linePositions[0], this.#coordinate], [this.#coordinate, linePositions[1]]]; // Create new positions for the line

        // -- Create or update the line --
        this._createOrUpdateLine(newPositions, this.#interactiveAnnotations.polylines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Create or update the label --
        const { distances } = this._createOrUpdateLabel(newPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            showBackground: true
        });
        if (distances.length === 0) return;

        // -- Handle Distances record --
        this.#distances.splice(minIndex, 1, ...distances);

        // -- Update total distance label --
        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "completed",
            showBackground: true
        });

        // -- Update measure data --
        if (distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record; // Update distances record
        }
        this.measure.status = "completed"; // Set the measure status to completed
        this.measure.coordinates = this.coordsCache.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        dataPool.updateOrAddMeasure({ ...this.measure }); // Update data pool with the measure data

        // -- Reset values --
        this.resetValuesModeSpecific(); // Reset the mode-specific values

        // reset the flags to be ready for the next measurement
        this.flags.isMeasurementComplete = true; // Set the measurement as complete
    }

    _selectAction(primitive) {
        console.log("selected:", primitive);
    }


    /***********************
     * MOUSE MOVE FEATURES *
     ***********************/
    /**
     * Handles mouse move events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Promise<void>}
     */
    handleMouseMove = async (eventData) => {
        // update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.#coordinate = cartesian;

        const pickedObjects = eventData.pickedFeature;
        if (!defined(pickedObjects)) return;

        // update pointerOverlay: the moving dot with mouse
        const pointerElement = this.stateManager.getOverlayState("pointer");
        const pointerOverlay = updatePointerOverlay(this.map, pointerElement, cartesian, pickedObjects)
        this.stateManager.setOverlayState("pointer", pointerOverlay);

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete
        switch (true) {
            case isMeasuring:
                // Moving coordinate data
                const positions = this.flags.isReverse ?
                    [this.coordsCache[0], this.#coordinate] :
                    [this.coordsCache[this.coordsCache.length - 1], this.#coordinate];

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


    /************************
     * RIGHT CLICK FEATURES *
     ************************/
    /**
     * Handles right-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Promise<void>}
     */
    handleRightClick = async (eventData) => {
        if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.#coordinate;
            if (!defined(cartesian)) return;

            // update coordinate data cache
            if (this.flags.isReverse) {
                this.coordsCache.unshift(this.#coordinate);
            } else {
                this.coordsCache.push(this.#coordinate);
            }

            // Create last point
            const lastPoint = this.drawingHelper._addPointMarker(this.#coordinate, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
                status: "completed"
            });
            if (!lastPoint) return; // If point creation fails, exit

            this._finalizeMeasure();
        }
    }

    _finalizeMeasure() {
        const lastPositions = this.flags.isReverse ?
            [this.coordsCache[0], this.coordsCache[1]] :
            [this.coordsCache[this.coordsCache.length - 2], this.coordsCache[this.coordsCache.length - 1]];

        // -- Create last annotations --
        // Create last line
        this._createOrUpdateLine(lastPositions, this.#interactiveAnnotations.polylines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });
        // Create last label
        const { distances } = this._createOrUpdateLabel(lastPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            showBackground: true
        });

        // -- Handle Distances record --
        this.#distances.push(...distances); // Store the last distance in the cache

        // -- Update the last total label --
        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "completed",
            showBackground: true
        });


        // -- Update annotations status --
        // update points status
        // Using Cesium recommended public API way to update it instead of accessing via _pointPrimitives
        const pointCollectionLength = this.pointCollection.length;
        for (let i = 0; i < pointCollectionLength; i++) {
            const pointPrimitive = this.pointCollection.get(i);
            // pointPrimitive is guaranteed to be a valid primitive object here
            if (pointPrimitive.id?.includes(`annotate_${this.mode}`)) { // The check for pointPrimitive itself is less critical here
                pointPrimitive.status = "completed";
            }
        }
        // update lines status
        const pendingLines = this.#interactiveAnnotations.polylines.filter(line => line.status === "pending");
        pendingLines.forEach(line => {
            line.status = "completed";
        });
        // update labels status
        const pendingLabels = this.#interactiveAnnotations.labels.filter(label => label.status === "pending");
        pendingLabels.forEach(label => {
            label.status = "completed";
        });


        // -- Update measure data --
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record // Update distances record
        }
        this.measure.coordinates = this.coordsCache.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        this.measure.status = "completed"; // Update the measure status

        // update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Reset to clean up after finish
        this.resetValuesModeSpecific();

        // -- Set state --
        this.flags.isMeasurementComplete = true; // Set the measurement as complete
    }


    /************************
     * MIDDLE CLICK FEATURE *
     ************************/
    /**
     * Handles middle-click events on the map.
     * @param {NormalizedEventData} eventData - The event data containing information about the click event.
     * @returns {Promise<void>}
     */
    handleMiddleClick = async (eventData) => {
        // use move position for the position
        const cartesian = this.#coordinate
        if (!defined(cartesian)) return;

        const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature, this.mode);

        switch (pickedObjectType) {
            case "label":
                return;
            case "point":
                const point = pickedObject.primitive;
                this._removePointFromMeasure(point);
                this._removeRemaining();
                return;
            case "line":
                // const line = pickedObject.primitive;
                // this._removeLineSet(line);
                return;   // False mean do not handle line click, because it could click on moving line
            default:
                return;
        }
    }

    /**
     * Removes a point primitive during measurement.
     * @param {PointPrimitive} point - The point primitive to remove. 
     * @returns {void} 
     */
    _removePointFromMeasure(point) {
        // Validate input parameters
        if (!point || !point.position) return;

        // confirmation 
        const userConfirmation = window.confirm(`Do you want to remove this point?`) // Confirm the removal action
        if (!userConfirmation) return;

        // -- Remove point --
        this.drawingHelper._removePointMarker(point); // Remove the point primitive

        // -- Set Measure and Distances --
        // Find the measure data by ID
        const measureId = Number(point.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID 

        this.measure = this._findMeasureById(measureId);    // Set the measure
        if (!this.measure) return;  // If the measure is not found, exit
        this.#distances = [...measure._records[0].distances]; // Get the distances from the measure data
        this.coordsCache = measure.coordinates // Get the coordinates from the measure data

        // Find the point index in the coordsCache
        const pointIndex = this.coordsCache.findIndex(coordinate => areCoordinatesEqual(coordinate, point.position));
        if (pointIndex === -1) return; // If the point is not found, exit

        // Find neighboring coordinate
        const { previous, current, next } = getNeighboringValues(this.coordsCache, pointIndex);

        // Remove the point from the cache
        this.coordsCache.splice(pointIndex, 1);

        // -- Remove related annotations --
        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(point.position,
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection,
        )
        // remove related lines
        linePrimitives.forEach(line => {
            this.drawingHelper._removePolyline(line); // Remove the line primitive

            const lineToRemoveIndex = this.#interactiveAnnotations.polylines.findIndex(l => areCoordinatesEqual(l.positions[0], line.positions[0]) && areCoordinatesEqual(l.positions[1], line.positions[1]));
            if (lineToRemoveIndex === -1) return; // If the line is not found, exit
            this.#interactiveAnnotations.polylines.splice(lineToRemoveIndex, 1); // Remove the line from this interactive annotations
        });
        // remove related labels
        labelPrimitives.forEach(label => {
            const isTotalLabel = label.id.startsWith(`annotate_${this.mode}_total_label`);
            const isMovingLabel = label.status === "moving";
            if (isTotalLabel || isMovingLabel) return;

            this.drawingHelper._removeLabel(label); // Remove the label primitive            

            // remove the label from this.#interactiveAnnotations
            const labelToRemoveIndex = this.#interactiveAnnotations.labels.findIndex(l => areCoordinatesEqual(l.position, label.position));
            if (labelToRemoveIndex === -1) return; // If the label is not found, exit
            this.#interactiveAnnotations.labels.splice(labelToRemoveIndex, 1);
        });


        // -- Handle Reconnection and distance record --
        if (previous && next) {
            const reconnectedPositions = [previous, next];

            // -- Create polyline --
            this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                status: "pending",
                color: this.stateManager.getColorState("line")
            });
            // -- Create label --
            const { distances } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                status: "pending",
                showBackground: true
            });

            // -- Handle Distances record --
            // Don't calculate all distances from coordsCache due to performance and consistency
            this.#distances.splice(pointIndex - 1, 2);
            this.#distances.splice(pointIndex - 1, 0, distances[0]);
        }
        // it is the first point, as it doesn't have previous point
        // click on the first point will forms perimeter so this won't be executed
        else if (next) {
            this.#distances.splice(pointIndex, 1) // Remove the first distance
        }
        // it is the last point, as it doesn't have next point
        else if (previous) {
            this.#distances.splice(pointIndex - 1, 1); // Remove the last distance
        }


        // -- Reposition the total label --
        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.#interactiveAnnotations.totalLabels, {
            status: "pending",
            showBackground: this.flags.isMeasurementComplete ? true : false
        });

        // -- Update current measure data --
        this.measure.status = "pending"; // Update the measure status
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record // Update distances record
        }
        // Update dataPool with the measure data
        dataPool.updateOrAddMeasure({ ...this.measure });
    }

    _removeRemaining() {
        if (this.coordsCache.length === 1) {
            const lastPosition = this.coordsCache[0];

            // Find if there are any lines at the last position
            const lastLines = this.drawingHelper._getLineByPositions([lastPosition]);
            if (Array.isArray(lastLines) && lastLines.length > 0) return; // If there are lines, do not remove the last point

            // Remove the remaining point and labels 
            const lastPoint = this.drawingHelper._getPointByPosition(lastPosition);
            const lastLabels = this.drawingHelper._getLabelByPosition([lastPosition]);

            if (lastPoint) {
                this.drawingHelper._removePointMarker(lastPoint); // Remove the last point primitive
            }
            if (lastLabels.length > 0) {
                lastLabels.forEach(label => {
                    this.drawingHelper._removeLabel(label);
                });
            }

            // -- Handle Measure Data -- 
            const measureId = Number(lastPoint.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
            if (isNaN(measureId)) return; // If the measure ID is not a number, exit
            this.coordsCache = []; // Clear the coordsCache
            this.#distances = []; // Clear the distances cache
            dataPool.removeMeasureById(measureId);
        }
    }


    /*****************************
     * DOUBLE LEFT CLICK FEATURE *
     *****************************/
    // handleLeftDoubleClick = async (eventData) => {
    //     if (eventData.pickedFeature.length === 0) return; // If no feature is picked, exit

    //     // clone the left click handler then remove it when setAddMode finish then recover it

    //     // Prevent condition to start double click
    //     if (!this.flags.isMeasurementComplete || this.coordsCache > 0) return;
    //     if (this.flags.isDragMode) return;
    //     const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature, this.mode);

    //     if (pickedObjectType === "line") {
    //         const linePrimitive = pickedObject.primitive;
    //         this.setAddModeByLine(linePrimitive);
    //     }
    // }

    _setAddModeByLine(linePrimitive) {
        // Validate input parameters
        if (!linePrimitive) return;
        if (linePrimitive.status === "moving") return;

        // -- Set measure id --
        const measureId = Number(linePrimitive.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID

        // -- User confirmation --
        const userConfirmation = window.confirm(`Do you want to add mode to add a new point to this segment? Measure id: ${measureId}`);
        if (!userConfirmation) return; // If the user does not confirm, exit

        // Set the measure data
        this.measure = this._findMeasureById(measureId);
        if (!this.measure) return; // If the measure is not found, exit
        this.coordsCache = this.measure.coordinates;
        this.#distances = [...this.measure._records[0].distances]; // Get the distances from the measure data

        // Update measure data and dataPool
        this.measure.status = "pending"; // Set the measure status to pending
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Set flags for add mode
        this.flags.isAddMode = true; // Set the add mode flag to true

        // Store references 
        this.#interactiveAnnotations.polylines = [linePrimitive];  // Store the line primitive in the interactive annotations

        // Due to update method logic only update on existing label, so it need to clone it again to update two labels 
        const existingLabel = this.drawingHelper._getLabelByPosition(linePrimitive.positions)[0];
        if (!existingLabel) return; // If no label is found, exit
        const clonedLabel = this.labelCollection.add(existingLabel);
        this.#interactiveAnnotations.labels = [existingLabel, clonedLabel];

        this.#interactiveAnnotations.totalLabels = [...this.drawingHelper._getLabelByPosition(this.coordsCache[this.coordsCache.length - 1])]; // Get the total label by the last position of the coordsCache

        // Show notification
        showCustomNotification(`Add mode is enabled. Click on the map to add a new point for segment, measure id: ${measureId}`, this.map.container);
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
        // -- Handling positions -- 
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // If the dragged position is not found, exit
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate;

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndex);

        let draggedPositions = [];
        // -- Handle dragged positions --
        if (previous && next) {
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {
            draggedPositions = [[this.dragHandler.coordinate, next]];
        }
        // FIXME: there is a perimeter scenario that is not handled

        if (draggedPositions.length === 0) return; // safe exit if no dragged positions are available

        // -- Update polyline --
        this._createOrUpdateLine(draggedPositions, this.dragHandler.draggedObjectInfo.lines, {
            status: "moving",
            color: this.stateManager.getColorState("move")
        });

        // -- Update label --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "moving",
            showBackground: false
        });


        // -- Handle Distances record --
        this.#distances = [...measure._records[0].distances];
        // Case: distances length is 1 means the draggedPositionIndex is the first or last index in the measure coordinates
        if (distances.length === 1) {
            const isFirstIndex = draggedPositionIndex + 1 < positions.length;
            const isLastIndex = draggedPositionIndex - 1 >= 0;
            if (isFirstIndex) {
                this.#distances[0] = distances[0]; // Update the first distance
            } else if (isLastIndex) {
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
            }

        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            this.#distances[draggedPositionIndex - 1] = distances[0];
            this.#distances[draggedPositionIndex] = distances[1];
        } else {
            console.warn("Unexpected distances length during drag finalization:", distances.length);
            return; // Exit if the distances length is not as expected
        }


        // -- Handle total label --
        this._createOrUpdateTotalLabel(positions, this.dragHandler.draggedObjectInfo.totalLabels, {
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
        // -- Handling positions -- 
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // If the dragged position is not found, exit
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate;

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndex);

        let draggedPositions = [];

        // -- Handle dragged positions --
        if (previous && next) {
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {
            draggedPositions = [[this.dragHandler.coordinate, next]];
        }
        if (draggedPositions.length === 0) return; // safe exit if no dragged positions are available

        // -- Finalize Line Graphics --
        // -- Handle polyline --
        this._createOrUpdateLine(draggedPositions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Finalize Label Graphics --
        const { distances } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });


        // -- Handle Distances record --
        this.#distances = [...measure._records[0].distances];
        // Case: distances length is 1 means the draggedPositionIndex is the first or last index in the measure coordinates
        if (distances.length === 1) {
            const isFirstIndex = draggedPositionIndex + 1 < positions.length;
            const isLastIndex = draggedPositionIndex - 1 >= 0;
            if (isFirstIndex) {
                this.#distances[0] = distances[0]; // Update the first distance
            } else if (isLastIndex) {
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
            }
        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            this.#distances[draggedPositionIndex - 1] = distances[0];
            this.#distances[draggedPositionIndex] = distances[1];
        } else {
            console.warn("Unexpected distances length during drag finalization:", distances.length);
            return; // Exit if the distances length is not as expected
        }


        // -- Finalize Total Label Graphics --
        const { totalDistance } = this._createOrUpdateTotalLabel(positions, this.dragHandler.draggedObjectInfo.totalLabels, {
            status: "completed",
            showBackground: true
        });


        // --- Update Measure Data ---
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            measure._records[0] = record; // Update distances record
        }
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
     * @param {Primitive[]} polylinesArray - Array to store the line primitive reference of the operation not the polyline collection.
     * @param {object} options - Options for line creation or update.
     * @returns {void}
     */
    _createOrUpdateLine(positions, polylinesArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(polylinesArray) || !Array.isArray(positions) || positions.length === 0) {
            console.warn("_createOrUpdateLine: input parameters are invalid.");
            return;
        }

        // default options
        const {
            status = "pending",
            color = this.stateManager.getColorState("line"),
            ...rest
        } = options;

        // Determine if `positions` represents multiple line segments (typically for drag)
        const isNested = positions.length > 0 && Array.isArray(positions[0]);

        // 2. REMOVAL PHASE
        // -- Check for and remove existing polyline --
        if (polylinesArray.length > 0) {
            // Case: remove all lines if positions is nested. Nested positions means it is from dragging operation
            if (isNested) {
                // remove all lines in the lines array
                polylinesArray.forEach(lineToRemove => {
                    this.drawingHelper._removePolyline(lineToRemove);
                });
                polylinesArray.length = 0; // Clear the array
            }
            // Case: remove lines that has status "moving"
            else {
                for (let i = polylinesArray.length - 1; i >= 0; i--) {
                    const line = polylinesArray[i];
                    // Ensure line exists and has a status property before checking
                    if (line && line.status === "moving") {
                        this.drawingHelper._removePolyline(line);
                        polylinesArray.splice(i, 1);
                    }
                }
            }
        }
        // 3. CREATION PHASE
        if (isNested) {
            // -- Create multiple polylines for nested positions --
            positions.forEach(posSet => {
                const newLinePrimitive = this.drawingHelper._addPolyline(posSet, {
                    color,
                    id: `annotate_${this.mode}_line_${this.measure.id}`, // Consider making ID more specific if needed (e.g., adding status)
                    ...rest
                });
                if (!newLinePrimitive) return;

                // -- Handle Metadata Update --
                newLinePrimitive.status = status; // Set status on the new primitive
                // -- Handle References Update --
                polylinesArray.push(newLinePrimitive);
            })
        } else {
            // -- Create a new single polyline --
            const newLinePrimitive = this.drawingHelper._addPolyline(positions, {
                color,
                id: `annotate_${this.mode}_line_${this.measure.id}`, // Consider making ID more specific if needed (e.g., adding status)
                ...rest
            });
            if (!newLinePrimitive) return;

            // -- Handle Metadata Update --
            newLinePrimitive.status = status; // Set status on the new primitive
            // -- Handle References Update --
            polylinesArray.push(newLinePrimitive);
        }
    }


    /**
     * 
     * @param {Cartesian3[]} positions - the positions to create or update the label. 
     * @param {Label[]} labelsArray - the array to store the label primitive reference of the operation not the label collection.
     * @param {object} [options={}] - options for label creation or update.
     * @returns {{distances: number[], labelPrimitives: Label[]|null}}
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelPrimitives: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            showBackground = true,
            ...rest
        } = options;

        // Determine if `positions` represents multiple line segments (typically for drag)
        const isNested = Array.isArray(positions[0]);

        let distances = [];
        let labelPrimitives = [];

        // 2. UPDATE LOGIC
        if (labelsArray.length > 0) {
            // Case: update MULTIPLE LABELS, typically for drag operation
            if (isNested) {
                // Assume: nested positions length should be same as labelsArray length
                positions.forEach((posSet, index) => {
                    labelPrimitives = labelsArray;
                    const segmentDistance = calculateDistance(posSet[0], posSet[1]);
                    const segmentFormattedText = formatDistance(segmentDistance);
                    const segmentMiddlePos = calculateMiddlePos(posSet);
                    if (!segmentDistance || !segmentMiddlePos) return;

                    const labelToUpdate = labelPrimitives[index];
                    // -- Handle Label Visual Update --
                    labelToUpdate.position = segmentMiddlePos;
                    labelToUpdate.text = segmentFormattedText;
                    labelToUpdate.showBackground = showBackground;

                    // -- Handle Label Metadata Update --
                    labelToUpdate.status = status;
                    labelToUpdate.positions = posSet.map(pos => ({ ...pos })); // store positions

                    // -- Handle records Update --
                    segmentDistance && distances.push(segmentDistance); // Collect distances for each segment
                });
            }
            // Case: update SINGLE LABEL, typically for moving operation 
            else {
                const segmentDistance = calculateDistance(positions[0], positions[1]);
                const segmentFormattedText = formatDistance(segmentDistance);
                const segmentMiddlePos = calculateMiddlePos(positions);

                const labelPrimitive = labelsArray.find(label => label.status === "moving");
                if (labelPrimitive) {
                    // -- Handle Label Visual Update --
                    labelPrimitive.position = segmentMiddlePos;
                    labelPrimitive.text = segmentFormattedText;
                    labelPrimitive.showBackground = showBackground; // Set background visibility

                    // -- Handle Label Metadata Update --
                    labelPrimitive.status = status;
                    labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions

                    // -- Handle references Update --
                    labelPrimitives = [labelPrimitive]; // Get the label that is currently being moved
                    segmentDistance ? distances = [segmentDistance] : distances = []; // Store the distance for the single segment
                }
            }
        }

        // 3. CREATE LOGIC
        if (labelPrimitives.length === 0) {
            const segmentDistance = calculateDistance(positions[0], positions[1]);
            if (!segmentDistance) console.warn("Failed to calculate segment distance.");

            const labelPrimitive = this.drawingHelper._addLabel(positions, segmentDistance, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
                ...rest
            });

            // Update the distances 
            segmentDistance ? distances = [segmentDistance] : distances = []; // Store the distance for the single segment

            // Safe exit if label creation fails, but return the distances
            if (!labelPrimitive) {
                console.warn("_createOrUpdateLabel: Failed to create new label primitive.");
                return { distances, labelPrimitives: null }; // Return distance but null primitive
            }

            // -- Handle Label Metadata Update --
            labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions
            labelPrimitive.status = status; // Set status

            // -- Handle References Update --
            labelPrimitives.push(labelPrimitive); // Store the new label primitive in the array
            labelsArray.push(labelPrimitive);
        }

        return { distances, labelPrimitives };
    }

    _createOrUpdateTotalLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distances: [], labelPrimitives: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            showBackground = true,
            ...rest
        } = options;

        const totalDistance = this.#distances.reduce((acc, val) => acc + val, 0);
        const formattedText = `Total: ${formatDistance(totalDistance)}`;
        const labelPosition = positions[positions.length - 1];


        let totalLabel;
        // -- Check for existing total label --
        if (labelsArray.length > 0) {
            totalLabel = labelsArray[0]; // Assume the labelsArray contains only one total label for this measure
        } else { // fallback to find in labelCollection
            const LabelLen = this.labelCollection.length;
            for (let i = 0; i < LabelLen; ++i) {
                const label = this.labelCollection.get(i);
                if (label.id === `annotate_${this.mode}_total_label_${this.measure.id}`) totalLabel = label;
            }
        }

        // Update total label if it exists
        if (totalLabel) {
            // -- Handle Label Visual Update --
            totalLabel.position = labelPosition;
            totalLabel.text = formattedText;
            totalLabel.showBackground = showBackground; // Set background visibility
        }

        // Create a new total label if it does not exist
        if (!totalLabel) {
            totalLabel = this.drawingHelper._addLabel([labelPosition], formattedText, null, {
                id: `annotate_${this.mode}_total_label_${this.measure.id}`,
                showBackground: showBackground,
                ...rest
            });
            // update references
            labelsArray.push(totalLabel);
        }

        // -- Handle Label Metadata Update --
        totalLabel.positions = [{ ...labelPosition }] // store positions
        totalLabel.status = status; // Set status

        return { totalLabel, totalDistance };
    }

    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;
        this.flags.isAddMode = false;
        this.flags.isReverse = false;


        // Clear cache
        this.coordsCache = [];
        this.#coordinate = null; // Clear the coordinate
        this.#distances = []; // Clear the distances
        this.#interactiveAnnotations.polylines = [];
        this.#interactiveAnnotations.labels = [];
        this.#interactiveAnnotations.totalLabels = [];
        this.measure = super._createDefaultMeasure(); // Reset measure to default state
    }
}

export { MultiDistanceCesium }
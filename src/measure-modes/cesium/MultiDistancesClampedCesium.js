import {
    Cartesian3,
    defined,
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    formatDistance,
    areCoordinatesEqual,
    calculateMiddlePos,
    convertToCartesian3,
    showCustomNotification,
    getRankedPickedObjectType,
    calculateClampedDistance
} from "../../lib/helper/cesiumHelper.js";
import { getNeighboringValues } from "../../lib/helper/helper.js";
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
class MultiDistancesClampedCesium extends MeasureModeCesium {
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
    /** @type {number[]} - Distances between points in the measure */
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
            throw new Error("MultiDistancesClampedCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("multi_distances_clamped", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

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
                    editableLabel(this._container, pickedObject.primitive);
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
                } else { // if it is not measuring
                    // -- Feature: resume measure --
                    // if click on the first or last point then resume measure
                    this._resumeMeasure(point);
                }
                return true;   // False mean do not handle point click 
            case "line":
                const line = pickedObject.primitive;
                if (this.flags.isMeasurementComplete && this.coordsCache.length === 0) {
                    this._setAddModeByLine(line); // Set the add mode by line primitive
                    return true;
                }
                // this._selectAction(pickedObject.primitive);
                return false;   // False mean do not handle line click, because it could click on moving line
            default:
                return false;
        }
    }

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
        showCustomNotification(`Add mode is enabled. Click on the map to add a new point for segment, measure id: ${measureId}`, this._container);
    }

    _formsPerimeter(point) {
        // User confirmation
        const userConfirmation = confirm('Do you want it to form a perimeter?');
        if (!userConfirmation) return; // If the user does not confirm, exit

        // -- Update coordsCache --
        const pointPosition = point.position;
        this.coordsCache.push(pointPosition); // Add the point to the cache

        // -- Complete the measure --
        this._finalizeMeasure(); // Finalize the measurement
    }

    _resumeMeasure(point) {
        // Find the measure data
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return;

        // -- Handle Measure Data --
        // Get the measure data from the data pool
        const measureData = dataPool.getMeasureById(measureId);
        if (!measureData) return;

        // convert measure data coordinates from cartographic degrees to Cartesian3
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToCartesian3(cartographicDegrees));
        this.measure = measureData;
        this.measure.status = "pending"; // Set the measure status to pending
        this.#distances = [...this.measure._records[0].distances]; // Get the distances from the measure data

        // Find the index of the point in the measure coordinates
        const pointIndex = this.measure.coordinates.findIndex(coordinate => areCoordinatesEqual(coordinate, point.positions[0]));

        // -- Resume Measure --
        // Resume measure only when the point is the first or last point
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === this.measure.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            // Confirm the resume action
            const confirmResume = window.confirm(`Do you want to resume this measure? id: ${measureId}`);
            if (!confirmResume) return;

            // Set variables and flags to resume measuring
            this.coordsCache = this.measure.coordinates;

            // reset the flag to continue measuring
            // NOTE: when coordsCache has values, and isMeasurementComplete flags is false, it means it is during measuring.
            this.flags.isMeasurementComplete = false;

            this.flags.isReverse = isFirstPoint; // If the point is the first point, set the reverse flag to true
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

        if (this.coordsCache.length > 1 && !this.flags.isMeasurementComplete) {
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
            const { distances, interpolatedPositions } = this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                status: "pending",
                showBackground: true
            });

            // -- Handle Distances record --
            if (this.flags.isReverse) {
                this.#distances.unshift(...distances); // Prepend distance if reversing
                this.measure.interpolatedPoints.unshift([...interpolatedPositions]); // Store the interpolated points
            } else {
                this.#distances.push(...distances); // Append distance otherwise
                this.measure.interpolatedPoints.push([...interpolatedPositions]); // Store the interpolated points
            }

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
        const { distances, interpolatedPositions } = this._createOrUpdateLabel(newPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            showBackground: true
        });
        if (distances.length === 0) return;

        // -- Handle Distances record --
        this.#distances.splice(minIndex, 1, ...distances);
        this.measure.interpolatedPoints.splice(minIndex, 1, ...interpolatedPositions); // Update the interpolated points

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
        // TODO: create right click context menu 
        // options: display info 
        // options: copy coordinate info - in cartographic degrees
        // options: if click on line then add options to set add mode by line
        // options: if click on point then add options to remove point
        // options: if click on line then add options to remove line
        // options: if click on label then add options to copy label text

        // if during measuring, right click on empty space will finalize the measure, will not open the context menu
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
        const { distances, interpolatedPositions } = this._createOrUpdateLabel(lastPositions, this.#interactiveAnnotations.labels, {
            status: "completed",
            showBackground: true
        });

        // -- Handle Distances record --
        if (this.flags.isReverse) {
            this.#distances.unshift(...distances); // Prepend distance if reversing
            this.measure.interpolatedPoints.unshift([...interpolatedPositions]); // Store the interpolated points
        } else {
            this.#distances.push(...distances); // Append distance otherwise
            this.measure.interpolatedPoints.push([...interpolatedPositions]); // Store the interpolated points
        }

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
        // update pending status line to completed
        const pendingLines = this.#interactiveAnnotations.polylines.filter(line => line.status === "pending");
        pendingLines.forEach(line => {
            line.status = "completed";
        });
        // update pending status labels to completed
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


        // Update data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // Reset to clean up after finish
        this.resetValuesModeSpecific();

        // Set flag
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

                if (this.coordsCache.length === 0) {
                    this.resetValuesModeSpecific();
                }
                return;
            case "line":
                const line = pickedObject.primitive;
                this._removeLineSet(line);
                return;
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
        if (!point || !Array.isArray(point.positions)) return;

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
        this.#distances = [...this.measure._records[0].distances]; // Get the distances from the measure data
        // clone the coordinates from the measure data
        // this.measure.coordinates is the `original coordinates`, this.coordsCache is the `updated coordinates`
        let positions = this.measure.coordinates.map(pos => (Cartesian3.clone(pos)));

        // Find the point index in the measure coordinates
        const pointPositionIndices = this.measure.coordinates
            .map((coordinate, index) => areCoordinatesEqual(coordinate, point.positions[0]) ? index : -1)
            .filter(index => index !== -1);
        if (pointPositionIndices.length === 0) return; // If the point is not found, exit

        // -- Update positions --
        // Set positions to filter out pointPositionIndices
        positions = positions.filter((_, index) => !pointPositionIndices.includes(index));

        // -- Find and Remove related annotations --
        // remove related lines
        const linePrimitives = this.drawingHelper._getLineByPositions([point.positions[0]]);
        if (!Array.isArray(linePrimitives) || linePrimitives.length === 0) return; // If no lines are found, exit
        linePrimitives.forEach(line => {
            this.drawingHelper._removePolyline(line); // Remove the line primitive

            // Case: during measuring, remove the line from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.polylines.length === 0) return; // If there are no polylines, exit
            const lineToRemoveIndex = this.#interactiveAnnotations.polylines.findIndex(l =>
                areCoordinatesEqual(l.positions[0], line.positions[0]) &&
                areCoordinatesEqual(l.positions[1], line.positions[1])
            );
            if (lineToRemoveIndex === -1) return; // If the line is not found, exit
            this.#interactiveAnnotations.polylines.splice(lineToRemoveIndex, 1); // Remove the line from this interactive annotations
        });

        // remove related labels
        const labelPrimitives = this.drawingHelper._getLabelByPosition([point.positions[0]]);
        if (!Array.isArray(labelPrimitives) || labelPrimitives.length === 0) return; // If no labels are found, exit
        labelPrimitives.forEach(label => {
            // Safety check: assume moving or total labels should not be removed here
            const isMovingLabel = label.status === "moving";
            const isTotalLabel = label.id.startsWith(`annotate_${this.mode}_total_label`);
            this.#interactiveAnnotations.totalLabels = isTotalLabel ? [label] : [];
            if (isMovingLabel || isTotalLabel) return;

            this.drawingHelper._removeLabel(label); // Remove the label primitive            

            // Case: during measuring, remove the label from this.#interactiveAnnotations
            if (this.#interactiveAnnotations.labels.length === 0) return; // If there are no labels, exit
            const labelToRemoveIndex = this.#interactiveAnnotations.labels.findIndex(l => areCoordinatesEqual(l.position, label.position));
            if (labelToRemoveIndex === -1) return; // If the label is not found, exit
            this.#interactiveAnnotations.labels.splice(labelToRemoveIndex, 1);
        });

        // -- Handle Reconnection and measure record --
        const { previous, current, next } = getNeighboringValues(this.measure.coordinates, pointPositionIndices[0]); // find the point position neighboring positions.

        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete; // Check if it is measuring
        const isPerimeter = areCoordinatesEqual(this.measure.coordinates[0], this.measure.coordinates[this.measure.coordinates.length - 1]);
        const graphicsStatus = isMeasuring ? "pending" : "completed"; // Determine the graphics status based on measuring state
        // Case: Perimeter measure, it can only be measure completed or measure not yet started
        if (isPerimeter) {
            if (previous && next) {  // Case: the removing point is in the middle of the positions
                // Case: The minimum shape is a triangle that consists of 4 points. Less than 4 means it is not a shape
                if (positions.length === 3) {
                    positions.pop(); // Remove the last point if it is less than 4 points
                    // -- Handle Distances record --
                    this.#distances.splice(pointPositionIndices[0] - 1, 2);
                    this.measure.interpolatedPoints.splice(pointPositionIndices[0] - 1, 2);
                } else {
                    const reconnectedPositions = [previous, next];

                    // -- Create polyline --
                    this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                        status: graphicsStatus,
                        color: this.stateManager.getColorState("line")
                    });
                    // -- Create label --
                    const { distances, interpolatedPositions } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                        status: graphicsStatus,
                        showBackground: true
                    });

                    // -- Handle Distances record --
                    // Don't calculate all distances from coordsCache due to performance and consistency
                    this.#distances.splice(pointPositionIndices[0] - 1, 2, distances[0]); // remove and insert the new distance
                    this.measure.interpolatedPoints.splice(pointPositionIndices[0] - 1, 2, interpolatedPositions); // remove and insert the new interpolated points
                }
            } else if (next) {  // Case: The removing point is the first point
                if (positions.length > 2) {
                    positions.push(positions[0]); // Reconnect the first point to the last point
                    const reconnectedPositions = [positions[0], positions[positions.length - 2]];  // the last point primitive is the length-2 because first point equals to last point in perimeter.
                    // -- Create polyline --
                    this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                        status: graphicsStatus,
                        color: this.stateManager.getColorState("line")
                    });
                    // -- Create label --
                    const { distances, interpolatedPositions } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                        status: graphicsStatus,
                        showBackground: true
                    });

                    // -- Handle Distances record --
                    // remove the first and the last distance in this.#distances and insert distances value to the last index
                    this.#distances.splice(0, 1); // Remove the first distance
                    this.#distances.splice(this.#distances.length - 1, 1); // Remove the last distance
                    this.#distances.push(...distances); // Add the new distance to the end of the distances array
                    this.measure.interpolatedPoints.splice(0, 1); // Remove the first interpolated point
                    this.measure.interpolatedPoints.splice(this.measure.interpolatedPoints.length - 1, 1); // Remove the last interpolated point
                    this.measure.interpolatedPoints.push(interpolatedPositions); // Add the new interpolated positions to the end of the interpolated points array
                }
                // Case: triangle, it will become two point line, which doesn't need reconnect
                else {
                    // -- Handle Distances record --
                    this.#distances.splice(0, 1); // Remove the first distance
                    this.#distances.splice(this.#distances.length - 1, 1); // Remove the last distance
                    this.measure.interpolatedPoints.splice(0, 1); // Remove the first interpolated point
                    this.measure.interpolatedPoints.splice(this.measure.interpolatedPoints.length - 1, 1); // Remove the last interpolated point
                }
            } else if (previous) {  // Case: The removing point is the last point
                this.#distances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
                this.measure.interpolatedPoints.splice(pointPositionIndices[0] - 1, 1);
            }
        }

        // Case: Normal measure, it could be during measuring or measure completed or measure not yet started
        if (!isPerimeter) {
            if (previous && next) {  // Case: the removing point is in the middle of the positions
                const reconnectedPositions = [previous, next];
                // -- Create polyline --
                this._createOrUpdateLine(reconnectedPositions, this.#interactiveAnnotations.polylines, {
                    status: graphicsStatus,
                    color: this.stateManager.getColorState("line")
                });
                // -- Create label --
                const { distances, interpolatedPositions } = this._createOrUpdateLabel(reconnectedPositions, this.#interactiveAnnotations.labels, {
                    status: graphicsStatus,
                    showBackground: true
                });
                // -- Handle Distances record --
                // Don't calculate all distances from coordsCache due to performance and consistency
                this.#distances.splice(pointPositionIndices[0] - 1, 2, distances[0]); // remove and insert the new distance
                this.measure.interpolatedPoints.splice(pointPositionIndices[0] - 1, 2, interpolatedPositions); // remove and insert the new interpolated points
            } else if (next) {  // Case: The removing point is the first point
                this.#distances.splice(0, 1) // Remove the first distance
                this.measure.interpolatedPoints.splice(0, 1); // Remove the first interpolated point
            } else if (previous) {  // Case: The removing point is the last point
                this.#distances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
                this.measure.interpolatedPoints.splice(pointPositionIndices[0] - 1, 1);
            }
        }
        // -- End of Handle Reconnection and measure record --

        // -- Reposition the total label --
        // If the total label exists, update it; Fallback to create new one, If total label does not exist
        const { totalDistance } = this._createOrUpdateTotalLabel(positions, this.#interactiveAnnotations.totalLabels, {
            status: graphicsStatus,
            showBackground: isMeasuring ? false : true
        });

        // Case: if only one point left, remove the remaining point and labels
        if (positions.length === 1) {
            this._removeRemaining(positions);
            return;
        }

        // -- Update current measure data --
        this.measure.status = isMeasuring ? "pending" : "completed"; // Update the measure status
        if (this.#distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.#distances], totalDistance };
            this.measure._records[0] = record // Update distances record
        }
        this.measure.coordinates = positions.map(pos => Cartesian3.clone(pos));
        // Update dataPool with the measure data
        dataPool.updateOrAddMeasure({ ...this.measure });

        // -- Update current measure variables --
        if (isMeasuring) {
            this.coordsCache = positions.map(pos => Cartesian3.clone(pos)); // Update the coordsCache with the remaining positions        
        }
    }

    /**
     * Removes the remaining point and labels when only one point is left in the measure.
     * @param {Cartesian3} positions - The positions to be removed
     * @returns {void}
     */
    _removeRemaining(positions) {
        const lastPosition = positions[0];

        // Remove the remaining point and labels 
        const lastPoint = this.drawingHelper._getPointByPosition(lastPosition);
        const lastLabels = this.drawingHelper._getLabelByPosition([lastPosition]);

        if (lastPoint) {
            this.drawingHelper._removePointMarker(lastPoint); // Remove the last point primitive
        }
        if (Array.isArray(lastLabels) && lastLabels.length > 0) {
            lastLabels.forEach(label => {
                this.drawingHelper._removeLabel(label); // Remove the label primitive
            });
        }
        // -- Handle Measure Data --
        const measureId = Number(lastPoint.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
        if (isNaN(measureId)) return; // If the measure ID is not a number, exit
        this.coordsCache = []; // Clear the coordsCache
        this.#distances = []; // Clear the distances cache
        dataPool.removeMeasureById(measureId); // Remove the measure from the data pool
    }

    /**
     * Removes an entire line measurement set and its associated primitives from the map.
     * @param {Primitive} line - The line primitive to remove. This is the visual representation of a measurement line.
     * @returns {void}
     */
    _removeLineSet(line) {
        if (!line) return;

        // confirmation 
        const userConfirmation = window.confirm(`Do you want to remove this entire line set?`) // Confirm the removal action
        if (!userConfirmation) return;

        const measureId = Number(line.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID    

        const {
            pointPrimitives,
            labelPrimitives,
            polylinePrimitives,
            polygonPrimitives
        } = this.drawingHelper._getRelatedPrimitivesByMeasureId(measureId);
        pointPrimitives.forEach(point => {
            this.drawingHelper._removePointMarker(point); // Remove the point primitive
        });
        labelPrimitives.forEach(label => {
            this.drawingHelper._removeLabel(label); // Remove the label primitive
        });
        polylinePrimitives.forEach(polyline => {
            this.drawingHelper._removePolyline(polyline); // Remove the polyline primitive
        });
        polygonPrimitives.forEach(polygon => {
            this.drawingHelper._removePolygon(polygon); // Remove the polygon primitive
        });

        // remove the measure data from dataPool
        dataPool.removeMeasureById(measureId);
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

        // -- Handling positions -- 
        const draggedPositionIndices = measure.coordinates
            .map((coord, index) => areCoordinatesEqual(coord, this.dragHandler.draggedObjectInfo.beginPosition) ? index : -1)
            .filter(index => index !== -1);
        if (draggedPositionIndices.length === 0) return; // If the dragged position is not found, exit

        // Update the dragged position with the new coordinate
        const positions = [...measure.coordinates];
        draggedPositionIndices.forEach(index => {
            positions[index] = this.dragHandler.coordinate;
        });

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndices[0]);

        let draggedPositions = [];
        // -- Handle dragged positions --
        if (previous && next) { // Case: dragging the middle position
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {  // Case: dragging the last position
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {  // Case: dragging the first position
            // Case: forms perimeter
            if (draggedPositionIndices.length === 2) {  // length of 2 means two positions matching beginPosition
                draggedPositions = [[this.dragHandler.coordinate, next], [this.dragHandler.coordinate, positions[positions.length - 2]]];
            }
            // Case: first position
            if (draggedPositionIndices.length === 1) {
                draggedPositions = [[this.dragHandler.coordinate, next]];
            }
        }
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
        // Case: distances length is 1 means the draggedPositionIndex is either first or last index in the measure coordinates
        if (distances.length === 1) {
            if (next) { // Case: dragging the first position
                this.#distances[0] = distances[0]; // Update the first distance
            } else if (previous) { // Case: dragging the last position
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
            }
        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            // Case: dragging the first or last position of perimeter
            if (draggedPositionIndices.length === 2) {
                this.#distances[draggedPositionIndices[0]] = distances[0];
                this.#distances[draggedPositionIndices[1] - 1] = distances[1];
            }
            // Case: dragging the middle position
            if (draggedPositionIndices.length === 1) {
                if (previous && next) {
                    this.#distances[draggedPositionIndices[0] - 1] = distances[0];
                    this.#distances[draggedPositionIndices[0]] = distances[1];
                }
            }
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
        // Set the measure to the dragged measure to represent the current measure data
        // !Important: it needs to reset at end of drag
        this.measure = measure;

        // -- Handling positions -- 
        const draggedPositionIndices = measure.coordinates
            .map((coord, index) => areCoordinatesEqual(coord, this.dragHandler.draggedObjectInfo.beginPosition) ? index : -1)
            .filter(index => index !== -1);
        if (draggedPositionIndices.length === 0) return; // If the dragged position is not found, exit

        // Update the dragged position with the new coordinate
        const positions = [...measure.coordinates];
        draggedPositionIndices.forEach(index => {
            positions[index] = this.dragHandler.coordinate;
        });

        const { previous, current, next } = getNeighboringValues(positions, draggedPositionIndices[0]);

        let draggedPositions = [];
        // -- Handle dragged positions --
        if (previous && next) { // Case: dragging the middle position
            draggedPositions = [[previous, this.dragHandler.coordinate], [this.dragHandler.coordinate, next]];
        } else if (previous) {  // Case: dragging the last position
            draggedPositions = [[previous, this.dragHandler.coordinate]];
        } else if (next) {  // Case: dragging the first position
            // Case: forms perimeter
            if (draggedPositionIndices.length === 2) {  // length of 2 means two positions matching beginPosition
                draggedPositions = [[this.dragHandler.coordinate, next], [this.dragHandler.coordinate, positions[positions.length - 2]]];
            }
            // Case: first position
            if (draggedPositionIndices.length === 1) {
                draggedPositions = [[this.dragHandler.coordinate, next]];
            }
        }
        if (draggedPositions.length === 0) return; // safe exit if no dragged positions are available

        // -- Finalize Line Graphics --
        // -- Handle polyline --
        this._createOrUpdateLine(draggedPositions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Finalize Label Graphics --
        const { distances, interpolatedPositions } = this._createOrUpdateLabel(draggedPositions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });

        // -- Handle Distances record --
        this.#distances = [...measure._records[0].distances];
        // Case: distances length is 1 means the draggedPositionIndex is either first or last index in the measure coordinates
        if (distances.length === 1) {
            if (next) { // Case: dragging the first position
                this.#distances[0] = distances[0]; // Update the first distance
                measure.interpolatedPoints[0] = interpolatedPositions[0];
            } else if (previous) { // Case: dragging the last position
                this.#distances[this.#distances.length - 1] = distances[0]; // Update the last distance
                measure.interpolatedPoints[measure.interpolatedPoints.length - 1] = interpolatedPositions[0];
            }
        }
        // Case: distances length is 2 means the draggedPositionIndex is in the middle of the measure coordinates
        else if (distances.length === 2) {
            // Case: dragging the first or last position of perimeter
            if (draggedPositionIndices.length === 2) {
                this.#distances[draggedPositionIndices[0]] = distances[0];
                this.#distances[draggedPositionIndices[1] - 1] = distances[1];
                measure.interpolatedPoints[draggedPositionIndices[0]] = interpolatedPositions[0];
                measure.interpolatedPoints[draggedPositionIndices[1] - 1] = interpolatedPositions[1];
            }
            // Case: dragging the middle position
            if (draggedPositionIndices.length === 1) {
                if (previous && next) {
                    this.#distances[draggedPositionIndices[0] - 1] = distances[0];
                    this.#distances[draggedPositionIndices[0]] = distances[1];
                    measure.interpolatedPoints[draggedPositionIndices[0] - 1] = interpolatedPositions[0];
                    measure.interpolatedPoints[draggedPositionIndices[0]] = interpolatedPositions[1];
                }
            }
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
                const newLinePrimitive = this.drawingHelper._addGroundPolyline(posSet, {
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
            const newLinePrimitive = this.drawingHelper._addGroundPolyline(positions, {
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
     * Creates or updates a label primitive for the measure.
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
        let interpolatedPositions = [];

        // 2. UPDATE LOGIC
        if (labelsArray.length > 0) {
            // Case: update MULTIPLE LABELS, typically for drag operation
            if (isNested) {
                // Assume: nested positions length should be same as labelsArray length
                positions.forEach((posSet, index) => {
                    labelPrimitives = labelsArray;
                    const { distance: segmentDistance, clampedPositions } = calculateClampedDistance([posSet[0], posSet[1]], this.map.scene);
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
                    interpolatedPositions.push([...clampedPositions]); // Collect clamped positions for the segment
                    segmentDistance && distances.push(segmentDistance); // Collect distances for each segment
                });
            }
            // Case: update SINGLE LABEL, typically for moving operation 
            else {
                const { distance: segmentDistance, clampedPositions } = calculateClampedDistance([positions[0], positions[1]], this.map.scene);
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
                    interpolatedPositions = [...clampedPositions]; // Store the clamped positions for the segment
                }
            }
        }

        // 3. CREATE LOGIC
        if (labelPrimitives.length === 0) {
            const { distance: segmentDistance, clampedPositions } = calculateClampedDistance([positions[0], positions[1]], this.map.scene);
            if (!segmentDistance) console.warn("Failed to calculate segment distance.");

            const labelPrimitive = this.drawingHelper._addLabel(positions, segmentDistance, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
                ...rest
            });

            // -- Handle records Update --
            segmentDistance ? distances = [segmentDistance] : distances = []; // Store the distance for the single segment
            interpolatedPositions = [...clampedPositions]; // Store the clamped positions for the segment

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

        return { distances, interpolatedPositions, labelPrimitives };
    }

    /**
     * Creates or updates a total label for the measure.
     * @param {Cartesian3[]} positions - The positions of the measure.
     * @param {Label[]} labelsArray - The array of labels to update or create.
     * @param {object} [options={}] - Options for creating or updating the label.
     * @returns {{ totalLabel: Label, totalDistance: number }} - The created or updated total label and the total distance.
     */
    _createOrUpdateTotalLabel(positions, labelsArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(positions) || !Array.isArray(labelsArray) || positions.length === 0) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { totalLabel: null, totalDistance: 0 }; // Validate input positions
        }

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

        // Reset variables
        this.coordsCache = [];
        this.#coordinate = null; // Clear the coordinate
        this.#distances = []; // Clear the distances
        this.#interactiveAnnotations.polylines = [];
        this.#interactiveAnnotations.labels = [];
        this.#interactiveAnnotations.totalLabels = [];

        // Reset the measure data
        this.measure = super._createDefaultMeasure(); // Reset measure to default state
    }
}

export { MultiDistancesClampedCesium };
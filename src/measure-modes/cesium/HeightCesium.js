import {
    Cartesian3,
    defined,
    SceneTransforms,
    Color,
} from "cesium";
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeCesium } from "./MeasureModeCesium";
import { areCoordinatesEqual, calculateMiddlePos, convertToCartographicDegrees, formatDistance, getGroundPosition, getHeight, getPickedObjectType, updatePointerOverlay } from "../../lib/helper/cesiumHelper.js";

// -- Cesium types --
/** @typedef {import('cesium').Primitive} Primitive */
/** @typedef {import('cesium').Label} Label*/
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
/** @typedef {import('cesium').Cartesian2} Cartesian2 */

// -- Data types -- 
/** @typedef {{points: PointPrimitive[], polylines: Primitive[], labels: Label[]}} InteractiveAnnotationsState */
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
 * Class representing the height measurement mode in Cesium.
 * @extends {MeasureModeCesium}
 */
class HeightCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        points: [],
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
            throw new Error("HeightCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("height", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

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

        const pickedObject = eventData.pickedFeature[0];
        const pickedObjectType = getPickedObjectType(pickedObject, this.mode);

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
                    editableLabel(this.map.container, pickedObject.primitive);
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
        };

        if (this.coordsCache.length === 2) {
            // Reset for a new measure using the default structure
            this.measure = this._createDefaultMeasure();

            // Establish data relation
            this.measure.coordinates = this.coordsCache; // when cache changed measure data changed, due to reference by address.


            this._createOrUpdatePoints(this.coordsCache, this.interactiveAnnotations.points, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
                status: "completed"
            });

            // -- APPROACH 2: Update existing polyline and label --
            // -- Handle polyline
            this._createOrUpdateLine(this.coordsCache, this.#interactiveAnnotations.polylines, {
                status: "completed",
                color: this.stateManager.getColorState("line")
            });

            // -- Handle label --
            const { height } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                showBackground: true
            });

            // -- Handle Data --
            this.measure.coordinates = this.coordsCache;
            this.measure._records.push(height);
            this.measure.status = "completed";

            // -- Update Data Pool --
            dataPool.updateOrAddMeasure({ ...this.measure });

            // -- Update State --
            this.flags.isMeasurementComplete = true;

            // -- Reset Values --
            // Clean up the current measure state, to prepare for the next measure
            this.coordsCache = [];
            this.#interactiveAnnotations.points = []; // Clear the interactive points
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
        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coordsCache = [];
        }

        // update coordinate
        const cartesian = eventData.mapPoint;
        if (!defined(cartesian)) return;
        this.#coordinate = cartesian;

        const pickedObjects = eventData.pickedFeature;
        if (!defined(pickedObjects)) return;

        // update pointerOverlay: the moving dot with mouse
        // const pointerElement = this.stateManager.getOverlayState("pointer");
        // const pointerOverlay = updatePointerOverlay(this.map, pointerElement, cartesian, pickedObjects)
        // this.stateManager.setOverlayState("pointer", pointerOverlay);

        // Get the positions
        const groundPosition = getGroundPosition(this.map.scene, cartesian);
        const positions = [cartesian, groundPosition];
        // update the coordinates cache
        this.coordsCache = positions.map(pos => ({ ...pos }))

        // Create or update the points - the position and the ground position
        this._createOrUpdatePoints(this.coordsCache, this.interactiveAnnotations.points, {
            color: this.stateManager.getColorState("move"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            status: "moving"
        });

        // update the polylines
        this._createOrUpdateLine(this.coordsCache, this.interactiveAnnotations.polylines, {
            color: this.stateManager.getColorState("move"),
            status: "moving",
            id: `annotate_${this.mode}_line_${this.measure.id}`,
        });

        // update the labels
        this._createOrUpdateLabel(this.coordsCache, this.interactiveAnnotations.labels, {
            status: "moving",
            showBackground: false,
            id: `annotate_${this.mode}_label_${this.measure.id}`,
        });
    }


    /******************
     * EVENT HANDLING *
     *    FOR DRAG    *
     ******************/
    setAnchorPoint(measure) {
        const anchorPosition = measure.coordinates.find(cart => !areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (!anchorPosition || !this.pointCollection) return null;

        // find the anchor point from the point collection
        let anchorPoint = null;
        const collectionLength = this.pointCollection.length;
        for (let i = 0; i < collectionLength; i++) {
            const pointPrimitive = this.pointCollection.get(i);
            if (pointPrimitive && pointPrimitive.position && areCoordinatesEqual(pointPrimitive.position, anchorPosition)) {
                anchorPoint = pointPrimitive;
                break;
            }
        }
        if (!anchorPoint) return null;

        // set anchor point 
        this.dragHandler.draggedObjectInfo.anchorPoint = anchorPoint;

        return anchorPoint;
    }

    /**
     * Handle graphics updates during dragging operation.
     * @param {MeasurementGroup} measure - The measure object data from drag operation.
     * @returns {void}
     */
    updateGraphicsOnDrag(measure) {
        const groundPosition = getGroundPosition(this.map.scene, this.dragHandler.coordinate);
        const positions = [this.dragHandler.coordinate, groundPosition];

        // -- Handle Point --
        // Drag point is updated by the drag handler already
        // Update the anchor point position
        const anchorPoint = this.dragHandler.draggedObjectInfo.anchorPoint;
        if (anchorPoint) {
            anchorPoint.position = groundPosition;
            anchorPoint.status = "moving"; // Set status to moving
            anchorPoint.color = Color.fromCssColorString(this.stateManager.getColorState("move")); // Set color to moving color
        }

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
        const groundPosition = getGroundPosition(this.map.scene, this.dragHandler.coordinate);
        const positions = [this.dragHandler.coordinate, groundPosition];

        // -- Handle Point --
        // Drag point is updated by the drag handler already
        // Finalize the anchor point position
        const anchorPoint = this.dragHandler.draggedObjectInfo.anchorPoint;
        if (anchorPoint) {
            anchorPoint.position = groundPosition;
            anchorPoint.status = "completed"; // Set status to moving
            anchorPoint.color = Color.fromCssColorString(this.stateManager.getColorState("pointColor")); // Set color to moving color
        }

        // -- Finalize Line Graphics --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Finalize Label Graphics --
        const { height } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });

        // --- Update Measure Data ---
        measure._records = [height]; // Update new distance record
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.status = "completed"; // Update the measure status

        return measure;
    }


    /*******************
     * HELPER FEATURES *
     *******************/
    _createOrUpdatePoints(positions, pointsArray, options = {}) {
        // default options
        const {
            status = null,
            color = this.stateManager.getColorState("point")
        } = options

        const [topPosition, bottomPosition] = positions;

        // Update points if existed
        if (pointsArray.length === 2) {
            pointsArray.forEach((pointPrimitive, index) => {
                if (!pointPrimitive) {
                    console.warn("_createOrUpdatePoints: Invalid object found in pointsArray. Attempting to remove and recreate.");
                    pointsArray.length = 0; // Clear the array to trigger creation below
                } else {
                    // Update point position
                    pointPrimitive.position = index === 0 ? topPosition : bottomPosition;
                    pointPrimitive.status = status; // Set status on the new primitive
                }
            });
        };

        // Create new points if not existed
        if (pointsArray.length === 0) {
            positions.forEach((position) => {
                // create a new point primitive
                const pointPrimitive = this.drawingHelper._addPointMarker(position, {
                    color,
                    id: `annotate_${this.mode}_point_${this.measure.id}`,
                });
                if (!pointPrimitive) return; // If point creation fails, exit
                pointPrimitive.status = status; // Set status to pending for the point primitive

                // Push the new primitive into the array passed by reference.
                pointsArray.push(pointPrimitive);
            });
        };
    }

    /**
   * Updates line primitive by removing the existing one and creating a new one.
   * @param {Cartesian3[]} positions - Array of positions to create or update the line.
   * @param {Primitive[]} polylinesArray - Array to store the line primitive reference of the operation not the polyline collection.
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
        const newLinePrimitive = this.drawingHelper._addPolyline(positions, {
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
     * 
     * @param {Cartesian3[]} positions - the positions to create or update the label. 
     * @param {Label[]} labelsArray - the array to store the label primitive reference of the operation not the label collection.
     * @param {object} options - options for label creation or update.
     * @returns {void}
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { height: null, labelPrimitive: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            showBackground = true,
        } = options;

        const height = getHeight(this.map.scene, positions[0]); // Assume positions[0] is the top position
        const formattedText = formatDistance(height); // Assume height unit is in meters
        const middlePos = calculateMiddlePos(positions);

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { height, labelPrimitive: null }; // Return height but null primitive
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
            labelPrimitive = this.drawingHelper._addLabel(positions, height, "meter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
            });

            if (!labelPrimitive) {
                console.error("_createOrUpdateLabel: Failed to create new label primitive.");
                return { height, labelPrimitive: null }; // Return height but null primitive
            }

            // -- Handle References Update --
            labelsArray.push(labelPrimitive);
        }

        // -- Handle Label Metadata Update --
        labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions
        labelPrimitive.status = status; // Set status

        return { height, labelPrimitive };
    }

    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Clear cache
        this.coordsCache = [];
    }
}

export { HeightCesium };
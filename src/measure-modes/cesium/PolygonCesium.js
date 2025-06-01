import {
    Cartesian3,
    defined,
} from "cesium";
import {
    editableLabel,
    updatePointerOverlay,
    computePolygonArea,
    formatArea,
    calculateMiddlePos,
    areCoordinatesEqual,
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



class PolygonCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        polygons: [],
        polygonOutlines: [],
        labels: []
    };

    /** @type {MeasurementGroup} */
    measure = null;

    /** @type {Cartesian3[]} */
    coordsCache = [];

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
            throw new Error("PolygonCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("area", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

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

    /***********************
     *    EVENT HANDLER    *
     * LEFT CLICK FEATURES *
     ***********************/
    /**
     * Handles left-click events on the map.
     * @param {EventDataState} eventData - The event data containing information about the click event.
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
                    editableLabel(this.map.container, pickedObject.primitive);
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

        // Update the coordinates cache and this.measure coordinates
        this.coordsCache.push(this.#coordinate);

        // -- Update dataPool --
        dataPool.updateOrAddMeasure({ ...this.measure });


        // -- Handle Polygon --
        // If three points create the polygon primitive
        if (this.coordsCache.length > 2) {

            // -- Handle Polygon Graphics --
            this._createOrUpdatePolygonGraphics(this.coordsCache, this.#interactiveAnnotations.polygons, {
                status: "pending",
                polygonOptions: {
                    color: this.stateManager.getColorState("polygon"),
                },
                polygonOutlineOptions: {
                    color: this.stateManager.getColorState("line"),
                }
            });
            // -- Handle Label Graphics --
            this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "pending",
                showBackground: false,
            });
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
        const pointerElement = this.stateManager.getOverlayState("pointer");
        const pointerOverlay = updatePointerOverlay(this.map, pointerElement, cartesian, pickedObjects)
        this.stateManager.setOverlayState("pointer", pointerOverlay);

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 2 && !this.flags.isMeasurementComplete
        switch (true) {
            case isMeasuring:
                // moving coordinate data
                const positions = [...this.coordsCache, this.#coordinate];

                // Moving polygon: remove if existed, create if not existed
                this._createOrUpdatePolygonGraphics(positions, this.#interactiveAnnotations.polygons, {
                    status: "moving",
                    polygonOptions: {
                        color: this.stateManager.getColorState("polygon"),
                    },
                    polygonOutlineOptions: {
                        color: this.stateManager.getColorState("polygonOutline"),
                    }
                });

                // Moving label: update if existed, create if not existed
                this._createOrUpdateLabel(positions, this.#interactiveAnnotations.labels, {
                    status: "moving",
                    showBackground: false,
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
     * @returns {Void}
     */
    handleRightClick = async (eventData) => {
        if (!this.flags.isMeasurementComplete && this.coordsCache.length > 0) { // prevent user to right click on first action
            // use mouse move position to control only one pickPosition is used
            const cartesian = this.#coordinate;
            if (!defined(cartesian)) return;

            // update coordinate data cache
            this.coordsCache.push(this.#coordinate);

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

            // -- Handle final point --
            // check if final point is near any existing point
            const nearPoint = this._isNearPoint(this.#coordinate);
            if (nearPoint) return;

            // create point
            const pointPrimitive = this.drawingHelper._addPointMarker(this.#coordinate, {
                color: this.stateManager.getColorState("pointColor"),
                id: `annotate_${this.mode}_point_${this.measure.id}`,
            });
            if (!pointPrimitive) return; // If point creation fails, exit
            pointPrimitive.status = "completed"; // Set status to completed for the point primitive


            // -- Handle polygon graphics --
            this._createOrUpdatePolygonGraphics(this.coordsCache, this.#interactiveAnnotations.polygons, {
                status: "completed",
                polygonOptions: {
                    color: this.stateManager.getColorState("polygon"),
                },
                polygonOutlineOptions: {
                    color: this.stateManager.getColorState("line"),
                }
            });


            // -- Handle label --
            const { area } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                showBackground: true,
            });

            // -- Update data --
            this.measure._records.push(area);
            this.measure.status = "completed";

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });

            // set flags
            this.flags.isMeasurementComplete = true;

            // Clear cache
            this.coordsCache = [];
            this.#interactiveAnnotations.polygons = []; // Clear the reference to the polygon primitive
            this.#interactiveAnnotations.labels = []; // Clear the reference to the polygon primitive
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
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // -- Handle polygon --
        this._createOrUpdatePolygonGraphics(positions, this.dragHandler.draggedObjectInfo.polygons, {
            status: "moving",
            polygonOptions: {
                color: this.stateManager.getColorState("polygon"),
            },
            polygonOutlineOptions: {
                color: this.stateManager.getColorState("polygonOutline"),
            }
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
        const draggedPositionIndex = measure.coordinates.findIndex(cart => areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (draggedPositionIndex === -1) return; // No dragged position found
        const positions = [...measure.coordinates];
        positions[draggedPositionIndex] = this.dragHandler.coordinate; // Update the dragged position

        // -- Finalize Line Graphics --
        this._createOrUpdatePolygonGraphics(positions, this.dragHandler.draggedObjectInfo.polygons, {
            status: "completed",
            polygonOptions: {
                color: this.stateManager.getColorState("polygon"),
            },
            polygonOutlineOptions: {
                color: this.stateManager.getColorState("line"),
            }
        });

        // -- Finalize Label Graphics --
        const { area } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });

        // --- Update Measure Data ---
        measure._records = [area]; // Update new area record
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.status = "completed"; // Update the measure status

        return measure;
    }

    /*******************
     * HELPER FEATURES *
     *******************/
    /**
     * Updates polygon primitive by removing the existing one and creating a new one.
     * @param {Cartesian3[]} positions - The positions to create or update the polygon graphics.
     * @param {Primitive[]} polygonsArray - The polygons array to update - Not the polygonCollection.
     * @param {object} options - Options for the polygon primitive.
     * @returns 
     */
    _createOrUpdatePolygonGraphics(positions, polygonsArray, options = {}) {
        if (positions.length < 3) return; // Ensure there are enough points to create a polygon

        // default options
        const {
            status = null,
            polygonOptions = {},
            polygonOutlineOptions = {},
        } = options;

        // -- Check for and remove existing polyline --    
        if (Array.isArray(polygonsArray) && polygonsArray.length > 0) {
            // remove polygon graphics: polygon and polygon outline primitives
            polygonsArray.forEach(polygonGraphic => {
                this.drawingHelper._removePolygon(polygonGraphic);
            });
            polygonsArray.length = 0; // Clear the reference to the polygon primitive
        }

        // -- Create new polygon --
        const polygonPrimitive = this.drawingHelper._addPolygon(positions, {
            id: `annotate_${this.mode}_polygon_${this.measure.id}`,
            ...polygonOptions
        });
        // Create polygon outline primitive
        const polygonOutlinePrimitive = this.drawingHelper._addPolygonOutline(positions, {
            id: `annotate_${this.mode}_polygonOutline_${this.measure.id}`,
            ...polygonOutlineOptions
        });

        // Validate polygon graphics
        if (!polygonPrimitive || !polygonOutlinePrimitive) {
            console.warn("Failed to create polygon graphics.");
            return null;
        }

        // -- Handle Polygon Metadata Update --
        polygonPrimitive.status = status; // Set status for polygon primitive
        polygonOutlinePrimitive.status = status; // Set status for polygon outline primitive

        // -- Handle References Update --
        // Push the new primitive into the array passed by reference.
        if (Array.isArray(polygonsArray)) {
            polygonsArray.push(polygonPrimitive, polygonOutlinePrimitive); // Store the polygon primitive reference
        } else {
            console.warn("Invalid polygonsArray provided.");
        }
    }

    /**
     * Creates or updates the label primitive.
     * @param {Cartesian3[]} positions - The positions to update or create label primitive.
     * @param {Label[]} labelsArray - The labels array to update - Not the labelCollection.
     * @param {Object} options - Options for the polygon primitive.
     * @return {{area: number, labelPrimitive: Label}} - Returns the area and the label primitive.
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { area: null, labelPrimitive: null }; // Validate input positions
        }

        // default options
        const {
            status = null,
            showBackground = true,
        } = options;

        const area = computePolygonArea(positions);
        const formattedText = formatArea(area);
        const middlePos = calculateMiddlePos(positions); // Calculate the middle position of the polygon

        if (!middlePos) {
            console.warn("_createOrUpdateLabel: Failed to calculate middle position.");
            return { area, labelPrimitive: null }; // Return distance but null primitive
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
            labelPrimitive = this.drawingHelper._addLabel(positions, area, "squareMeter", {
                id: `annotate_${this.mode}_label_${this.measure.id}`,
                showBackground: showBackground,
            });

            if (!labelPrimitive) {
                console.error("_createOrUpdateLabel: Failed to create new label primitive.");
                return { area, labelPrimitive: null }; // Return area but null primitive
            }

            // -- Handle References Update --
            labelsArray.push(labelPrimitive);
        }

        // -- Handle Label Metadata Update --
        labelPrimitive.positions = positions.map(pos => ({ ...pos })); // store positions
        labelPrimitive.status = status; // Set status

        return { area, labelPrimitive };
    }

    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Clear cache
        this.coordsCache = [];
    }
}
export { PolygonCesium };
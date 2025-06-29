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
    calculateClampedDistance,
    getRankedPickedObjectType,
    convertToCartesian3,
} from "../../lib/helper/cesiumHelper.js";
import dataPool from "../../lib/data/DataPool.js";
import { MeasureModeCesium } from "./MeasureModeCesium.js";

// -- Cesium types --
/** @typedef {import('cesium').Primitive} Primitive */
/** @typedef {import('cesium').Label} Label*/
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
/** @typedef {import('cesium').Cartesian2} Cartesian2 */
/** @typedef {import('cesium').PointPrimitive} PointPrimitive */

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


class ProfileCesium extends MeasureModeCesium {
    // -- Public fields: dependencies --
    /** @type {any} The Cesium package instance. */
    cesiumPkg;

    /** @type {Cartesian3} */
    #coordinate = null;

    /** @type {InteractiveAnnotationsState} - References to temporary primitive objects used for interactive drawing*/
    #interactiveAnnotations = {
        polylines: [],
        labels: [],
        chartHoveredPoint: null, // For hover interaction on chart
        chartHoveredPoints: [], // For hover interaction on chart, multiple points
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
            throw new Error("ProfileCesium requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }

        super("profile", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // flags specific to this mode
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

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
        if (this.coordsCache.length === 2) {
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

            // -- APPROACH 2: Update existing polyline and label --
            // -- Handle polyline
            this._createOrUpdateLine(this.coordsCache, this.#interactiveAnnotations.polylines, {
                status: "completed",
                color: this.stateManager.getColorState("line")
            });

            // -- Handle label --
            const { distance, clampedPositions, clampedPositionsCartographic } = this._createOrUpdateLabel(this.coordsCache, this.#interactiveAnnotations.labels, {
                status: "completed",
                showBackground: true
            });

            // -- Handle Chart --
            this._createOrUpdateChart(clampedPositions, clampedPositionsCartographic);

            // -- Handle Data --
            this.measure._records.push(distance);
            this.measure.interpolatedPoints = clampedPositions; // Store interpolated points
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

        const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(eventData.pickedFeature, this.mode);

        // Handle different scenarios based on the state of the tool
        // the condition to determine if it is measuring
        const isMeasuring = this.coordsCache.length > 0 && !this.flags.isMeasurementComplete

        switch (pickedObjectType) {
            case "label":
                break; // Do nothing, label is handled by the event handler
            case "point":
                break; // Do nothing, point is handled by the event handler
            case "line":
                const linePrimitive = pickedObject.primitive;
                if (linePrimitive.status === "moving") return;
                // hide the pointer overlay 
                const pointerElement = this.stateManager.getOverlayState("pointer");
                pointerElement && (pointerElement.style.display = "none");

                this._handleLineHover(linePrimitive, cartesian);

                break; // Do nothing, line is handled by the event handler
            default:
                if (isMeasuring) {
                    const positions = [this.coordsCache[0], this.#coordinate]

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
                }
        }
    }

    _handleLineHover(linePrimitive, position) {
        // Validate input parameters
        if (!this.chartDiv || !this.chartInstance) {
            this.removeChartHoveredPoint();
            return;
        };

        // Set the position
        const cartesian = position;

        // Find the associated measure by ID
        const measureId = Number(linePrimitive.id.split("_").slice(-1)[0]); // Extract the measure ID from the polyline ID
        const measure = this._findMeasureById(measureId);
        if (!measure) {
            console.warn(`Measure with ID ${measureId} not found.`);
            return;
        }
        const interpolatedPoints = measure.interpolatedPoints;

        // minimal check: if interpolatedPoints matched the chart data by length.
        const isPointsMatchedChartData = this.chartInstance.data.datasets[0].data.length === interpolatedPoints.length;
        if (!isPointsMatchedChartData) return; // If the interpolated points do not match the chart data, do not proceed

        // Find the closest point in the interpolated points to the picked position
        const closestPosition = interpolatedPoints.reduce((closest, current) => {
            const currentDistance = Cartesian3.distance(current, cartesian);
            const closestDistance = Cartesian3.distance(closest, cartesian);
            return currentDistance < closestDistance ? current : closest;
        }, interpolatedPoints[0]);

        this._createOrUpdateHoveredPoint(closestPosition, {
            id: `annotate_${this.mode}_hovered_point_${measure.id}`,
            status: "completed"
        });

        const closestPositionIndex = interpolatedPoints.findIndex(pos => areCoordinatesEqual(pos, closestPosition));
        if (closestPositionIndex === -1) return;
        this._activateTooltipAtPointIndex(closestPositionIndex); // Activate tooltip at the closest point index
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

        const anchorPosition = measure.coordinates.find(cart => !areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (!anchorPosition) return;
        const positions = [anchorPosition, this.dragHandler.coordinate];

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

        const anchorPosition = measure.coordinates.find(cart => !areCoordinatesEqual(cart, this.dragHandler.draggedObjectInfo.beginPosition));
        if (!anchorPosition) return;
        const positions = [anchorPosition, this.dragHandler.coordinate];

        // -- Finalize Line Graphics --
        this._createOrUpdateLine(positions, this.dragHandler.draggedObjectInfo.lines, {
            status: "completed",
            color: this.stateManager.getColorState("line")
        });

        // -- Finalize Label Graphics --
        const { distance, clampedPositions, clampedPositionsCartographic } = this._createOrUpdateLabel(positions, this.dragHandler.draggedObjectInfo.labels, {
            status: "completed",
            showBackground: true
        });

        // -- Handle Chart --
        this._createOrUpdateChart(clampedPositions, clampedPositionsCartographic);

        // --- Update Measure Data ---
        measure._records = [distance]; // Update new distance record
        measure.coordinates = positions.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        measure.interpolatedPoints = clampedPositions; // Store interpolated points
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
        // default options
        const {
            status = null,
            color = this.stateManager.getColorState("line"),
        } = options;

        // -- Check for and remove existing polyline --
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
        const newLinePrimitive = this.drawingHelper._addGroundPolyline(positions, {
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
     * @returns 
     */
    _createOrUpdateLabel(positions, labelsArray, options = {}) {
        // Validate input
        if (!Array.isArray(positions) || !Array.isArray(labelsArray)) {
            console.warn("Invalid input: positions and labelsArray should be arrays.");
            return { distance: null, labelPrimitive: null }; // Validate input positions
        };

        // default options
        const {
            status = null,
            showBackground = true,
        } = options;

        const { distance, clampedPositions, clampedPositionsCartographic } = calculateClampedDistance(positions, this.map.scene, 4);
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
            labelPrimitive = this.drawingHelper._addLabel(positions, distance ?? 0, "meter", {
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

        return { distance, clampedPositions, clampedPositionsCartographic, labelPrimitive };
    }

    _createOrUpdateHoveredPoint(position, options = {}) {
        const {
            color = this.stateManager.getColorState("pointColor"),
            status = "pending",
        } = options;

        if (this.#interactiveAnnotations.chartHoveredPoints.length > 0) {
            const hoveredPoints = this.#interactiveAnnotations.chartHoveredPoints;
            hoveredPoints.forEach(point => {
                this.drawingHelper._removePointMarker(point);
            });
            // Clear the reference
            this.#interactiveAnnotations.chartHoveredPoints.length = 0;
        }

        // Create a new point marker at the closest position
        const hoveredPoint = this.drawingHelper._addPointMarker(position, {
            color,
            id: `annotate_${this.mode}_hovered_point_${this.measure.id}`,
            status
        });
        if (!hoveredPoint) {
            console.warn("_createOrUpdateHoveredPoint: Failed to create hovered point primitive.");
            return null;
        }
        this.#interactiveAnnotations.chartHoveredPoints = [hoveredPoint]
        return hoveredPoint;
    }

    /**
     * Creates or updates the chart based on the provided positions and options.
     * @param {Cartesian3[]} clampedPositions 
     * @param {Cartographic[]} clampedPositionsCartographic 
     * @param {object} [options={}] - options for chart creation or update.
     * @returns {void}
     */
    _createOrUpdateChart(clampedPositions, clampedPositionsCartographic, options = {}) {
        if (Array.isArray(clampedPositionsCartographic) && clampedPositionsCartographic.length === 0 &&
            Array.isArray(clampedPositions) && clampedPositions.length === 0 &&
            clampedPositions.length === clampedPositionsCartographic.length
        ) return null;

        // Default options
        const {
            show = true,
        } = options;

        // check if the chart is already created
        if (!this.charDiv) {
            this._createChart({}, {}, (event, chartElements, chartInstance) => this._addPointAtChartHoveredPoint(event, chartElements, chartInstance));
            this._setChartVisibility(show);
        }

        // -- Prepare data for the chart --
        // x-axis label: the distance between points, the first label is 0
        const labels = new Array(clampedPositions.length);
        labels[0] = 0; // First point is at distance 0
        for (let i = 0; i < clampedPositions.length - 1; i++) {
            const segmentDistance = Cartesian3.distance(clampedPositions[i], clampedPositions[i + 1]);
            // Cumulative distance: previous cumulative distance + current segment distance (rounded)
            labels[i + 1] = labels[i] + Math.round(segmentDistance);
        }
        // y-axis label: the height of the points (also store x label and metadata)
        const formattedData = clampedPositionsCartographic.map((pos, index) => ({ "x": `${labels[index]}m`, "y": pos.height, position: [pos] }));

        // -- Update chart data --
        const chartData = {
            labels: labels.map(label => `${label}m`), // Convert to string with 'm' suffix
            datasets: [{ label: "Terrain Profile", data: formattedData }]
        };

        this._updateChartData(chartData);
    }

    /**
     * Add a point in the map at the hovered point on the chart.
     * @param {object} event - The event object from the chart.js interaction.
     * @param {object[]} chartElements - The chart elements that were interacted with on chart.js.
     * @param {import("chart.js").Chart} chartInstance - The chart.js Chart instance.
     * @returns {PointPrimitive}
     */
    _addPointAtChartHoveredPoint(event, chartElements, chartInstance) {
        // Validate input parameters
        if (!chartElements || !chartElements.length || !chartInstance) {
            return null;
        }

        const chartHoveredPoint = chartElements[0];
        const chartHoveredPointIndex = chartHoveredPoint.index;
        const datasetIndex = chartHoveredPoint.datasetIndex;

        // Add minimal bounds checking
        const datasets = chartInstance.data.datasets;
        if (datasetIndex >= datasets.length || chartHoveredPointIndex >= datasets[datasetIndex]?.data?.length) {
            return null;
        }
        // Get the data point that contains your metadata
        const dataPoint = datasets[datasetIndex].data[chartHoveredPointIndex];
        if (!dataPoint?.position?.[0]) {
            return null;
        }
        // Access the metadata you stored in the 'position' property
        const pointCartographic = dataPoint.position[0];
        const pointCartesian = convertToCartesian3(pointCartographic); // convert to Cartesian3
        if (!pointCartesian) return null;

        this._createOrUpdateHoveredPoint(pointCartesian, {
            id: `annotate_${this.mode}_chart_hovered_point`,
            status: "completed"
        });
    }

    _activateTooltipAtPointIndex(index) {
        if (!this.chartInstance) return;
        this.chartInstance.tooltip.setActiveElements([{ datasetIndex: 0, index: index }], this.chartInstance.getDatasetMeta(0).data[1].element);
        this.chartInstance.update();
    }

    removeChartHoveredPoint() {
        const hoveredPoints = this.#interactiveAnnotations.chartHoveredPoints;
        if (hoveredPoints.length > 0) {
            hoveredPoints.forEach(point => {
                this.drawingHelper._removePointMarker(point); // Remove the point primitive
            });
            this.#interactiveAnnotations.chartHoveredPoints = []; // Clear the reference
        }
    }

    resetValuesModeSpecific() {
        // Reset flags
        this.flags.isMeasurementComplete = false;
        this.flags.isDragMode = false;

        // Reset variables
        this.coordsCache = [];
        this.#coordinate = null; // Clear the coordinate
        this.#interactiveAnnotations.polylines = [];
        this.#interactiveAnnotations.labels = [];
        this.#interactiveAnnotations.chartHoveredPoint = null;

        // Reset the measure data
        this.measure = super._createDefaultMeasure(); // Reset measure to default state

        // Clear chart
        // this._destroyChart();
    }
}

export { ProfileCesium };
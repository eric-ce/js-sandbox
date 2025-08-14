import { Cartesian3 } from "cesium";
import { MeasureModeBase } from "../MeasureModeBase.mjs";
import { areCoordinatesEqual, calculateMiddlePos, convertToCartesian3, convertToCartographicDegrees, createPointerOverlay, editableLabel, getRankedPickedObjectType } from "../../lib/helper/cesiumHelper.mjs";
import { Chart } from "chart.js/auto";
import { createCloseButton, createContextMenu, deconstructIdForMetadata, hideContextMenu, makeDraggable, showCustomNotification, updateContextMenu } from "../../lib/helper/helper.mjs";
import { closeIconBlack } from "../../assets/icons.mjs";


/** @typedef {import('cesium').PointPrimitiveCollection} PointPrimitiveCollection */
/** @typedef {import('cesium').LabelCollection} LabelCollection */
/** @typedef {import('cesium').Cartesian3} Cartesian3 */
/** @typedef {import('cesium').Cartographic} Cartographic */
/** @typedef {{latitude: number, longitude: number, height?: number}} CartographicDegrees */

/** @typedef {import('../../lib/docs/types.mjs').MeasurementGroup} MeasurementGroup */

/** @typedef {import('../../lib/docs/types.mjs').DataPool} DataPool */
/** @typedef {import('../../lib/docs/types.mjs').CesiumInputHandler} CesiumInputHandler */
/** @typedef {import('../../lib/docs/types.mjs').CesiumDragHandler} CesiumDragHandler */
/** @typedef {import('../../lib/docs/types.mjs').CesiumHighlightHandler} CesiumHighlightHandler */
/** @typedef {import('../../lib/docs/types.mjs').ShareEmitter} ShareEmitter */
/** @typedef {import('../../lib/docs/types.mjs').StateManager} StateManager*/
/** @typedef {import('../../lib/docs/types.mjs').CesiumAnnotation} CesiumAnnotation */


/**
 * Shared functionality between modes in Cesium.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `cesiumHelper.mjs`, This is mainly for logic override when needed.
 */
class MeasureModeCesium extends MeasureModeBase {
    cesiumPkg;

    // Chart related
    /** @type {import("chart.js/auto").Chart} */
    chartInstance;
    /** @type {HTMLElement} */
    chartDiv;

    // Events cleanup
    /** @type {function(): void} */
    _closeButtonCleanup;

    // UI components
    /** @type {HTMLElement} */
    contextMenu;

    /**
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {CesiumInputHandler} inputHandler - The map input event handler abstraction.
     * @param {CesiumDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {CesiumHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {CesiumAnnotation} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool, cesiumPkg) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool);

        this.cesiumPkg = cesiumPkg; // Store the Cesium package instance

        this.contextMenu = this.stateManager.getElementState("contextMenu") || null; // Get the context menu from state manager
    }


    /*******************
     * UTILITY FEATURE *
     *******************/
    /**
     * Finds a measure by its ID.
     * @param {number} measureId - The ID of the measure to find.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureById(measureId) {
        if (typeof measureId !== "number") {
            console.warn("Invalid measureId provided. It should be a number.");
            return null; // Return null if measureId is not a number
        }

        const measure = this.dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measure) return; // If no measure found, exit the function

        // Convert cartographic degrees to Cartesian3 coordinates
        measure.coordinates = measure.coordinates.map(coord => convertToCartesian3(coord)); // Ensure coordinates are in Cartesian3 format
        return measure;
    }

    /**
     * Finds a measure by its coordinate.
     * @param {Cartesian3|Cartographic|{latitude:number, longitude:number, height: number}} coordinate - The coordinate to find the measure.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to Cesium Cartesian3 object
        const cartesian = convertToCartesian3(coordinate);
        if (!cartesian) return null;

        // Get all measure data from the data pool in Cartesian3 format
        const data = this.dataPool.getAllMeasures("cartesian");
        if (Array.isArray(data) && data.length === 0) return null;

        // Find the measure that contains the coordinate
        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, cartesian));
        })

        if (!measure) return null;

        // Clone the coordinates to avoid mutating the original data
        const clonedCoordinates = measure.coordinates.map(coord => {
            return Cartesian3.clone(coord);
        });

        // Return a new object with the coordinates cloned
        return { ...measure, coordinates: clonedCoordinates }; // Return a new object with the coordinates cloned
    }

    /**
    * Resets all the collections, listeners, and internal state of cesium measure.
    * This method is called when the tool is disconnected.
    * @override
    * @returns {void}
    */
    removeAnnotationsAndListeners() {
        this.drawingHelper.clearCollections();
    }

    /**
     * Removes all pending annotations in the current mode.
     * This includes points, labels, polylines, and polygons that are not completed.
     * It does not remove completed annotations.
     * @override
     * @returns {void}
     */
    removePendingAnnotations() {
        const targetIdPrefix = `annotate_${this.mode}`;

        // Helper function to check if annotation should be removed
        const shouldRemove = (annotation) => {
            const annotationStatus = annotation?.feature?.properties?.status;
            return annotation && annotation?.id?.includes(targetIdPrefix) && annotationStatus !== "completed";
        }

        // Define collections with their access methods and removal methods
        const collections = [
            {
                collection: this.pointCollection,
                accessMethod: 'get',
                removeMethod: '_removePointMarker'
            },
            {
                collection: this.labelCollection,
                accessMethod: 'get',
                removeMethod: '_removeLabel'
            },
            {
                collection: this.polylineCollection,
                accessMethod: 'index',
                removeMethod: '_removePolyline'
            },
            {
                collection: this.polygonCollection,
                accessMethod: 'index',
                removeMethod: '_removePolygon'
            }
        ];

        collections.forEach(({ collection, accessMethod, removeMethod }) => {
            const length = collection.length;
            if (length === 0) return; // Skip if collection is empty
            for (let i = length - 1; i >= 0; i--) {
                const item = accessMethod === 'get' ? collection.get(i) : collection[i];
                if (shouldRemove(item)) {
                    this.drawingHelper[removeMethod](item);
                }
            }
        });
    }


    /*******************************
     * COMMON METHOD USED IN MODES *
     *  USED AS REUSABLE METHODS   *
     *******************************/
    /**
     * Checks if the given coordinate is near any existing point in the mode.
     * @param {Cartesian3} coordinate - The coordinate to check.
     * @return {boolean} - Returns true if the coordinate is near an existing point, false otherwise.
     */
    _isNearPoint(coordinate) {
        if (!coordinate) {   // Validate input coordinate
            console.warn("Invalid coordinate provided.");
            return false;
        };

        // Get all measure data from the data pool in Cartesian3 format
        const data = this.dataPool.getAllMeasures("cartesian");

        if (!Array.isArray(data) && data.length === 0) {
            console.warn("No measures available in the data pool.");
            return false; // No measures available}
        }

        // Check if the coordinate is near any existing point in the mode
        return data.some(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => Cartesian3.distance(coord, coordinate) < 0.2);
        });
    }

    _updateLabel(label, positions, labelText, options = {}) {
        if (!label || typeof labelText !== 'string') {
            console.warn("Invalid label or labelText provided.");
            return null;
        }

        const { status, showBackground, id } = options;

        // Label position
        const numPos = positions.length;
        const labelPosition = numPos === 1 ? positions[0] : calculateMiddlePos(positions);
        if (!labelPosition) return null;

        // -- Handle Label Visual Update --
        label.position = labelPosition; // Update the position of the label 
        label.text = labelText; // Update the text of the label 
        label.showBackground = showBackground; // Update the background visibility of the label

        // -- Handle Label Metadata Update --
        if (!label?.feature?.properties) {
            label.feature = { properties: {} }; // Ensure feature properties exist
        }
        Object.assign(label.feature.properties, {
            status,
            positions: positions.map(pos => Cartesian3.clone(pos)), // Store the original positions
            ...(id && deconstructIdForMetadata(id)) // deconstruct id for metadata
        });
        label.feature.id = id; // Set the feature ID
        label.id = id;

        return label; // Return the updated label
    }

    /**
     * Removes the remaining point and labels when only one point is left in the measure.
     * @param {Cartesian3[]} positions - The positions to be removed
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
        this.dataPool.removeMeasureById(measureId); // Remove the measure from the data pool

        // -- Reset values --
        this.resetValuesModeSpecific();

        // -- Destroy chart if exists --
        if (this.chartDiv && typeof this._destroyChart === "function") {
            this._destroyChart(); // Destroy the chart if it exists
        }

        // Show notification
        showCustomNotification(`Last point removed from measure ${measureId}`, this._container);
    }

    /**
     * Gets the necessary context for resuming a measurement from a clicked point.
     * It checks if the point is the first or last point of a completed measurement.
     * @param {Primitive} point - The clicked point primitive.
     * @returns {{pointIndex: number, measureData: MeasurementGroup}|null} - The context, or null if not eligible.
     * @private
     */
    _getPointContextForResume(point) {
        // Find the measure data by the ID embedded in the point primitive
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return null;

        const measureData = this.dataPool.getMeasureById(measureId);
        // Only completed measures can be resumed
        if (!measureData || measureData.status !== "completed") {
            return null;
        }

        // The coordinates in the data pool are CartographicDegrees, convert them for comparison
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToCartesian3(cartographicDegrees));

        // Find the index of the clicked point within the measure's coordinates
        const pointPosition = point.feature?.properties?.positions[0];
        if (!pointPosition) return null;

        const pointIndex = measureData.coordinates.findIndex(coordinate => areCoordinatesEqual(coordinate, pointPosition));
        if (pointIndex === -1) return null;

        // Check if the point is the first or the last one
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === measureData.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            return { pointIndex, measureData };
        }

        return null;
    }


    /***********************************************************
     *                     COMMON FEATURE                      *
     * THE STANDALONE FEATURE OR SERIES METHOD FORMS A FEATURE *
     ***********************************************************/
    /*************************
     * CONTEXT MENU FEATURES *
     *************************/
    /**
    * Handle right click on the map.
    * To Hide the context menu if right click at empty space on the map
    * @override
    */
    async handleRightClick(eventData) {
        const { pickedFeature, screenPoint } = eventData;

        // -- Handle Picked Object Priority -- 
        const { type: pickedObjectType, object: pickedObject } = getRankedPickedObjectType(pickedFeature, null);

        // -- Handle not picked object --
        if (!pickedObjectType || !pickedObject || pickedObject?.primitive?.feature?.properties?.status !== "completed") {
            // Finish the measurement if it has finishMeasure method
            if (typeof this._finishMeasure === "function") {
                this._finishMeasure();
            }

            // Hide the context menu
            if (this.contextMenu) {
                this._setContextMenuVisibility(false);
            }
            return;  // Exit to skip the rest of the logic
        }

        // -- Handle context menu of picked object  --
        // If a picked object is found, show the context menu with options
        const items = [];
        if (pickedObjectType && pickedObject) {
            // -- Get the context menu items for the picked object --
            const annotationItems = this._getContextMenuItemsForAnnotation(pickedObject, pickedObjectType);
            items.push(...annotationItems);

            // -- Add feature tasks items if the user role includes "tester" --
            if (this.drawingHelper.getUserRole().includes("tester")) {
                const featureTasksItems = this._getContextMenuItemsForFeatureTasks(pickedObject, pickedObjectType);
                items.push(...featureTasksItems);
            }

            // If no items to show, hide the context menu
            if (!Array.isArray(items) || items.length === 0) {
                this._setContextMenuVisibility(false);
                return; // If no items to show, exit
            }

            // Update the context menu with the items
            this._updateContextMenu(this._container, screenPoint, items);
        }
    }

    _getContextMenuItemsForAnnotation(pickedObject, pickedObjectType) {
        // Validate input parameters
        if (!pickedObject) return [];

        // -- Common actions --
        const commonItems = [
            {
                text: "Copy Coordinate",
                event: () => { this._copyCoordinateToClipboard(this.coordinate); }
            },
            {
                text: "Remove Primitive Set",
                event: () => { this._removePrimitiveSet(pickedObject.primitive); }
            }
        ];

        // -- Get the picked object mode --
        // Determine the pickedObject mode from its properties metadata or ID
        let pickedObjectMode = null;
        if (pickedObject?.feature?.properties?.mode) {
            pickedObjectMode = pickedObject.feature.properties.mode;
        } else if (pickedObject?.id?.startsWith('annotate_')) {
            pickedObjectMode = pickedObject.id.split('_')[1];
        }

        // Modes that support advanced actions
        const advancedAnnotationModes = [
            'multi-distances',
            'multi-distances-clamped',
            'profile-distances',
        ];

        const additionalItems = [];

        // AdvancedAnnotationModes handle its own context menu items
        if (advancedAnnotationModes.includes(pickedObjectMode)) {
            const modeInstance = this.drawingHelper.getModeInstanceByName(pickedObjectMode)
            if (!modeInstance || typeof modeInstance._getContextMenuAdditionalItems !== "function") return;
            // Let the mode instance handle its own context menu items
            const itemList = modeInstance._getContextMenuAdditionalItems(pickedObject, pickedObjectType);
            additionalItems.push(...itemList);  // Add the items from the mode instance
        }

        // Handle specific actions based on the picked object type
        switch (pickedObjectType) {
            case "label":
                const label = pickedObject.primitive;
                additionalItems.push({ text: "Edit label", event: () => { editableLabel(this._container, label) } });
                break;
            case "line":
                break;
            case "point":
                break;
            default:
                break;
        }

        return [...commonItems, ...additionalItems];
    }

    _getContextMenuItemsForFeatureTasks(pickedObject, pickedObjectType) {
        return [{
            text: "Feature Tasks",
            submenu: [
                { text: "Add Missing Bay", event: () => { this._addMissingBay(pickedObject) } },
                { text: "Add Missing Pole", event: () => { this._addMissingPole(pickedObject) } },
            ]
        }];
    }

    _addMissingBay(pickedObject) {
        this.stateManager.setBehaviorState('featureTasks', 'addMissingBay');
        showCustomNotification("Feature task 'Add Missing Bay' is activated.", this._container);

        // switch to the mode of the picked object
        const pickedObjectMode = pickedObject?.feature?.properties?.mode || pickedObject.id.split('_')[1];
        this._getOrSetModeInstance(pickedObjectMode);

        // Add a stop button to stop the feature task
        if (this.drawingHelper._buttonContainer.querySelector(".stop-feature-task")) {
            return; // If the stop button already exists, do not add again
        }
        const stopButton = document.createElement("button");
        stopButton.textContent = "Stop";
        stopButton.title = "Stop feature tasks";
        stopButton.classList.add("annotate-button", "animate-on-show", "active", "stop-feature-task");
        stopButton.style.top = "0.5rem";
        stopButton.style.left = "0px";
        stopButton.setAttribute("aria-pressed", "false");
        stopButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.stateManager.setBehaviorState('featureTasks', null);
            showCustomNotification("Feature tasks stopped.", this._container);
            stopButton.remove();
        });
        this.drawingHelper._buttonContainer && this.drawingHelper._buttonContainer.appendChild(stopButton);
    }

    _addMissingPole() {
        this.stateManager.setBehaviorState('featureTasks', 'addMissingPole');
        showCustomNotification("Feature task 'Add Missing Pole' is activated.", this._container);
    }

    /**
     * Get or set the mode instance for a given mode name.
     * This method match this.mode with the modeName to see if the mode is already active.
     * If the mode is already active, it retrieves the instance of the active mode.
     * otherwise it activates the mode and returns the mode instance.
     * @param {string} modeName  - The name of the mode to get or set.
     * @returns {Object|null} - The mode instance or null if invalid.
     */
    _getOrSetModeInstance(modeName) {
        // Validate param
        if (typeof modeName !== "string") return null;

        // Check if the mode is already active
        const currentActiveModeInstance = this.drawingHelper.getActiveModeInstance();
        if (!currentActiveModeInstance) return null;

        const currentActiveModeName = currentActiveModeInstance.mode;
        const isAlreadyInMode = currentActiveModeName === modeName;

        // -- Handle mode activation --
        // If already in the mode, get the instance
        if (isAlreadyInMode) {
            return currentActiveModeInstance; // Return the current active mode instance
        } else {  // Otherwise, activate the mode
            return this.drawingHelper._activateMode(modeName) || null;
        }
    }

    /**
     * Removes the entire primitive set associated with the same measure id used in the picked primitive id.
     * @param {Primitive} primitive - The primitive to look up for its id and remove the entire primitive set.
     * @returns {void} 
     */
    _removePrimitiveSet(primitive) {
        if (!primitive || !primitive.id || !primitive?.id?.startsWith("annotate_")) {
            console.warn("Invalid primitive provided or primitive does not have a valid ID.");
            return; // Exit if the primitive is invalid or does not have a valid ID
        }

        // confirmation 
        // const userConfirmation = window.confirm(`Do you want to remove this entire line set?`) // Confirm the removal action
        // if (!userConfirmation) return;

        const measureId = Number(primitive.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID

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
        this.dataPool.removeMeasureById(measureId);

        // Remove the chart if it exists for profile and profile distance modes
        if (this.chartDiv && typeof this._destroyChart === 'function') {
            this._destroyChart(); // Destroy the chart if it exists
        };

        // show notification
        showCustomNotification(`Removed primitive set, id: ${measureId}`, this._container);
    }

    _resumeMeasure(pointIndex, measureData) {
        if (measureData === undefined || pointIndex === undefined) return;

        // Set the component's state to the measure being resumed
        this.measure = measureData;
        this.measure.status = "pending";
        this.distances = [...this.measure._records[0].distances];
        this.coordsCache = this.measure.coordinates;

        // Determine if resuming from the start or end
        const isFirstPoint = pointIndex === 0;

        // Set flags to continue measuring
        this.flags.isMeasurementComplete = false;
        this.flags.isReverse = isFirstPoint;

        // Optional: Add a user notification
        showCustomNotification(`Resuming measure id: ${this.measure.id}`, this._container);
    }

    /**
     * Copy the given coordinate to the clipboard.
     * @param {Cartesian3|Cartographic|CartographicDegrees} coordinate 
     * @returns {string|null} - The text copied to clipboard or null if conversion failed.
     */
    _copyCoordinateToClipboard(coordinate) {
        if (!coordinate) return null;

        const cartographicDegrees = convertToCartographicDegrees(coordinate);
        if (!cartographicDegrees) {
            console.warn("Failed to convert coordinate to cartographic degrees.");
            return null;
        }
        const latitude = cartographicDegrees.latitude.toFixed(4);
        const longitude = cartographicDegrees.longitude.toFixed(4);
        const height = cartographicDegrees.height ? cartographicDegrees.height.toFixed(2) : '0';

        // Prepare the text to copy
        const textToCopy = `${latitude}, ${longitude}, ${height}`;

        // copy to clipboard
        navigator.clipboard.writeText(textToCopy)

        showCustomNotification(`Copied coordinate: ${textToCopy}`, this._container);

        return textToCopy;
    }

    _setAddModeByLine(linePrimitive) {
        // Validate input parameters
        if (!linePrimitive || linePrimitive?.feature?.properties?.status === "moving") return;

        // -- Set measure id --
        const measureId = Number(linePrimitive.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID

        // -- User confirmation --
        // const userConfirmation = window.confirm(`Do you want to add a new point to this line segment? Measure id: ${measureId}`);
        // if (!userConfirmation) return; // If the user does not confirm, exit

        // Set the measure data
        const measureData = this._findMeasureById(measureId);
        if (!measureData) return; // If the measure is not found, exit
        measureData.status = "pending"; // Set the measure status to pending

        // Set relevant properties of the mode instance by measureData 
        this.measure = measureData; // Set the measure data to the mode instance
        this.coordsCache = measureData.coordinates; // Set the coordsCache to the measure coordinates
        this.distances = [...measureData._records[0].distances]; // Get the distances from the measure data

        // Update measure data and dataPool
        // modeInstance.measure.status = "pending"; // Set the measure status to pending

        // Update data pool with the measure data (to update the specific data status)
        this.dataPool.updateOrAddMeasure({ ...this.measure });

        // Set flags for add mode
        this.flags.isAddMode = true; // Set the add mode flag to true

        // Store references 
        this.interactiveAnnotations.polylines = [linePrimitive];  // Store the line primitive in the interactive annotations

        // Due to update method logic only update on existing label, so it need to clone it again to update two labels 
        const linePrimitivePositions = linePrimitive.feature?.properties?.positions;
        const existingLabel = this.drawingHelper._getLabelByPosition(linePrimitivePositions)[0];
        if (!existingLabel) return; // If no label is found, exit
        const clonedLabel = this.labelCollection.add(existingLabel);
        this.interactiveAnnotations.labels = [existingLabel, clonedLabel];

        this.interactiveAnnotations.totalLabels = [...this.drawingHelper._getLabelByPosition(this.coordsCache[this.coordsCache.length - 1])]; // Get the total label by the last position of the coordsCache

        // Show notification
        showCustomNotification(`Add mode is enabled. Click on the map to add a new point for segment, measure id: ${measureId}`, this._container);
    }

    _addAction() {
        const line = this.interactiveAnnotations.polylines[0];
        if (!line || line?.feature?.properties?.status === "moving") {
            console.warn("No valid line to add a point to.");
            return;
        }

        // -- Update this.coordsCache --
        const linePositions = line?.feature?.properties?.positions;
        const linePos1Index = this.coordsCache.findIndex(pos => areCoordinatesEqual(pos, linePositions[0]));
        const linePos2Index = this.coordsCache.findIndex(pos => areCoordinatesEqual(pos, linePositions[1]));
        if (linePos1Index === -1 || linePos2Index === -1) return; // If positions are not found, exit
        const minIndex = Math.min(linePos1Index, linePos2Index);
        this.coordsCache.splice(minIndex + 1, 0, this.coordinate); // Insert the new coordinate after the first position of the line

        // -- Create new point --
        this.drawingHelper._addPointMarker(this.coordinate, {
            color: this.stateManager.getColorState("pointColor"),
            id: `annotate_${this.mode}_point_${this.measure.id}`,
            status: "completed"
        });

        const newPositions = [[linePositions[0], this.coordinate], [this.coordinate, linePositions[1]]]; // Create new positions for the line

        // -- Create or update the line --
        this._createOrUpdateLine(newPositions, this.interactiveAnnotations.polylines, {
            color: this.stateManager.getColorState("line"),
            status: "completed"
        });

        // -- Create or update the label --
        const { distances, interpolatedPositions } = this._createOrUpdateLabel(newPositions, this.interactiveAnnotations.labels, {
            showBackground: true,
            status: "completed"
        });
        if (distances.length === 0) return;


        // -- Handle Distances record --
        const currentDistances = this.distances;
        currentDistances.splice(minIndex, 1, ...distances);
        this.distances = currentDistances;

        // -- Handle interpolated positions --
        if (Array.isArray(interpolatedPositions) && interpolatedPositions.length > 0) {
            this.measure.interpolatedPoints.splice(minIndex, 1, ...interpolatedPositions);
        }

        // -- Handle Chart if it exists --
        if (typeof this._createOrUpdateChart === "function") {
            const interpolatedCartesian = this.measure.interpolatedPoints.flat(1);
            const interpolatedCartographicDegrees = interpolatedCartesian.map(pos => convertToCartographicDegrees(pos));
            this._createOrUpdateChart(interpolatedCartesian, interpolatedCartographicDegrees);
        }

        // -- Update total distance label --
        const { totalDistance } = this._createOrUpdateTotalLabel(this.coordsCache, this.interactiveAnnotations.totalLabels, {
            showBackground: true,
            status: "completed"
        });

        // -- Update measure data --
        if (distances.length > 0 && typeof totalDistance === "number") {
            const record = { distances: [...this.distances], totalDistance };
            this.measure._records[0] = record; // Update distances record
        }
        this.measure.status = "completed"; // Set the measure status to completed
        this.measure.coordinates = this.coordsCache.map(pos => ({ ...pos })); // Update the measure with the new coordinates
        this.dataPool.updateOrAddMeasure({ ...this.measure }); // Update data pool with the measure data

        // -- Reset values --
        this.resetValuesModeSpecific(); // Reset the mode-specific values

        // reset the flags to be ready for the next measurement
        this.flags.isMeasurementComplete = true; // Set the measurement as complete
    }

    _setupPointerOverlay() {
        // update pointerOverlay: the moving dot with mouse
        let pointerElement = this.stateManager.getOverlayState("pointer");
        if (!pointerElement) {
            pointerElement = createPointerOverlay(this._container); // Create pointer overlay if not exists
        }
        this.stateManager.setOverlayState("pointer", pointerElement);
        return pointerElement;
    }

    /**************************
     * CHART FEATURE SPECIFIC *
     **************************/
    /**
     * Creates and initializes the chart.
     * @param {object} specificChartConfig - Mode-specific chart configuration to merge with defaults.
     * @param {object} specificChartData - Mode-specific data for the chart.
     * @param {function} onHoverCallback - Mode-specific callback for chart hover events.
     * @returns {import("chart.js").Chart | null}
     */
    _createChart(specificChartConfig = {}, specificChartData = {}, onHoverCallback = null) {
        // -- Validate dependencies --
        if (!this.drawingHelper || !this.drawingHelper.map || !this.drawingHelper.map.container) {
            console.error("Cesium viewer or container not available to create chart.");
            return null;
        }

        // Ensure any existing chart is destroyed before creating a new one
        this._destroyChart();


        // -- Handle chart container --
        this.chartDiv = document.createElement("div");
        this.chartDiv.className = "cesium-chart"; // Use a more specific class name
        // It's better to use this.drawingHelper.map.container
        this.drawingHelper.map.container.appendChild(this.chartDiv);


        // -- Create and add the close button --
        const { button: closeButton, cleanup: closeButtonCleanup } = createCloseButton({
            position: "absolute",
            top: "5px",
            right: "5px",
            image: closeIconBlack,
            clickCallback: () => this._destroyChart()
        });
        this._closeButtonCleanup = closeButtonCleanup; // Store cleanup function    
        this.chartDiv.appendChild(closeButton); // Add close button to chart div


        // -- Create the canvas element --
        const canvas = document.createElement("canvas");
        // Use this.modeName for a more specific ID if modes can have charts simultaneously
        canvas.id = `${this.mode || 'common'}-chart`;
        // Let CSS handle sizing primarily, or make it configurable
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        this.chartDiv.appendChild(canvas);


        // -- Handle chart container styles --
        // Apply styles via CSS classes or make them configurable
        Object.assign(this.chartDiv.style, {
            position: "absolute",
            top: "0px",
            left: "0px",
            transform: "translate(10px, 10px)", // Offset from the top-left corner
            width: "400px",
            height: "200px",
            backgroundColor: "white", // Corrected property name
            zIndex: "1000",
            border: "1px solid #ccc",
            boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
            display: "block" // Show by default, or control via a separate method
        });

        // -- Handle the Chart param --
        const ctx = canvas.getContext("2d");

        // Default configuration - can be overridden/extended by specificChartConfig
        const baseChartConfig = {
            type: "line",
            data: { // Base data structure, specificChartData will populate datasets
                labels: [], // Populated by specificChartData
                datasets: [
                    {
                        label: "Profile Data", // Generic label
                        data: [], // Populated by specificChartData
                        borderColor: "rgba(75, 192, 192, 1)",
                        borderWidth: 2,
                        fill: false, // Often better for profile lines
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, chartElements) => {
                    if (onHoverCallback && typeof onHoverCallback === 'function') {
                        onHoverCallback(event, chartElements, this.chartInstance);
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Distance (meters)", // Generic
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Height (meters)", // Generic
                        },
                    },
                },
            },
        };

        // Deep merge specific config and data
        const finalConfig = { ...baseChartConfig, ...specificChartConfig };
        if (specificChartData.labels) finalConfig.data.labels = specificChartData.labels;
        if (specificChartData.datasets) finalConfig.data.datasets = specificChartData.datasets;

        // -- Error Handling if not Chart --
        if (typeof Chart === 'undefined') {
            console.error("chart.js is not loaded.");
            this._destroyChart(); // Clean up div if chart cannot be created
            return null;
        }

        // -- Create the chart instance --
        this.chartInstance = new Chart(ctx, finalConfig);

        // Storing custom data directly on chartInstance.customData is fine if needed,
        // but often the mode itself will hold the relevant source data.
        // this.chartInstance.customData = { /* ... */ };

        // -- Make the chart draggable --
        makeDraggable(this.chartDiv, this.drawingHelper.map.container);

        return this.chartInstance;
    }

    /**
     * Destroys the chart instance and cleans up the chart container.
     * @returns {void}
     */
    _destroyChart() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        if (this.chartDiv) {
            this.chartDiv.remove();
            this.chartDiv = null;
        }

        if (this._closeButtonCleanup) {
            this._closeButtonCleanup();
            this._closeButtonCleanup = null;
        }
    }

    /**
     * Updates the chart with new data.
     * @param {object} newData - Object containing new labels and datasets.
     * Example: { labels: [...], datasets: [{ data: [...] }] }
     * @returns {void}
     */
    _updateChartData(newData) {
        if (this.chartInstance && newData) {
            if (newData.labels) {
                this.chartInstance.data.labels = newData.labels;
            }
            if (newData.datasets) {
                // Assuming the structure of datasets matches (e.g., updating the first dataset)
                // For more complex updates, you might need to merge more carefully
                newData.datasets.forEach((newDataset, index) => {
                    if (this.chartInstance.data.datasets[index]) {
                        Object.assign(this.chartInstance.data.datasets[index], newDataset);
                    } else {
                        this.chartInstance.data.datasets[index] = newDataset;
                    }
                });
            }
            this.chartInstance.update();
        }
    }

    /**
     * Sets the visibility of the chart container.
     * @param {boolean} visible - Whether the chart should be visible.
     * @returns {void}
     */
    _setChartVisibility(visible) {
        if (this.chartDiv) {
            this.chartDiv.style.display = visible ? 'block' : 'none';
        }
    }


    /*********************************
     * CONTEXT MENU SPECIFIC UTILITY *
     *********************************/
    /**
     * Update the context menu with new items and position. Fallbacks to setup context menu if not exists.
     * @param {HTMLElement} container - the map container where the context menu should be displayed
     * @param {{x:number, y:number}} position - the position where the context menu should be displayed
     * @param {Array<{text:string, event:function}>} itemOptions - the context menu items options
     *      e.g: [{text: "remove point", event: function() { }},{text: "remove line", event: function() { }}]
     * @param {*} options - additional options for the context menu
     * @returns {HTMLElement|null} - the updated context menu element or null if not created
     */
    _updateContextMenu(container, position, itemOptions = [], options = {}) {
        let contextMenu = this.stateManager.getElementState("contextMenu");

        if (contextMenu) {
            contextMenu.remove();
            this.stateManager.setElementState("contextMenu", null); // Clear the previous context menu state
        }

        contextMenu = createContextMenu(container, options);
        this.stateManager.setElementState("contextMenu", contextMenu);

        updateContextMenu(contextMenu, position, itemOptions);
        return contextMenu;
    }

    _setContextMenuVisibility(visible) {
        const contextMenu = this.stateManager.getElementState("contextMenu");
        if (visible) {
            if (contextMenu) contextMenu.style.display = 'block';
        } else {
            hideContextMenu(contextMenu);
        }
    }

    /*******************
     *     HELPER      *
     * GENERAL METHODS *
     *******************/
}

export { MeasureModeCesium };
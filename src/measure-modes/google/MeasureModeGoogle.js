import { MeasureModeBase } from "../MeasureModeBase.js";
import { areCoordinatesEqual, calculateDistance, calculateMiddlePos, checkOverlayType, convertToLatLng } from "../../lib/helper/googleHelper.js";
import dataPool from "../../lib/data/DataPool.js";
import { createContextMenu, deconstructIdForMetadata, formatMeasurementValue, getNeighboringValues, showCustomNotification, updateContextMenu, hideContextMenu } from "../../lib/helper/helper.js";


/** @typedef {import('../../lib/input/GoogleMapsInputHandler.js').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../../lib/interaction/GoogleDragHandler.js').GoogleDragHandler} GoogleDragHandler */
/** @typedef {import('../../lib/interaction/GoogleHighlightHandler.js').GoogleHighlightHandler} GoogleHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/GoogleMeasure.js').GoogleMeasure} GoogleMeasure */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {Array<{latitude: number, longitude: number, height?: number}|number|string>} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */
/**
 * @typedef NormalizedEventData
 * @property {object} domEvent - The original DOM event
 * @property {{lat:number, lng:number}} mapPoint - The point on the map where the event occurred
 * @property {{x:number, y:number}} screenPoint - The screen coordinates of the event
 * @property {google.maps.Marker|google.maps.Polyline|google.maps.Polygon|null} overlay - The annotation graphics object
 */


/**
 * Shared functionality between modes in Google Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `googleHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeGoogle extends MeasureModeBase {
    contextMenu;

    /**
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {GoogleMapsInputHandler} inputHandler - The map input event handler abstraction.
     * @param {GoogleDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {GoogleHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {GoogleMeasure} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {EventEmitter} emitter - The event emitter instance.
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);

        // Initialize context menu - default to hidden
        this.contextMenu = createContextMenu(this._container, { show: false });
        this.stateManager.setElementState("contextMenu", this.contextMenu);
    }


    /*******************
     * OVERRIDE METHOD *
     *******************/
    /**
     * Attach Leaflet-specific event listeners.
     * @override
     */
    _attachMapSpecificListeners() {
        this.emitter.on('annotation-contextmenu-google', this._handleContextMenu);
    }

    /**
     * Remove Leaflet-specific event listeners.
     * @override
     */
    _removeMapSpecificListeners() {
        this.emitter.off('annotation-contextmenu-google', this._handleContextMenu);
    }

    /**
     * Handle right click on the map.
     * To Hide the context menu if right click at empty space on the map
     * Intended to skip the param as it is not used in this method
     * @override
     */
    handleRightClick() {
        // Hide the context menu
        this.contextMenu && this._setContextMenuVisibility(false);
    }


    /*******************
     * UTILITY FEATURE *
     *******************/
    /**
     * Find a measure by its ID from the data pool.
     * @param {number} measureId - The ID of the measure to find.
     * @returns {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureById(measureId) {
        if (typeof measureId !== "number") {
            console.warn("Invalid measureId provided. It should be a number.");
            return null; // Return null if measureId is not a number
        }

        const measure = dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measure) return; // If no measure found, exit the function

        // Convert cartographic degrees to Google coordinates
        measure.coordinates = measure.coordinates.map(coord => convertToLatLng(coord)); // Ensure coordinates are in Google format
        return measure;
    }

    /**
     * Find and handle the measure data from dataPool
     * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number}} coordinate - The coordinate to find the measure data. 
     * @returns {MeasurementGroup} - returns a cloned measure object with converted google coordinates
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to lat lng object
        const latLng = { ...convertToLatLng(coordinate) };
        if (!latLng) return null;

        const data = dataPool.getAllMeasures("cartographicDegrees");
        if (Array.isArray(data) && data.length === 0) return null;

        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, latLng));
        })
        if (!measure) return null;

        const coordinates = measure.coordinates.map(coord => convertToLatLng(coord));

        return { ...measure, coordinates }; // Return a new object with the coordinates converted to Google format
    }

    /**
     * Remove all annotations and listeners from the map.
     * It is intended to be called when the map disconnects. 
     */
    removeAnnotationsAndListeners() {
        this.pointCollection.forEach(marker => {
            google.maps.event.clearInstanceListeners(marker); // Remove all listeners from this marker
            marker.setMap(null); // Remove marker from map
        });
        this.pointCollection = []; // Clear the collection

        this.labelCollection.forEach(label => {
            google.maps.event.clearInstanceListeners(label); // Remove all listeners from this label
            label.setMap(null); // Remove label from map
        })
        this.labelCollection = []; // Clear the collection

        this.polylineCollection.forEach(polyline => {
            google.maps.event.clearInstanceListeners(polyline); // Remove all listeners from this polyline
            polyline.setMap(null); // Remove polyline from map
        });
        this.polylineCollection = []; // Clear the collection

        this.polygonCollection.forEach(polygon => {
            google.maps.event.clearInstanceListeners(polygon); // Remove all listeners from this polygon
            polygon.setMap(null); // Remove polygon from map
        });
    }

    /**
     * Removes all pending annotations in the current mode.
     * This includes points, labels, polylines, and polygons that are not completed.
     * It does not remove completed annotations.
     * @returns {void}
     */
    removePendingAnnotations() {
        const targetIdPrefix = `annotate_${this.mode}`;

        // Helper function to check if annotation should be removed
        const shouldRemove = (annotation) => {
            const annotationStatus = annotation?.feature?.properties?.status || annotation.status;
            return annotation.id.includes(targetIdPrefix) && annotationStatus !== "completed";
        }

        // Define collections with their removal methods
        const collections = [
            { items: this.pointCollection, removeMethod: '_removePointMarker' },
            { items: this.labelCollection, removeMethod: '_removeLabel' },
            { items: this.polylineCollection, removeMethod: '_removePolyline' },
            { items: this.polygonCollection, removeMethod: '_removePolygon' }
        ];

        collections.forEach(({ items, removeMethod }) => {
            for (let i = items.length - 1; i >= 0; i--) {
                const item = items[i];
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
     * Updates a single label's visual appearance and metadata.
     * Reused in different modes to ensure consistent label updates.
     * @param {google.maps.Marker} label - The label to update.
     * @param {{lat:number,lng:number}[]} positions - Array of positions for this label.
     * @param {string} labelText - The plain formatted text string to display on the label.
     * @param {Object} [options={}] - Additional options for label update.
     */
    _updateLabel(label, positions, labelText, options = {}) {
        if (!label || typeof labelText !== "string") {
            console.warn("Invalid label or labelText provided for update.");
            return null;
        }

        const { status, clickable, id } = options;

        // Label position
        const numPos = positions.length;
        const labelPosition = numPos === 1 ? positions[0] : calculateMiddlePos(positions);

        // -- Handle Label Visual Update --
        label.setPosition(labelPosition); // update position
        // Ensure getLabel() exists and returns an object before spreading
        const currentLabelOptions = label.getLabel();
        if (currentLabelOptions) {
            label.setLabel({ ...currentLabelOptions, text: labelText, clickable }); // update text
        } else {
            // Fallback if getLabel() is not as expected
            label.setLabel({ text: labelText, clickable });
        }

        // -- Handle Label Metadata Update --
        if (!label?.feature?.properties) {
            label.feature = { properties: {} }; // Ensure feature properties exist
        }
        Object.assign(label.feature.properties, {
            status,
            positions: positions.map(pos => ({ ...pos })),
            ...(id && deconstructIdForMetadata(id))
        });
        label.feature.id = id;
        label.id = id;

        return label;
    }

    /**
     * Updates all pending items in a collection to completed status and makes them interactive.
     * @param {Array} collection - The collection of items to update (points, polylines, or labels)
     * @param {string} filterPrefix - The ID prefix to filter items by (e.g., `annotate_${this.mode}`)
     * @returns {void}
     */
    _updatePendingItemsToCompleted(collection, filterPrefix) {
        if (!Array.isArray(collection)) return;

        const pendingItems = collection.filter(item =>
            item.id?.includes(filterPrefix) && item?.feature?.properties?.status === "pending"
        );

        pendingItems.forEach(item => {
            // Set status to completed
            if (item?.feature?.properties?.status) {
                item.feature.properties.status = "completed";
            }

            // Make the item interactive (Google Maps uses different methods)
            if (item.setOptions) {
                item.setOptions({ clickable: true });
            } else if (item.clickable !== undefined) {
                item.clickable = true;
            }
        });
    }


    /***********************************************************
     *                     COMMON FEATURE                      *
     * THE STANDALONE FEATURE OR SERIES METHOD FORMS A FEATURE *
     ***********************************************************/
    /*************************
     * CONTEXT MENU FEATURES *
     *************************/
    /**
     * Handles the context menu event.
     * @param {NormalizedEventData} eventData - The event data containing information about the context menu event.
     * @returns {void}
     */
    _handleContextMenu = (eventData) => {
        const { overlay, screenPoint } = eventData;

        // If no overlay was right-clicked, or if a measurement is in progress, do nothing.
        if (!overlay || this.coordsCache.length > 0) {
            this._setContextMenuVisibility(false);
            return;
        }

        // Get the menu items specific to the clicked overlay
        const items = this._getContextMenuItemsForAnnotation(overlay);
        if (items.length === 0) {
            this._setContextMenuVisibility(false);
            return; // If no items to show, exit
        }

        // Update and show the context menu at the clicked position
        this._updateContextMenu(this._container, screenPoint, items);
    }

    /**
     * Gets the context menu items for a specific annotation overlay.
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} overlay
     * @returns {Array<{text: string, event: Function}>}
     */
    _getContextMenuItemsForAnnotation(overlay) {
        if (!overlay) return [];

        const itemList = [];
        // Add common items
        itemList.push(
            { text: "Copy Coordinate", event: () => { this._copyCoordinateToClipboard(this.coordinate) } },
            { text: "Remove Layer Set", event: () => this._removeOverlaySet(overlay) }
        );

        // -- Handle Mode-Specific Items --
        // Determine the overlay mode from its properties metadata or ID
        const overlayMode = overlay?.feature?.properties?.mode || overlay.id?.split('_')[1];

        switch (overlayMode) {
            // Get mode-specific items based on the overlay's mode
            case 'multi-distances':
                const multiDistanceItems = this._getMultiDistanceContextMenuItems(overlay);
                itemList.push(...multiDistanceItems);
                break;
            // Add other modes as needed
            default:
                break;
        }

        return itemList;
    }

    /**
     * Removes an overlay set, including related points, labels, polylines and polygons.
     * @param {google.maps.Marker|google.maps.Polyline|google.maps.Polygon} overlay - The overlay to remove.
     * @returns {void}
     */
    _removeOverlaySet(overlay) {
        if (!overlay) return;

        // confirmation 
        // const userConfirmation = window.confirm(`Do you want to remove this overlay set?`) // Confirm the removal action
        // if (!userConfirmation) return;

        const measureId = Number(overlay.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID

        const { points, polylines, labels, polygons } = this.drawingHelper._getRelatedOverlaysByMeasureId(measureId);
        points.forEach(point => {
            this.drawingHelper._removePointMarker(point); // Remove the point marker
        });
        labels.forEach(label => {
            this.drawingHelper._removeLabel(label); // Remove the label
        });
        polylines.forEach(polyline => {
            this.drawingHelper._removePolyline(polyline); // Remove the polyline
        });
        polygons.forEach(polygon => {
            this.drawingHelper._removePolygon(polygon); // Remove the polygon
        });

        // remove the measure data from dataPool
        dataPool.removeMeasureById(measureId);

        // show notification
        showCustomNotification(`removed overlay set, id: ${measureId}`, this._container)
    }

    /**
     * Copies the given coordinate to the clipboard.
     * @param {{lat:number, lng:number}} coordinate - The coordinate to copy.
     * @returns {string|null} - The copied coordinate as a string or null if invalid.
     */
    _copyCoordinateToClipboard(coordinate) {
        if (!coordinate) return null;

        const latLng = convertToLatLng(coordinate);
        if (!latLng) {
            console.warn("Invalid coordinate provided for clipboard copy.");
            return null;
        }
        const latitude = latLng.lat.toFixed(4);
        const longitude = latLng.lng.toFixed(4);

        // Prepare the text to copy
        const textToCopy = `${latitude}, ${longitude}`;

        // copy to clipboard
        navigator.clipboard.writeText(textToCopy)

        showCustomNotification(`Copied coordinate: ${textToCopy}`, this._container);

        return textToCopy;
    }

    /****************************
     *  CONTEXT MENU ITEMS FOR  *
     * MULTI DISTANCES SPECIFIC *
     ****************************/
    /**
     * Get the context menu items for the multi-distances measurement mode.
     * @param {google.maps.Marker} overlay - The overlay marker for which to get context menu items.
     * @returns {Array<{text: string, event: Function}>} - An array of context menu items.
     */
    _getMultiDistanceContextMenuItems(overlay) {
        // Validate input
        if (!overlay) return [];

        const itemList = [];
        const modeName = "multi-distances"; // The default mode name in this method

        // Check the overlay type to determine the context menu items
        const overlayType = checkOverlayType(overlay);
        switch (overlayType) {
            case "point":
                // -- Handle Remove Point --
                itemList.push({
                    text: "Remove Point",
                    event: () => this._removePointFromMultiDistances(overlay, modeName)
                });

                // -- Handle Resume Measure --
                const resumeContext = this._getPointContextForResume(overlay);
                // Check if resumeContext is valid and it is not a perimeter measure case
                const canResume = resumeContext &&
                    !areCoordinatesEqual(
                        resumeContext.measureData.coordinates[0],
                        resumeContext.measureData.coordinates[resumeContext.measureData.coordinates.length - 1]
                    )
                if (canResume) {
                    itemList.push({
                        text: "Resume measure",
                        event: () => this._resumeMultiDistancesMeasure(resumeContext.pointIndex, resumeContext.measureData)
                    });
                }
                break;
            default:
                return [];
        }

        return itemList;
    }

    /**
     * Removes a point from the multi-distances mode specific.
     * @param {google.maps.Marker} overlay - The overlay marker to remove.
     * @param {string} modeName - The name of the measurement mode.
     */
    _removePointFromMultiDistances(overlay, modeName) {
        // Validate input parameters
        if (!overlay || !overlay?.feature?.properties) return;

        // Find measure data by id
        const measureId = Number(overlay.id.split("_").slice(-1)[0]); // Extract the measure ID from the overlay ID
        const measureData = dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measureData || measureData.mode !== "multi-distances") {
            console.warn("Invalid measure data for multi-distances mode.");
            return;
        }
        // Set measure data to pending status
        measureData.status = "pending";
        // Convert coordinates to latLng format
        let positions = measureData.coordinates.map(coord => ({ ...convertToLatLng(coord) }));


        // -- Handle Point Removal in data -- 
        // Remove the point from the measure data coordinates
        const pointPosition = overlay.feature?.properties?.positions[0];
        if (!pointPosition) return;

        // Find the point index in the measure coordinates
        const pointPositionIndices = positions
            .map((coordinate, index) => areCoordinatesEqual(coordinate, pointPosition) ? index : -1)
            .filter(index => index !== -1); // Get the indices of the point, need to consider two cases: perimeter and normal case
        if (pointPositionIndices.length === 0) return; // If the point is not found, exit

        // Update positions
        positions = positions.filter((_, index) => !pointPositionIndices.includes(index));  // Set positions to filter out pointPositionIndices
        // -- End of Point Removal in data --


        // -- Handle Visual Removal for point, polyline and label --
        let totalLabel = null; // Keep total label reference for later use
        // Remove the point marker from the map
        this.drawingHelper._removePointMarker(overlay);

        // Remove associated polyline
        const polylines = this.drawingHelper._getLineByPositions([pointPosition]);
        if (!Array.isArray(polylines) || polylines.length === 0) return; // If no lines are found, exit
        polylines.forEach(line => {
            this.drawingHelper._removePolyline(line); // Remove the line
        });
        // Remove associated label
        const labelMarkers = this.drawingHelper._getLabelByPosition([pointPosition]);
        if (!Array.isArray(labelMarkers) || labelMarkers.length === 0) return; // If no labels are found, exit
        labelMarkers.forEach(label => {
            // Safety check: assume moving or total labels should not be removed here
            const isMovingLabel = label?.feature?.properties?.status === "moving";
            const isTotalLabel = label.id.startsWith(`annotate_${modeName}_total-label`);

            if (isTotalLabel) {
                totalLabel = label;  // Keep the total label reference for later use
            }

            // Remove the label except moving or total labels
            if (isMovingLabel || isTotalLabel) return;
            this.drawingHelper._removeLabel(label);
        });
        // -- End of Visual Removal --


        // -- Handle Reconnecting graphic and data --
        // Find neighboring coordinate
        const { previous, current, next } = getNeighboringValues(measureData.coordinates, pointPositionIndices[0]); // find the point position neighboring positions.

        const firstCoordinate = measureData.coordinates[0];
        const lastCoordinate = measureData.coordinates[measureData.coordinates.length - 1];
        const isPerimeter = areCoordinatesEqual(firstCoordinate, lastCoordinate);
        const recordDistances = [...measureData._records[0]["distances"]];

        // -- Handling Perimeter Case --
        if (isPerimeter) {
            // Case: the removing point is in the middle of the positions
            if (previous && next) {
                // Case: The minimum shape is a triangle that consists of 4 points. Less than 4 means it is not a shape
                if (positions.length === 3) {
                    positions.pop(); // Remove the last point if it is less than 4 points
                    // -- Handle Distances record --
                    recordDistances.splice(pointPositionIndices[0] - 1, 2);
                } else {
                    const reconnectedPositions = [previous, next];
                    // Create new polyline
                    this.drawingHelper._addPolyline(reconnectedPositions, {
                        id: `annotate_${modeName}_line_${measureId}`,
                        positions: reconnectedPositions,
                        status: "completed",
                        clickable: true,
                        color: this.stateManager.getColorState("line")
                    });
                    // Create new label
                    const distance = calculateDistance(reconnectedPositions[0], reconnectedPositions[1]);
                    this.drawingHelper._addLabel(reconnectedPositions, distance, "meter", {
                        id: `annotate_${modeName}_label_${measureId}`,
                        status: "completed",
                        clickable: true,
                    });
                    // Update measure data record distances properties
                    // Don't calculate all distances from coordsCache due to performance and consistency
                    recordDistances.splice(pointPositionIndices[0] - 1, 2, distance); // remove and insert the new distance
                }
            }
            // Case: The removing point is the first point
            else if (next) {
                if (positions.length > 2) {
                    positions.push(positions[0]); // Reconnect the first point to the last point
                    const reconnectedPositions = [positions[0], positions[positions.length - 2]];  // the last point primitive is the length-2 because first point equals to last point in perimeter.
                    // Create new polyline
                    this.drawingHelper._addPolyline(reconnectedPositions, {
                        id: `annotate_${modeName}_line_${measureId}`,
                        color: this.stateManager.getColorState("line"),
                        clickable: true,
                        status: "completed",
                    });
                    // Create new label
                    const distance = calculateDistance(reconnectedPositions[0], reconnectedPositions[1]);
                    this.drawingHelper._addLabel(reconnectedPositions, distance, "meter", {
                        id: `annotate_${modeName}_label_${measureId}`,
                        status: "completed",
                        clickable: true,
                    });
                    // -- Handle Distances record --
                    // remove the first and the last distance in recordDistances and insert distances value to the last index
                    recordDistances.splice(0, 1); // Remove the first distance
                    recordDistances.splice(recordDistances.length - 1, 1); // Remove the last distance
                    recordDistances.push(distance); // Add the new distance to the end of the distances array
                }
                // Case: triangle, it will become two point line, which doesn't need reconnect
                else {
                    // -- Handle Distances record --
                    recordDistances.splice(0, 1); // Remove the first distance
                    recordDistances.splice(recordDistances.length - 1, 1); // Remove the last distance
                }
            }
            // Case: The removing point is the last point
            else if (previous) {
                recordDistances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
            }
        }

        // -- Handling Normal Case --
        if (!isPerimeter) {
            // Case: the removing point is in the middle of the positions
            if (previous && next) {
                const reconnectedPositions = [previous, next];

                // Create new polyline
                this.drawingHelper._addPolyline(reconnectedPositions, {
                    id: `annotate_${modeName}_line_${measureId}`,
                    status: "completed",
                    clickable: true,
                    color: this.stateManager.getColorState("line")
                });
                // Create new label
                const distance = calculateDistance(reconnectedPositions[0], reconnectedPositions[1]);
                this.drawingHelper._addLabel(reconnectedPositions, distance, "meter", {
                    id: `annotate_${modeName}_label_${measureId}`,
                    status: "completed",
                    clickable: true,
                });

                // -- Handle Distances record --
                // Don't calculate all distances from coordsCache due to performance and consistency
                recordDistances.splice(pointPositionIndices[0] - 1, 2, distance); // remove and insert the new distance
            }
            // Case: The removing point is the first point
            else if (next) {
                recordDistances.splice(0, 1); // Remove the first distance
            }
            // Case: The removing point is the last point
            else if (previous) {
                recordDistances.splice(pointPositionIndices[0] - 1, 1); // Remove the last distance
            }
        }
        // -- End of Handle Reconnection and distance record --


        // -- Reposition the total label --
        const totalDistance = recordDistances.reduce((acc, val) => acc + val, 0); // Calculate total distance

        if (!totalLabel) { // Fallback to find total label in the label collection
            totalLabel = this.labelCollection.find(label => label.id === `annotate_${modeName}_total-label_${measureId}`) || null; // Find the total label by ID
        }

        if (totalLabel) {
            const labelString = `Total: ${formatMeasurementValue(totalDistance, "meter")}`;
            totalLabel = this._updateLabel(totalLabel, [positions[positions.length - 1]], labelString, {
                id: `annotate_${modeName}_total-label_${measureId}`,
                status: "completed",
                clickable: true
            });
        }

        // Case: if only one point left, remove the remaining point and labels
        if (positions.length === 1) {
            this._removeRemaining(positions);
            return;
        }

        // -- Update current measure data --
        measureData.status = "completed";  // Set status to completed
        measureData._records[0]["distances"] = recordDistances;  // Update distances record  
        measureData._records[0]["totalDistance"] = totalDistance;  // Update total distance
        measureData.coordinates = positions.map(coord => ({ ...coord }));  // Update coordinates with the new positions

        // Update dataPool with the measure data
        dataPool.updateOrAddMeasure({ ...measureData });

        // Show notification
        showCustomNotification(`Point removed from measure ${measureId}`, this._container);
    }

    /**
     * Removes the remaining point and its labels from the map.
     * @param {{lat:number, lng:number}[]} positions - The positions of the points to remove.
     * @returns {void}
     */
    _removeRemaining(positions) {
        const lastPosition = positions[0];

        //  Remove the remaining point and labels 
        const lastPoint = this.drawingHelper._getPointByPosition(lastPosition);
        const lastLabels = this.drawingHelper._getLabelByPosition([lastPosition]);

        if (lastPoint) {
            this.drawingHelper._removePointMarker(lastPoint); // Remove the last point marker
        }
        if (Array.isArray(lastLabels) && lastLabels.length > 0) {
            lastLabels.forEach(label => {
                this.drawingHelper._removeLabel(label); // Remove the label marker
            });
        }

        // -- Handle Measure Data --
        const measureId = Number(lastPoint.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
        if (isNaN(measureId)) return; // If the measure ID is not a number, exit

        dataPool.removeMeasureById(measureId); // Remove the measure from the data pool

        // Show notification
        showCustomNotification(`Last point removed from measure ${measureId}`, this._container);
    }

    /**
     * Get the context for resuming a measurement from a specific point.
     * @param {google.maps.Marker} point - The point to resume from.
     * @returns {{pointIndex:number, measureData: MeasurementGroup}|null} - The context for resuming the measurement or null if not found.
     */
    _getPointContextForResume(point) {
        // Find the measure data
        const measureId = Number(point.id.split("_").slice(-1)[0]);
        if (isNaN(measureId)) return;

        // -- Handle Measure Data --
        // Get the measure data from the data pool
        const measureData = dataPool.getMeasureById(measureId);
        // Only completed measures can be resumed
        if (!measureData || measureData.status !== "completed") {
            return null;
        }

        // convert measure data coordinates from cartographic degrees to latLng format
        measureData.coordinates = measureData.coordinates.map(cartographicDegrees => convertToLatLng(cartographicDegrees));

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

    /**
     * Resumes measuring in multi-distances mode from a specific point index.
     * This method is used to continue measuring distances from either the first or last point of a
     * @param {number} pointIndex - The index of the point to resume measuring from, either first or last point.
     * @param {MeasurementGroup} measureData - The measure data to resume.
     * @returns {void}
     */
    _resumeMultiDistancesMeasure(pointIndex, measureData) {
        if (measureData === undefined || pointIndex === undefined) return;

        // Check if we're already in multi-distances mode
        const isAlreadyInMode = this.mode === "multi-distances";

        let modeInstance;
        if (isAlreadyInMode) {
            // If we're already in multi-distances mode, get the actual MultiDistanceGoogle instance
            modeInstance = this.drawingHelper.getActiveModeInstance();
        } else {
            // Otherwise, activate multi-distances mode
            modeInstance = this.drawingHelper._activateMode("multi-distances");
        }

        if (!modeInstance || modeInstance.mode !== "multi-distances") {
            console.warn("Failed to get multi-distances mode instance");
            return;
        }

        // Set the component's state to the measure being resumed
        modeInstance.measure = measureData;
        modeInstance.measure.status = "pending";

        // Use setter method for private distances property
        if (typeof modeInstance.setDistances === 'function') {
            modeInstance.setDistances([...measureData._records[0].distances]);
        }

        modeInstance.coordsCache = measureData.coordinates;

        // Determine if resuming from the start or end
        const isFirstPoint = pointIndex === 0;

        // Set flags to continue measuring
        modeInstance.flags.isMeasurementComplete = false;
        modeInstance.flags.isReverse = isFirstPoint;
        modeInstance.flags.isActive = true;

        // Optional: Add a user notification
        showCustomNotification(`Resuming measure id: ${measureData.id}`, this._container);
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

        if (!contextMenu) {
            contextMenu = createContextMenu(container, options);
            this.stateManager.setElementState("contextMenu", contextMenu);
        }

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

export { MeasureModeGoogle };
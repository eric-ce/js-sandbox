import { MeasureModeBase } from "../MeasureModeBase.js";
import dataPool from "../../lib/data/DataPool.js";
import { areCoordinatesEqual, calculateDistance, calculateMiddlePos, convertToLatLng } from "../../lib/helper/leafletHelper.js";
import { deconstructIdForMetadata, formatMeasurementValue, showCustomNotification } from "../../lib/helper/helper.js";

/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]|string:{latitude: number, longitude: number, height?: number}} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {'cesium'|'google'|'leaflet'} mapName - Map provider name ("google")
 */

/** @typedef {import('../../lib/data/DataPool.js').DataPool} DataPool */
/** @typedef {import('../../lib/input/LeafletInputHandler.js').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/interaction/LeafletDragHandler.js').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/interaction/LeafletHighlightHandler.js').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('eventemitter3').EventEmitter} EventEmitter */
/** @typedef {import('../../lib/state/StateManager.js').StateManager} StateManager*/
/** @typedef {import('../../components/LeafletMeasure.js').LeafletMeasure} LeafletMeasure */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/**
 * Shared functionality between modes in Leaflet Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `leafletHelper.js`, This is mainly for logic override when needed.
 */
class MeasureModeLeaflet extends MeasureModeBase {
    /**
     * @param {string} modeName - The name of the mode 
     * @param {LeafletInputHandler} inputHandler 
     * @param {LeafletDragHandler} dragHandler 
     * @param {LeafletHighlightHandler} highlightHandler 
     * @param {LeafletMeasure} drawingHelper 
     * @param {StateManager} stateManager 
     * @param {EventEmitter} emitter 
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter);
    }

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
     * @param {Coordinate} coordinate 
     * @return {MeasurementGroup}
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

        return measure;
    }

    /**
     * Removes all pending annotations in the current mode.
     * This includes points, labels, polylines, and polygons that are not completed.
     * It does not remove completed annotations.
     * @returns {void}
     */
    removePendingAnnotations() {
        const targetId = `annotate_${this.mode}`;

        // Get all layer groups from the drawing helper
        const collections = [
            this.pointCollection,
            this.labelCollection,
            this.polylineCollection,
            this.polygonCollection
        ].filter(Boolean); // Filter out any null/undefined collections

        collections.forEach(collection => {
            const layersToRemove = [];

            // Iterate through layers to find pending annotations for this mode
            collection.eachLayer(layer => {
                const layerStatus = layer?.feature?.properties?.status
                if (layer.id.includes(targetId) && layerStatus !== 'completed') {
                    layersToRemove.push(layer);
                }
            });

            // Remove the identified layers
            layersToRemove.forEach(layer => collection.removeLayer(layer));
        });
    }


    /*******************************
     * COMMON METHOD USED IN MODES *
     *******************************/
    /**
    * Creates a new polyline or updates an existing one based on positions.
    * Manages the reference within the provided polylinesArray.
    * @param {{lat: number, lng: number}[]} positions - Array of positions to create or update the line.
    * @param {L.polyline[]} polylinesArray - The array (passed by reference) that holds the polyline instance. This array will be modified. Caution: this is not the polylineCollection.
    * @param {Object} [options={}] - Options for the line.
    * @returns {L.polyline | null} The created or updated polyline instance, or null if failed.
    */
    _createOrUpdateLine(positions, polylinesArray, options = {}) {
        // 1. DEFAULTS & INPUT VALIDATION
        if (!Array.isArray(polylinesArray) || !Array.isArray(positions) || positions.length === 0) {
            console.warn("_createOrUpdateLine: input parameters are invalid.");
            return;
        }

        // default options
        const {
            status = "pending", // Default pending status
            color = this.stateManager.getColorState("move"),
            interactive = false,
            id = `annotate_${this.mode}_line_${this.measure.id}`,
            ...rest
        } = options;


        // Determine if `positions` represents multiple line segments (typically for drag)
        const isNested = positions.length > 0 && Array.isArray(positions[0]);

        // 2. REMOVAL PHASE
        if (polylinesArray.length > 0) {
            // For nested positions (drag) or simple cases (TwoPointsDistance), remove all existing lines.
            // For non-nested in MultiDistance (move), remove only the 'moving' line.
            if (isNested || this.mode === 'distance') {
                // remove all lines in the lines array
                polylinesArray.forEach(lineToRemove => this.drawingHelper._removePolyline(lineToRemove));
                polylinesArray.length = 0; // Clear the array
            }
            // Case: remove lines that has status "moving"
            else {
                for (let i = polylinesArray.length - 1; i >= 0; i--) {
                    const line = polylinesArray[i];
                    // Ensure line exists and has a status property before checking
                    if (line && line?.feature?.properties?.status === "moving") {
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
                const newLineInstance = this.drawingHelper._addPolyline(posSet, {
                    color,
                    id, // Consider making ID more specific if needed (e.g., adding status)
                    interactive,
                    status,
                    ...rest
                });
                if (!newLineInstance) return;

                // -- Handle References Update --
                polylinesArray.push(newLineInstance);
            })
        } else {
            // -- Create a new single polyline --
            const newLineInstance = this.drawingHelper._addPolyline(positions, {
                color,
                id, // Consider making ID more specific if needed (e.g., adding status)
                interactive,
                status,
                ...rest
            });
            if (!newLineInstance) return;

            // -- Handle References Update --
            polylinesArray.push(newLineInstance);
        }
    }

    /**
     * Updates a single label's visual appearance and metadata.
     * Reused in different modes to ensure consistent label updates.
     * @param {L.tooltip} label - The label instance to update
     * @param {{lat:number,lng:number}[]} positions - Array of positions for this label
     * @param {string} labelText - The text to display in the label
     * @param {Object} [options={}] - Update options
     * @returns {L.tooltip | null} The updated label
     * @private
     */
    _updateLabel(label, positions, labelText, options = {}) {
        if (!label || typeof labelText !== "string") {
            console.warn("Invalid label or labelText provided for update.");
            return null;
        }

        const { status, color, interactive, id } = options;

        // Label position
        const numPos = positions.length;
        const labelPosition = numPos === 1 ? positions[0] : calculateMiddlePos(positions);

        // -- Handle Label Visual Update --
        label.setLatLng(labelPosition);

        // Create HTML element for label content
        const contentElement = document.createElement('span');
        contentElement.style.color = color;
        contentElement.textContent = labelText;
        contentElement.style.whiteSpace = 'pre';  // Preserve whitespace

        label.setContent(contentElement);  // Update label content

        // Update interactive state
        const oldInteractiveState = label.options.interactive;
        if (oldInteractiveState !== interactive) {
            label.options.interactive = interactive;
            if (typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                this.drawingHelper._refreshLayerInteractivity(label);
            }
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

            // Make the item interactive
            if (item.options.interactive === false && typeof this.drawingHelper._refreshLayerInteractivity === 'function') {
                item.options.interactive = true;
                this.drawingHelper._refreshLayerInteractivity(item);
            }
        });
    }

    /******************
     * COMMON FEATURE *
     ******************/
    /**
     * Removes an entire line set, including related points, labels, and polygons.
     * @param {L.Polyline} polyline - The polyline to remove.
     * @returns {void}
     */
    _removeLineSet(polyline) {
        if (!polyline) return;

        // confirmation 
        const userConfirmation = window.confirm(`Do you want to remove this entire line set?`) // Confirm the removal action
        if (!userConfirmation) {
            this._refreshMapDrag();
            return; // If the user does not confirm, exit
        }

        const measureId = Number(polyline.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
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

        // Refresh the map dragging, to solve issue the middle click keep dragging
        this._refreshMapDrag();

        // Show notification
        showCustomNotification(`Line set removed from measure ${measureId}`, this._container);
    }


    /**********
     * HELPER *
     **********/
    /**
     * Refreshes the map dragging to ensure it is responsive after changes.
     */
    _refreshMapDrag() {
        this.map?.dragging.disable();
        this.map?.dragging.enable();
    }
}

export { MeasureModeLeaflet };
import { MeasureModeBase } from "../MeasureModeBase.mjs";
import { areCoordinatesEqual, calculateDistance, calculateMiddlePos, convertToLatLng } from "../../lib/helper/leafletHelper.mjs";
import { createContextMenu, deconstructIdForMetadata, formatMeasurementValue, hideContextMenu, showCustomNotification, updateContextMenu } from "../../lib/helper/helper.mjs";


/** @typedef {import('../../lib/docs/types.mjs').MeasurementGroup} MeasurementGroup */

/** @typedef {import('../../lib/docs/types.mjs').DataPool} DataPool */
/** @typedef {import('../../lib/docs/types.mjs').LeafletInputHandler} LeafletInputHandler */
/** @typedef {import('../../lib/docs/types.mjs').LeafletDragHandler} LeafletDragHandler */
/** @typedef {import('../../lib/docs/types.mjs').LeafletHighlightHandler} LeafletHighlightHandler */
/** @typedef {import('../../lib/docs/types.mjs').ShareEmitter} ShareEmitter */
/** @typedef {import('../../lib/docs/types.mjs').StateManager} StateManager*/
/** @typedef {import('../../lib/docs/types.mjs').LeafletAnnotation} LeafletAnnotation */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/**
 * Shared functionality between modes in Leaflet Maps.
 * Overrides method defined in MeasureModeBase.
 * Common shared helper function should be declared in `leafletHelper.mjs`, This is mainly for logic override when needed.
 */
class MeasureModeLeaflet extends MeasureModeBase {
    contextMenu;

    /**
     * @param {string} modeName - The name of the mode
     * @param {LeafletInputHandler} inputHandler
     * @param {LeafletDragHandler} dragHandler
     * @param {LeafletHighlightHandler} highlightHandler
     * @param {LeafletAnnotation} drawingHelper
     * @param {StateManager} stateManager
     * @param {ShareEmitter} emitter
     * @param {object} app
     * @param {DataPool} dataPool
     */
    constructor(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool) {
        super(modeName, inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter, app, dataPool);

        this.contextMenu = this.stateManager.getElementState("contextMenu") || null; // Get the context menu from state manager
    }


    /*******************
     * OVERRIDE METHOD *
     *******************/
    /**
     * Attach Leaflet-specific event listeners.
     * @override
     */
    _attachMapSpecificListeners() {
        this.emitter.onLeafletContextMenu(this._handleContextMenu);
    }

    /**
     * Remove Leaflet-specific event listeners.
     * @override
     */
    _removeMapSpecificListeners() {
        this.emitter.off('annotation-contextmenu-leaflet', this._handleContextMenu);
    }

    /**
     * Handle right click on the map.
     * @override
     */
    async handleRightClick() {
        // Hide the context menu
        // this.contextMenu && this._setContextMenuVisibility(false);
        console.log("overrided in leaflet")
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

        const measure = this.dataPool.getMeasureById(measureId); // Get the measure data by ID
        if (!measure) return null; // If no measure found, exit the function

        // Convert cartographic degrees to Google coordinates
        measure.coordinates = measure.coordinates.map(coord => convertToLatLng(coord)); // Ensure coordinates are in Google format
        return measure;
    }

    /**
     * Find and handle the measure data from dataPool
     * @param {Coordinate} coordinate - The coordinate to find the measure by.
     * @return {MeasurementGroup|null} - The found measure or null if not found.
     */
    _findMeasureByCoordinate(coordinate) {
        if (!coordinate) return null;

        // Convert input coordinate to lat lng object
        const latLng = { ...convertToLatLng(coordinate) };
        if (!latLng) return null;

        const data = this.dataPool.getAllMeasures("cartographicDegrees");
        if (Array.isArray(data) && data.length === 0) return null;

        const measure = data.find(measure => {
            if (measure.mapName !== this.mapName) return false; // Check if the measure belongs to the current map
            return measure.coordinates.some(coord => areCoordinatesEqual(coord, latLng));
        })
        if (!measure) return null;

        return measure;
    }

    /**
     * Removes all pending annotations only in the current activated mode.
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
     *  USED AS REUSABLE METHODS   *
     *******************************/
    /**
    * Creates a new polyline or updates an existing one based on positions.
    * Manages the reference within the provided polylinesArray.
    * @param {{lat: number, lng: number}[]} positions - Array of positions to create or update the line.
    * @param {L.Polyline[]} polylinesArray - The array (passed by reference) that holds the polyline instance. This array will be modified. Caution: this is not the polylineCollection.
    * @param {Object} [options={}] - Options for the line.
    * @returns {L.Polyline | null} The created or updated polyline instance, or null if failed.
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
     * @param {L.Tooltip} label - The label instance to update
     * @param {{lat:number,lng:number}[]} positions - Array of positions for this label
     * @param {string} labelText - The text to display in the label
     * @param {Object} [options={}] - Update options
     * @returns {L.Tooltip | null} The updated label
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


    /***********************************************************
     *                     COMMON FEATURE                      *
     * THE STANDALONE FEATURE OR SERIES METHOD FORMS A FEATURE *
     ***********************************************************/
    /**
     * Handles the context menu event.
     * @param {NormalizedEventData} eventData - The event data containing information about the context menu event.
     * @returns {void}
     */
    _handleContextMenu = (eventData) => {
        const { layer, screenPoint } = eventData;

        // If no layer was right-clicked, or if a measurement is in progress, do nothing.
        if (!layer || this.coordsCache.length > 0) {
            this._setContextMenuVisibility(false);
            return;
        }

        // Get the menu items specific to the clicked layer
        const items = this._getContextMenuItemsForAnnotation(layer);
        if (!Array.isArray(items) || items.length === 0) {
            this._setContextMenuVisibility(false);
            return; // If no items to show, exit
        }

        // Update and show the context menu at the clicked position
        this._updateContextMenu(this._container, screenPoint, items);
    }

    _getContextMenuItemsForAnnotation(layer) {
        // Validate input parameters
        if (!layer) return [];

        // -- Common actions --
        const commonItems = [
            { text: "Copy Coordinate", event: () => { this._copyCoordinateToClipboard(this.coordinate) } },
            { text: "Remove Layer Set", event: () => this._removeLayerSet(layer) }
        ];

        // -- Get the picked object mode --
        // Determine the layer mode from its properties metadata or ID
        let layerMode = null;
        if (layer?.feature?.properties?.mode) {
            layerMode = layer.feature.properties.mode;
        } else if (layer?.id?.startsWith("annotate_")) {
            layerMode = layer.id.split('_')[1];
        }

        // Modes that support advanced actions
        const advancedAnnotationModes = ["multi-distances"];

        const additionalItems = [];

        // AdvancedAnnotationModes handle its own context menu items
        if (advancedAnnotationModes.includes(layerMode)) {
            const modeInstance = this.drawingHelper.getModeInstanceByName(layerMode);
            if (!modeInstance || typeof modeInstance._getContextMenuAdditionalItems !== "function") return;
            // Let the mode instance handle its own context menu items
            const itemList = modeInstance._getContextMenuAdditionalItems(layer);
            additionalItems.push(...itemList);  // Add the items from the mode instance
        }

        return [...commonItems, ...additionalItems];
    }

    /**
    * Removes an entire layer set, including related points, labels, polylines, and polygons.
    * @param {L.CircleMarker|L.Tooltip|L.Polyline|L.Polygon} layer - The layer to remove.
    * @returns {void}
    */
    _removeLayerSet(layer) {
        if (!layer) return;

        // confirmation 
        // const userConfirmation = window.confirm(`Do you want to remove this entire line set?`) // Confirm the removal action
        // if (!userConfirmation) {
        //     this._refreshMapDrag();
        //     return; // If the user does not confirm, exit
        // }

        const measureId = Number(layer.id.split("_").slice(-1)[0]); // Assume the last part of the ID is the measure ID
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
        this.dataPool.removeMeasureById(measureId);

        // Refresh the map dragging, to solve issue the middle click keep dragging
        this._refreshMapDrag();

        // Show notification
        showCustomNotification(`Layer set removed from measure ${measureId}`, this._container);
    }

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


    /*************************
     * CONTEXT MENU SPECIFIC *
     *************************/
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
    /**
     * Refreshes the map dragging to ensure it is responsive after changes.
     */
    _refreshMapDrag() {
        this.map?.dragging.disable();
        this.map?.dragging.enable();
    }
}

export { MeasureModeLeaflet };
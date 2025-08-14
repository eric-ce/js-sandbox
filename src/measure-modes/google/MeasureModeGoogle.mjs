import { MeasureModeBase } from "../MeasureModeBase.mjs";
import { areCoordinatesEqual, calculateDistance, calculateMiddlePos, checkOverlayType, convertToLatLng } from "../../lib/helper/googleHelper.mjs";
import { createContextMenu, deconstructIdForMetadata, formatMeasurementValue, getNeighboringValues, showCustomNotification, updateContextMenu, hideContextMenu } from "../../lib/helper/helper.mjs";


/** @typedef {import('../../lib/docs/types.mjs').GoogleMapsInputHandler} GoogleMapsInputHandler */
/** @typedef {import('../../lib/docs/types.mjs').GoogleDragHandler} GoogleDragHandler */
/** @typedef {import('../../lib/docs/types.mjs').GoogleHighlightHandler} GoogleHighlightHandler */
/** @typedef {import('../../lib/docs/types.mjs').ShareEmitter} ShareEmitter */
/** @typedef {import('../../lib/docs/types.mjs').StateManager} StateManager*/
/** @typedef {import('../../lib/docs/types.mjs').GoogleAnnotation} GoogleAnnotation */

/** @typedef {lat:number, lng:number | latitude: number, longitude: number, height: number} Coordinate */

/** @typedef {import('../../lib/docs/types.mjs').MeasurementGroup} MeasurementGroup */

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
 * Common shared helper function should be declared in `googleHelper.mjs`, This is mainly for logic override when needed.
 */
class MeasureModeGoogle extends MeasureModeBase {
    contextMenu;

    /**
     * @param {string} modeName - The name of the mode (e.g., "Point", "Line", "Polygon")
     * @param {GoogleMapsInputHandler} inputHandler - The map input event handler abstraction.
     * @param {GoogleDragHandler} dragHandler - The drag handler abstraction (can be null if not used).
     * @param {GoogleHighlightHandler} highlightHandler - The highlight handler abstraction (can be null if not used).
     * @param {GoogleAnnotation} drawingHelper - The map-specific drawing helper/manager.
     * @param {StateManager} stateManager - The application state manager.
     * @param {ShareEmitter} emitter - The event emitter instance.
     * @param {object} app - The application instance.
     * @param {DataPool} dataPool - The data pool instance.
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
        this.emitter.onGoogleContextMenu(this._handleContextMenu);
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
        // this.contextMenu && this._setContextMenuVisibility(false);
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

        const data = this.dataPool.getAllMeasures("cartographicDegrees");
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
        if (!Array.isArray(items) || items.length === 0) {
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

        // -- Common actions --
        const commonItems = [
            { text: "Copy Coordinate", event: () => { this._copyCoordinateToClipboard(this.coordinate) } },
            { text: "Remove Layer Set", event: () => this._removeOverlaySet(overlay) }
        ];

        // -- Handle Mode-Specific Items --
        // Determine the overlay mode from its properties metadata or ID
        let overlayMode = null;
        if (overlay?.feature?.properties?.mode) {
            overlayMode = overlay.feature.properties.mode;
        } else if (overlay?.id?.startsWith("annotate_")) {
            overlayMode = overlay.id.split('_')[1];
        }

        // Modes that support advanced actions
        const advancedAnnotationModes = ["multi-distances"];

        const additionalItems = [];

        // AdvancedAnnotationModes handle its own context menu items
        if (advancedAnnotationModes.includes(overlayMode)) {
            const modeInstance = this.drawingHelper.getModeInstanceByName(overlayMode);
            if (!modeInstance || typeof modeInstance._getContextMenuAdditionalItems !== "function") return;
            // Let the mode instance handle its own context menu items
            const itemList = modeInstance._getContextMenuAdditionalItems(overlay);
            additionalItems.push(...itemList);  // Add the items from the mode instance
        }

        return [...commonItems, ...additionalItems];
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
        this.dataPool.removeMeasureById(measureId);

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
}

export { MeasureModeGoogle };
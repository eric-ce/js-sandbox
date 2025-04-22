import { color } from "chart.js/helpers";
import dataPool from "../../lib/data/DataPool.js";
import { generateIdByTimestamp } from "../../lib/helper/cesiumHelper.js"; // Keep if generic enough
import { convertToGoogleCoord, calculateMiddlePos, calculateDistance, formatMeasurementValue, } from "../../lib/helper/googleHelper.js";
import { MeasureModeGoogle } from "./MeasureModeGoogle.js";

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

/**
 * Handles two-point distance measurement specifically for Google Maps.
 * Uses googleHelper functions for drawing temporary graphics.
 * Expects an IInputEventHandler and IDrawingHelper (but only uses map from drawingHelper for now).
*/
export class TwoPointsDistanceGoogle extends MeasureModeGoogle {
    /**
     * Creates an instance of TwoPointsDistanceGoogle.
     * @param {import('../../lib/input/GoogleMapsInputHandler').GoogleMapsInputHandler} inputHandler - The Google Maps input handler instance.
     * @param {import('../../components/MeasureComponentBase').MeasureComponentBase} drawingHelper - The GoogleMeasure component instance (provides map).
     * @param {import('../../lib/state/StateManager').StateManager} stateManager - The state manager instance.
     * @param {import('eventemitter3').EventEmitter} emitter - The event emitter instance.
     */
    constructor(inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter) {
        // Validate input parameters
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("TwoPointsDistanceGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
        }

        super("distance", inputHandler, dragHandler, highlightHandler, drawingHelper, stateManager, emitter)

        // Updated Constructor Arguments
        this.handler = inputHandler; // Use the passed Input Handler abstraction
        this.drawingHelper = drawingHelper; // The GoogleMeasure instance
        this.map = drawingHelper.map;      // Get map reference from drawing helper
        this.stateManager = stateManager;
        this.emitter = emitter;
        this.dragHandler = dragHandler; // Use the passed Drag Handler abstraction
        this.highlightHandler = highlightHandler; // Use the passed Highlight Handler abstraction

        this.mode = "distance"; // Use generic mode ID now

        // Coordinate management and related properties
        this.coords = {
            /** @type {Array<{lat: number, lng: number}>} */
            cache: [],                  // Stores temporary coordinates during operations
            /** @type {MeasurementGroup[]} */
            groups: [],                 // Tracks all coordinates involved in operations
            measureCounter: 0,            // Counter for the number of groups
            /** @type {{lat: number, lng: number}} */
            dragStart: null,            // Stores the initial position before a drag begins
            /** @type {{x: number, y: number}} */
            dragStartToCanvas: null,    // Stores the initial position in canvas coordinates before a drag begins
        };

        // Flags
        this.flags = {
            isMeasurementComplete: false,
            isDragMode: false,
            isShowLabels: true
        };

        // Stored points (generic format)
        /** @type {{lat: number, lng: number}} */
        this.coordinate = null;

        // References to temporary Google Maps overlays
        this.interactiveAnnotations = {
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels

            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels

            hoveredPoint: null,       // Point that is currently hovered
            hoveredLine: null,        // Line that is currently hovered
            hoveredLabel: null        // Label that is currently hovered
        };

        this.pointCollection = [];      // Collection of point markers
        this.labelCollection = [];      // Collection of labels
        this.polylineCollection = [];   // Collection of polylines
    }

    /**
     * Handles left clicks, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     */
    handleLeftClick = async (eventData) => {
        // Use normalized mapPoint
        if (!eventData || !eventData.mapPoint) return;

        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = this._createDefaultMeasure(); // Create a new measure object

            // Set values for the new measure
            this.measure.id = generateIdByTimestamp();
            this.measure.mode = this.mode;
            this.measure.labelNumberIndex = this.coords.measureCounter;
            this.measure.status = "pending";
            this.measure.mapName = "google";

            // Establish data relation
            this.coords.groups.push(this.measure);
            this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
            this.coords.measureCounter++;
        }

        const markerOptions = {
            // Add any specific marker options here if needed
            // Pass the mousedown listener
            listeners: {
                mousedown: (marker, event) => {
                    // Check if drag handler exists and is active
                    if (this.dragHandler && this.flags.isActive) {
                        // Prevent map drag, default behavior
                        event.domEvent?.stopPropagation();
                        event.domEvent?.preventDefault();

                        // Tell the drag handler to start dragging this specific marker
                        this.dragHandler._handleDragStart(marker, event);
                    }
                },
                // --- ADD MOUSEUP LISTENER HERE ---
                mouseup: (marker, event) => { // 'event' here is google.maps.MapMouseEvent
                    // Check if a drag sequence was potentially active
                    if (this.dragHandler && this.dragHandler.isDragging) {
                        event.domEvent?.stopPropagation(); // Avoid stopping propagation here too
                        event.domEvent?.preventDefault(); // Prevent potential text selection, etc.

                        // Directly call the drag handler's end method
                        this.dragHandler._handleDragEnd(event);
                    }
                }
            }
        };

        const point = this.drawingHelper._addPointMarker(this.coordinate, { color: "#FF0000", ...markerOptions });
        if (!point) return;
        point.id = `annotate_distance_point_${this.measure.id}`;
        point.status = "pending"; // Set status to pending
        this.pointCollection.push(point); // Store point reference

        // Update the this.coords cache and this.measure coordinates
        this.coords.cache.push(this.coordinate);

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        if (this.coords.cache.length === 2) {
            // update pending annotations
            this.pointCollection.forEach(point => point.status = "completed");

            // Remove existing moving lines and labels
            this._removeMovingAnnotations();

            // create line
            const line = this.drawingHelper._addPolyline(this.coords.cache, "#A52A2A");
            if (line) {
                line.id = `annotate_distance_line_${this.measure.id}`; // Set ID for the line
                this.polylineCollection.push(line); // Store polyline reference
            }

            const googlePositions = this.coords.cache.map(pos => convertToGoogleCoord(pos));
            const distance = calculateDistance(googlePositions[0], googlePositions[1]);

            // create label 
            const label = this.drawingHelper._addLabel(googlePositions, distance, "meter");
            if (label) {
                label.id = `annotate_distance_label_${this.measure.id}`; // Set ID for the label
                this.labelCollection.push(label); // Store label reference
            }

            // Update this.measure
            this.measure._records.push(distance);
            this.measure.status = "completed";

            // Update to data pool
            dataPool.updateOrAddMeasure({ ...this.measure });

            // set flag that the measure has ended
            this.flags.isMeasurementComplete = true;
            this.coords.cache = [];
        }

    };

    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     */
    handleMouseMove = async (eventData) => { // Use arrow fn
        if (!eventData || !eventData.mapPoint) return;

        const pos = eventData.mapPoint; // Already {latitude, longitude}
        if (!pos) return;
        this.coordinate = pos; // Store for later use

        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

        switch (true) {
            case isMeasuring:
                if (this.coords.cache.length === 1) {
                    // convert to google coord
                    const googlePositions = [convertToGoogleCoord(this.coords.cache[0]), this.coordinate];

                    // validate googlePositions
                    if (!googlePositions || googlePositions.length === 0 || googlePositions.some(pos => pos === null)) {
                        console.error("Google positions are empty or invalid:", googlePositions);
                        return;
                    }

                    // Moving line: update if existed, create if not existed, to save dom operations
                    this._createOrUpdateMovingLine(googlePositions);

                    // Moving label: update if existed, create if not existed, to save dom operations
                    this._createOrUpdateMovingLabel(googlePositions);
                }
                break;
            default:
                // this.handleHoverHighlighting();
                break;
        }
    };

    /**
     * Creates or update the moving line
     * @param {{lat: number, lng: number}[]} positions - Array of positions to create or update the line.
     */
    _createOrUpdateMovingLine(positions) {
        if (this.interactiveAnnotations.movingPolylines && this.interactiveAnnotations.movingPolylines.length > 0) {
            // update position of the line
            const movingLine = this.interactiveAnnotations.movingPolylines[0];
            movingLine.setPath(positions);
            // update custom positions attribute
            movingLine.positions = [...positions];
        } else {
            // create new line
            const movingLine = this.drawingHelper._addPolyline(positions, "A52A2A", { clickable: false })
            if (!movingLine) return;
            movingLine.id = `annotate_distance_line_${this.measure.id}`; // Set ID for the moving line
            movingLine.status = "moving"; // Set status to moving
            this.interactiveAnnotations.movingPolylines.push(movingLine);
        }
    }

    /**
     * Create or update the moving label.
     * If the label exists, update its position and text, else create a new one.
     * @param {{lat:number,lng:number}[]} positions - Array of positions to create or update the label.
     */
    _createOrUpdateMovingLabel(positions) {
        // calculate distance
        const distance = calculateDistance(positions[0], positions[1]);
        const formattedText = formatMeasurementValue(distance, "meter"); // Format the distance value

        if (this.interactiveAnnotations.movingLabels && this.interactiveAnnotations.movingLabels.length > 0) {
            const movingLabel = this.interactiveAnnotations.movingLabels[0];
            // calculate label position
            const middlePos = calculateMiddlePos(positions);
            console.log("🚀 middlePos:", middlePos);

            // set label position
            movingLabel.setPosition(middlePos);
            // set label text
            movingLabel.setLabel({ ...movingLabel.getLabel(), text: formattedText });
        } else {
            // create new label
            const movingLabel = this.drawingHelper._addLabel(positions, distance, "meter", { clickable: false });
            if (!movingLabel) return;
            movingLabel.id = `annotate_distance_label_${this.measure.id}`; // Set ID for the moving label
            movingLabel.status = "moving"; // Set status to moving
            this.interactiveAnnotations.movingLabels = [movingLabel]; // Store moving label reference
        }
    }

    /**
     * Removes pending annotations from the map.
     */
    _removePendingAnnotations() {
        // Remove pending annotations
        const pendingPoints = this.pointCollection.filter(point => point.status === "pending");
        if (pendingPoints && pendingPoints.length > 0) {
            pendingPoints.forEach(point => this.drawingHelper._removePointMarker(point));
        }

        const pendingLines = this.polylineCollection.filter(line => line.status === "pending");
        if (pendingLines && pendingLines.length > 0) {
            pendingLines.forEach(line => this.drawingHelper._removePolyline(line));
        }

        const pendingLabels = this.labelCollection.filter(label => label.status === "pending");
        if (pendingLabels && pendingLabels.length > 0) {
            pendingLabels.forEach(label => this.drawingHelper._removeLabel(label));
        }
    }

    /**
     * Removes moving annotations from the map.
     */
    _removeMovingAnnotations() {
        // Remove moving annotations
        if (this.interactiveAnnotations.movingPolylines && this.interactiveAnnotations.movingPolylines.length > 0) {
            this.interactiveAnnotations.movingPolylines.forEach((line) => {
                this.drawingHelper._removePolyline(line);
            });
            this.interactiveAnnotations.movingPolylines = [];
        }

        if (this.interactiveAnnotations.movingLabels && this.interactiveAnnotations.movingLabels.length > 0) {
            this.interactiveAnnotations.movingLabels.forEach((label) => {
                this.drawingHelper._removeLabel(label);
            });
            this.interactiveAnnotations.movingLabels = [];
        }
    }


}
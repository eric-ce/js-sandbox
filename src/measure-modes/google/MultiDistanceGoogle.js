// import {
//     createPointMarker,
//     createPolyline,
//     createLabelMarker,
//     removePointMarker,
//     removePolyline,
//     removeLabel,
// } from '../../lib/helper/googleHelper.js';

import dataPool from "../../lib/data/DataPool.js";
import { generateIdByTimestamp } from "../../lib/helper/cesiumHelper.js"; // Keep if generic enough
import * as Turf from "@turf/turf";
import { convertToGoogleCoord, calculateMiddlePos, calculateDistance, formatMeasurementValue, } from "../../lib/helper/googleHelper.js";
/**
 * @typedef MeasurementGroup
 * @property {string} id - Unique identifier for the measurement
 * @property {string} mode - Measurement mode (e.g., "distance")
 * @property {{latitude: number, longitude: number, height?: number}[]} coordinates - Points that define the measurement
 * @property {number} labelNumberIndex - Index used for sequential labeling
 * @property {'pending'|'completed'} status - Current state of the measurement
 * @property {{latitude: number, longitude: number, height?: number}[]|number[]} _records - Historical coordinate records
 * @property {{latitude: number, longitude: number, height?: number}[]} interpolatedPoints - Calculated points along measurement path
 * @property {string} mapName - Map provider name ("google")
 */

/**
 * Handles two-point distance measurement specifically for Google Maps.
 * Uses googleHelper functions for drawing temporary graphics.
 * Expects an IInputEventHandler and IDrawingHelper (but only uses map from drawingHelper for now).
 */
export class MultiDistanceGoogle {
    /**
     * Creates an instance of TwoPointsDistanceGoogle.
     * @param {import('../../lib/input/GoogleMapsInputHandler').GoogleMapsInputHandler} inputHandler - The Google Maps input handler instance.
     * @param {import('../../components/MeasureComponentBase').MeasureComponentBase} drawingHelper - The GoogleMeasure component instance (provides map).
     * @param {import('../../lib/state/StateManager').StateManager} stateManager - The state manager instance.
     * @param {import('eventemitter3').EventEmitter} emitter - The event emitter instance.
     */
    constructor(inputHandler, drawingHelper, stateManager, emitter) {
        // --- Updated Constructor Arguments ---
        if (!inputHandler || !drawingHelper || !drawingHelper.map || !stateManager || !emitter) {
            throw new Error("TwoPointsDistanceGoogle requires inputHandler, drawingHelper (with map), stateManager, and emitter.");
        }
        if (!google?.maps?.geometry?.spherical) {
            throw new Error("Google Maps geometry library not loaded.");
        }

        this.handler = inputHandler; // Use the passed Input Handler abstraction
        this.drawingHelper = drawingHelper; // The GoogleMeasure instance
        this.map = drawingHelper.map;      // Get map reference from drawing helper
        this.stateManager = stateManager;
        this.emitter = emitter;
        // --- End Updated Args ---

        this.mode = "multi_distance"; // Use generic mode ID now

        // Coordinate management and related properties
        this.coords = {
            /** @type {Array<{lat: number, lng: number}>} */
            cache: [],                  // Stores temporary coordinates during operations
            /** @type {MeasurementGroup[]} */
            groups: [],                 // Tracks all coordinates involved in operations
            measureCounter: 0,            // Counter for the number of groups
            /** @type {Array<{lat: number, lng: number}>} */
            dragStart: null,            // Stores the initial position before a drag begins
            /** @type {Array<{x: number, y: number}>} */
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
     * Activates the mode: attaches listeners via inputHandler, resets state.
     */
    activate() {
        console.log(`Activating ${this.constructor.name} mode.`);
        this.flags.isMeasurementComplete = false;

        // --- Use Input Handler ---
        // Pass the bound method reference directly
        this.handler.on('leftClick', (eventData) => this.handleLeftClick(eventData));
        this.handler.on('mouseMove', (eventData) => this.handleMouseMove(eventData));
        this.emitter.on('annotation:click', (eventData) => {
            if (!eventData) return;
            this.flags.isDragMode = true;
            // add drag event logic here
            console.log(this.flags.isDragMode);
        });
        // --- End Use Input Handler ---

        this.handler.setCursor('crosshair'); // Set cursor via handler
    }

    /**
     * Deactivates the mode: removes listeners via inputHandler and temporary graphics.
     */
    deactivate() {
        console.log(`Deactivating ${this.constructor.name} mode.`);

        // remove any pending annotations
        this._removePendingOrMovingAnnotations();

        // --- Use Input Handler to remove listeners ---
        // Pass the *same function references* used in activate()
        this.handler.off('leftClick', this.handleLeftClick);
        this.handler.off('mouseMove', this.handleMouseMove);
        // --- End Use Input Handler ---

        this.handler.setCursor('default'); // Reset cursor via handler
    }

    /**
     * Handles left clicks, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     */
    handleLeftClick(eventData) {
        // Use normalized mapPoint
        if (!eventData || !eventData.mapPoint) return;

        if (this.flags.isMeasurementComplete) {
            this.flags.isMeasurementComplete = false;
            this.coords.cache = [];
        }

        // Initiate cache if it is empty, start a new group and assign cache to it
        if (this.coords.cache.length === 0) {
            // Reset for a new measure using the default structure
            this.measure = {
                id: null,
                mode: "",
                coordinates: [],
                labelNumberIndex: 0,
                status: "pending",
                _records: [],
                interpolatedPoints: [],
                mapName: "google",
            };

            // Set values for the new measure
            this.measure.id = generateIdByTimestamp();
            this.measure.mode = this.mode;
            this.measure.labelNumberIndex = this.coords.measureCounter;
            this.measure.status = "pending";

            // Establish data relation
            this.coords.groups.push(this.measure);
            this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
            this.coords.measureCounter++;
        }


        const point = this.drawingHelper._addPointMarker(this.coordinate);
        if (!point) return;
        point.id = `annotate_distance_${this.measure.id}`
        this.pointCollection.push(point); // Store point reference

        // Update the this.coords cache and this.measure coordinates
        this.coords.cache.push({ latitude: this.coordinate.lat, longitude: this.coordinate.lng, height: 0 });

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        if (this.coords.cache.length === 2) {
            // create line
            const line = this.drawingHelper._addPolyline(this.coords.cache, "#A52A2A", { dataId: this.measure.id });
            this.polylineCollection.push(line); // Store polyline reference

            // create label 
            const googlePositions = this.coords.cache.map(pos => convertToGoogleCoord(pos));
            const distance = calculateDistance(googlePositions[0], googlePositions[1]);
            const label = this.drawingHelper._addLabel(googlePositions, distance, "meter");
            this.labelCollection.push(label); // Store label reference

            // Update this.measure
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
    handleMouseMove(eventData) { // Use arrow fn
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

                    // Remove existing moving lines and labels
                    // this._removeMovingAnnotations();

                    // Moving line: update if existed, create if not existed, to save dom operations
                    this._createOrUpdateMovingLine(googlePositions);

                    // Moving label: update if existed, create if not existed, to save dom operations
                    this._createOrUpdateMovingLabel(googlePositions);
                }
                break;
            default:
                this.handleHoverHighlighting();
                break;
        }
    };

    /**
     * Creates or update the moving line
     * @param {{latitude: number, longitude: number}[]|{lat: number, lng: number}[]} positions - Array of positions to create or update the line.
     */
    _createOrUpdateMovingLine(positions) {
        if (this.interactiveAnnotations.movingPolylines && this.interactiveAnnotations.movingPolylines.length > 0) {
            // update position of the line
            const movingLine = this.interactiveAnnotations.movingPolylines[0];
            movingLine.setPath(positions);
            // TODO: update moving line id
        } else {
            // create new line
            // TODO: set line id
            const movingLine = this.drawingHelper._addPolyline(positions, "A52A2A", { clickable: false })
            this.interactiveAnnotations.movingPolylines.push(movingLine);
        }
    }


    _createOrUpdateMovingLabel(positions) {
        // calculate distance
        const distance = calculateDistance(positions[0], positions[1]);
        const formattedText = formatMeasurementValue(distance, "meter"); // Format the distance value

        if (this.interactiveAnnotations.movingLabels && this.interactiveAnnotations.movingLabels.length > 0) {
            const movingLabel = this.interactiveAnnotations.movingLabels[0];
            // calculate label position
            const middlePos = calculateMiddlePos(positions);
            // set label position
            movingLabel.setPosition(middlePos);
            // set label text
            movingLabel.setLabel({ ...movingLabel.getLabel(), text: formattedText });

            // TODO: update moving label id
        } else {
            // create new label
            const movingLabel = this.drawingHelper._addLabel(positions, distance, "meter", { clickable: false });
            this.interactiveAnnotations.movingLabels = [movingLabel];
            // TODO: set labelid
        }
    }

    _removePendingOrMovingAnnotations() {
        // Remove pending annotations
        const pendingPoints = this.pointCollection.filter(point => point.id.includes("pending"));
        if (pendingPoints && pendingPoints.length > 0) {
            pendingPoints.forEach(point => this.drawingHelper._removePointMarker(point));
        }

        const pendingLines = this.polylineCollection.filter(line => line.id.includes("pending"));
        if (pendingLines && pendingLines.length > 0) {
            pendingLines.forEach(line => this.drawingHelper._removePolyline(line));
        }

        const pendingLabels = this.labelCollection.filter(label => label.id.includes("pending"));
        if (pendingLabels && pendingLabels.length > 0) {
            pendingLabels.forEach(label => this.drawingHelper._removeLabel(label));
        }

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

    handleHoverHighlighting() {
    }
}
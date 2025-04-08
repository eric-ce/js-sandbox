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
export class TwoPointsDistanceGoogle {
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

        this.mode = "distance"; // Use generic mode ID now

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
            movingLines: [],
            movingLabels: [],

            dragPoint: null,          // Currently dragged point primitive
            dragPolylines: [],        // Array of dragging polylines
            dragLabels: [],           // Array of dragging labels

            hoveredPoint: null,       // Point that is currently hovered
            hoveredLine: null,        // Line that is currently hovered
            hoveredLabel: null        // Label that is currently hovered
        };

        this.pointCollection = []; // Collection of point markers
        this.labelCollection = []; // Collection of labels
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
        // --- End Use Input Handler ---

        this.handler.setCursor('crosshair'); // Set cursor via handler
    }

    /**
     * Deactivates the mode: removes listeners via inputHandler and temporary graphics.
     */
    deactivate() {
        console.log(`Deactivating ${this.constructor.name} mode.`);

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
    handleLeftClick(eventData) { // Use arrow fn for 'this'
        // Use normalized mapPoint
        if (!eventData || !eventData.mapPoint) return;
        console.log(this.pickedObject);
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

        // create a new point primitive
        const position = this.coordinate; // Already {latitude, longitude}
        if (!position) return; // Ensure position is valid

        const point = this.drawingHelper._addPointMarker(position);
        if (!point) return;
        this.pointCollection.push(point); // Store point reference

        // Update the this.coords cache and this.measure coordinates
        this.coords.cache.push({ latitude: position.lat, longitude: position.lng, height: 0 });

        // Update to data pool
        dataPool.updateOrAddMeasure({ ...this.measure });

        // if (this.points.length === 2) {

        // }
    };

    /**
     * Handles mouse move, using normalized event data.
     * @param {NormalizedEventData} eventData - Normalized data from input handler.
     */
    handleMouseMove(eventData) { // Use arrow fn
        if (!eventData || !eventData.mapPoint) return;

        const coordinate = eventData.mapPoint; // Already {latitude, longitude}
        if (!coordinate) return;
        this.coordinate = coordinate; // Store for later use

        const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

        // switch (true) {
        //     case isMeasuring:
        //         if (this.coords.cache.length === 1) {
        //             this.removeMovingAnnotations("test"); // Remove previous moving graphics
        //             const movingLine = createPolyline(
        //                 this.map,
        //                 [this.points[0], cartesian], // Use generic format for helper
        //                 this.stateManager.getColorState("move") || '#FFFF00', // Use generic color key
        //             )
        //             this.interactivePrimitives.movingPolylines.push(movingLine);
        //         }
        //         break;
        //     default:
        //         this.handleHoverHighlighting(pickedObject);
        //         break;
        // }
    };

    handleHoverHighlighting(pickedObject) {
        console.log("remove:", pickedObject);
    }
}
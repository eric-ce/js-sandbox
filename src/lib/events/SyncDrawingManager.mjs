/**
 * @typedef {import('../docs/types.mjs').ShareEmitter} ShareEmitter
 * @typedef {import('../docs/types.mjs').StateManager} StateManager
 * @typedef {import('../docs/types.mjs').AnnotationComponentBase} AnnotationComponentBase
 * @typedef {import('../docs/types.mjs').MeasurementGroup} MeasurementGroup
 */

import { formatMeasurementValue } from '../helper/helper.mjs';

/**
 * Manages synchronization of drawing data across different map instances.
 * Handles create, update, and remove operations for annotations.
 */
export class SyncDrawingManager {
    annotationComponent;
    mapName;
    emitter;
    stateManager;

    data = [];
    dataHandler = null;

    /**
     * @param {AnnotationComponentBase} annotationComponent
     */
    constructor(mapName, emitter, stateManager, annotationComponent) {
        this.annotationComponent = annotationComponent;
        this.mapName = mapName;
        this.emitter = emitter;
        this.stateManager = stateManager;
    }

    /**
     * Initialize sync drawing listeners
     */
    initialize() {
        if (!this.dataHandler && this.emitter) {
            // Listen for individual updates (create/update actions)
            const handleDataUpdate = (data) => { this._syncUpdate(data) };
            this.emitter.onDataUpdate(handleDataUpdate);

            // Listen for removal actions
            const handleDataRemove = (data) => { this._syncRemove(data); };
            this.emitter.onDataRemove(handleDataRemove);

            // Store the data handler references
            this.dataHandler = { handleDataUpdate, handleDataRemove };

            // Load initial data
            this.loadInitialDrawingData();
        };
    }

    /**
     * Cleanup event listeners
     */
    destroy() {
        if (this.dataHandler && this.emitter) {
            this.emitter.off("data:updated", this.dataHandler.handleDataUpdate);
            this.emitter.off("data:removed", this.dataHandler.handleDataRemove);
            this.dataHandler = null;
        }

        // Clean up map annotations
        if (this.data.length > 0) {
            this.data.forEach((item) => {
                if (item.annotations) {
                    this._removeAnnotations(item.annotations);
                }
            });
            this.data = [];
        }
    }

    loadInitialDrawingData() {
        const data = this.annotationComponent.dataPool.data;
        data.forEach(item => {
            this._syncUpdate(item);
        });
    }

    /**
     * Handles sync update actions (create or update existing).
     * @param {MeasurementGroup} data - The data object to create/update
     * @private
     */
    async _syncUpdate(data) {
        if (!data?.coordinates) return;

        // Skip update if it is from the same map
        if (data.sourceMap === this.mapName) return;

        // Await the next tick to allow the data object to be fully populated.
        await new Promise(resolve => setTimeout(resolve, 0));

        const existingIndex = this.data.findIndex((item) => item.id === data.id);

        if (data.coordinates.length === 0) {
            // Handle as removal
            this._syncRemove({ id: data.id });
            return;
        }

        if (existingIndex >= 0) {
            // Update existing
            const existingMeasure = this.data[existingIndex];
            const coordsEqual = data.coordinates.every((coord, index) => {
                return this._areCoordinatesEqual(coord, existingMeasure.coordinates?.[index]);
            });

            const coordsLengthEqual = this.data[existingIndex]?.coordinates?.length === data?.coordinates?.length;

            if (coordsEqual && existingMeasure.annotations && coordsLengthEqual) return;

            // Clean up existing annotations
            this._removeAnnotations(existingMeasure.annotations);
        }

        // Create new annotations
        const annotations = this._createAnnotationsForData(data);
        const updatedData = { ...data, annotations };

        if (existingIndex >= 0) {
            this.data[existingIndex] = updatedData;
        } else {
            this.data.push(updatedData);
        }

        // Update dataPool data
        if (this.annotationComponent.dataPool) {
            const existedMapName = data.renderedOn.includes(this.mapName);
            if (!existedMapName) {
                this.annotationComponent.dataPool.updateMeasureById(
                    data.id,
                    { renderedOn: [...data.renderedOn, this.mapName] },
                    true  // Don't fire emitter for this update, to avoid duplicate sync drawing
                );
            }
        }
    }

    /**
     * Handles sync remove actions.
     * @param {Partial<MeasurementGroup>} data - The removal data with id and mapName
     * @private
     */
    _syncRemove(data) {
        if (!data.id) return;

        // Add missing mapName filter to prevent self-removal
        if (data.sourceMap === this.mapName) return;

        const existingIndex = this.data.findIndex((item) => item.id === data.id);
        if (existingIndex >= 0) {
            const existingMeasure = this.data[existingIndex];
            if (existingMeasure?.annotations) {
                this._removeAnnotations(existingMeasure.annotations);
            }
            this.data.splice(existingIndex, 1);
        }
    }

    /**
    * Creates annotations for a data object based on its mode.
    * @param {MeasurementGroup} data - The data object
    * @returns {Object} The annotations object
    * @private
    */
    _createAnnotationsForData(data) {
        const annotations = { markers: [], polylines: [], polygon: null, labels: [] };

        try {
            switch (data.mode) {
                case "area":
                    annotations.polygon = this.annotationComponent._addPolygon(data.coordinates, {
                        id: `annotate_${data.mode}_polygon_${data.id}`,
                        color: this.stateManager.getColorState("polygon"),
                        status: "completed"
                    });
                    annotations.markers = this.annotationComponent._addPointMarkersFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("pointColor"),
                        id: `annotate_${data.mode}_point_${data.id}`,
                        status: "completed"
                    });
                    annotations.labels = [
                        this.annotationComponent._addLabel(data.coordinates, data._records[0], "squareMeter", {
                            id: `annotate_${data.mode}_label_${data.id}`,
                            status: "completed"
                        }),
                    ];
                    break;
                case "pointInfo":
                    const [cartographicDegrees] = data.coordinates;
                    annotations.markers = this.annotationComponent._addPointMarkersFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("pointColor"),
                        id: `annotate_${data.mode}_point_${data.id}`,
                        status: "completed"
                    });
                    const formattedText =
                        `lat: ${cartographicDegrees.latitude.toFixed(6)}\u00B0` +
                        `\nlng: ${cartographicDegrees.longitude.toFixed(6)}\u00B0` +
                        (cartographicDegrees.height ? `\nheight: ${cartographicDegrees.height.toFixed(2)} m` : "");
                    annotations.labels = [
                        this.annotationComponent._addLabel([data.coordinates[0], data.coordinates[0]], formattedText, null, {
                            status: "completed",
                            id: `annotate_${data.mode}_label_${data.id}`
                        }),
                    ];
                    break;
                case "multi-distances":
                case "multi-distances-clamped":
                case "profile-distances":
                    annotations.markers = this.annotationComponent._addPointMarkersFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("pointColor"),
                        id: `annotate_${data.mode}_point_${data.id}`,
                        status: "completed"
                    });
                    annotations.polylines = this.annotationComponent._addPolylinesFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("line"),
                        id: `annotate_${data.mode}_line_${data.id}`,
                        status: "completed"
                    });

                    const { distances, totalDistance } = data._records[0] || {};
                    annotations.labels = this.annotationComponent._addLabelsFromArray(data.coordinates, distances, "meter", {
                        id: `annotate_${data.mode}_label_${data.id}`,
                        status: "completed"
                    });

                    if (data.status === "completed") {
                        const endCoords = data.coordinates[data.coordinates.length - 1];
                        const formattedText = `Total: ${formatMeasurementValue(totalDistance, "meter")}`;
                        const totalLabel = this.annotationComponent._addLabel([endCoords, endCoords], formattedText, "meter", {
                            id: `annotate_${data.mode}_total_label_${data.id}`,
                            status: "completed"
                        });
                        if (totalLabel) annotations.labels.push(totalLabel);
                    }
                    break;
                default:
                    annotations.markers = this.annotationComponent._addPointMarkersFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("pointColor"),
                        id: `annotate_${data.mode}_point_${data.id}`,
                        status: "completed"
                    });
                    annotations.polylines = this.annotationComponent._addPolylinesFromArray(data.coordinates, {
                        color: this.stateManager.getColorState("line"),
                        id: `annotate_${data.mode}_line_${data.id}`,
                        status: "completed"
                    });
                    annotations.labels = this.annotationComponent._addLabelsFromArray(data.coordinates, data._records, "meter", {
                        id: `annotate_${data.mode}_label_${data.id}`,
                        status: "completed"
                    });
                    break;
            }
        } catch (error) {
            console.error(`${this.constructor.name}: Error creating annotations for ${data.mode}:`, error);
            this._removeAnnotations(annotations);
            return { markers: [], polylines: [], polygon: null, labels: [] };
        }

        return annotations;
    }

    /**
     * Removes all annotations in the provided annotations object.
     * @private
     * @param {Object} annotations - Object containing markers, polylines, and polygon
     */
    _removeAnnotations(annotations) {
        if (!annotations) return;

        annotations.markers?.forEach((marker) => this.annotationComponent._removePointMarker(marker));
        annotations.polylines?.forEach((line) => this.annotationComponent._removePolyline(line));
        if (annotations.polygon) this.annotationComponent._removePolygon(annotations.polygon);
        annotations.labels?.forEach((label) => this.annotationComponent._removeLabel(label));
    }

    /**********
     * HELPER *
     **********/
    /**
     * Checks if two coordinate objects are equal by comparing only latitude and longitude.
     * @param {Object} coord1 - First coordinate object
     * @param {Object} coord2 - Second coordinate object
     * @returns {boolean}
     */
    _areCoordinatesEqual(coord1, coord2) {
        if (!coord1 || !coord2) return false;
        if (typeof coord1.latitude !== "number" || typeof coord1.longitude !== "number") return false;
        if (typeof coord2.latitude !== "number" || typeof coord2.longitude !== "number") return false;
        return coord1.latitude === coord2.latitude && coord1.longitude === coord2.longitude;
    }
}
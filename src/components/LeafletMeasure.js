import {
    createCircleMarker,
    createCircleMarkers,
    createPolygon,
    createPolyline,
    createPolylines,
    removeMarker,
    removePolyline,
    removePolygon,
    createLabelTooltip,
    createLabelTooltips
} from "../lib/helper/leafletHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class LeafletMeasure extends MeasureComponentBase {
    constructor() {
        super();
    }

    // Implementation of abstract methods from the base class
    _addPointMarker(position, color = "#FF0000", options = {}) {
        return createCircleMarker(this.map, position, color, options);
    }

    _addPointMarkersFromArray(positions, color = "#FF0000", options = {}) {
        return createCircleMarkers(this.map, positions, color, options);
    }

    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options);
    }

    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options);
    }

    _addPolygon(positions, color = "#3388ff", options = {}) {
        return createPolygon(this.map, positions, color, options);
    }

    _addLabel(positions, value, unit, options) {
        return createLabelTooltip(this.map, positions, value, unit, options);
    }

    _addLabelsFromArray(positions, valueArray, unit, options) {
        return createLabelTooltips(this.map, positions, valueArray, unit, options);
    }

    _removePointMarker(marker) {
        removeMarker(marker);
    }

    _removePolyline(polyline) {
        removePolyline(polyline);
    }

    _removePolygon(polygon) {
        removePolygon(polygon);
    }

    _removeLabel(label) {
        removeMarker(label);
    }
}

customElements.define("leaflet-measure", LeafletMeasure);
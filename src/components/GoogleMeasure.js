import { Loader } from "@googlemaps/js-api-loader";
import {
    createPointMarker,
    createPointMarkers,
    createPolyline,
    createPolylines,
    createPolygon,
    removePointMarker,
    removePolyline,
    removePolygon,
    createLabelMarkers,
    createLabelMarker,
    removeLabel,
} from "../lib/helper/googleHelper.js";
import { MeasureComponentBase } from "./MeasureComponentBase.js";

export default class GoogleMeasure extends MeasureComponentBase {
    constructor() {
        super();
    }

    _addLabel(positions, text, options = {}) {
        return createLabelMarker(this.map, positions, text, options);
    }
    _addLabelsFromArray(positions, textArray, options = {}) {
        return createLabelMarkers(this.map, positions, textArray, options);
    }

    _removeLabel(label) {
        removeLabel(label);
    }

    // Implementation of abstract methods from the base class
    _addPointMarker(position, color = "#FF0000", options = {}) {
        return createPointMarker(this.map, position, color, options);
    }

    _addPointMarkersFromArray(positions, color = "#FF0000", options = {}) {
        return createPointMarkers(this.map, positions, color, options);
    }

    _addPolyline(positions, color = "#A52A2A", options = {}) {
        return createPolyline(this.map, positions, color, options);
    }

    _addPolylinesFromArray(positions, color = "#A52A2A", options = {}) {
        return createPolylines(this.map, positions, color, options);
    }

    _addPolygon(positions, color = "#A52A2A", options = {}) {
        return createPolygon(this.map, positions, color, options);
    }

    _removePointMarker(marker) {
        removePointMarker(marker);
    }

    _removePolyline(polyline) {
        removePolyline(polyline);
    }

    _removePolygon(polygon) {
        removePolygon(polygon);
    }

}

customElements.define("google-measure", GoogleMeasure);
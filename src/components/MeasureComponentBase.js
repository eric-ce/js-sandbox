/**
 * Base class for all measure components of cesium-measure, google-measure, and leaflet-measure.
 */

export class MeasureComponentBase extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }
}
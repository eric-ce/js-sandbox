/**
 * Creates a circle marker on the provided map at the given position.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {{latitude: number, longitude: number}} position - The marker's position.
 * @param {string} [color="#FF0000"] - The color for the marker.
 * @param {Object} [options={}] - Additional options for the circle marker.
 * @returns {L.CircleMarker|undefined} The created circle marker.
 */
export function createCircleMarker(map, position, color = "#FF0000", options = {}) {
    if (!map) return;
    if (!position || !position.latitude || !position.longitude) return;

    const defaultOptions = {
        radius: 5,
        fillColor: color,
        color: color,
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
    }
    // Merge default options with user provided options
    const circleMarkerOptions = { ...defaultOptions, ...options };

    // Create a circle marker (dot)
    const marker = L.circleMarker(
        [position.latitude, position.longitude],
        { ...circleMarkerOptions }
    ).addTo(map);

    // Store the original position on the marker for reference
    marker.position = { ...position };

    return marker;
}

/**
 * Creates multiple circle markers on the provided map from an array of positions.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
 * @param {string} [color="#FF0000"] - The color for the markers.
 * @param {Object} [options={}] - Additional options for the circle markers.
 * @returns {Array<L.CircleMarker>|undefined} An array of circle marker elements.
 */
export function createCircleMarkers(map, positions, color = "#FF0000", options = {}) {
    if (!map) return;
    if (!positions || positions.length <= 0) return;

    return positions.map((pos) => createCircleMarker(map, pos, color, options));
}

/**
 * Creates a polyline on the provided map connecting points.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polyline.
 * @param {Object} [options={}] - Additional options for the polyline
 * @returns {L.Polyline|undefined} The created polyline if valid; otherwise, undefined.
 */
export function createPolyline(map, positions, color = "#A52A2A", options = {}) {
    if (!map) return;
    if (!positions || positions.length < 2) return;

    const linePositions = positions.map(pos => [pos.latitude, pos.longitude]);

    const defaultOptions = {
        color: color,
        weight: 4,
        opacity: 1.0,
        smoothFactor: 1
    };

    const polylineOptions = { ...defaultOptions, ...options };

    const polyline = L.polyline(linePositions, polylineOptions).addTo(map);

    // Store original positions data on the polyline
    polyline.positions = [...positions];

    return polyline;
}

/**
 * Creates multiple polylines on the provided map by connecting consecutive position pairs.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polylines.
 * @param {Object} [options={}] - Additional options for the polylines
 * @returns {Array<L.Polyline>|undefined} An array of created polylines if valid; otherwise, undefined.
 */
export function createPolylines(map, positions, color, options = {}) {
    if (!map) return;
    if (!positions || positions.length < 2) return;

    const polylines = [];
    for (let i = 0; i < positions.length - 1; i++) {
        const polyline = createPolyline(map, [positions[i], positions[i + 1]], color, options);
        polylines.push(polyline);
    }
    return polylines;
}

/**
 * Draws a polygon on a Leaflet map
 * @param {L.Map} map - The Leaflet map instance
 * @param {Array} positions - Array of lat/lng positions: [[lat, lng], [lat, lng], ...]
 * @param {string} [color="#3388ff"] - The color for the polygon
 * @param {Object} [options={}] - Optional styling options for the polygon
 * @returns {L.Polygon} - The created polygon instance
 */
export function createPolygon(map, positions, color = "#3388ff", options = {}) {
    if (!map) return;
    if (!positions || positions.length < 3) return;

    const polygonPositions = positions.map(pos => [pos.latitude, pos.longitude]);

    // Default styling options
    const defaultOptions = {
        color: color,
        weight: 3,
        opacity: 0.8,
        fillColor: color,
        fillOpacity: 0.2
    };

    // Merge default options with user provided options
    const polygonOptions = { ...defaultOptions, ...options };

    // Create the polygon
    const polygon = L.polygon(polygonPositions, polygonOptions);

    // Add the polygon to the map
    polygon.addTo(map);

    return polygon;
}

/**
 * Creates a tooltip label on the map displaying the given value at the middle position between two coordinates.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} positions - An array containing two position objects with { latitude, longitude }.
 * @param {number} value - The numerical value to display on the tooltip label.
 * @param {Object} [options={}] - Optional tooltip options.
 * @returns {L.Tooltip|undefined} The created tooltip label or undefined if parameters are invalid.
 */
export function createLabelTooltip(map, positions, value, unit = "meter", options = {}) {
    if (!map || !positions || positions.length < 2 || !value) return;

    const leafletCoords = positions.map(pos => [pos.latitude, pos.longitude]);
    const textContent = formatMeasurementValue(value, unit);

    const middlePos = calculateMiddlePos(leafletCoords);

    const defaultOptions = {
        className: "leaflet-label-tooltip",
        direction: "center",
        permanent: true,
        opacity: 0.8,
        offset: [0, -20]
    };

    const tooltipOptions = { ...defaultOptions, ...options };

    // Create a permanent tooltip at the middle position with just text.
    const tooltip = L.tooltip(tooltipOptions)
        .setContent(textContent)
        .setLatLng(middlePos)
        .addTo(map);

    // Store original positions data on the tooltip
    tooltip.positions = [...positions];

    return tooltip;
}

/**
 * Creates multiple tooltip labels on the map for each consecutive pair of positions using corresponding values.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} positions - An array of position objects with { latitude, longitude }.
 * @param {Array<number>} valueArray - An array of values to display for each tooltip label.
 * @param {Object} [options={}] - Optional tooltip options.
 * @returns {Array<L.Tooltip>} An array of created tooltip labels.
 */
export function createLabelTooltips(map, positions, valueArray, unit = "meter", options = {}) {
    // Validate input parameters
    if (!map || !positions || positions.length < 2 || !valueArray || valueArray.length < 1) return;
    const tooltips = [];

    // Loop until the second to last position to prevent an undefined reference.
    for (let i = 0; i < valueArray.length; i++) {
        const tooltip = createLabelTooltip(map, [positions[i], positions[i + 1]], valueArray[i], unit, options);
        tooltip && tooltips.push(tooltip);
    }

    return tooltips;
}

/**
 * Removes a marker from the map.
 *
 * @param {L.Marker|L.CircleMarker} marker - The marker to remove.
 */
export function removeMarker(marker) {
    if (!marker) return;
    marker.remove();
}

/**
 * Removes a polyline from the map.
 *
 * @param {L.Polyline} polyline - The polyline to remove.
 */
export function removePolyline(polyline) {
    if (!polyline) return;
    polyline.remove();
}

/**
 * Removes a polygon from the map
 * 
 * @param {L.Polygon} polygon - The polygon to remove
 */
export function removePolygon(polygon) {
    if (!polygon) return;
    polygon.remove();
}

/**
 * Remove a label from the map
 * @param {L.Marker} label 
 */
export function removeLabel(label) {
    if (!label) return;
    label.remove();
}

/**
 * Converts Leaflet LatLng to standard coordinate object format
 * @param {L.LatLng} latLng - The Leaflet LatLng object
 * @returns {{latitude: number, longitude: number}} A standard coordinate object
 */
export function convertFromLeafletLatLng(latLng) {
    return {
        latitude: latLng.lat,
        longitude: latLng.lng
    };
}

/**
 * Creates a standardized popup with content on a marker
 * 
 * @param {L.Marker|L.CircleMarker} marker - The marker to add the popup to
 * @param {string} content - HTML content for the popup
 * @returns {L.Marker|L.CircleMarker} The marker with popup attached
 */
export function addPopupToMarker(marker, content) {
    if (!marker) return;

    marker.bindPopup(content);
    return marker;
}

/**
 * Fit map bounds to show all provided elements
 * 
 * @param {L.Map} map - The Leaflet map instance
 * @param {Array<L.Marker|L.CircleMarker|L.Polyline>} elements - Array of map elements
 * @param {Object} [options] - Options for the fit bounds operation
 * @param {number} [options.padding=50] - Padding in pixels
 */
export function fitBoundsToElements(map, elements, options = { padding: 50 }) {
    if (!map || !elements || elements.length === 0) return;

    const bounds = L.latLngBounds();

    elements.forEach(element => {
        if (element instanceof L.Marker || element instanceof L.CircleMarker) {
            bounds.extend(element.getLatLng());
        } else if (element instanceof L.Polyline) {
            element.getLatLngs().forEach(latLng => {
                bounds.extend(latLng);
            });
        }
    });

    if (!bounds.isValid()) return;

    map.fitBounds(bounds, options);
}

/**
 * Creates a custom icon for markers
 * 
 * @param {Object} options - Icon options
 * @param {string} options.iconUrl - URL to the icon image
 * @param {Array} [options.iconSize=[25, 41]] - Size [width, height] in pixels
 * @param {Array} [options.iconAnchor=[12, 41]] - Anchor point [x, y] in pixels
 * @returns {L.Icon} Custom icon instance
 */
export function createIcon({ iconUrl, iconSize = [25, 41], iconAnchor = [12, 41] }) {
    return L.icon({
        iconUrl,
        iconSize,
        iconAnchor,
        popupAnchor: [1, -34],
        shadowUrl: '/leaflet/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [12, 41]
    });
}

/**
 * Clears all custom elements from the map
 * 
 * @param {L.Map} map - The Leaflet map instance
 * @param {boolean} [preserveBaseLayers=true] - Whether to preserve base tile layers
 */
export function clearMapElements(map, preserveBaseLayers = true) {
    if (!map) return;

    map.eachLayer(layer => {
        // Skip base tile layers if preserveBaseLayers is true
        if (preserveBaseLayers && layer instanceof L.TileLayer) return;

        // Remove all other layers (markers, polylines, etc.)
        if (layer instanceof L.Marker ||
            layer instanceof L.CircleMarker ||
            layer instanceof L.Polyline) {
            map.removeLayer(layer);
        }
    });
}

function calculateMiddlePos(positions) {
    if (!positions || positions.length < 2) return;
    // bounding box
    const bounds = L.latLngBounds(positions);
    const middlePos = bounds.getCenter();

    return middlePos;
}

/**
 * Formats a measurement value based on the provided unit.
 *
 * @param {number|string} value - The measurement value.
 * @param {string} unit - The unit type ("meter" or "squareMeter").
 * @returns {string} The formatted measurement string.
 */
function formatMeasurementValue(value, unit) {
    if (typeof value === "string" && unit === "meter") {
        return value;
    }
    if (typeof value === "number") {
        const numValue = Number(value);
        if (unit === "meter") {
            return numValue >= 1000
                ? (numValue / 1000).toFixed(2) + "km"
                : numValue.toFixed(2) + "m";
        }
        if (unit === "squareMeter") {
            return numValue >= 1000000
                ? (numValue / 1000000).toFixed(2) + "km²"
                : numValue.toFixed(2) + "m²";
        }
    }
    return value.toString();
}
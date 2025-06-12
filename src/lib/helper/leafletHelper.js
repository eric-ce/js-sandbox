import L from 'leaflet';
import * as turf from '@turf/turf';

/***********
 * Layers *
 ***********/
/**
 * Checks the type of a given layer.
 * @param {L.Polyline|L.Polygon|L.Tooltip|L.CircleMarker} layer - The layer to check.
 * @returns {"polyline"|"polygon"|"label"|"point"|null} - The type of the layer or null if not recognized.
 */
export function checkLayerType(layer) {
    if (layer instanceof L.Polyline && layer?.id.includes('line')) {
        return "polyline";
    } else if (layer instanceof L.Polygon && layer?.id.includes('polygon')) {
        return "polygon";
    } else if (layer instanceof L.Tooltip && layer?.id.includes('label')) {
        return "label";
    } else if (layer instanceof L.CircleMarker && layer?.id.includes('point')) {
        return "point";
    } else {
        return null;
    }
}

/**
 * Creates a circle marker object with specific position and options.
 * Does NOT add the marker to the map.
 * @param {{lat:number,lng:number}} position - The marker's position.
 * @param {Object} [options={}] - Additional options for the circle marker.
 * @returns {L.CircleMarker|null} The created circle marker.
 */
export function createCircleMarker(position, options = {}) {
    // Removed map parameter and check
    if (!position) {
        console.warn("createCircleMarker: Invalid position provided.", position);
        return null;
    }

    // Convert position to Leaflet LatLng object
    const latLng = convertToLatLng(position);

    if (!latLng) {
        console.error("Failed to convert position to Leaflet LatLng.");
        return null;
    }

    // Default options
    const {
        radius = 5,
        fillColor = "rgba(255,0,0,1)",
        color = "rgba(255,0,0,1)",
        weight = 0,
        opacity = 1,
        fillOpacity = 0.8,
        pane = 'markerPane',
        id = "annotate_marker",
        interactive = false,
        ...rest
    } = options;

    // Create a circle marker (dot)
    const marker = L.circleMarker(
        latLng,
        { radius, fillColor, color, weight, opacity, fillOpacity, pane, interactive, ...rest }
    );

    if (!marker) {
        console.error("Failed to create circle marker.");
        return null;
    }

    // -- Handle Metadata --
    marker.positions = [{ ...position }]; // Store original positions
    marker.id = id; // Store the ID

    return marker;
}

export function getVectorByPosition(
    position,
    pointCollection,
    labelCollection,
    polylineCollection,
    polygonCollection
) {
    let foundPointMarker = undefined;
    let foundLabelMarkers = [];
    let foundPolylines = [];
    let foundPolygons = [];

    if (!position) {
        console.warn("getOverlayByPosition: Invalid input position provided.");
        return { pointMarker: undefined, labelMarker: [], polylines: [], polygons: [] };
    }

    // --- Find Point Marker ---
    if (Array.isArray(pointCollection.getLayers())) {
        for (const marker of pointCollection.getLayers()) {
            if (marker && Array.isArray(marker.positions) &&
                marker.positions.some(pos => areCoordinatesEqual(pos, position))) {
                foundPointMarker = marker;
                break; // Stop searching after finding the first match
            }
        }
    }

    // --- Find Label Marker ---
    // Checks if the search position matches any coordinate in the label's 'positions' property.
    if (Array.isArray(labelCollection.getLayers())) {
        foundLabelMarkers = labelCollection.getLayers().filter(label =>
            label && Array.isArray(label.positions) &&
            label.positions.some(p => areCoordinatesEqual(p, position))
        );
    }

    // --- Find Polylines ---
    // Checks if the search position matches any coordinate in the polyline's 'positions' property.
    if (Array.isArray(polylineCollection.getLayers())) {
        foundPolylines = polylineCollection.getLayers().filter(polyline =>
            polyline && Array.isArray(polyline.positions) &&
            polyline.positions.some(p => areCoordinatesEqual(p, position))
        );
    }

    // --- Find Polygons ---
    // Checks if the search position matches any coordinate in the polygon's 'positions' property.
    if (Array.isArray(polygonCollection.getLayers())) {
        foundPolygons = polygonCollection.getLayers().filter(polygon =>
            polygon && Array.isArray(polygon.positions) &&
            polygon.positions.some(p => areCoordinatesEqual(p, position))
        );
    }

    return {
        pointMarker: foundPointMarker,
        labelMarkers: foundLabelMarkers,
        polylines: foundPolylines,
        polygons: foundPolygons
    };
}

/**
 * Creates a polyline on the provided map connecting points.
 *
 * @param {{lat:number,lng:number}[]} positions - Array of position objects.
 * @param {Object} [options={}] - Additional options for the polyline
 * @returns {L.Polyline|undefined} The created polyline if valid; otherwise, undefined.
 */
export function createPolyline(positions, options = {}) {
    // -- Validate dependencies --
    if (!positions || positions.length < 2) return;

    // Convert positions to Leaflet LatLng objects
    const latLngArray = positions.map(pos => convertToLatLng(pos)).filter(Boolean);
    if (latLngArray.length < 2) return;

    // Default options
    const {
        smoothFactor = 1.0,
        color = "rgba(154, 205, 50, 1)",
        weight = 4,
        opacity = 1.0,
        pane = 'overlayPane',
        id = "annotate_polyline",
        interactive = false,
        ...rest
    } = options

    // Create the polyline
    const polyline = L.polyline(latLngArray, {
        smoothFactor,
        color,
        weight,
        opacity,
        interactive,
        pane,
        ...rest
    });

    if (!polyline) {
        console.error("Failed to create polyline.");
        return null;
    }
    // -- Handle Metadata --
    polyline.positions = positions.map(pos => ({ ...pos })) // Store cloned original positions
    polyline.id = id; // Store the ID

    return polyline;
}

/**
 * Draws a polygon on a Leaflet map
 * @param {Array} positions - Array of lat/lng positions: [[lat, lng], [lat, lng], ...]
 * @param {Object} [options={}] - Optional styling options for the polygon
 * @returns {L.Polygon} - The created polygon instance
 */
export function createPolygon(positions, options = {}) {
    if (!positions || positions.length < 3) return;

    const latLngArray = positions.map(pos => convertToLatLng(pos)).filter(Boolean);
    if (latLngArray.length < 3) return;

    // Default options
    const {
        color = "rgba(0, 128, 0, 0.8)",
        weight = 3,
        opacity = 0.8,
        fillColor = color,
        fillOpacity = 0.2,
        id = "annotate_polygon",
        ...rest
    } = options;

    // Create the polygon
    const polygon = L.polygon(latLngArray, {
        color,
        weight,
        opacity,
        fillColor,
        fillOpacity,
        ...rest
    });

    if (!polygon) {
        console.error("Failed to create polygon.");
        return null;
    }

    // -- Handle Metadata --
    polygon.positions = positions.map(pos => ({ ...pos })); // Store cloned original positions
    polygon.id = id; // Store the ID

    return polygon;
}

/**
 * Creates a tooltip label on the map displaying the given value at the middle position between two coordinates.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} positions - An array containing two position objects with { latitude, longitude }.
 * @param {number} value - The numerical value to display on the tooltip label.
 * @param {Object} [options={}] - Optional tooltip options.
 * @returns {L.Tooltip|null} The created tooltip label or undefined if parameters are invalid.
 */
export function createLabelTooltip(positions, value, unit = "meter", options = {}) {
    // -- Validate dependencies --
    if (!positions) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;

    // -- Handle positions -- 
    const latLngArray = positions.map(pos => convertToLatLng(pos)).filter(Boolean);

    const numPos = latLngArray.length;
    const middlePos = numPos === 1 ? latLngArray[0] : calculateMiddlePos(latLngArray);
    if (!middlePos) {
        console.error("Failed to calculate middle position for tooltip.");
        return null;
    }
    const middlePosLatLng = convertToLatLng(middlePos);

    // -- Handle value --
    const textContent = formatMeasurementValue(value, unit);

    // Default options
    const {
        className = "leaflet-label-tooltip",
        direction = "center",
        permanent = true,
        opacity = 0.8,
        offset = [0, -30],
        id = "annotate_label",
        color = "rgba(0, 0, 0, 1)",
        interactive = false,
        ...rest
    } = options;

    // Create an HTMLElement for the content
    const contentElement = document.createElement('span');
    contentElement.style.color = color;
    contentElement.textContent = textContent;

    // Create Label tooltip
    // !important: L.tooltip requires L.latLng for position but using setLagLng() can accept lat lng object
    const tooltip = L.tooltip({
        className,
        direction,
        permanent,
        opacity,
        offset,
        interactive,
        ...rest,
    })
        .setLatLng(middlePosLatLng) // Set the position
        .setContent(contentElement); // Set the content

    if (!tooltip) {
        console.error("Failed to create tooltip.");
        return null;
    }

    // -- Handle Metadata --
    tooltip.positions = positions.map(pos => ({ ...pos })); // Store cloned original positions
    tooltip.id = id; // Store the ID

    return tooltip;
}

/**
 * Removes a layer from the map.
 * This function is a generic utility to remove various types of layers from the map.
 * @param {L.polyline | L.circleMarker | L.tooltip | L.polygon} layer 
 * @returns {void}
 */
export function removeVector(layer) {
    if (!layer) return;
    layer.remove();
}



/**************
 * COORDINATE *
 **************/
/**
 * Converts a given position object to a general LatLng object.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} position - The position to convert.
 * @returns {{lat:number, lng:number} | null} - The converted position object or null if conversion fails.
 */
export function convertToLatLng(position) {
    if (!position) {
        console.warn("convertToLatLng: Invalid position provided.", position);
        return null;
    }

    if (typeof position.latitude === 'number' || typeof position.longitude === 'number') {
        return { lat: position.latitude, lng: position.longitude };
    }

    if (typeof position.lat === 'number' || typeof position.lng === 'number') {
        return { lat: position.lat, lng: position.lng };
    }

    if (position instanceof L.LatLng) {
        return { lat: position.lat, lng: position.lng };
    }

    return null;
}

/**
 * Converts a given position object to a Leaflet LatLng object.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} position - The position to convert.
 * @returns {L.LatLng|null} - The converted Leaflet LatLng object or null if conversion fails.
 */
export function convertToLeafletCoord(position) {
    // Quick return if already a Leaflet LatLng object
    if (position instanceof L.LatLng) return position; // Already a Leaflet LatLng object

    // Normalize the position to a {lat, lng} object
    const latLngObj = convertToLatLng(position);

    if (latLngObj) {
        try {
            // Create the Leaflet object from the normalized {lat, lng}
            return L.latLng(latLngObj.lat, latLngObj.lng);
        } catch (error) {
            console.error("convertToLeafletLatLng: Error creating L.LatLng:", error, latLngObj);
            return null;
        }
    }

    return null;
}

/**
 * Compares two coordinates to check if they are equal.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} coord1 - The first coordinate to compare.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} coord2 - The second coordinate to compare.
 * @returns {boolean} - True if the coordinates are equal, false otherwise.
 */
export function areCoordinatesEqual(coord1, coord2) {
    if (!coord1 || !coord2) {
        // console.warn("areCoordinatesEqual: Invalid coordinates provided for comparison.");
        return false;
    }

    const latLng1 = convertToLeafletCoord(coord1);
    const latLng2 = convertToLeafletCoord(coord2);

    if (latLng1 && latLng2) {
        return latLng1.equals(latLng2);
    }

    // If either conversion failed, consider them not equal
    return false;
}

/**
 * Calculates the center position between two or more positions.
 * @param {Coordinate} positions - The positions to calculate the middle point for. 
 * @returns {L.LatLng} The center position of the bounds
 */
export function calculateMiddlePos(positions) {
    if (!Array.isArray(positions) || positions.length < 2) return;

    // Convert positions to Leaflet LatLng objects
    const latLngArray = positions.map(pos => convertToLeafletCoord(pos)).filter(Boolean);
    if (latLngArray.length < 2) return;

    // Calculate the bounds of the positions
    const bounds = L.latLngBounds(positions);
    if (!bounds.isValid()) return;
    // Get the center of the bounds
    return bounds.getCenter();
}

/***********
 * MEASURE *
 ***********/
/**
 * Calculates the distance between two coordinates.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} coord1 - The first coordinate.
 * @param {{latitude:number, longitude:number, height:number}|{lat:number,lng:number}|L.LatLng} coord2 - The second coordinate.
 * @returns 
 */
export function calculateDistance(coord1, coord2) {
    // -- Validate input params --
    if (!coord1 || !coord2) return null;

    // Convert to Leaflet LatLng objects
    const latLng1 = convertToLeafletCoord(coord1);
    const latLng2 = convertToLeafletCoord(coord2);

    if (!latLng1 || !latLng2) return null; // Handle invalid coordinates

    // Calculate distance in meters
    const distance = latLng1.distanceTo(latLng2); // in meters
    return distance ?? null;
}

/**
 * Formats a measurement value based on the provided unit.
 * @param {number|string} value - The measurement value.
 * @param {string} unit - The unit type ("meter" or "squareMeter").
 * @returns {string} The formatted measurement string.
 */
export function formatMeasurementValue(value, unit) {
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

export function findMeasureByCoordinate(coordinate, measureDataArray, mapName) {
    if (!coordinate) return null;

    // Convert input coordinate to lat lng object
    const latLng = convertToLeafletCoord(coordinate);
    if (!latLng) return null;

    // Find the measure data that contains the coordinate
    const measure = measureDataArray.find(measure => {
        if (measure.mapName !== mapName) return false; // Check if the measure belongs to the current map
        return measure.coordinates.some(coord => areCoordinatesEqual(coord, latLng));
    });

    return measure || null;
}

/**
 * Calculates the area of a polygon defined by an array of coordinates using Turf.js.
 * @param {{lat:number, lng:number}[] | {latitude: number, longitude:number, height:number}[] | L.LatLng[]} positions
 *        - An array of coordinates defining the polygon vertices. Must have at least 3 points.
 * @returns {number | null} - The calculated area in square meters, or null if input is invalid.
 */
export function calculateArea(positions) {
    // -- Validate input params --
    if (!Array.isArray(positions) || positions.length < 3) {
        console.error("calculateArea: Invalid input. Requires an array of at least 3 positions.");
        return null;
    }

    // 1. Convert all input positions to the standard {lat, lng} format
    const latLngObjects = positions.map(pos => convertToLatLng(pos)).filter(Boolean);

    if (latLngObjects.length < 3) {
        console.error("calculateArea: Invalid input or conversion failure. Requires at least 3 valid positions.");
        return null;
    }

    // 2. Convert {lat, lng} objects to Turf's required format: [longitude, latitude] array
    const turfCoordinates = latLngObjects.map(pos => [pos.lng, pos.lat]);

    // 3. Ensure the polygon is closed for Turf (first and last point must be the same)
    const firstPoint = turfCoordinates[0];
    const lastPoint = turfCoordinates[turfCoordinates.length - 1];
    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
        turfCoordinates.push(firstPoint); // Close the ring
    }

    // Ensure we still have enough points after potential closing (should always be true if initial check passed)
    if (turfCoordinates.length < 4) { // A closed ring needs at least 4 points (A->B->C->A)
        console.error("calculateArea: Not enough valid coordinates to form a closed ring for Turf.");
        return null;
    }


    try {
        // 4. Create a Turf polygon feature
        // Turf expects coordinates in a nested array: [[ [lng, lat], [lng, lat], ... ]]
        const turfPolygon = turf.polygon([turfCoordinates]);

        // 5. Calculate the area using Turf
        const area = turf.area(turfPolygon);
        return area; // Returns area in square meters
    } catch (error) {
        console.error("calculateArea: Error during Turf.js area calculation:", error);
        return null;
    }
}




/**********************
 * DEPRECATED HELPERS *
 *   TO BE REMOVED    *
 **********************/
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
 * Creates multiple circle markers on the provided map from an array of positions.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {{lat:number,lng:number}[]} positions - Array of position objects.
 * @param {string} [color="#FF0000"] - The color for the markers.
 * @param {Object} [options={}] - Additional options for the circle markers.
 * @returns {L.CircleMarker[]|undefined} An array of circle marker elements.
 */
export function createCircleMarkers(positions, options = {}) {
    // Removed map parameter and check
    if (!Array.isArray(positions) || positions.length === 0) {
        console.warn("createCircleMarkers: Invalid positions provided.",);
        return [];
    }

    return positions.map((pos) => createCircleMarker(pos, options));
}
/**
 * Creates multiple polylines on the provided map by connecting consecutive position pairs.
 *
 * @param {L.Map} map - The Leaflet Map instance.
 * @param {{lat:number,lng:number}[]} positions - Array of position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polylines.
 * @param {Object} [options={}] - Additional options for the polylines
 * @returns {L.Polyline[]|undefined} An array of created polylines if valid; otherwise, undefined.
 */
export function createPolylines(positions, options = {}) {
    if (!positions || positions.length < 2) return;

    const polylines = [];
    // for every two consecutive positions, create a polyline
    for (let i = 0; i < positions.length - 1; i += 2) {
        const polyline = createPolyline([positions[i], positions[i + 1]], options);
        if (polyline) {
            polylines.push(polyline);
        } else {
            console.warn("Failed to create polyline for positions:", [positions[i], positions[i + 1]]);
        }
    }
    return polylines;
}
/**
 * Creates multiple tooltip labels on the map for each consecutive pair of positions using corresponding values.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} positions - An array of position objects with { latitude, longitude }.
 * @param {nubmer[]} valueArray - An array of values to display for each tooltip label.
 * @param {Object} [options={}] - Optional tooltip options.
 * @returns {L.Tooltip[]} An array of created tooltip labels.
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
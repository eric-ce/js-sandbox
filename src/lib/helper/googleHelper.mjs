import { LatLng } from "@googlemaps/js-api-loader";
import { formatMeasurementValue } from "./helper.mjs";
/***********
 * OVERLAY *
 ***********/
/**
 * Checks the type of Google Maps overlay (marker, polyline, polygon, label).
 * @param {google.maps.Marker| google.maps.Polyline|google.maps.Polygon} overlay 
 * @returns {"polyline"|"polygon"|"label"|"point"|null} - The type of overlay
 */
export function checkOverlayType(overlay) {
    if (overlay instanceof google.maps.Polyline) {
        return "polyline";
    } else if (overlay instanceof google.maps.Polygon) {
        return "polygon";
    } else if (overlay instanceof google.maps.Marker && typeof overlay?.getLabel()?.text === "string") {
        return "label";
    } else if (overlay instanceof google.maps.Marker) {
        return "point";
    } else {
        return null;
    }
}

/**
 * Finds Google Maps related overlays of points, labels, polylines, and polygons by the point position.
 * by checking a custom 'positions' property stored on the overlays.
 * Exclude moving or total labels
 *
 * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number} | {lat:number, lon:number}} position - The position to search for.
 * @param {Array<google.maps.Marker|google.maps.marker.AdvancedMarkerElement>} pointCollection - Array of point markers.
 * @param {Array<google.maps.Marker|google.maps.marker.AdvancedMarkerElement>} labelCollection - Array of label markers.
 * @param {Array<google.maps.Polyline>} polylineCollection - Array of polylines.
 * @param {Array<google.maps.Polygon>} polygonCollection - Array of polygons.
 * @returns {{pointMarker: (google.maps.Marker|google.maps.marker.AdvancedMarkerElement|undefined), labelMarker: (google.maps.Marker|google.maps.marker.AdvancedMarkerElement|undefined), polylines: google.maps.Polyline[], polygons: google.maps.Polygon[]}} An object containing the found overlays.
 */
export function getOverlayByPosition(
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

    // Convert the input position for reliable comparison
    // const searchLatLng = convertToLatLng(position);
    if (!position) {
        console.warn("getOverlayByPosition: Invalid input position provided.");
        return { pointMarker: undefined, labelMarker: [], polylines: [], polygons: [] };
    }

    // --- Find Point Marker ---
    // Checks if the search position matches any coordinate in the marker's 'positions' property.
    if (Array.isArray(pointCollection)) {
        for (const point of pointCollection) {
            const pointPosition = point?.feature?.properties?.positions;
            if (
                Array.isArray(pointPosition) &&
                pointPosition.some(p => areCoordinatesEqual(p, position))
            ) {
                foundPointMarker = point;
                break; // Found the point marker associated with this position
            }
        }
    }

    // --- Find Label Marker ---
    // Checks if the search position matches any coordinate in the label's 'positions' property.
    if (Array.isArray(labelCollection)) {
        foundLabelMarkers = labelCollection.filter(label => {
            const labelPositions = label?.feature?.properties?.positions;
            return typeof label.id === 'string' &&
                label.id.startsWith("annotate_") &&
                !label.id.includes("total-label") &&
                Array.isArray(labelPositions) &&
                labelPositions.some(p => areCoordinatesEqual(p, position))
        });
    }

    // --- Find Polylines ---
    // Checks if the search position matches any coordinate in the polyline's 'positions' property.
    if (Array.isArray(polylineCollection)) {
        foundPolylines = polylineCollection.filter(polyline => {
            const polylinePositions = polyline?.feature?.properties?.positions;
            return typeof polyline.id === 'string' &&
                polyline.id.startsWith("annotate_") &&
                Array.isArray(polylinePositions) &&
                polylinePositions.some(p => areCoordinatesEqual(p, position))
        });
    }

    // --- Find Polygons ---
    // Checks if the search position matches any coordinate in the polygon's 'positions' property.
    if (Array.isArray(polygonCollection)) {
        foundPolygons = polygonCollection.filter(polygon => {
            const polygonPositions = polygon?.feature?.properties?.positions;
            return typeof polygon.id === 'string' &&
                polygon.id.startsWith("annotate_") &&
                Array.isArray(polygonPositions) &&
                polygonPositions.some(p => areCoordinatesEqual(p, position))
        });
    }

    return {
        pointMarker: foundPointMarker,
        labelMarkers: foundLabelMarkers,
        polylines: foundPolylines,
        polygons: foundPolygons
    };
}

/**
 * Creates a point marker on the provided map at the given position.
 * For vector maps (with a mapId), it returns an AdvancedMarkerElement;
 * otherwise, it returns a standard Marker.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}|{lat: number, lng: number}>} position - The marker's position.
 * @param {object} [options={}] - Additional options for marker styling.
 * @returns {google.maps.Marker|null} The created marker or null if creation fails.
 */
export function createPointMarker(map, position, options = {}) {
    // -- Validate input params --
    if (!map || !position) {
        console.error("createPointMarker: Invalid map or position provided.");
        return null;
    }

    // -- Convert position to {lat, lng} format --
    const googlePos = convertToLatLng(position);
    if (!googlePos) {
        console.error("createPointMarker: Invalid position format.", position);
        return null;
    }

    // ✅ Simplified destructuring - style properties at top level
    const {
        id = "annotate_point",
        clickable = true,
        title = "Point Marker",
        color = "rgba(255,0,0,1)",
        outlineColor = "rgba(255,0,0,1)",
        opacity = 1.0,
        weight = 0,
        scale = 5,
        zIndex = 1,
        status,  // exclude status, it should stored at feature properties
        ...rest
    } = options;

    // -- Create the point marker --
    const markerStyleOptions = {
        fillColor: color,
        fillOpacity: opacity,
        strokeColor: outlineColor,
        strokeWeight: weight,
        scale,
        zIndex
    };
    try {
        // Create and return the traditional Marker
        const pointInstance = new google.maps.Marker({
            map,
            position: googlePos,
            title,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                ...markerStyleOptions,
            },
            clickable,
            ...rest
        });

        if (!pointInstance) {
            console.error("createPointMarker: Failed to create marker. Ensure the Google Maps API is loaded correctly.");
            return null;
        }

        pointInstance.id = id; // Store id on the pointInstance

        return pointInstance;
    } catch (e) {
        console.error("Failed to create Marker. Ensure the Google Maps API is loaded correctly.", e);
        return null;
    }
}

export function createAdvancedPointMarker(map, position, options = {}) {
    // -- Validate input params --
    if (!map || !position || !map.mapId) {
        console.warn("createAdvancedPointMarker: Invalid map or position provided.");
        return null;
    }

    // ✅ Simplified destructuring - style properties at top level
    const {
        id = "annotate_advanced-point",
        title = "Advanced Point Marker",
        zIndex = 1,
        color = "rgba(255,0,0,1)",
        clickable = true,
        width = "10px",
        height = "10px",
        borderRadius = "50%",
        cssPosition = "absolute",
        top = "50%",
        left = "50%",
        transform = "translate(-50%, -50%)",
        status, // exclude status, it should stored at feature properties
        ...rest
    } = options;

    // -- Convert position to {lat, lng} format --
    const googlePos = convertToLatLng(position);
    if (!googlePos) {
        console.warn("createAdvancedPointMarker: Invalid position format.", position);
        return null;
    }

    // Create a dot element for advanced marker content
    const dotElement = document.createElement("div");

    // ✅ Apply styles using flattened properties
    Object.assign(dotElement.style, {
        width,
        height,
        backgroundColor: color,
        borderRadius,
        position: cssPosition,
        top,
        left,
        transform,
    });

    // Create and return the Advanced Marker
    try {
        const pointInstance = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: googlePos,
            content: dotElement,
            title,
            zIndex,
            clickable,
            ...rest
        });

        // Add id to the pointInstance
        pointInstance.id = id;

        return pointInstance;
    } catch (e) {
        console.error("Failed to create AdvancedMarkerElement. Ensure the Google Maps Marker library is loaded.", e);
        return null;
    }
}

/**
 * Creates a polyline on the provided map connecting exactly two points.
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}|{lat: number, lng: number}>} positions - Array containing exactly two position objects.
 * @param {object} [options={}] - Additional options for polyline styling.
 * @returns {google.maps.Polyline|null} - The created polyline instance or null if invalid.
 */
export function createPolyline(map, positions, options = {}) {
    // -- Validate input params --
    if (!map || !Array.isArray(positions) || positions.length !== 2) {
        console.warn("createPolyline: Invalid map or positions provided. Requires exactly 2 positions.");
        return null;
    }

    // -- Convert positions to {lat, lng} format -- 
    const linePositions = positions
        .map(pos => convertToLatLng(pos))
        .filter(Boolean); // Filter out invalid positions

    // Validation for converted positions
    if (linePositions.length < 2) {
        console.warn("createPolyline: Invalid position format. Could not convert positions to lat/lng.");
        return null;
    }

    // -- Create the polyline --
    const {
        color = "#ADFF2F",
        opacity = 1.0,
        weight = 4,
        zIndex = 1,
        clickable = false,
        title = "Polyline",
        id = "annotate_line",
        status, // exclude status, it should stored at feature properties
        ...rest
    } = options;

    try {
        const polylineInstance = new google.maps.Polyline({
            map,
            path: linePositions,
            strokeColor: color,
            strokeOpacity: opacity,
            strokeWeight: weight,
            zIndex,
            title,
            clickable,
            ...rest
        });

        if (!polylineInstance) {
            console.error("createPolyline: Failed to create polyline. Ensure the Google Maps API is loaded correctly.");
            return null;
        }

        // Store id for quick access
        polylineInstance.id = id;

        return polylineInstance;
    } catch (error) {
        console.error("createPolyline: Error creating polyline:", error);
        return null;
    }
}

/**
 * Creates a polygon on a Google Map
 * @param {google.maps.Map} map - The Google Map instance
 * @param {Array<{latitude: number, longitude: number}|{lat: number, lng: number}>} positions - Array of coordinates
 * @param {object} [options={}] - Additional options for polygon styling.
 * @returns {google.maps.Polygon | null} - The created polygon instance or null if invalid.
 */
export function createPolygon(map, positions, options = {}) {
    // -- Validate input params --
    if (!map || !Array.isArray(positions) || positions.length < 3) {
        console.warn("createPolygon: Invalid map or positions provided. Requires at least 3 positions.");
        return null;
    }

    // -- Convert positions to {lat, lng} format --
    const polygonPositions = positions
        .map(pos => convertToLatLng(pos))
        .filter(Boolean); // Filter out invalid positions

    // Validation for converted positions
    if (polygonPositions.length < 3) {
        console.warn("createPolygon: Invalid position format. Could not convert enough positions to lat/lng.");
        return null;
    }

    // Options for polygon
    const {
        clickable = false,
        id = "annotate_polygon",
        strokeColor = "rgba(255,0,0,1)",
        color = "rgba(255,0,0,1)",
        opacity = 0.35,
        weight = 2,
        zIndex = 1,
        title = "Polygon",
        status, // exclude status, it should stored at feature properties
        ...rest
    } = options;

    // Create polygon
    try {
        const polygon = new google.maps.Polygon({
            map,
            paths: polygonPositions,
            title,
            clickable,
            strokeColor,
            strokeOpacity: 0.8,
            strokeWeight: weight,
            fillColor: color,
            fillOpacity: opacity,
            zIndex,
            ...rest
        });

        // Store id for quick access
        polygon.id = id;

        return polygon;
    } catch (error) {
        console.error("createPolygon: Error creating polygon:", error);
        return null;
    }
}

/**
 * Creates a marker of label on the Google map at the given position.
 * @param {google.maps.Map} map - The Google Map instance
 * @param {Array<{latitude: number, longitude: number}|{lat: number, lng: number}>} positions - Array of position objects
 * @param {Number} value - The value to display on the label marker
 * @param {string} unit - The unit of measurement (default is "meter")
 * @param {object} [options={}] - Optional configuration for the label marker
 * @returns {google.maps.Marker|null} The created marker.
 */
export function createLabelMarker(map, positions, value, unit = "meter", options = {}) {
    // -- Validate input params --
    if (!map || !positions) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;

    // -- Convert positions to {lat, lng} format --
    const latLngArray = positions.map(pos => convertToLatLng(pos)).filter(Boolean); // Filter out invalid positions
    if (latLngArray.length === 0) return null; // Handle empty positions

    // -- Prepare label value --
    const formattedText = formatMeasurementValue(value, unit); // Format the value based on the unit

    const numPos = positions.length;
    let middlePos = null;
    if (numPos === 1) { // Use the single position
        middlePos = latLngArray[0];
    } else {  // Calculate the middle positions
        middlePos = calculateMiddlePos(latLngArray);
    }

    // Label marker options with default values
    const {
        color = "#000000",
        backgroundColor = "ffffff",
        zIndex = 1,
        id = "annotate_label",
        title = "Label Marker",
        clickable = true,
        status, // exclude status, it should stored at feature properties
        ...rest
    } = options;

    try {
        // Style options
        const markerStyleOptions = {
            fontSize: "16px",
            fontWeight: "bold",
            labelInBackground: true,
            color,
        };

        // Create a transparent image for the marker icon
        const transparentImage = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

        // Create the marker
        const markerInstance = new google.maps.Marker({
            map,
            position: middlePos,
            icon: {
                url: transparentImage,
                size: new google.maps.Size(1, 1),
                origin: new google.maps.Point(0, 0),
                anchor: new google.maps.Point(0, 0),
                labelOrigin: new google.maps.Point(0, -20)
            },
            label: {
                text: formattedText,
                className: "custom-marker-label",
                ...markerStyleOptions
            },
            title,
            clickable,
            zIndex,
            ...rest
        });

        // Validate label marker
        if (!markerInstance) {
            console.error("createLabelMarker: Failed to create marker. Ensure the Google Maps API is loaded correctly.");
            return null;
        }

        // Store id for quick access
        markerInstance.id = id;

        return markerInstance;
    } catch (error) {
        console.error("createLabelMarker: Error creating label marker:", error);
        return null;
    }
}

/**
 * Creates an Advanced marker of label on the Google map at the given position.
 * @param {google.maps.Map} map - The Google Map instance
 * @param {Array<{latitude: number, longitude: number}|{lat: number, lng: number}>} positions - Array of position objects
 * @param {Number} value - The value to display on the label marker
 * @param {string} unit - The unit of measurement (default is "meter")
 * @param {object} [options={}] - Optional configuration for the label marker
 * @returns {google.maps.marker.AdvancedMarkerElement|null} The created marker.
 */
export function createAdvancedLabelMarker(map, positions, value, unit = "meter", options = {}) {
    // -- Validate input params --
    if (!map || !positions || !map.mapId) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;

    // -- Convert positions to {lat, lng} format --
    const latLngArray = positions.map(pos => convertToLatLng(pos)).filter(Boolean); // Filter out invalid positions
    if (latLngArray.length === 0) return null; // Handle empty positions

    // -- Prepare label value --
    const formattedText = formatMeasurementValue(value, unit); // Format the value based on the unit

    const numPos = positions.length;
    let middlePos = null;
    if (numPos === 1) { // Use the single position
        middlePos = latLngArray[0];
    } else {  // Calculate the middle positions
        middlePos = calculateMiddlePos(latLngArray);
    }

    // Label marker options with default values
    const {
        color = "#000000",
        backgroundColor = "ffffff",
        zIndex = 1,
        id = "annotate_label",
        title = "Label Marker",
        clickable = true,
        status, // exclude status, it should stored at feature properties
        ...rest
    } = options;

    // Style configuration
    const labelStyle = {
        fontSize: "16px",
        fontWeight: "bold",
        borderColor: "#ccc",
        padding: "5px",
        borderRadius: "3px",
        textAlign: "center",
        border: "1px solid #ccc",
        minWidth: "50px",
        boxSizing: "border-box",
        color,
        backgroundColor,
    };

    try {
        const labelElement = document.createElement("div");

        // Apply styles
        Object.assign(labelElement.style, labelStyle);

        labelElement.textContent = formattedText;

        // Create the Advanced Marker
        const markerInstance = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: middlePos,
            content: labelElement,
            title,
            zIndex,
            ...rest
        });

        if (!markerInstance) {
            console.error("createAdvancedLabelMarker: Failed to create advanced marker. Ensure the Google Maps API is loaded correctly.");
            return null;
        }

        // Store id for quick access
        markerInstance.id = id;

        return markerInstance;
    } catch (error) {
        console.error("createAdvancedLabelMarker: Error creating advanced label marker:", error);
        return null;
    }
}

/**
 * Removes an overlay (marker, polygon, polyline, label) from the map.
 * @param {google.maps.Marker|google.maps.Polygon|google.maps.Polyline} overlay - The overlay to remove
 * @returns 
 */
export function removeOverlay(overlay) {
    if (!overlay) return;
    overlay.setMap(null);
}



/**************
 * COORDINATE *
 **************/
/**
 * Compare two coordinates for equality, handling various input formats.
 * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number} | {lat:number, lon:number}} coord1
 * @param {google.maps.LatLng | {latitude: number, longitude: number} | {lat:number,lng:number} | {lat:number, lon:number}} coord2
 * @returns {boolean} - Returns true if the coordinates are equal after conversion, false otherwise.
 */
export function areCoordinatesEqual(coord1, coord2) {
    // Validate coord1 and coord2
    if (!coord1 || !coord2) {
        // console.warn("areCoordinatesEqual: Invalid coordinates provided for comparison."); // Use warn instead of error for potentially recoverable issues
        return false;
    }

    const latLng1 = convertToGoogleCoord(coord1);
    const latLng2 = convertToGoogleCoord(coord2);

    // Only compare if both conversions were successful and resulted in valid LatLng objects
    if (latLng1 && latLng2) {
        // Use the built-in equals method for robust comparison (handles floating point nuances)
        return latLng1.equals(latLng2);
    }

    // If either conversion failed, consider them not equal
    return false;
}

/**
 * Converts a coordinate object to {lat, lng} format.
 * @param {{latitude: number, longitude: number} | {lat: number, lng:number} | {lat: function, lng: function}} coord - The coordinate object to convert.
 * @returns {{lat: number, lng: number} | null} - The converted coordinate in {lat, lng} format or null if invalid.
 */
export function convertToLatLng(position) {
    if (!position || typeof position !== 'object') {
        console.warn("Cannot convert invalid position input:", position);
        return null;
    }

    if (Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
        return { lat: position.lat, lng: position.lng };
    }
    // Case 1: {lat: function, lng: function} format
    if (typeof position.lat === 'function' && typeof position.lng === 'function') {
        const lat = position.lat();
        const lng = position.lng();
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }
    // Case 2:{lat: number, lng: number} or {latitude: number, longitude: number} format
    const lat =
        [position.lat, position.latitude].find(Number.isFinite);
    const lng =
        [position.lng, position.lon, position.longitude].find(Number.isFinite);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
    }

    // fallback for unknown formats
    console.warn('Invalid position input:', position);
    return null;
}

/**
 * Convert various coord formats to a google.maps.LatLng.
 * @param {google.maps.LatLng|object} coord - The coordinate to convert.
 * @returns {google.maps.LatLng|null} - The converted LatLng object or null if invalid.
 */
export function convertToGoogleCoord(coord) {
    // if (!coord || typeof coord !== 'object') {
    //     console.warn("Cannot convert invalid coordinate input:", coord);
    //     return null;
    // }

    // // Case 1: {lat: function, lng: function} format
    // if (typeof coord.lat === 'function' && typeof coord.lng === 'function') {
    //     const lat = coord.lat();
    //     const lng = coord.lng();
    //     return Number.isFinite(lat) && Number.isFinite(lng)
    //         ? new google.maps.LatLng(lat, lng)
    //         : (console.warn('Getter returned non-numeric values:', coord), null);
    // }

    // // Case 2: plain object with numbers
    // const lat =
    //     [coord.lat, coord.latitude].find(Number.isFinite);
    // const lng =
    //     [coord.lng, coord.lon, coord.longitude].find(Number.isFinite);

    // if (Number.isFinite(lat) && Number.isFinite(lng)) {
    //     return new google.maps.LatLng(lat, lng);
    // }

    if (coord instanceof google.maps.LatLng) { return coord; }

    const latLng = convertToLatLng(coord);

    if (latLng) {
        return new google.maps.LatLng(latLng.lat, latLng.lng);
    }

    return null;
}

/**
 * Converts a coordinate object to a CartographicDegrees format object.
 * @param {google.maps.LatLng | {lat: number, lng: number} | {latitude: number, longitude: number, height: number}} coord 
 * @returns {latitude: number, longitude: number, height: number} | null
 */
export function convertToCartographicDegrees(coord) {
    // Validate input
    if (!coord) return null;

    // Convert to google.maps.LatLng
    const googleLatLng = convertToGoogleCoord(coord);

    // Error handling for invalid lat/lng values
    if (!googleLatLng) {
        return null;
    }

    // return the object in {latitude, longitude, height} format
    return { latitude: googleLatLng.lat(), longitude: googleLatLng.lng(), height: 0 };
}

/**
 * Calculates the top middle position of a given set of positions.
 * @param {Array<google.maps.LatLng>} positions - Array of Google Maps LatLng objects 
 * @returns {google.maps.LatLng} - The top middle position
 */
function calculateTopMiddlePos(positions) {
    const bounds = new google.maps.LatLngBounds();

    positions.forEach(position => {
        bounds.extend(position);
    });

    // Get the top middle position
    const northeast = bounds.getNorthEast();
    const topMiddle = new google.maps.LatLng(
        northeast.lat(),
        bounds.getCenter().lng()
    );
    return topMiddle || null; // Handle empty bounds
};

/**
 * Calculates the middle position of a given set of positions.
 * @param {google.maps.LatLng[]| {lat: number, lng: number}[] | {latitude: number, longitude: number, height: number}[]} positions - Array of Google Maps LatLng objects 
 * @returns {google.maps.LatLng} - The middle position
 */
export function calculateMiddlePos(positions) {
    const googleCoordsArray = positions
        .map(position => convertToGoogleCoord(position))
        .filter(Boolean); // Filter out invalid positions

    if (googleCoordsArray.length < 2) return null; // Handle invalid number of position, needs at least 2 positions

    // Create the bounds
    const bounds = new google.maps.LatLngBounds();

    // Extend the bounds to include all positions
    googleCoordsArray.forEach(position => {
        bounds.extend(position);
    });

    if (!bounds) return null; // Handle empty bounds

    // Get the center of the bounds
    const centerLatLng = bounds.getCenter(); // google.maps.LatLng

    if (!centerLatLng.lat() || !centerLatLng.lng()) {
        return null; // Handle empty center
    }

    // Convert to {lat, lng} format
    return { lat: centerLatLng.lat(), lng: centerLatLng.lng() };
}



/***********
 * MEASURE *
 ***********/
/**
 * Calculates the distance in meters between two positions.
 * @param {{latitude: number, longitude: number}|{lat:number, lng: number}} positionA 
 * @param {{latitude: number, longitude: number}|{lat:number, lng: number}} positionB 
 * @returns {number|null} - The distance in meters or null if invalid positions.
 */
export function calculateDistance(pos1, pos2) {
    // -- Validate Google Maps API --
    if (!google?.maps?.geometry?.spherical) {
        console.error("calculateDistance: Google Maps geometry library (spherical) not loaded.");
        return null;
    }

    // -- Validate input params --
    if (!pos1 || !pos2) return null;

    // -- Convert positions -- 
    const googleCoord1 = convertToGoogleCoord(pos1);
    const googleCoord2 = convertToGoogleCoord(pos2);

    if (!googleCoord1 || !googleCoord2) return null; // Handle invalid positions

    // -- Calculate distance --
    const distance = google.maps.geometry.spherical.computeDistanceBetween(googleCoord1, googleCoord2);

    return distance ?? null;    // distance could be 0 
}

/**
 * Calculates the area by an array of positions.
 * @param {{latitude: number, longitude: number}[]|{lat:number, lng: number}[]} positions - Array of positions
 * @returns {number|null} - The area in square meters or null if invalid positions.
 */
export function calculateArea(positions) {
    // -- Validate Google Maps API --
    if (!google?.maps?.geometry?.spherical) {
        console.error("calculatePolygonArea: Google Maps geometry library (spherical) not loaded.");
        return null;
    }

    // -- Validate input params --
    if (!Array.isArray(positions) || positions.length < 3) {
        console.error("calculatePolygonArea: Invalid input. Requires an array of at least 3 positions.");
        return null;
    }

    const googleCoordsArray = positions
        .map(pos => convertToGoogleCoord(pos))
        .filter(Boolean); // Filter out invalid positions

    if (googleCoordsArray.length < 3) {
        console.error("calculatePolygonArea: Not enough valid positions after conversion. Requires at least 3.");
        return null;
    }
    const area = google.maps.geometry.spherical.computeArea(googleCoordsArray);

    return area ?? null; // Handle empty area
}





/**********************
 * DEPRECATED HELPERS *
 *   TO BE REMOVED    *
 **********************/

/**
 * Removes a marker from the map.
 *
 * @param {google.maps.marker.AdvancedMarkerElement|google.maps.Marker} marker - The marker to remove.
 */
// export function removePointMarker(marker) {
//     if (!marker) return;
//     marker.setMap(null);
// }

/**
 * Removes a polyline from the map.
 * @param {google.maps.Polyline} polyline - The polyline to remove.
 */
// export function removePolyline(polyline) {
//     if (!polyline) return;
//     polyline.setMap(null);
// }

/**
 * Removes a polygon from the map
 * @param {google.maps.Polygon} polygon - The polygon to remove
 */
// export function removePolygon(polygon) {
//     if (!polygon) return;
//     polygon.setMap(null);
// }

/**
 * Removes a label marker from the map.
 * @param {google.maps.Marker} label  - The label marker to remove.
 */
// export function removeLabel(label) {
//     if (!label) return;
//     label.setMap(null);
// }

// /**
//  * Creates multiple polylines on the provided map by connecting consecutive positions.
//  *
//  * @param {google.maps.Map} map - The Google Map instance.
//  * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
//  * @param {string} [color="#A52A2A"] - Stroke color for the polylines.
//  * @param {object} [options={}] - Additional options for polyline styling.
//  * @returns {Array<google.maps.Polyline>|undefined} An array of created polylines if valid; otherwise, undefined.
//  */
// export function createPolylines(map, positions, options = {}) {
//     // -- Validate input params --
//     if (!map || !Array.isArray(positions) || positions.length < 2) {
//         console.error("createPolylines: Invalid positions provided. Ensure at least two positions are provided.");
//         return [];
//     }

//     // -- Create polylines --
//     const polylines = [];
//     for (let i = 0; i < positions.length - 1; i++) {
//         const polyline = createPolyline(map, [positions[i], positions[i + 1]], options);
//         polyline && polylines.push(polyline);
//     }

//     return polylines;
// }

// /**
//  * Creates multiple point markers on the provided map from an array of positions.
//  *
//  * @param {google.maps.Map} map - The Google Map instance.
//  * @param {{latitude: number, longitude: number}[]} positions - Array of position objects.
//  * @param {object} [options={}] - Additional options for marker styling.
//  * @returns {google.maps.marker.AdvancedMarkerElement[]|google.maps.Marker[]} An array of marker elements.
//  */
// export function createPointMarkers(map, positions, options = {}) {
//     if (!map || !Array.isArray(positions) || positions.length === 0) {
//         return [];
//     }

//     return positions
//         .map((pos) => createPointMarker(map, pos, options))
//         .filter(Boolean);
// }

// /**
//  * Creates multiple label markers for an array of positions and texts.
//  * @param {*} map - The Google Map instance
//  * @param {Array} positions - Array of position objects
//  * @param {Number[]} valueArray - Array of text labels to display
//  * @param {object} options - Optional configuration for the label markers
//  * @returns {Array} - Array of created markers
//  */
// export function createLabelMarkers(map, positions, valueArray, unit = "meter", options = {}) {
//     // -- Validate input params --
//     if (!map || !Array.isArray(positions) || positions.length < 2 || !Array.isArray(valueArray) || valueArray.length < 1) return;
//     const labels = [];

//     // -- Create label markers --
//     // Create a label for each segment (between consecutive points)
//     for (let i = 0; i < valueArray.length; i++) {
//         // Create label for the segment between position i and i+1
//         const label = createLabelMarker(map, [positions[i], positions[i + 1]], valueArray[i], unit, options);
//         label && labels.push(label);
//     }

//     return labels;
// }

// /**
//  * Formats a measurement value based on the provided unit.
//  *
//  * @param {number|string} value - The measurement value.
//  * @param {"meter"|"squareMeter"} unit - The unit type ("meter" or "squareMeter").
//  * @returns {string} The formatted measurement string.
//  */
// export function formatMeasurementValue(value, unit) {
//     if (typeof value === "string" && unit === "meter") {
//         return value;
//     }
//     if (typeof value === "number") {
//         const numValue = Number(value);
//         if (unit === "meter") {
//             return numValue >= 1000
//                 ? (numValue / 1000).toFixed(2) + "km"
//                 : numValue.toFixed(2) + "m";
//         }
//         if (unit === "squareMeter") {
//             return numValue >= 1000000
//                 ? (numValue / 1000000).toFixed(2) + "km²"
//                 : numValue.toFixed(2) + "m²";
//         }
//     }
//     return value ? value.toString() : "";
// }
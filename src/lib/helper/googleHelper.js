/**
 * Creates a point marker on the provided map at the given position.
 * For vector maps (with a mapId), it returns an AdvancedMarkerElement;
 * otherwise, it returns a standard Marker.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {{latitude: number, longitude: number}} position - The marker's position.
 * @param {string} [color="#FF0000"] - The color for the marker.
 * @param {Object} [options={}] - Additional options for marker styling.
 * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|undefined} The created marker.
 */
export function createPointMarker(map, position, color = "#FF0000", options = {}) {
    // Validations for map and position
    if (!map) {
        console.error("createPointMarker: 'map' object is required.");
        return;
    }
    if (!position) {
        console.error("createPointMarker: 'position' object is required.");
        return;
    }

    // Convert and validate the position
    const googlePos = convertToGoogleCoord(position);
    if (!googlePos) return;

    let defaultOptions;
    let pointMarker;

    if (map.mapId) {
        // --- Logic for AdvancedMarkerElement (Vector Maps) ---
        defaultOptions = {
            width: "10px",
            height: "10px",
            backgroundColor: color,
            borderRadius: "50%",
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
        }

        // Merge default options with user provided options
        const markerOptions = { ...defaultOptions, ...options };

        // Create a dot element for advanced marker content.
        const dotElement = document.createElement("div");

        // Apply all styles from markerOptions to the dotElement
        Object.keys(markerOptions).forEach(key => {
            dotElement.style[key] = markerOptions[key];
        });

        // Create and return the Advanced Marker
        try {
            pointMarker = new google.maps.marker.AdvancedMarkerElement({
                map,
                position: googlePos,
                content: dotElement,
                title: "Point Marker", // Consider making this configurable via options
            });
        } catch (e) {
            console.error("Failed to create AdvancedMarkerElement. Ensure the Google Maps Marker library is loaded.", e);
            return; // Prevent further errors
        }
    } else {
        // --- Logic for traditional Marker (Raster Maps or no mapId) ---
        defaultOptions = {  // Default Icon options for the dot symbol
            fillColor: color,
            fillOpacity: 1,
            strokeWeight: 0, // No border
            scale: 5,        // Size of the circle
        };

        // Merge default icon options with user-provided options
        const markerIconOptions = { ...defaultOptions, ...options };

        // Create and return the traditional Marker
        pointMarker = new google.maps.Marker({
            map,
            position: googlePos,
            title: "Point Marker", // Consider making this configurable via options
            icon: {
                path: google.maps.SymbolPath.CIRCLE, // Use the built-in circle symbol
                ...markerIconOptions // Spread the merged options here
            },
            clickable: true, // Default, but can be overridden by options if needed
        });
    }

    if (!pointMarker) {
        console.error("createPointMarker: Failed to create marker. Ensure the Google Maps API is loaded correctly.");
        return;
    }

    // Store original positions data on the marker.
    pointMarker.positions = [position];
    // Store default id 
    pointMarker.id = "annotate_point";

    return pointMarker;
}

/**
 * Creates multiple point markers on the provided map from an array of positions.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
 * @param {string} [color="#FF0000"] - The color for the markers.
 * @param {Object} [options={}] - Additional options for marker styling.
 * @returns {Array<google.maps.marker.AdvancedMarkerElement|google.maps.Marker>|undefined} An array of marker elements.
 */
export function createPointMarkers(map, positions, color = "#FF0000", options = {}) {
    if (!map) return;
    if (!positions || positions.length <= 0) return;

    return positions.map((pos) => createPointMarker(map, pos, color, options));
}

/**
 * Creates a polyline on the provided map connecting exactly two points.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array containing exactly two position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polyline.
 * @param {Object} [options={}] - Additional options for polyline styling.
 * @returns {google.maps.Polyline|undefined} The created polyline if valid; otherwise, undefined.
 */
export function createPolyline(map, positions, color = "#A52A2A", options = {}) {
    if (!map) return;
    if (!positions || positions.length !== 2) return;

    const linePositions = positions.map(pos => convertToGoogleCoord(pos));

    const defaultOptions = {
        strokeColor: color,
        strokeOpacity: 1.0,
        strokeWeight: 4,
    }
    // Merge default options with user provided options
    const polylineOptions = { ...defaultOptions, ...options };

    const polyline = new google.maps.Polyline({
        map,
        path: linePositions,
        ...polylineOptions
    });

    // Store original positions data on the polyline.
    polyline.positions = [...positions];
    // Store default id 
    polyline.id = "annotate_line";

    return polyline;
}

/**
 * Creates multiple polylines on the provided map by connecting consecutive positions.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array of position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polylines.
 * @param {Object} [options={}] - Additional options for polyline styling.
 * @returns {Array<google.maps.Polyline>|undefined} An array of created polylines if valid; otherwise, undefined.
 */
export function createPolylines(map, positions, color = "#A52A2A", options = {}) {
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
 * Creates a polygon on a Google Map
 * @param {google.maps.Map} map - The Google Map instance
 * @param {Array} positions - Array of lat/lng positions: [{lat: number, lng: number}, ...]
 * @param {string} [color="#FF0000"] - The color for the polygon
 * @param {Object} options - Additional options for polygon styling.
 * @returns {google.maps.Polygon} - The created polygon instance
 */
export function createPolygon(map, positions, color = "#FF0000", options = {}) {
    if (!map) return;
    if (!positions || positions.length < 3) return;

    const convertPositions = positions.map(pos => convertToGoogleCoord(pos));
    if (!convertPositions) return;

    // Default styling options
    const defaultOptions = {
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.35,
        editable: false
    };

    // Merge default options with user provided options
    const polygonOptions = { ...defaultOptions, ...options };

    // Create the polygon
    const polygon = new google.maps.Polygon({
        map: map,
        paths: convertPositions,
        ...polygonOptions
    });

    return polygon;
}

/**
 * Creates a label marker on the provided map at the given position.
 * @param {google.maps.Map} map - The Google Map instance
 * @param {{lat:number,lng:number}[]}} positions - Array of position objects
 * @param {Number} value - The value to display on the label marker
 * @param {string} unit - The unit of measurement (default is "meter")
 * @param {Object} options - Optional configuration for the label marker
 * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|undefined} The created marker.
 */
export function createLabelMarker(map, positions, value, unit = "meter", options = {}) {
    if (!map || !positions || positions.length < 2 || !value) return;

    // Format positions and text
    const formatGoogleCoords = positions.map(pos => convertToGoogleCoord(pos));
    const formattedText = formatMeasurementValue(value, unit);

    const middlePos = calculateMiddlePos(formatGoogleCoords);

    let marker;

    if (map.mapId) {
        // AdvancedMarkerElement branch (vector maps)
        const defaultOptions = {
            color: "#000000",
            backgroundColor: "white",
            fontSize: "16px",
            fontWeight: "normal",
            borderColor: "#ccc",
            padding: "5px",
            borderRadius: "3px",
            textAlign: "center",
            border: "1px solid #ccc",
            minWidth: "50px",
            boxSizing: "border-box",
            offset: { x: 0, y: -20 } // desired offset in pixels
        };
        const labelOptions = { ...defaultOptions, ...options };
        const labelElement = document.createElement("div");

        // Ensure absolute positioning for custom offsets
        labelElement.style.position = "absolute";

        // Apply style properties (skip non-CSS options)
        Object.keys(labelOptions).forEach(key => {
            if (!["title", "zIndex", "clickable", "offset"].includes(key)) {
                labelElement.style[key] = labelOptions[key];
            }
        });

        labelElement.textContent = formattedText;

        const markerOptions = {
            map,
            position: middlePos,
            content: labelElement,
            title: labelOptions.title || "Label Marker",
            zIndex: labelOptions.zIndex || 1
        };

        // Use the anchor property to set the offset
        if (labelOptions.offset) {
            markerOptions.anchor = new google.maps.Point(labelOptions.offset.x, labelOptions.offset.y);
        }

        marker = new google.maps.marker.AdvancedMarkerElement(markerOptions);
    } else {
        // Traditional Marker branch (raster maps)
        const defaultOptions = {
            fontSize: "16px",
            fontWeight: "bold",
            color: "#000000",
            labelOrigin: new google.maps.Point(0, -20),
            labelInBackground: true,
        };

        const labelOptions = { ...defaultOptions, ...options };

        const transparentImage =
            'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

        marker = new google.maps.Marker({
            map,
            position: middlePos,
            title: options.title || "Label Marker",
            icon: {
                url: transparentImage,
                size: new google.maps.Size(1, 1),
                origin: new google.maps.Point(0, 0),
                anchor: new google.maps.Point(0, 0),
                labelOrigin: new google.maps.Point(0, -20) // Set your Y offset here
            },
            label: {
                text: formattedText,
                color: labelOptions.color,
                fontWeight: labelOptions.fontWeight,
                fontSize: labelOptions.fontSize,
                className: "custom-marker-label"
            },
            clickable: labelOptions.clickable !== undefined ? labelOptions.clickable : false,
            zIndex: labelOptions.zIndex || 1,
        });
    }

    if (!marker) console.error("createLabelMarker: Failed to create marker. Ensure the Google Maps API is loaded correctly.");
    // store original positions data on the label marker
    marker.positions = [...positions];

    return marker;
}


/**
 * Creates multiple label markers for an array of positions and texts.
 * @param {*} map - The Google Map instance
 * @param {Array} positions - Array of position objects
 * @param {Number[]} valueArray - Array of text labels to display
 * @param {Object} options - Optional configuration for the label markers
 * @returns {Array} - Array of created markers
 */
export function createLabelMarkers(map, positions, valueArray, unit = "meter", options = {}) {
    // Validate input parameters
    if (!map || !positions || positions.length < 2 || !valueArray || valueArray.length < 1) return;
    const labels = [];

    // Create a label for each segment (between consecutive points)
    for (let i = 0; i < valueArray.length; i++) {
        // Create label for the segment between position i and i+1
        const label = createLabelMarker(map, [positions[i], positions[i + 1]], valueArray[i], unit, options);
        label && labels.push(label);
    }

    return labels;
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

/**
 * Converts a coordinate object to the Google Maps {lat, lng} format.
 * Accepts input formats {lat, lng} or {latitude, longitude}.
 * 
 * @param {{latitude: number, longitude: number} | {lat: number, lng:number} | null | undefined} coord - The coordinate object to convert.
 * Expected formats: {lat: number, lng: number} or {latitude: number, longitude: number}.
 * @returns {{lat: number, lng: number} | null} - The coordinate object in {lat, lng} format,
 * or null if the input is invalid or cannot be converted.
 */
export function convertToGoogleCoord(coord) {
    // Handle null or undefined input object
    if (coord === null || coord === undefined) {
        // console.warn("convertToGoogleCoord: Input coordinate object is missing.");
        return null;
    }

    // Extract lat and lng
    const lat = coord.lat ?? coord.latitude;
    const lng = coord.lng ?? coord.longitude;

    // Validate lat and lng
    if (lat === null || lat === undefined || lng === null || lng === undefined) {
        // console.warn("convertToGoogleCoord: Could not extract valid {lat, lng} or {latitude, longitude} from input:", coord);
        return null; // Indicate invalid or incomplete input
    }

    // Return the object guaranteed to be in {lat, lng} format
    const googleCoord = { lat: lat, lng: lng };
    return googleCoord;
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
    return topMiddle;
};

/**
 * Calculates the middle position of a given set of positions.
 * @param {Array<google.maps.LatLng>} positions - Array of Google Maps LatLng objects 
 * @returns {google.maps.LatLng} - The middle position
 */
export function calculateMiddlePos(positions) {
    const bounds = new google.maps.LatLngBounds();

    positions.forEach(position => {
        bounds.extend(position);
    });

    return bounds.getCenter();
}

/**
 * Calculates the distance in meters between two positions.
 * @param {{latitude: number, longitude: number}|{lat:number, lng: number}} positionA 
 * @param {{latitude: number, longitude: number}|{lat:number, lng: number}} positionB 
 * @returns {number|null} - The distance in meters or null if invalid positions.
 */
export function calculateDistance(positionA, positionB) {
    const googlePosA = convertToGoogleCoord(positionA);
    const googlePosB = convertToGoogleCoord(positionB);
    // validate the converted positions
    if (!googlePosA || !googlePosB) return null; // Handle invalid positions

    return google.maps.geometry.spherical.computeDistanceBetween(positionA, positionB) || null;
}

/**
 * Formats a measurement value based on the provided unit.
 *
 * @param {number|string} value - The measurement value.
 * @param {"meter"|"squareMeter"} unit - The unit type ("meter" or "squareMeter").
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
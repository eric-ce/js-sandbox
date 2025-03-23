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
    if (!map) return;
    if (!position || !position.latitude || !position.longitude) return;

    let defaultOptions;

    if (map.mapId) {
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

        // Use AdvancedMarkerElement for vector maps with custom styling.
        return new google.maps.marker.AdvancedMarkerElement({
            map,
            position: convertToGoogleCoord(position),
            content: dotElement,
            title: "Dot Marker",
        });
    } else {
        defaultOptions = {
            fillColor: color,
            fillOpacity: 1,
            strokeWeight: 0,
            scale: 5, // Adjust the size as needed
        }

        // Merge default options with user provided options
        const markerOptions = { ...defaultOptions, ...options };

        // Use the traditional Marker for raster maps (or when no mapId is provided).
        return new google.maps.Marker({
            map,
            position: convertToGoogleCoord(position),
            title: "Dot Marker",
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                ...markerOptions
            },
        });
    }
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
 * @param {Array} positions - Array of position objects
 * @param {Number} text - The text to display in the label
 * @param {Object} options - Optional configuration for the label marker
 * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|undefined} The created marker.
 */
export function createLabelMarker(map, positions, text, options = {}) {
    console.log("Creating label with text:", text);
    if (!map || !positions || positions.length < 2 || text == null) return;

    // Format positions and text
    const formatGoogleCoords = positions.map(pos => convertToGoogleCoord(pos));
    const formatText = text.toFixed(2) + "m";

    const middlePos = calculateMiddlePos(formatGoogleCoords);

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

        labelElement.textContent = formatText;

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

        return new google.maps.marker.AdvancedMarkerElement(markerOptions);
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

        return new google.maps.Marker({
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
                text: formatText,
                color: labelOptions.color,
                fontWeight: labelOptions.fontWeight,
                fontSize: labelOptions.fontSize,
                className: "custom-marker-label"
            },
            clickable: labelOptions.clickable !== undefined ? labelOptions.clickable : false,
            zIndex: labelOptions.zIndex || 1
        });
    }
}


/**
 * Creates multiple label markers for an array of positions and texts.
 * @param {*} map - The Google Map instance
 * @param {Array} positions - Array of position objects
 * @param {Array} textArray - Array of text labels to display
 * @param {Object} options - Optional configuration for the label markers
 * @returns {Array} - Array of created markers
 */
export function createLabelMarkers(map, positions, textArray, options = {}) {
    // Validate input parameters
    if (!map) return [];
    if (!positions || positions.length < 2) return [];
    if (!textArray || textArray.length === 0) return [];

    console.log("Creating label markers with textArray:", textArray);

    const labels = [];

    // Create a label for each segment (between consecutive points)
    // Make sure we don't go beyond array boundaries
    // const numLabels = Math.min(textArray.length, positions.length - 1);

    for (let i = 0; i < textArray.length; i++) {
        // Create label for the segment between position i and i+1
        const label = createLabelMarker(
            map,
            [positions[i], positions[i + 1]],
            textArray[i],
            options
        );

        if (label) {
            labels.push(label);
        }
    }

    return labels;
}

/**
 * Removes a marker from the map.
 *
 * @param {google.maps.marker.AdvancedMarkerElement|google.maps.Marker} marker - The marker to remove.
 */
export function removePointMarker(marker) {
    if (!marker) return;
    marker.setMap(null);
}

/**
 * Removes a polyline from the map.
 *
 * @param {google.maps.Polyline} polyline - The polyline to remove.
 */
export function removePolyline(polyline) {
    if (!polyline) return;
    polyline.setMap(null);
}

/**
 * Removes a polygon from the map
 * 
 * @param {google.maps.Polygon} polygon - The polygon to remove
 */
export function removePolygon(polygon) {
    if (!polygon) return;
    polygon.setMap(null);
}

export function removeLabel(label) {
    if (!label) return;
    label.setMap(null);
}

/**
 * Converts a coordinate object with latitude/longitude properties to Google Maps LatLng format
 * @param {Object} coord - The coordinate object to convert
 * @param {number} coord.latitude - The latitude value
 * @param {number} coord.longitude - The longitude value
 * @param {number} [coord.height] - The height value (ignored).
 * @returns {Object} A Google Maps compatible coordinate object with lat/lng properties
 */
export function convertToGoogleCoord(coord) {
    const { latitude, longitude } = coord;
    return { lat: latitude, lng: longitude }
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
function calculateMiddlePos(positions) {
    const bounds = new google.maps.LatLngBounds();

    positions.forEach(position => {
        bounds.extend(position);
    });

    return bounds.getCenter();
}

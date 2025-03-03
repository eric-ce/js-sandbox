/**
 * Creates a point marker on the provided map at the given position.
 * For vector maps (with a mapId), it returns an AdvancedMarkerElement;
 * otherwise, it returns a standard Marker.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {{latitude: number, longitude: number}} position - The marker's position.
 * @param {string} [color="#FF0000"] - The color for the marker.
 * @returns {google.maps.marker.AdvancedMarkerElement|google.maps.Marker|undefined} The created marker.
 */
export function createPointMarker(map, position, color = "#FF0000") {
    if (!map) return;
    if (!position || !position.latitude || !position.longitude) return;

    // Create a dot element for advanced marker content.
    const dotElement = document.createElement("div");
    dotElement.style.width = "10px"; // Adjust for visibility
    dotElement.style.height = "10px";
    dotElement.style.backgroundColor = color;
    dotElement.style.borderRadius = "50%";
    dotElement.style.position = "absolute";
    dotElement.style.top = "50%";
    dotElement.style.left = "50%";
    dotElement.style.transform = "translate(-50%, -50%)";

    if (map.mapId) {
        // Use AdvancedMarkerElement for vector maps with custom styling.
        return new google.maps.marker.AdvancedMarkerElement({
            map,
            position: convertToGoogleCoord(position),
            content: dotElement,
            title: "Dot Marker",
        });
    } else {
        // Use the traditional Marker for raster maps (or when no mapId is provided).
        return new google.maps.Marker({
            map,
            position: convertToGoogleCoord(position),
            title: "Dot Marker",
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: color,
                fillOpacity: 1,
                strokeWeight: 0,
                scale: 5, // Adjust the size as needed
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
 * @returns {Array<google.maps.marker.AdvancedMarkerElement|google.maps.Marker>|undefined} An array of marker elements.
 */
export function createPointMarkers(map, positions, color = "#FF0000") {
    if (!map) return;
    if (!positions || positions.length <= 0) return;

    return positions.map((pos) => createPointMarker(map, pos, color));
}

/**
 * Creates a polyline on the provided map connecting exactly two points.
 *
 * @param {google.maps.Map} map - The Google Map instance.
 * @param {Array<{latitude: number, longitude: number}>} positions - Array containing exactly two position objects.
 * @param {string} [color="#A52A2A"] - Stroke color for the polyline.
 * @returns {google.maps.Polyline|undefined} The created polyline if valid; otherwise, undefined.
 */
export function createPolyline(map, positions, color = "#A52A2A") {
    if (!map) return;
    if (!positions || positions.length !== 2) return;

    const linePositions = positions.map(pos => convertToGoogleCoord(pos));

    const polyline = new google.maps.Polyline({
        path: linePositions,
        strokeColor: color,
        strokeOpacity: 1.0,
        strokeWeight: 4,
        map,
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
 * @returns {Array<google.maps.Polyline>|undefined} An array of created polylines if valid; otherwise, undefined.
 */
export function createPolylines(map, positions, color = "#A52A2A") {
    if (!map) return;
    if (!positions || positions.length < 2) return;

    const polylines = [];
    for (let i = 0; i < positions.length - 1; i++) {
        const polyline = createPolyline(map, [positions[i], positions[i + 1]], color);
        polylines.push(polyline);
    }
    return polylines;
}

/**
 * Removes a marker from the map.
 *
 * @param {google.maps.marker.AdvancedMarkerElement|google.maps.Marker} marker - The marker to remove.
 */
export function removeMarker(marker) {
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
 * Converts a coordinate object with latitude/longitude properties to Google Maps LatLng format
 * @param {Object} coord - The coordinate object to convert
 * @param {number} coord.latitude - The latitude value
 * @param {number} coord.longitude - The longitude value
 * @param {number} [coord.height] - The height value (ignored).
 * @returns {Object} A Google Maps compatible coordinate object with lat/lng properties
 */
function convertToGoogleCoord(coord) {
    const { latitude, longitude } = coord;
    return { lat: latitude, lng: longitude }
}
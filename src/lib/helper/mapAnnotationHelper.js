import * as leafletHelper from './leafletHelper.js';
import * as googleHelper from './googleHelper.js';
import * as cesiumHelper from './cesiumHelper.js';

///////////////
// example only - TODO: please correct it later
///////////////
/**
 * Creates a marker on any supported map type
 * @param {Object} map - Map instance (Leaflet, Google Maps, or Cesium)
 * @param {{latitude: number, longitude: number}} position - The marker position
 * @param {Object} options - Marker options
 * @returns {Object} The created marker (specific type depends on map)
 */
export function createMarker(map, position, options = {}) {
    if (!map || !position) return null;

    // Determine map type and call appropriate helper
    if (map.hasOwnProperty('_leaflet_id')) {  // Leaflet map
        return leafletHelper.createMarker(map, position, options);
    } else if (window.google && map instanceof google.maps.Map) {  // Google map
        return googleHelper.createPointMarker(map, position, options.color || "#FF0000");
    } else if (map.hasOwnProperty('scene')) {  // Likely a Cesium viewer
        return cesiumHelper.createPointPrimitive(map, position, options);
    }

    console.warn('Unsupported map type provided to createMarker');
    return null;
}
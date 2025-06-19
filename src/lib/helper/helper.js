import { Cartesian3, Cartographic, Math } from "cesium";

/**
 * Get the neighboring values of an array at a given index.
 * @param {array} array - the array to get the neighboring values from
 * @param {number} index - the index of the array
 * @returns {{previous: any, current: any, next: any}} - the previous, current and next value of the array
 */
export function getNeighboringValues(array, index) {
    if (index < 0 || index >= array.length) {
        throw new Error("Index out of bounds");
    }

    return {
        previous: index > 0 ? array[index - 1] : undefined,
        current: array[index],
        next: index < array.length - 1 ? array[index + 1] : undefined,
    };
}

/**
 * Generates a unique ID based on the current timestamp in milliseconds.
 * @returns {number} - A unique ID based on the current timestamp in milliseconds.
 */
export function generateIdByTimestamp() {
    return new Date().getTime();
}

/**
 * Makes an HTML element draggable within a specified container using CSS transforms.
 * @param {HTMLElement} element - The element to make draggable.
 * @param {HTMLElement} container - The container element used as boundary.
 * @param {function(boolean): void} [onDragStateChange] - Called when dragging starts/ends.
 * @returns {function} Cleanup function.
 */
export function makeDraggable(element, container, onDragStateChange) {
    if (!element || !container) return; // Exit early if element or container is not defined

    let isDragging = false;
    let dragStarted = false;
    let startX = 0, startY = 0;
    const threshold = 5;
    let resizeDebounceTimer = null;

    // Initialize transform values
    let currentX = 0, currentY = 0;

    // Store initial element position and set up correct positioning
    const initPositioning = () => {
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        // Validate container and element rect
        if (!containerRect || !elementRect ||
            containerRect.width === 0 || containerRect.height === 0) return;

        // Default positioning - this positions the element at the bottom left of the container
        const defaultX = 0; // Left edge of container
        const defaultY = 0; // Bottom edge of container (negative values move up)

        // Calculate offsets if element is already positioned
        const style = window.getComputedStyle(element);
        const transform = style.transform;

        if (transform && transform !== 'none') {
            const matrix = transform.match(/matrix\((.+)\)/)?.[1]?.split(', ');
            if (matrix && matrix.length >= 6) {
                currentX = parseFloat(matrix[4]);
                currentY = parseFloat(matrix[5]);
            }
        } else {
            // Apply initial positioning if no transform exists
            updateTransform(defaultX, defaultY);
            currentX = defaultX;
            currentY = defaultY;
        }
    };

    // Helper to clamp a value between min and max
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

    // Update the element's transform
    const updateTransform = (tx, ty) => {
        if (!element) return;
        element.style.transform = `translate(${tx}px, ${ty}px)`;
    };

    const onMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        if (!isDragging && (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold)) {
            isDragging = true;
            dragStarted = true;
            if (onDragStateChange) onDragStateChange(true);
        }

        if (isDragging) {
            const containerRect = container.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();

            // Calculate new position with delta
            let newX = currentX + deltaX;
            let newY = currentY + deltaY;

            // Apply boundaries to keep element inside container
            // For X: 0 to containerWidth-elementWidth
            // For Y: -(containerHeight-elementHeight) to 0 (negative values move up)
            const minX = 0;
            const maxX = containerRect.width - elementRect.width;
            const minY = -(containerRect.height); // Negative value to move up to top
            const maxY = 0 - elementRect.height; // Bottom of container

            newX = clamp(newX, minX, maxX);
            newY = clamp(newY, minY, maxY);

            updateTransform(newX, newY);
        }
    };

    const onMouseUp = () => {
        if (isDragging) {
            // Store current transform values for next drag operation
            const style = window.getComputedStyle(element);
            const transform = style.transform;
            if (transform && transform !== 'none') {
                const matrix = transform.match(/matrix\((.+)\)/)?.[1]?.split(', ');
                if (matrix && matrix.length >= 6) {
                    currentX = parseFloat(matrix[4]);
                    currentY = parseFloat(matrix[5]);
                }
            }

            isDragging = false;
            if (onDragStateChange) onDragStateChange(false);
        }

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e) => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    element.addEventListener('mousedown', onMouseDown);

    // Prevent click events if drag occurred
    const onClick = (e) => {
        if (dragStarted) {
            e.preventDefault();
            e.stopPropagation();
            dragStarted = false;
        }
    };

    element.addEventListener('click', onClick, true);

    // Handle container resizing
    const handleResize = () => {
        if (!element || !container) return;

        if (resizeDebounceTimer) {
            cancelAnimationFrame(resizeDebounceTimer);
        }

        resizeDebounceTimer = requestAnimationFrame(() => {
            try {
                const containerRect = container.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();

                // Recalculate boundaries
                const minX = 0;
                const maxX = containerRect.width - elementRect.width;
                const minY = -(containerRect.height);
                const maxY = 0 - elementRect.height;

                // Ensure element stays within boundaries after resize
                currentX = clamp(currentX, minX, maxX);
                currentY = clamp(currentY, minY, maxY);

                updateTransform(currentX, currentY);
                resizeDebounceTimer = null;
            } catch (e) {
                console.warn('Error in resize handler:', e);
            }
        });
    };

    let resizeObserver = null;

    try {
        resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(container);
    } catch (e) {
        console.warn('ResizeObserver not supported or error occurred:', e);
    }

    window.addEventListener('resize', handleResize);

    // Initialize positioning
    initPositioning();

    // Return cleanup function
    return () => {
        if (resizeObserver) {
            resizeObserver.disconnect();
        }

        if (resizeDebounceTimer) {
            cancelAnimationFrame(resizeDebounceTimer);
        }

        element.removeEventListener('mousedown', onMouseDown);
        element.removeEventListener('click', onClick, true);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('resize', handleResize);
    };
}


/**
 * Shows a custom notification message
 * @param {string} message - The message to display in the notification
 * @param {HTMLElement} viewerContainer - the cesium viewer container to append the notification
 * @returns {HTMLElement} - The notification element
 */
export function showCustomNotification(message, viewerContainer) {
    // Create notification container
    const notification = document.createElement('div');
    notification.classList.add('custom-notification');
    notification.textContent = message;

    // Style the notification
    Object.assign(notification.style, {
        position: 'absolute',
        top: '0px', // Position at the bottom
        left: '50%',
        padding: '14px 24px',
        backgroundColor: '#323232', // Material Design dark background
        color: '#FFFFFF', // White text color
        borderRadius: '4px', // Slightly rounded corners
        boxShadow: '0px 3px 5px rgba(0, 0, 0, 0.2)', // Soft shadow for elevation
        zIndex: '1000',
        opacity: '0',
        transition: 'opacity 0.3s, transform 0.3s',
        width: 'fit-content',
        transform: 'translateX(-50%)', // Start slightly below
        fontFamily: 'Roboto, Arial, sans-serif',
        fontSize: '14px',
        lineHeight: '20px',
    });

    // Add to the document
    viewerContainer.appendChild(notification);

    // Fade in
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 100);

    // Fade out and remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, 500);
    }, 3000);

    return notification;
}


/**
 * Convert coordinate that used in cesium, google or leaflet map to universal coordinate (degrees).
 * @param {object | Array<number>} coordinate - Input coordinate in various formats:
 *   - Cesium Cartesian3 ({x, y, z})
 *   - Cesium Cartographic-like ({latitude, longitude, height?}) - assumes degrees
 *   - Google LatLng-like ({lat, lon} or {lat, lng}) - assumes degrees
 *   - Leaflet LatLng-like ([lat, lon]) - assumes degrees
 * @returns {{latitude: number, longitude: number, height: number} | null} Cartographic degrees coordinate or null if conversion fails.
 */
export function convertToUniversalCoordinate(coordinate) {
    if (!coordinate) {
        return null; // Handle null or undefined input
    }

    // Case 1: Array [lat, lon] (Leaflet-like) - Assuming degrees
    if (Array.isArray(coordinate) && coordinate.length === 2 &&
        typeof coordinate[0] === 'number' && typeof coordinate[1] === 'number') {
        const [lat, lon] = coordinate;
        return { latitude: lat, longitude: lon, height: 0 };
    }

    // Ensure coordinate is an object for subsequent checks
    if (typeof coordinate !== 'object' || coordinate === null) {
        return null;
    }

    // Case 2: Object { lat, lon/lng } (Google-like) - Assuming degrees
    const lonProp = coordinate.hasOwnProperty('lon') ? 'lon' : (coordinate.hasOwnProperty('lng') ? 'lng' : null);
    if (coordinate.hasOwnProperty('lat') && typeof coordinate.lat === 'number' &&
        lonProp && typeof coordinate[lonProp] === 'number') {
        return { latitude: coordinate.lat, longitude: coordinate[lonProp], height: 0 };
    }

    // Case 3: Object { latitude, longitude, height? } (Cartographic-like) - Assuming degrees
    if (coordinate.hasOwnProperty('latitude') && typeof coordinate.latitude === 'number' &&
        coordinate.hasOwnProperty('longitude') && typeof coordinate.longitude === 'number') {
        const height = (coordinate.hasOwnProperty('height') && typeof coordinate.height === 'number') ? coordinate.height : 0;
        return { latitude: coordinate.latitude, longitude: coordinate.longitude, height: height };
    }

    // Case 4: Object { x, y, z } (Cesium Cartesian3-like)
    if (coordinate.hasOwnProperty('x') && typeof coordinate.x === 'number' &&
        coordinate.hasOwnProperty('y') && typeof coordinate.y === 'number' &&
        coordinate.hasOwnProperty('z') && typeof coordinate.z === 'number') {
        try {
            // Ensure it's a valid Cartesian3 structure for conversion
            const cartesian = new Cartesian3(coordinate.x, coordinate.y, coordinate.z);
            const cartographic = Cartographic.fromCartesian(cartesian);
            if (!cartographic) { // Conversion might return undefined
                console.warn("convertToUniversalCoordinate: Cesium conversion failed for", coordinate);
                return null;
            }
            return {
                latitude: Math.toDegrees(cartographic.latitude),
                longitude: Math.toDegrees(cartographic.longitude),
                height: cartographic.height
            };
        } catch (error) {
            console.error("convertToUniversalCoordinate: Error converting Cartesian-like coordinate:", error);
            return null; // Handle potential errors during Cesium conversion
        }
    }

    // If none of the formats match
    console.warn("convertToUniversalCoordinate: Unknown or invalid coordinate format provided.", coordinate);
    return null;
}

/**
 * Compares two coordinates from potentially different map formats (Cesium, Google, Leaflet)
 * by converting them to a universal format first. Always compares latitude, longitude, and height.
 * @param {object | Array<number>} coordinate1 - The first coordinate in any supported map format.
 * @param {object | Array<number>} coordinate2 - The second coordinate in any supported map format.
 * @param {object} [options={}] - Optional settings for comparison.
 * @param {number} [options.epsilon=1e-10] - Tolerance for latitude/longitude comparison.
 * @param {number} [options.heightEpsilon=1e-6] - Tolerance for height comparison.
 * @returns {boolean} True if the coordinates represent the same location within tolerance.
 */
export function areCoordinatesEqual(coordinate1, coordinate2, options = {}) {
    // Handle null or undefined input
    if (!coordinate1 || !coordinate2) return false;

    // Convert both coordinates to the universal format
    const cartographicDegrees1 = convertToUniversalCoordinate(coordinate1);
    const cartographicDegrees2 = convertToUniversalCoordinate(coordinate2);

    // Handle conversion failure
    if (!cartographicDegrees1 || !cartographicDegrees2) return false;

    // Determine the epsilon values to use, applying defaults if not provided
    const epsilon = options.epsilon ?? 1e-10; // Use nullish coalescing for cleaner default assignment
    const heightEpsilon = options.heightEpsilon ?? 1e-6;

    // Compare latitude, longitude, and height within the specified tolerances
    const latEqual = Math.abs(cartographicDegrees1.latitude - cartographicDegrees2.latitude) < epsilon;
    const lonEqual = Math.abs(cartographicDegrees1.longitude - cartographicDegrees2.longitude) < epsilon; // Corrected comparison
    // Use ?? 0 to handle cases where height might be undefined/null after conversion, defaulting to 0
    const heightEqual = Math.abs((cartographicDegrees1.height ?? 0) - (cartographicDegrees2.height ?? 0)) < heightEpsilon;

    return latEqual && lonEqual && heightEqual;
}
import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";
import { shrinkIcon, closeIcon } from "../../assets/icons.mjs"


/****************************
 * GENERAL HELPER FUNCTIONS *
 ****************************/
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
 * Capitalizes the first letter of a string.
 * @param {string} string - The string to capitalize.
 * @returns {string} The capitalized string.
 */
export function capitalizeString(string) {
    if (typeof string !== 'string') {
        // convert it to string if it's not already
        string = String(string);
    }
    return string.charAt(0).toUpperCase() + string.slice(1);
}


/**********************
 * COMPONENTS HELPERS *
 **********************/
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
 * Creates a base styled button with common functionality.
 * @param {object} options - Button configuration options
 * @returns {{button: HTMLButtonElement, cleanup: function}} Button and cleanup function
 * @private
 */
function _createBaseButton(options) {
    const {
        className,
        title,
        color = "#333333",
        clickCallback,
        top,
        right,
        position,
        textContent,
        image,
        hoverColor = "rgba(170, 221, 255, 0.8)",
    } = options;

    // Create button element
    const button = document.createElement("button");
    button.title = title;
    button.className = className;

    // Set button content
    if (image) {
        const imgElement = document.createElement("img");
        Object.assign(imgElement, {
            src: image,
            alt: title,
            draggable: false
        });
        Object.assign(imgElement.style, {
            width: "auto",
            height: "100%",
            display: "block",
            objectFit: "contain",
            pointerEvents: "none" // ✅ Prevent image from interfering with button events
        });
        button.appendChild(imgElement);
    } else if (textContent) {
        button.textContent = textContent;
    }

    // Set button styles
    Object.assign(button.style, {
        position: position,
        top: top,
        right: right,
        width: "14px",
        height: "14px",
        padding: "2px",
        border: "none",
        background: "transparent",
        color: color,
        cursor: "pointer",
        zIndex: "1001",
        transition: "all 0.1s ease-in-out 0.05s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none", // ✅ Prevent text selection
        outline: "none" // ✅ Remove focus outline for cleaner look
    });

    // Handler events
    const imgElement = button.querySelector("img");

    const clickHandler = (event) => {
        event.stopPropagation();
        event.preventDefault();
        clickCallback?.(event);

        // Reset hover effects on click
        if (imgElement) {
            Object.assign(imgElement.style, {
                filter: "brightness(1)",
                transform: "scale(1) rotate(0deg)"
            });
        } else {
            button.style.transform = "scale(1)";
        }
    };

    const mouseEnterHandler = () => {
        if (imgElement) {
            Object.assign(imgElement.style, {
                transition: "transform 0.2s ease-in-out, filter 0.2s ease-in-out",
                filter: "brightness(1.5)",
                transform: "scale(1.3) rotate(90deg)",
                transformOrigin: "center"
            });
        } else {
            button.style.transform = "scale(1.2)";
        }
    };

    const mouseLeaveHandler = () => {
        if (imgElement) {
            Object.assign(imgElement.style, {
                transition: "transform 0.2s ease-in-out, filter 0.2s ease-in-out",
                filter: "brightness(1)",
                transform: "scale(1) rotate(0deg)",
                transformOrigin: "center"
            });
        } else {
            button.style.transform = "scale(1)";
        }
    };

    // Attach listeners 
    button.addEventListener("click", clickHandler);
    button.addEventListener("mouseenter", mouseEnterHandler);
    button.addEventListener("mouseleave", mouseLeaveHandler);

    return {
        button,
        cleanup: () => {
            button.removeEventListener("click", clickHandler);
            button.removeEventListener("mouseenter", mouseEnterHandler);
            button.removeEventListener("mouseleave", mouseLeaveHandler);
        }
    };
}

/**
 * Creates and styles a close button for a UI component.
 * @param {object} [options={}] - The options for the close button.
 * @returns {{button: HTMLButtonElement, cleanup: function}} The created button element and cleanup function.
 */
export function createCloseButton(options = {}) {
    const defaults = {
        className: "close-button",
        title: "close",
        image: closeIcon,
        clickCallback: (event) => { console.log("click event for close button", event) },
    };
    return _createBaseButton({ ...defaults, ...options });
}

/**
 * Creates and styles an expand/collapse button for a UI component.
 * @param {object} [options={}] - The options for the expand/collapse button.
 * @returns {{button: HTMLButtonElement, cleanup: function}} The created button element and cleanup function.
 */
export function createExpandCollapseButton(options = {}) {
    const defaults = {
        className: "expand-collapse-button",
        title: "Expand/Collapse",
        image: shrinkIcon,
        clickCallback: (event) => { console.log("click event for expand/collapse button", event) },
    };
    return _createBaseButton({ ...defaults, ...options });
}

/**
 * Creates a context menu DOM element with standard styling.
 * @param {HTMLDivElement} container - The container to append the menu to
 * @param {Object} [options={}] - Configuration options
 * @returns {HTMLDivElement} The created context menu element
 */
export function createContextMenu(container, options = {}) {
    const { show = false } = options;

    if (!container) {
        console.warn("Container is not provided for context menu setup.");
        return null;
    }

    const contextMenu = document.createElement("div");
    contextMenu.classList.add("an-context-menu");

    Object.assign(contextMenu.style, {
        background: "#fefefe",
        border: "1px solid #ddd",
        borderRadius: "4px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        padding: "4px 0",
        minWidth: "120px",
        position: "absolute",
        zIndex: "1000",
        display: show ? 'block' : 'none'
    });

    container.appendChild(contextMenu);
    return contextMenu;
}

/**
 * Updates context menu position and content.
 * @param {HTMLDivElement} contextMenu - The context menu element
 * @param {{x: number, y: number}} position - {x, y} position coordinates
 * @param {Array<{text: string, event: function}>} itemOptions - Menu item configurations
 */
export function updateContextMenu(contextMenu, position, itemOptions = []) {
    if (!contextMenu || !position.x || !position.y) return;

    // Update position
    contextMenu.style.left = `${position.x}px`;
    contextMenu.style.top = `${position.y}px`;
    contextMenu.style.display = 'block';

    // Clear existing content
    const existingList = contextMenu.querySelector("ul");
    if (existingList) existingList.remove();

    // Create new menu list
    const menuList = createMenuList(itemOptions);
    contextMenu.appendChild(menuList);

    // Auto-close on click elsewhere
    setTimeout(() => document.addEventListener('click', () => hideContextMenu(contextMenu), { once: true }), 0);
}

/**
 * Hides the context menu.
 * @param {HTMLDivElement} contextMenu - The context menu element
 */
export function hideContextMenu(contextMenu) {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
}

/**
 * Creates a menu list with items.
 * @param {Array<{text: string, event: function}>} itemOptions - Menu item configurations
 * @returns {HTMLUListElement} The menu list element
 * @private
 */
function createMenuList(itemOptions) {
    const menuList = document.createElement("ul");
    menuList.className = "an-context-menu-list";
    Object.assign(menuList.style, {
        listStyle: "none",
        margin: "0",
        padding: "0"
    });

    itemOptions.forEach(item => {
        const menuItem = createMenuItem(item);
        menuList.appendChild(menuItem);
    });

    // Remove border from last item
    if (menuList.lastElementChild) {
        menuList.lastElementChild.style.borderBottom = "none";
    }

    return menuList;
}

/**
 * Creates a single menu item.
 * @param {{text: string, event: function}} item - Menu item configuration
 * @returns {HTMLLIElement} The menu item element
 * @private
 */
function createMenuItem(item) {
    const menuItem = document.createElement("li");
    menuItem.classList.add("an-context-menu-list-item");
    menuItem.textContent = item.text;

    Object.assign(menuItem.style, {
        padding: "8px 12px",
        cursor: "pointer",
        borderBottom: "1px solid #eee",
        transition: "background-color 0.3s ease"
    });

    // Add hover effects
    menuItem.addEventListener("mouseenter", () => {
        menuItem.style.backgroundColor = "#ece5e5";
    });
    menuItem.addEventListener("mouseleave", () => {
        menuItem.style.backgroundColor = "transparent";
    });

    // Click event handler - FIXED: Hide menu after executing item action
    menuItem.addEventListener("click", event => {
        event.stopPropagation();
        event.preventDefault();

        // Execute the menu item action
        item.event(event);

        // Hide the context menu after item execution
        const contextMenu = event.target.closest('.an-context-menu');
        if (contextMenu) {
            hideContextMenu(contextMenu);
        }
    });

    return menuItem;
}


/***********************************
 *        UTILITY FUNCTIONS        *
 * HAVE RELATIONSHIP WITH THE TOOL *
 ***********************************/
/**
 * Makes an HTML element draggable within a specified container using CSS transforms.
 * @param {HTMLElement} element - The element to make draggable.
 * @param {HTMLElement} container - The container element used as boundary.
 * @param {function(boolean): void} [onDragStateChange] - Called when dragging starts/ends.
 * @returns {function} Cleanup function.
 */
export function makeDraggable(element, container, onDragStateChange) {
    if (!element || !container) return () => { }; // Return empty cleanup function

    let isDragging = false;
    let dragStarted = false;
    let startX = 0, startY = 0;
    const threshold = 3;
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

        // Parse existing transform values more robustly
        const style = window.getComputedStyle(element);
        const transform = style.transform;

        if (transform && transform !== 'none') {
            // Handle both matrix() and translate() formats
            let matrix = transform.match(/matrix\(([^)]+)\)/);
            if (matrix) {
                const values = matrix[1].split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 6) {
                    currentX = values[4]; // translateX
                    currentY = values[5]; // translateY
                }
            } else {
                // Try to parse translate() format directly
                const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if (translateMatch) {
                    currentX = parseFloat(translateMatch[1]) || 0;
                    currentY = parseFloat(translateMatch[2]) || 0;
                }
            }
        } else {
            // No existing transform - use default top-left positioning
            currentX = 0;
            currentY = 0;
            updateTransform(currentX, currentY);
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
            const minX = 0;
            const maxX = containerRect.width - elementRect.width;
            const minY = 0;
            const maxY = containerRect.height - elementRect.height;

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
        e.stopPropagation();

        // Capture current position at the start of drag
        const style = window.getComputedStyle(element);
        const transform = style.transform;

        if (transform && transform !== 'none') {
            const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (translateMatch) {
                currentX = parseFloat(translateMatch[1]) || 0;
                currentY = parseFloat(translateMatch[2]) || 0;
            }
        }

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
                const minY = 0;
                const maxY = containerRect.height - elementRect.height;

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
 * Formats a measurement value based on the provided unit with automatic unit conversion.
 * @param {number|string} value - The measurement value to format.
 * @param {string} unit - The unit type:
 *   - "meter": Displays as m, converts to km when ≥1000m, or cm when <1m
 *   - "squareMeter": Displays as m², converts to km² when ≥1,000,000m², or cm² when <1m²
 * @returns {string} The formatted measurement string with appropriate unit suffix.
 */
export function formatMeasurementValue(value, unit) {
    if (value == null || value === "") return "";
    if (typeof value === "string") return value;

    // Convert to number and validate
    const numValue = Number(value);
    if (isNaN(numValue)) return value.toString();

    // Configuration object defining conversion rules for each unit type
    // Each unit has an array of conversion rules ordered from largest to smallest threshold
    const unitConfig = {
        // Linear distance conversions: km → m → cm
        meter: [
            { threshold: 1000, factor: 1 / 1000, suffix: "km" },
            { threshold: 1, factor: 1, suffix: "m" },
            { threshold: 0, factor: 100, suffix: "cm" },
        ],
        // Area conversions: km² → m² → cm²
        squareMeter: [
            { threshold: 1000000, factor: 1 / 1000000, suffix: "km²" },
            { threshold: 1, factor: 1, suffix: "m²" },
            { threshold: 0, factor: 10000, suffix: "cm²" },
        ],
    };

    // Get the conversion rules for the specified unit type
    const config = unitConfig[unit];
    if (!config) {
        // Unknown unit type - return the value as-is without conversion
        return value.toString();
    }

    // Find the first threshold that the value meets or exceeds
    // The array is ordered from largest to smallest threshold for efficiency
    for (const { threshold, factor, suffix } of config) {
        if (numValue >= threshold) {
            // Apply the conversion factor and format to 2 decimal places
            // factor: multiplier to convert from base unit to target unit
            // Example: 1500m with factor 1/1000 = 1.50km
            return (numValue * factor).toFixed(2) + suffix;
        }
    }

    // Fallback for edge cases (e.g., negative numbers that don't meet any threshold)
    // Use the smallest unit (last in array) for conversion
    const lastUnit = config[config.length - 1];
    return (numValue * lastUnit.factor).toFixed(2) + lastUnit.suffix;
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
                latitude: CesiumMath.toDegrees(cartographic.latitude),
                longitude: CesiumMath.toDegrees(cartographic.longitude),
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

/**
 * Deconstructs an annotation formatted id to extract metadata.
 * The id format is expected to be "annotate_{mode}_{type}_{measureId}"
 * @param {string} id - The annotation formatted id for the graphics. (e.g. "annotate_height_label_12345")
 * @returns {{id: string, mode: string|null, type: string|null, measureId: string|null} | null} An object containing the deconstructed metadata from the id, or null if invalid.
 */
export function deconstructIdForMetadata(id) {
    if (typeof id !== "string") {
        // convert id to string if it's not already
        id = String(id);
    }

    // validate if it is annotation id
    if (!id.startsWith("annotate_")) return null;

    const [annotation, mode, type, measureId] = id.split("_");

    return {
        mode: mode || null,
        type: type || null,
        measureId: measureId || null
    };
}

/**
 * Converts a camelCase or snake_case string to a human-readable format with spaces.
 * @param {string} str - The camelCase or snake_case string to convert.
 * @returns {string} The converted human-readable string.
 */
export function camelCaseToWords(str) {
    // Replace underscores with spaces and camelCase with spaces before capital letters
    return (
        str
            .replace(/_/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
            // Optionally, capitalize the first letter of each word
            .replace(/\b\w/g, (char) => char.toUpperCase())
    );
}

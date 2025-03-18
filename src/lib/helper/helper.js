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
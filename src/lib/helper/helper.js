import * as Cesium from "cesium";

/**
 * Opens a modal for the user to edit the label name and updates the label primitive.
 * @param {HTMLElement} viewerContainer - The container element of the Cesium viewer.
 * @param {Cesium.Label} label - the label primitive to be updated.
 * @returns {Promise<void>} - A promise that resolves when the label is updated.
 */
export async function editableLabel(viewerContainer, label) {
    try {
        // open a modal for user to edit the label name
        const newLabelName = await setupEditableModal(viewerContainer);

        const labelText = label.text
        let value = null;
        // check the label to see if it has ":"
        if (labelText.includes(":")) {
            // retrieve the distance value
            const [labelName, distance] = label.text.split(":");
            value = distance;
        } else {
            // if the label does not have ":", label value is the distance value
            value = label.text;
        }

        // create the new label text
        const newLabelText = `${newLabelName.trim()} : ${value.trim()}`;

        // set the new label text
        label.text = newLabelText;
    } catch (error) {
        return;
    }
}

/**
 * Sets up a modal for the user to edit the label name.
 * @param {HTMLElement} viewerContainer - The container element of the Cesium viewer.
 * @returns {Promise<string>} - A promise that resolves to the new label name.
 */
function setupEditableModal(viewerContainer) {
    return new Promise((resolve, reject) => {
        const modal = document.createElement("div");
        modal.className = "edit-label-modal";

        const style = document.createElement('style');
        style.textContent = `
            .edit-label-modal{
                position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);
                display: flex; justify-content: center; align-items: center; z-index: 2000; color: white; font-size: 20px;
            }
            .edit-label-modal-container{
                background-color: #242526 ; padding: 20px 30px 30px 30px; border-radius: 10px; border: 1px solid #3b4855
            }
            .edit-label-modal-input{
                display: flex; flex-direction: column; gap: 20px;
            }
            .edit-label-modal-input p{
                font-family:Roboto, sans-serif; font-size: 1.25rem
            }  
            .edit-label-modal-input input{
                padding: 5px; margin: 0px 0px 20px 0px;
            }
            .edit-label-modal-buttons{
                display: flex; justify-content: flex-end; gap: 10px; 
            }
            .edit-label-modal-buttons button{
                padding: 5px 10px; border-radius: 5px; border: none; outline: none; cursor: pointer; transition: all .5s ease; 
                font-family:Roboto, sans-serif; 
            }
            .edit-label-modal-buttons button:hover{
                background-color: rgba(245, 245, 245, 0.8);
            }
        `;

        modal.innerHTML = `
        <div class="edit-label-modal-container">
            <div class="edit-label-modal-input">
                <p>Enter new label name</p>
                <input type="text" id="editableLabelInput" />
            </div>
            <div class="edit-label-modal-buttons">
                <button class="label-submit-btn">Submit</button>
                <button class="label-cancel-btn">Cancel</button>
            </div>
        </div>
        `;
        viewerContainer.appendChild(modal);
        viewerContainer.append(style);

        // Focus on the input field
        const input = modal.querySelector("#editableLabelInput");
        input.focus();

        // Add event listener to cancel button
        const removeModal = () => {
            viewerContainer.removeChild(modal)
            modal.removeEventListener("keydown", keyDownHandler);
        };

        const cancelBtn = modal.querySelector(".label-cancel-btn");
        const cancelBtnHandler = () => {
            removeModal();
            reject(null);
        }
        cancelBtn.addEventListener("click", cancelBtnHandler);

        // Add event listener to submit button
        const submitBtn = modal.querySelector(".label-submit-btn");
        const submitBtnHandler = () => {
            const newLabel = modal.querySelector("#editableLabelInput").value;
            removeModal();
            resolve(newLabel);
        }
        submitBtn.addEventListener("click", submitBtnHandler);

        // add event listener for "enter" and "esc" keydown
        const keyDownHandler = (e) => {
            if (e.key === "Enter") {
                submitBtnHandler();
            } else if (e.key === "Escape") {
                cancelBtnHandler();
            }
        }
        modal.addEventListener("keydown", keyDownHandler);
    });
}

/**
 * update the pointer overlay position and color based on the pickedObjects
 * @param {Cesium.Viewer} viewer 
 * @param {HTMLElement} pointerOverlay 
 * @param {Cesium.Cartesian3} cartesian 
 * @param {Array} pickedObjects 
 */
export function updatePointerOverlay(viewer, pointerOverlay, cartesian, pickedObjects) {
    // const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
    // cesium api update for world position to WindowCoordinates
    const screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
    pointerOverlay.style.display = 'block';
    pointerOverlay.style.left = `${screenPosition.x - 5}px`;
    pointerOverlay.style.top = `${screenPosition.y - 5}px`;
    pointerOverlay.style.borderRadius = "50%";
    pointerOverlay.style.width = "1px";
    pointerOverlay.style.height = "1px";

    if (pickedObjects.length === 0) {
        pointerOverlay.style.backgroundColor = "yellow";
    } else {
        const annotatePrimitives = pickedObjects.some(pickedObject => {
            // check for its id is string type and start with "annotate"
            return (typeof pickedObject.id === "string" && pickedObject.id.startsWith("annotate"));
        });
        const annotateEntity = pickedObjects.some(pickedObject => {
            return (pickedObject.id instanceof Cesium.Entity);
        });

        // anything other than annotate object will be blue
        pointerOverlay.style.backgroundColor = (!annotatePrimitives && !annotateEntity) ? "blue" : "yellow";
    }
}

// Cesium primitive
// point primitive
export function createPointPrimitive(coordinate, color = Cesium.Color.RED) {
    if (!coordinate) {
        return; // Exit early if coordinate is not defined
    }

    //check if coordinate is cartographic degrees or radians or cartesian
    const cartesian = convertToCartesian3(coordinate);

    return {
        position: cartesian,
        pixelSize: 8,
        color: color,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    }
}

// line primitive
export function createLineGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }

    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    const polylineGeometry = new Cesium.PolylineGeometry({
        positions: convertedCoordinates,
        width: 2,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT
    });

    const geometryInstance = new Cesium.GeometryInstance({
        geometry: polylineGeometry,
        id: `${generateId(convertedCoordinates, mode)}`,
    });

    return geometryInstance
}

export function createLinePrimitive(geometryInstance, color = Cesium.Color.RED, Primitive) {
    return new Primitive({
        geometryInstances: geometryInstance,
        appearance: new Cesium.PolylineMaterialAppearance({
            material: new Cesium.Material.fromType('Color', {
                color: color
            })
        }),
        depthFailAppearance: new Cesium.PolylineMaterialAppearance({
            material: new Cesium.Material.fromType('Color', {
                color: color
            })
        }),
        asynchronous: false,
        // false: make geometry instance available to lookup, true: release geometry instances to save memory
        releaseGeometryInstances: false
    });
}

export function createClampedLineGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }

    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    const groundPolylineGeometry = new Cesium.GroundPolylineGeometry({
        positions: convertedCoordinates,
        width: 2
    });

    const groundPolylineGeometryInstance = new Cesium.GeometryInstance({
        geometry: groundPolylineGeometry,
        id: `${generateId(convertedCoordinates, mode)}`,
    });

    return groundPolylineGeometryInstance;
}

export function createClampedLinePrimitive(geometryInstance, color = Cesium.Color.RED, GroundPolylinePrimitive) {
    return new GroundPolylinePrimitive({
        geometryInstances: geometryInstance,
        appearance: new Cesium.PolylineMaterialAppearance({
            material: new Cesium.Material.fromType('Color', {
                color: color
            })
        }),
        asynchronous: true,
        releaseGeometryInstances: false
    });
}

// label primitive
export function createLabelPrimitive(startPoint, endPoint, distance) {
    const midpoint = Cesium.Cartesian3.lerp(
        startPoint,
        endPoint,
        0.5,
        new Cesium.Cartesian3()
    );

    // Define the offset from the midpoint position
    const labelOffset = new Cesium.Cartesian2(0, -20);

    let labelString = formatDistance(distance);

    // create label primtive
    return {
        position: midpoint,
        pixelOffset: labelOffset,
        text: labelString,
        font: "14px Roboto, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
        scale: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // Make the label always visible
    }
}
// polygon primitive
export function createPolygonGeometryInstance(coordinateArray, mode) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) {
        return;
    }

    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    const polygonGeometry = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
        perPositionHeight: true,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
    });

    const polygonGeometryInstance = new Cesium.GeometryInstance({
        geometry: polygonGeometry,
        id: `${generateId(convertedCoordinates, mode)}`,
    });

    return polygonGeometryInstance;
}
export function createPolygonPrimitive(polygonGeometryInstance, color = Cesium.Color.GREEN.withAlpha(0.8), Primitive) {
    return new Primitive({
        geometryInstances: polygonGeometryInstance,
        appearance: new Cesium.EllipsoidSurfaceAppearance({
            material: Cesium.Material.fromType('Color', {
                color: color
            })
        }),
        depthFailAppearance: new Cesium.EllipsoidSurfaceAppearance({
            material: Cesium.Material.fromType('Color', {
                color: color
            })
        }),
        asynchronous: false,
        releaseGeometryInstances: false
    });
}

export function createPolygonOutlineGeometryInstance(coordinateArray, mode, color = Cesium.Color.YELLOW) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 3) {
        return;
    }

    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    const polygonOutlineGeometry = new Cesium.PolygonOutlineGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(convertedCoordinates),
        perPositionHeight: true
    });

    const polygonOutlineGeometryInstance = new Cesium.GeometryInstance({
        geometry: polygonOutlineGeometry,
        id: `${generateId(coordinateArray, mode)}-outline`,
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(color) // Add depthFailColor attribute
        }
    });

    return polygonOutlineGeometryInstance;
}

export function createPolygonOutlinePrimitive(outlineGeometryInstance, Primitive) {
    return new Primitive({
        geometryInstances: outlineGeometryInstance,
        appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: false,
        }),
        depthFailAppearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: false,
        }),
        asynchronous: false,
        releaseGeometryInstances: false
    });
}

/**
 * calculate the distance between two points
 * @param {Cesium.Cartesian3} startPoint - the cartesian coordinates
 * @param {Cesium.Cartesian3} endPoint - the cartesian coordinates
 * @returns {number} distance - the distance between startPoint and endPoint
 */
export function calculateDistance(startPoint, endPoint) {
    const distance = Cesium.Cartesian3.distance(startPoint, endPoint);
    return distance;
}

export function convertToCartesian3(coordinate) {
    if (!Cesium.defined(coordinate)) return;

    let cartesian = coordinate;

    if (coordinate.longitude) {
        if (Math.abs(coordinate.longitude) > 10) {
            cartesian = Cesium.Cartesian3.fromDegrees(
                coordinate.longitude,
                coordinate.latitude,
                coordinate.height
            );
        } else {
            cartesian = Cesium.Cartesian3.fromRadians(
                coordinate.longitude,
                coordinate.latitude,
                coordinate.height
            );
        }
    }

    return cartesian;
}

export function cartesian3ToCartographicDegrees(cartesian) {
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);

    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);
    const height = cartographic.height;

    return { longitude, latitude, height };
}

/**
 * Format the distance.
 * @param {number} distance - The distance in meters.
 * @returns {string} The formatted distance string.
 */
export function formatDistance(distance) {
    if (distance >= 1_000) {
        // Convert to kilometers
        return (distance / 1_000).toFixed(2) + " km";
    } else if (distance >= 1) {
        // Keep in meters
        return distance.toFixed(2) + " m";
    } else {
        // Convert to centimeters
        return (distance * 100).toFixed(2) + " cm";
    }
}

/**
 * Format the area.
 * @param {number} area - The area in square meters.
 * @returns {string} The formatted area string.
 */
export function formatArea(area) {
    if (area >= 1_000_000) {
        // Convert to square kilometers
        return (area / 1_000_000).toFixed(2) + " km²";
    } else if (area >= 1) {
        // Keep in square meters
        return area.toFixed(2) + " m²";
    } else {
        // Convert to square centimeters
        return (area * 10_000).toFixed(2) + " cm²";
    }
}

/**
 * Generate a unique id for annotation mode with its coordinates. 
 * @param {Cesium.Cartesian3} cartesian - The Cartesian coordinates of the point.
 * @param {string} mode - The mode name of the annotation tool.
 * @returns {string} id - The unique id for entity or primitive.
 */
export function generateId(cartesian, mode) {
    let coordsId = null;
    // cartesian could be either array or cartesian3
    if (Array.isArray(cartesian)) {
        cartesian.forEach((cart) => {
            const coordId = cartesianToId(cart);
            coordsId = coordsId ? coordsId + "_" + coordId : coordId;
        });
    } else {
        coordsId = cartesianToId(cartesian);
    }
    const modeString = mode.toString().toLowerCase();
    // Create the entity id using the hash
    return `annotate_${modeString}_${coordsId}`;
}

/**
 * generate id for cartesian coordinate
 * @param {Cesium.Cartesian3} cartesian 
 * @returns {string} id - the id for the cartesian coordinate
 */
export function cartesianToId(cartesian) {
    // Convert the cartesian position to a string
    const positionString = cartesian.toString();

    let hash = 0;
    // Loop through the characters of the position string and calculate the hash
    for (let i = 0; i < positionString.length; i++) {
        const char = positionString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to a 32-bit integer
    }
    // create id using hash
    return `${Math.abs(hash).toString(36)}`;
}

export function removeInputActions(handler) {
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
    // handler.removeInputAction(Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
}

/**
 * Makes an HTML element draggable within a specified container.
 * @param {HTMLElement} element - The HTML element to be made draggable.
 * @param {HTMLElement} container - The container within which the element can be dragged.
 * @param {function(number, number, DOMRect): void} updatePositionCallback - Callback to update the position of the element.
 * @param {function(boolean): void} [onDragStateChange] - Optional callback to notify when dragging starts or ends.
 */
export function makeDraggable(element, container, updatePositionCallback, onDragStateChange) {
    let posInitialX = 0, posInitialY = 0;  // Initial cursor positions
    let isDragging = false;  // Internal flag to track dragging state
    const threshold = 5;  // Pixels to move before triggering a drag

    // Function to emit drag state changes
    const emitDragState = (newState) => {
        if (isDragging !== newState) {
            isDragging = newState;
            if (typeof onDragStateChange === 'function') {
                onDragStateChange(isDragging);
            }
        }
    };

    // Retrieves the bounding rectangle of the container
    const fetchContainerRect = () => container.getBoundingClientRect();
    let containerRect = fetchContainerRect();  // Initial dimensions of the container

    // Updates the position of the draggable element
    const updatePosition = (newTop, newLeft) => {
        containerRect = fetchContainerRect();  // Refresh dimensions for dynamic changes

        // Ensure the element remains within container bounds
        newLeft = Math.max(0, Math.min(newLeft, containerRect.width - element.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, containerRect.height - element.offsetHeight));

        // Apply the new position styles to the element
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;

        // Call the callback function with new position and updated container dimensions
        if (updatePositionCallback) {
            updatePositionCallback(newTop, newLeft, containerRect);
        }
    };

    // Handles the mouse move event to update the element's position
    const elementDrag = (event) => {
        event.preventDefault();
        const deltaX = Math.abs(posInitialX - event.clientX);
        const deltaY = Math.abs(posInitialY - event.clientY);

        if (!isDragging && (deltaX > threshold || deltaY > threshold)) {
            emitDragState(true);
        }

        if (isDragging) {
            const deltaX = posInitialX - event.clientX;
            const deltaY = posInitialY - event.clientY;

            posInitialX = event.clientX;
            posInitialY = event.clientY;

            const newTop = element.offsetTop - deltaY;
            const newLeft = element.offsetLeft - deltaX;
            updatePosition(newTop, newLeft);
        }
    };

    // Cleans up event listeners when dragging ends
    const closeDragElement = () => {
        document.onmouseup = null;
        document.onmousemove = null;
        if (isDragging) {
            emitDragState(false);
        }
    };

    // Initiates dragging
    element.onmousedown = (event) => {
        // Avoid dragging when clicking on input elements to allow normal interaction
        if (event.target.tagName.toLowerCase() === 'input' || event.target.tagName.toLowerCase() === 'textarea') {
            return;
        }
        event.preventDefault();
        posInitialX = event.clientX;
        posInitialY = event.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    };

    // Handle container resize using ResizeObserver
    const handleResize = () => {
        containerRect = fetchContainerRect();  // Refresh container dimensions

        // Get current position of the element
        let currentLeft = parseInt(element.style.left, 10) || 0;
        let currentTop = parseInt(element.style.top, 10) || 0;

        // Adjust position if it's outside the container bounds
        const adjustedLeft = Math.max(0, Math.min(currentLeft, containerRect.width - element.offsetWidth));
        const adjustedTop = Math.max(0, Math.min(currentTop, containerRect.height - element.offsetHeight));

        // Update the position only if it has changed
        if (currentLeft !== adjustedLeft || currentTop !== adjustedTop) {
            element.style.left = `${adjustedLeft}px`;
            element.style.top = `${adjustedTop}px`;

            // Call the updatePositionCallback with new position
            if (updatePositionCallback) {
                updatePositionCallback(adjustedTop, adjustedLeft, containerRect);
            }
        }
    };

    // Set up ResizeObserver on the container
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Clean up function to remove event listeners and observers when needed
    const cleanup = () => {
        resizeObserver.unobserve(container);
        resizeObserver.disconnect();
        element.onmousedown = null;
        document.onmouseup = null;
        document.onmousemove = null;
    };

    // Return the cleanup function optionally
    return cleanup;
}


import * as Cesium from "cesium";

/**
 * Opens a modal for the user to edit the label name and updates the label entity.
 * @param {HTMLElement} viewerContainer - The container element of the Cesium viewer.
 * @param {Cesium.Entity} label - The label entity to be edited.
 * @returns {Promise<void>} - A promise that resolves when the label is updated.
 */
export async function editableLabel(viewerContainer, label) {
    try {
        // open a modal for user to edit the label name
        const newLabelName = await setupEditableModal(viewerContainer);

        const labelText = label.text.getValue();
        let value = null;
        // check the label to see if it has ":"
        if (labelText.includes(":")) {
            // retrieve the distance value
            const [labelName, distance] = label.text.getValue().split(":");
            value = distance
        } else {
            // if the label does not have ":", label value is the distance value
            value = label.text.getValue();
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
export function setupEditableModal(viewerContainer) {
    return new Promise((resolve, reject) => {
        const modal = document.createElement("div");

        modal.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
            background-color: rgba(0,0,0,0.5); display: flex; justify-content: center; 
            align-items: center; z-index: 2000; color: white; font-size: 20px;
        `;

        modal.innerHTML = `
        <div style="background-color: #242526 ; padding: 20px; border-radius: 10px; border: 1px solid #3b4855">
            <p>Enter new label name</p>
<input type="text" id="editableLabelInput" style="padding: 5px; margin: 20px 0;" />            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button class="label-submit-btn" style="padding: 5px 10px; border-radius: 5px">Submit</button>
                <button class="label-cancel-btn" style="padding: 5px 10px; border-radius: 5px">Cancel</button>
            </div>
        </div>
        `;
        viewerContainer.appendChild(modal);

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

export function updatePointerOverlay(viewer, pointerOverlay, cartesian, pickedObjects) {
    const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
    pointerOverlay.style.display = 'block';
    pointerOverlay.style.left = `${screenPosition.x - 5}px`;
    pointerOverlay.style.top = `${screenPosition.y - 5}px`;
    pointerOverlay.style.borderRadius = "50%";
    pointerOverlay.style.width = "1px";
    pointerOverlay.style.height = "1px";

    // Check if there is any pickedObject that is not an entity using `some` for efficiency
    const hasNonEntityObject = pickedObjects.some(pickedObject => !(pickedObject.id instanceof Cesium.Entity));

    pointerOverlay.style.backgroundColor = hasNonEntityObject ? "blue" : "yellow";
}

/**
 * Create a point entity setting at the given Cartesian coordinates with the specified color.
 * @param {Cesium.Cartesian3 | Cesium.Cartographic} coordinate - The coordinate of point entity
 * @param {Cesium.Color} color - The color of the point entity.
 * @return {Object} the property for point entity that can be added to the viewer. use viewer.entities.add()
 */
export function createPointEntity(coordinate, color = Cesium.Color.RED) {
    if (!coordinate) {
        return; // Exit early if coordinate is not defined
    }

    //check if coordinate is cartographic degrees or radians or cartesian
    const cartesian = convertToCartesian3(coordinate);

    // Create a point entity with the given position and color
    return {
        // id: formatEntityId(cartesian), // Use a unique id for the point entity
        position: cartesian,
        point: {
            pixelSize: 8,
            color: color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    };
}

/**
 * Creates a line entity between two or more points using a mix of Cartesian3 and Cartographic coordinates.
 *
 * @param {(Cesium.Cartesian3|Cesium.Cartographic)[]} coordinateArray - An array of Cartesian3 or Cartographic coordinates representing the points of the line. The function will convert Cartographic points to Cartesian3 internally.
 * @param {Cesium.Color} [cesiumColor=Cesium.Color.RED] - The color of the line entity.
 * @returns {Object} the property for line entity that can be added to the viewer. use viewer.entities.add()
 */
export function createLineEntity(
    coordinateArray,
    cesiumColor = Cesium.Color.RED
) {
    // Check if the input is valid (an array of Cartesian3 points with at least two points)
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }
    // convert unexpect coordinate to cartesian3
    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    // unstable color fix using ColorMaterialProperty
    const color = new Cesium.ColorMaterialProperty(cesiumColor);

    return {
        polyline: {
            positions: convertedCoordinates,
            width: 2,
            material: color,
            depthFailMaterial: color,
        },
    };
}

export function createLineEntityClamped(
    coordinateArray,
    cesiumColor = Cesium.Color.RED
) {
    // Check if the input is valid (an array of Cartesian3 points with at least two points)
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }
    // convert unexpect coordinate to cartesian3
    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    // unstable color fix using ColorMaterialProperty
    const color = new Cesium.ColorMaterialProperty(cesiumColor);

    return {
        polyline: {
            positions: convertedCoordinates,
            width: 2,
            clampToGround: true,
            material: color,
            depthFailMaterial: color,
        },
    };
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


/**
 * Create a label entity for displaying the distance or area.
 * @param {Cesium.Cartesian3} startPoint - The Cartesian coordinates of the starting point.
 * @param {Cesium.Cartesian3} endPoint - The Cartesian coordinates of the ending point.
 * @param {number} distance - The distance between startPoint and endPoint.
 * @param {boolean} isTotal - state to determine if it is for total measurement.
 * @returns {object} the property for label entity that can be added to the viewer. use viewer.entities.add()
 */
export function createDistanceLabel(
    startPoint,
    endPoint,
    distance,
) {
    const midpoint = Cesium.Cartesian3.lerp(
        startPoint,
        endPoint,
        0.5,
        new Cesium.Cartesian3()
    );

    // Define the offset from the midpoint position
    const labelOffset = new Cesium.Cartesian2(0, -20);

    let labelString = "Total: " + formatDistance(distance);

    // Create a label entity with the fixed position
    return {
        position: midpoint,
        label: {
            text: labelString,
            font: "14px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
            pixelOffset: labelOffset,
            scale: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // Make the label always visible
        },
    };
}

/**
 * Create a polygon entity between three or more points.
 * @param {(Cesium.Cartesian3|Cesium.Cartographic)[]} coordinateArray - An array of Cartesian coordinates representing the points of the line.
 * @returns {Object} polygonEntity - The polygon entity created.
 */
export function createPolygonEntity(coordinateArray) {
    if (!Array.isArray(coordinateArray)) {
        return; // Exit early if cartesianArray is not defined or contains less than 3 points
    }
    const cartesian3Array = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    return {
        name: "measure tool polygon",
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cartesian3Array),
            perPositionHeight: true,
            material: new Cesium.ColorMaterialProperty(Cesium.Color.GREEN.withAlpha(0.5)),
            outline: true,
            outlineColor: Cesium.Color.YELLOW,
            outlineWidth: 4,
            // disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // depthFailMaterial: Cesium.Color.YELLOW,
            // extrudedHeight: 0,
        },
    };
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
 * format the distance
 * @param {number} distance
 * @returns {number} distance - the formatted distance
 */
export function formatDistance(distance) {
    if (distance > 1000) {
        return (distance / 1000).toFixed(2) + " km";
    } else {
        return distance.toFixed(2) + " m";
    }
}

export function removeInputActions(handler) {
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    // handler.removeInputAction(Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
}






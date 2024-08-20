import * as Cesium from "cesium";

/**
 * Opens a modal for the user to edit the label name and updates the label entity.
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
export function setupEditableModal(viewerContainer) {
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
    const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
    // cesium api update for wgs84ToWindowCoordinates
    // const screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
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


// Cesium entity
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
    cesiumColor = Cesium.Color.RED,
    isClamped = false,
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
            clampToGround: isClamped,
        },
    };
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

    let labelString = formatDistance(distance);

    // Create a label entity with the fixed position
    return {
        position: new Cesium.CallbackProperty(() => midpoint, false),
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
            material: new Cesium.ColorMaterialProperty(Cesium.Color.GREEN.withAlpha(0.8)),
            outline: true,
            outlineColor: Cesium.Color.YELLOW,
            outlineWidth: 4,
        },
    };
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
export function createLineGeometryInstance(
    coordinateArray,
    mode,
    isClamped = false
) {
    if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
        return;
    }

    const convertedCoordinates = coordinateArray.map((item) =>
        convertToCartesian3(item)
    );

    let geometryInstance;
    if (isClamped) {
        const groundPolylineGeometry = new Cesium.GroundPolylineGeometry({
            positions: convertedCoordinates,
            width: 2
        });

        geometryInstance = new Cesium.GeometryInstance({
            geometry: groundPolylineGeometry,
            id: `${generateId(convertedCoordinates, mode)}-clamped`,
        });
    } else {
        const polylineGeometry = new Cesium.PolylineGeometry({
            positions: convertedCoordinates,
            width: 2,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT
        });

        geometryInstance = new Cesium.GeometryInstance({
            geometry: polylineGeometry,
            id: `${generateId(convertedCoordinates, mode)}`,
        });
    }

    return geometryInstance
}

export function createLinePrimitive(geometryInstance, color = Cesium.Color.RED, Primitive, isClamped = false) {
    if (isClamped) {
        // For clamped polylines
        return new Cesium.GroundPolylinePrimitive({
            geometryInstances: geometryInstance,
            appearance: new Cesium.PolylineMaterialAppearance({
                material: new Cesium.Material.fromType('Color', {
                    color: color
                })
            }),
            asynchronous: false,
            releaseGeometryInstances: false
        });
    } else {
        // For regular polylines
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
}

// export function createClampedLineGeometryInstance(coordinateArray, mode) {
//     if (!Array.isArray(coordinateArray) || coordinateArray.length < 2) {
//         return;
//     }

//     const convertedCoordinates = coordinateArray.map((item) =>
//         convertToCartesian3(item)
//     );

//     const groundPolylineGeometry = new Cesium.GroundPolylineGeometry({
//         positions: convertedCoordinates,
//         width: 2
//     });

//     const groundPolylineGeometryInstance = new Cesium.GeometryInstance({
//         geometry: groundPolylineGeometry,
//         id: `${generateId(convertedCoordinates, mode)}-clamped`,
//     });

//     return groundPolylineGeometryInstance;
// }

// export function createClampedLinePrimitive(geometryInstance, color = Cesium.Color.RED) {
//     return new Cesium.GroundPolylinePrimitive({
//         geometryInstances: geometryInstance,
//         appearance: new Cesium.PolylineMaterialAppearance({
//             material: new Cesium.Material.fromType('Color', {
//                 color: color
//             })
//         }),
//         asynchronous: false,
//         releaseGeometryInstances: false
//     });
// }
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
        font: "14px roboto",
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






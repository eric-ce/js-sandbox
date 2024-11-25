import * as Cesium from "cesium";
import { createLineArrowPrimitive, createPointPrimitive, generateId, getPickedObjectType, removeInputActions, showCustomNotification } from "../../helper/helper.js";

export function editFlyPath() {
    if (this.flags.isRecording) {
        showCustomNotification("Please stop recording before editing the fly path.", this.viewer.container);
        return;
    }
    this.flags.isEditing = !this.flags.isEditing;
    if (this.coords._flyRecords.length === 0) {
        alert("No fly-through data recorded.");
        return;
    }

    if (this.flags.isEditing) {
        this.coords._flyCache.position = this.viewer.camera.positionWC.clone();
        this.coords._flyCache.hpr = { heading: this.viewer.camera.heading, pitch: this.viewer.camera.pitch, roll: this.viewer.camera.roll };
        const pointPositions = this.coords._flyRecords.map((record) => record.position);

        const pointsBoundingSphere = new Cesium.BoundingSphere.fromPoints(pointPositions);

        // look to the ground
        this.viewer.camera.flyToBoundingSphere(pointsBoundingSphere, {
            offset: new Cesium.HeadingPitchRange(
                0.015530892129316243,
                -1.1280768131665995,
                pointsBoundingSphere.radius * 3
            ),
        });

        removePrimitives.call(this);

        // place points
        this.coords._flyRecords.forEach((record) => {
            const pointColor = this.stateManager.getColorState("pointColor");
            const point = createPointPrimitive(record.position, pointColor);
            point.id = generateId(record.position, "fly_through_point");
            this.pointCollection.add(point);
        });

        // place lines
        for (let index = 0; index < this.coords._flyRecords.length - 1; index++) {
            const currentRecord = this.coords._flyRecords[index];
            const nextRecord = this.coords._flyRecords[index + 1];
            // create a line primitive
            const lineColor = this.stateManager.getColorState("default");
            const lineArrow = createLineArrowPrimitive(
                [currentRecord.position, nextRecord.position],
                "fly_through_line",
                10,
                lineColor,
                1,
                this.cesiumPkg.Primitive
            );
            this.viewer.scene.primitives.add(lineArrow);
        }

        // edit features for points and lines
        // mouse move hover to point or line will highlight the point or line
        this.handler.setInputAction((movement) => hoverToHighlight.call(this, movement), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        // user can click on a point to use arrow keys to move the point
        this.handler.setInputAction((movement) => handleSelect.call(this, movement, this.handler), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        // OPTIONAL: user can drag a point to move to a new location
        // handleDrag.call(this, this.handler);

        // user can click on a line to add a new point
        handleDoubleClickAction.call(this, this.handler);

        // user can middle click to remove a point
        this.handler.setInputAction((movement) => handleRemovePoint.call(this, movement), Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
        // update fly-through data for its related actions

    } else {
        // reset the camera fly back to the initial position
        if (!this.coords._flyCache.position || !this.coords._flyCache.hpr) return;  // error handling: if there is no cache data
        this.viewer.camera.flyTo({
            destination: this.coords._flyCache.position,
            orientation: {
                heading: this.coords._flyCache.hpr.heading,
                pitch: this.coords._flyCache.hpr.pitch,
                roll: this.coords._flyCache.hpr.roll,
            },
            complete: () => {
                removeInputActions.call(this, this.handler);
                removePrimitives.call(this);
            },
            cancel: () => {
                console.log("fly cancelled");
            }
        });
    }
}

function hoverToHighlight(movement) {
    const resetHighlight = () => {
        if (this.interactivePrimitives.hoveredLine) {
            this.interactivePrimitives.hoveredLine.appearance.material.uniforms.color = this.stateManager.getColorState("lineCacheColor");
            this.interactivePrimitives.hoveredLine.depthFailAppearance.material.uniforms.color = this.stateManager.getColorState("lineCacheColor");
            this.interactivePrimitives.hoveredLine = null;
        }

        if (this.interactivePrimitives.hoveredPoint &&
            this.interactivePrimitives.hoveredPoint !== this.interactivePrimitives.selectedPoint
        ) {
            this.interactivePrimitives.hoveredPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.hoveredPoint.outlineWidth = 0;
            this.interactivePrimitives.hoveredPoint = null;
        }
    }

    const pickedObject = this.viewer.scene.pick(movement.endPosition);

    resetHighlight.call(this);

    // get the type of the picked object
    const pickedObjectType = getPickedObjectType(pickedObject, "fly_through");

    // based on the type of the picked object, highlight the object
    switch (pickedObjectType) {
        case "point":
            const point = pickedObject.primitive;
            if (point && point !== this.interactivePrimitives.selectedPoint) {
                // set the hover color for the point
                point.outlineColor = this.stateManager.getColorState("hover");
                point.outlineWidth = 2;
                // save the hovered point
                this.interactivePrimitives.hoveredPoint = point;
            }
            break;
        case "line":
            const line = pickedObject.primitive;
            if (line) {
                // clone the original color of the line
                const lineColor = line.appearance.material.uniforms.color.clone();
                this.stateManager.setColorState("lineCacheColor", lineColor);
                // set the hover color for the line
                line.appearance.material.uniforms.color = this.stateManager.getColorState("hover");
                line.depthFailAppearance.material.uniforms.color = this.stateManager.getColorState("hover");
                // save the hovered line
                this.interactivePrimitives.hoveredLine = line;
            }
            break;
        default:
            break;
    }
}

// remove primitives by the id of fly_through
function removePrimitives() {
    // remove the fly through points
    this.pointCollection._pointPrimitives.forEach(point => {
        point.id && point.id.includes("fly_through_point") && this.pointCollection.remove(point);
    })
    // remove the fly through lines
    const lines = this.viewer.scene.primitives._primitives.filter(p => p.id && p.id.includes("fly_through_line"));
    lines.forEach(line => this.viewer.scene.primitives.remove(line));
}

//TODO: editing features: select, drag, add, remove
// when user click on a point, the point will be selected
// when selected changed the color of the point shows relevant info in the logBox and show notification
function handleSelect(movement) {
    const pickedObject = this.viewer.scene.pick(movement.position);
    const pickedObjectType = getPickedObjectType(pickedObject, "fly_through");

    if (pickedObjectType === "point") {
        const point = pickedObject.primitive;

        // if there is a selected point, reset the color
        if (this.interactivePrimitives.selectedPoint) {
            this.interactivePrimitives.selectedPoint.outlineColor = this.stateManager.getColorState("pointColor");
            this.interactivePrimitives.selectedPoint.outlineWidth = 0;
        }
        // highlight the point
        point.outlineColor = this.stateManager.getColorState("select");
        point.outlineWidth = 2;
        // save the selected point
        this.interactivePrimitives.selectedPoint = point;

        // move the selected point with keyboard arrow keys
        moveSelectedPoint.call(this, point);

    } else if (pickedObjectType === "line") {
        // add a point to the line
    }
}

function moveSelectedPoint(point) {
    const keydownHandler = (event) => {
        const key = event.key;
        const shiftKey = event.shiftKey;
        const cartesian = this.interactivePrimitives.selectedPoint.position.clone();
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);

        const cartographicDegrees = {
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            height: cartographic.height
        };

        switch (key) {
            case "ArrowUp":
                if (shiftKey) {
                    cartographicDegrees.height += 1;
                } else {
                    cartographicDegrees.latitude += 0.0001;
                }
                break;
            case "ArrowDown":
                if (shiftKey) {
                    cartographicDegrees.height -= 1;
                } else {
                    cartographicDegrees.latitude -= 0.0001;
                }
                break;
            case "ArrowLeft":
                cartographicDegrees.longitude -= 0.0001;
                break;
            case "ArrowRight":
                cartographicDegrees.longitude += 0.0001;
                break;
            case "Enter":
                // Finalize editing
                this.flags.isEditing = false;
                window.removeEventListener('keydown', keydownHandler);
                // reset the color of the selected point
                point.outlineColor = this.stateManager.getColorState("pointColor");
                point.outlineWidth = 0;
                // fly to the bounding sphere of the points
                const boundingSphere = new Cesium.BoundingSphere.fromPoints(this.coords._flyRecords.map(record => record.position));
                const { pitch, heading } = this.coords._flyCache.hpr;
                this.viewer.camera.flyToBoundingSphere(boundingSphere, {
                    offset: new Cesium.HeadingPitchRange(heading, pitch, boundingSphere.radius * 2),
                });
            default:
                return;
        }

        // convert the cartographic degrees to cartesian
        const newCartesian = Cesium.Cartesian3.fromDegrees(cartographicDegrees.longitude, cartographicDegrees.latitude, cartographicDegrees.height);

        // update the position of the point
        point.position = newCartesian;

        // update the fly-through data
        const pointIndex = this.coords._flyRecords.findIndex(record => Cesium.Cartesian3.equals(record.position, cartesian));
        this.coords._flyRecords[pointIndex].position = newCartesian;

        // update the connecting lines
        // remove the existing lines
        const lines = this.viewer.scene.primitives._primitives.filter(p => p.id && p.id.includes("fly_through_line") && p.positions.some(pos => Cesium.Cartesian3.equals(pos, cartesian)));
        lines.forEach(line => this.viewer.scene.primitives.remove(line));
        // redraw the lines with the updated positions
        const positionsArray = this.coords._flyRecords.map(record => record.position);
        const lineColor = this.stateManager.getColorState("default");
        for (let i = 0; i < positionsArray.length - 1; i++) {
            const line = createLineArrowPrimitive([positionsArray[i], positionsArray[i + 1]], "fly_through_line", 10, lineColor, 1, this.cesiumPkg.Primitive);
            this.viewer.scene.primitives.add(line);
        }

        return newCartesian;
    };

    if (this.flags.isEditing) {
        window.addEventListener('keydown', keydownHandler);
    } else {
        window.removeEventListener('keydown', keydownHandler);
    }
}

// function handleDrag(handler) {
//     handler.setInputAction((movement) => handleDragStart.call(this, movement), Cesium.ScreenSpaceEventType.LEFT_DOWN);
//     if (this.flags.isDragMode) {
//         handler.setInputAction(() => handleDragMove.call(this), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
//     } else {
//         // handler.setInputAction(() => hoverToHighlight.call(this), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
//         hoverToHighlight.call(this, handler);
//     }
//     handler.setInputAction(() => handleDragFinish.call(this), Cesium.ScreenSpaceEventType.LEFT_UP);
// }

// function handleDragStart(movement) {
//     const pickedObject = this.viewer.scene.pick(movement.position);
//     const pickedObjectType = getPickedObjectType(pickedObject, "fly_through");

//     if (pickedObjectType === "point") {
//         const point = pickedObject.primitive;
//         this.interactivePrimitives.draggedPoint = point;
//         this.coords.dragStart = point.position.clone();
//         this.coords.dragStartToCanvas = this.viewer.scene.cartesianToCanvasCoordinates(this.coords.dragStart);

//         // Disable camera movement
//         this.viewer.scene.screenSpaceCameraController.enableInputs = false;

//         // highlight the point
//         point.outlineColor = this.stateColor.hover;
//         point.outlineWidth = 2;

//         // highlight the lines
//         handler.setInputAction((movement) => handleDragMove.call(this, movement), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
//     }
// }

// function handleDragMove(movement) {
//     if (!this.interactivePrimitives.draggedPoint) return;

//     // Set drag flag by moving distance threshold
//     const dragThreshold = 5;
//     const moveDistance = Cesium.Cartesian2.distance(this.coords.dragStartToCanvas, movement.endPosition);
//     if (moveDistance > dragThreshold) {
//         this.flags.isDragMode = true;
//     }

//     const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
//     if (!Cesium.defined(cartesian)) return;
//     this.coordinate = cartesian;

//     // Create or update dragging point primitive
//     if (this.interactivePrimitives.dragPoint) {
//         // If dragging point exists, update it
//         this.interactivePrimitives.dragPoint.outlineColor = Cesium.Color.YELLOW;
//         this.interactivePrimitives.dragPoint.outlineWidth = 2;
//         this.interactivePrimitives.dragPoint.position = cartesian;
//         this.interactivePrimitives.dragPoint.id = generateId(cartesian, "fire_trail_point_moving");
//     } else {
//         // If dragging point doesn't exist, create a new one
//         const pointPrimitive = createPointPrimitive(selectedPoint.primitive.position.clone(), Cesium.Color.RED);
//         pointPrimitive.id = generateId(selectedPoint.primitive.position.clone(), "fire_trail_point_moving");
//         this.interactivePrimitives.dragPoint = this.pointCollection.add(pointPrimitive);
//     }

//     // Create or update dragging line primitive
//     if (this.interactivePrimitives.dragLine) {
//         // If dragging line exists, update it
//         this.interactivePrimitives.dragLine.positions = [this.coords.dragStart, cartesian];
//     } else {
//         // If dragging line doesn't exist, create a new one
//         const linePrimitive = createLineArrowPrimitive(
//             [this.coords.dragStart, cartesian],
//             "fire_trail_line_moving",
//             Cesium.Color.YELLOW,
//             1,
//             this.cesiumPkg.Primitive
//         );
//         this.interactivePrimitives.dragLine = this.viewer.scene.primitives.add(linePrimitive);
//     }
// }

// function handleDragFinish() { }

function handleDoubleClickAction(handler) {
    handler.setInputAction((movement) => {
        // pick the object
        const pickedObject = this.viewer.scene.pick(movement.position);
        // get the type of the picked object
        const pickedObjectType = getPickedObjectType(pickedObject, "fly_through");
        if (pickedObjectType === "line") {
            handleAddPoint.call(this, movement); // add a point to the line
        } else if (pickedObjectType === "point") {
            rotateCameraByPoint.call(this, movement); // rotate the camera around the point
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

function handleAddPoint(movement) {
    console.log("add point")
    // TODO: add a point to the line

}

function rotateCameraByPoint(movement) {
    console.log("rotate")
    // TODO: rotate the camera automatically in a circle horizontally
}

function handleRemovePoint(movement) {
    const pickedObject = this.viewer.scene.pick(movement.position);
    const pickedObjectType = getPickedObjectType(pickedObject, "fly_through");

    if (pickedObjectType === "point") {
        const confirm = window.confirm("Are you sure you want to remove this point?");
        if (!confirm) return;

        const point = pickedObject.primitive;

        const pointPosition = point._position.clone();

        this.pointCollection.remove(pickedObject.primitive);

        // find neighbouring line/lines by pointPosition
        const lines = this.viewer.scene.primitives._primitives.filter(p => p.id && p.id.includes("fly_through_line") && p.positions.some(pos => Cesium.Cartesian3.equals(pos, pointPosition)));
        // remove the neighbouring line/lines
        lines.forEach(line => this.viewer.scene.primitives.remove(line));

        // update fly-through data
        const pointPositionIndex = this.coords._flyRecords.findIndex(record => Cesium.Cartesian3.equals(record.position, pointPosition));
        this.coords._flyRecords.splice(pointPositionIndex, 1);

        // create reconnecting lines
        if (pointPositionIndex === 0 || pointPositionIndex === this.coords._flyRecords.length) return; // do not create lines for the first and last points
        const reconnectPos1 = this.coords._flyRecords[pointPositionIndex - 1].position
        const reconnectPos2 = this.coords._flyRecords[pointPositionIndex].position;
        const reconnectLine = createLineArrowPrimitive([reconnectPos1, reconnectPos2], "fly_through_line", 10, Cesium.Color.YELLOWGREEN, 1, this.cesiumPkg.Primitive);
        this.viewer.scene.primitives.add(reconnectLine);
    }

}


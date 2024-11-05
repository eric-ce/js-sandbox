
import * as Cesium from "cesium";
import {
    updatePointerOverlay,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    createLabelPrimitive,
    generateId,
    calculateClampedDistance,
    getPickedObjectType,
} from "../../helper/helper.js";

/***********************
 * MOUSE MOVE FEATURES *
 ***********************/
/**
 * Main method to handle mouse move events in the FireTrail tool.
 * @param {{endPosition: Cesium.Cartesian2}} movement - The mouse movement data.
 */
export function handleFireTrailMouseMove(movement) {
    const cartesian = this.viewer.scene.pickPosition(movement.endPosition);
    if (!Cesium.defined(cartesian)) return;

    // Update the current coordinate and pick objects
    this.coordinate = cartesian;
    const pickedObjects = this.viewer.scene.drillPick(movement.endPosition, 3, 1, 1);

    // Update the pointer overlay based on the picked objects
    pickedObjects && updatePointerOverlay(this.viewer, this.pointerOverlay, cartesian, pickedObjects);

    // Determine the appropriate action based on tool state
    determineMoveAction.call(this, pickedObjects, cartesian);
}

/**
 * Determines the action based on the current state of the tool.
 * @param {Array} pickedObjects - Array of objects picked at the current mouse position.
 * @param {Cesium.Cartesian3} cartesian - The current Cartesian position of the mouse.
 */
function determineMoveAction(pickedObjects, cartesian) {
    const isMeasuring = this.coords.cache.length > 0 && !this.flags.isMeasurementComplete;

    if (isMeasuring) {
        handleActiveMeasure.call(this, cartesian);
    } else {
        handleHoverHighlighting.call(this, pickedObjects[0]);
    }
}

/**
 * The default method to handle mouse movement during measure 
 * @param {Cesium.Cartesian3} cartesian 
 */
function handleActiveMeasure(cartesian) {
    // Calculate the distance between the last selected point and the current cartesian position
    const lastPointCartesian = this.coords.cache[this.coords.cache.length - 1]

    // remove moving line and label primitives
    this.removeMovingPrimitives();
    // create line primitive
    const movingLineGeometryInstance = createClampedLineGeometryInstance([lastPointCartesian, cartesian], "fire_trail_line_moving");
    const movingLinePrimitive = createClampedLinePrimitive(movingLineGeometryInstance, Cesium.Color.YELLOW, this.cesiumPkg.GroundPolylinePrimitive);
    const movingLine = this.viewer.scene.primitives.add(movingLinePrimitive);
    this.interactivePrimitives.movingPolylines.push(movingLine);

    // create label primitive
    const { distance } = calculateClampedDistance(lastPointCartesian, cartesian, this.viewer.scene, 4);
    const midPoint = Cesium.Cartesian3.midpoint(lastPointCartesian, cartesian, new Cesium.Cartesian3());
    const label = createLabelPrimitive(lastPointCartesian, cartesian, distance);
    label.showBackground = false;
    label.show = this.flags.isShowLabels;
    label.id = generateId(midPoint, "fire_trail_label_moving");
    const movingLabel = this.labelCollection.add(label);
    this.interactivePrimitives.movingLabels.push(movingLabel);
}

/**
 * Hover to the clamped line to highlight it when the mouse move over it
 * @param {*} pickedObjects - the picked objects from the drillPick method
 */
function handleHoverHighlighting(pickedObject) {
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    // reset highlighting
    const resetHighlighting = () => {
        const { hoveredLine, selectedLine, selectedLines, hoveredPoint, hoveredLabel } = this.interactivePrimitives;
        // when mouse move out of the line, reset the line color
        // Reset hovered line if it's not the selected line
        if (
            hoveredLine &&
            hoveredLine !== selectedLine   // don't change selected line color
            // !hoveredLine.isSubmitted     // don't change submitted line color
        ) {
            let colorToSet;
            if (hoveredLine.isSubmitted) {
                colorToSet = 'submitted';
            } else if (selectedLines.includes(hoveredLine)) {
                colorToSet = 'select';
            } else {
                colorToSet = 'default';
            }
            this.changeLinePrimitiveColor(hoveredLine, colorToSet);
            this.interactivePrimitives.hoveredLine = null;
        }

        // Reset hover point
        if (hoveredPoint) {
            hoveredPoint.outlineColor = Cesium.Color.RED;
            hoveredPoint.outlineWidth = 0;
            this.interactivePrimitives.hoveredPoint = null;
        }
        // Reset hover label
        if (hoveredLabel) {
            hoveredLabel.fillColor = Cesium.Color.WHITE;
            this.interactivePrimitives.hoveredLabel = null;
        }
    };
    resetHighlighting();   // reset highlighting, need to reset before highlighting

    switch (pickedObjectType) {
        case "line":
            const line = pickedObject.primitive;
            if (line && line !== this.interactivePrimitives.selectedLine) {
                this.changeLinePrimitiveColor(line, 'hover');
                this.interactivePrimitives.hoveredLine = line;
            }
            break;
        case "point":
            const point = pickedObject.primitive;
            if (point) {
                point.outlineColor = this.stateColors.hover;
                point.outlineWidth = 2;
                this.interactivePrimitives.hoveredPoint = point;
            }
            break;
        case "label":
            const label = pickedObject.primitive;
            if (label) {
                label.fillColor = this.stateColors.hover;
                this.interactivePrimitives.hoveredLabel = label;
            }
            break;
        default:
            break;
    }
}

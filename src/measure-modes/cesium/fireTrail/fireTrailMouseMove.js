
import * as Cesium from "cesium";
import {
    updatePointerOverlay,
    createLabelPrimitive,
    generateId,
    calculateClampedDistance,
    getPickedObjectType,
    createGroundPolylinePrimitive,
} from "../../lib/helper/cesiumHelper.js";

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
    // Determine the reference point based on measurement direction
    let referencePointCartesian = null;
    if (this.flags.isReverse) {
        referencePointCartesian = this.coords.cache[0];
    } else {
        referencePointCartesian = this.coords.cache[this.coords.cache.length - 1];
    }

    // Remove existing moving primitives
    this.removeMovingPrimitives();

    // Create current line primitive
    const currentLinePrimitive = createGroundPolylinePrimitive(
        [referencePointCartesian, cartesian],
        "fire_trail_line_moving",
        Cesium.Color.YELLOW,
        this.cesiumPkg.GroundPolylinePrimitive
    )
    const addedLinePrimitive = this.viewer.scene.primitives.add(currentLinePrimitive);
    this.interactivePrimitives.movingPolylines.push(addedLinePrimitive);

    // Calculate distance and create label
    const { distance: calculatedDistance } = calculateClampedDistance(
        referencePointCartesian,
        cartesian,
        this.viewer.scene,
        4
    );
    const labelPosition = Cesium.Cartesian3.midpoint(
        referencePointCartesian,
        cartesian,
        new Cesium.Cartesian3()
    );
    const distanceLabel = createLabelPrimitive(
        referencePointCartesian,
        cartesian,
        calculatedDistance
    );
    distanceLabel.showBackground = false;
    distanceLabel.show = this.flags.isShowLabels;
    distanceLabel.id = generateId(labelPosition, "fire_trail_label_moving");
    const addedLabelPrimitive = this.labelCollection.add(distanceLabel);
    this.interactivePrimitives.movingLabels.push(addedLabelPrimitive);
}

/**
 * Hover to the clamped line to highlight it when the mouse move over it
 * @param {*} pickedObjects - the picked objects from the drillPick method
 */
function handleHoverHighlighting(pickedObject) {
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    // reset highlighting
    const resetHighlighting = () => {
        const { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel } = this.interactivePrimitives;
        // when mouse move out of the line, reset the line color
        // Reset hovered line if it's not the selected line
        if (
            hoveredLine &&
            hoveredLine !== addModeLine   // don't change selected line color
            // !hoveredLine.isSubmitted     // don't change submitted line color
        ) {
            let colorToSet;
            if (hoveredLine.isSubmitted) {
                colorToSet = 'submitted';
            } else if (selectedLines.includes(hoveredLine)) {
                colorToSet = 'select';
            }
            else if (hoveredLine.feature) {   // it is line from layer
                colorToSet = this.stateColors.layerColor  // set the original color back
            }
            else {
                colorToSet = 'default';
            }

            if (!colorToSet) console.error('color is not defined');

            this.changeLinePrimitiveColor(hoveredLine, colorToSet);
            this.interactivePrimitives.hoveredLine = null;
            this.stateColors.layerColor = null;
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
            if (line && line !== this.interactivePrimitives.addModeLine) {
                if (line.feature) {    // it is line from layer
                    if (!this.stateColors.layerColor) {
                        const layerColor = line.appearance.material.uniforms.color.clone();  // save the color for the layer line into Primitive
                        if (layerColor) {
                            const { red, green, blue, alpha } = layerColor; // get the color values
                            this.stateColors.layerColor = new Cesium.Color(red, green, blue, alpha);  // save the color, NEED TO CALLED CESIUM COLOR AGAIN TO AVOID invalid value
                        }
                    }
                }
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

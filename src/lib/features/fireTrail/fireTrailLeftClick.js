
import * as Cesium from "cesium";
import {
    formatDistance,
    editableLabel,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    calculateClampedDistance,
    calculateClampedDistanceFromArray,
    getPickedObjectType,
    getPrimitiveByPointPosition,
    generateIdByTimestamp,
    showCustomNotification,
} from "../../helper/helper.js";

/***********************
 * LEFT CLICK FEATURES *
 ***********************/
/**
 * The method to handle left-click Cesium handler events 
 *
 * @param {{position: Cesium.Cartesian2}} movement - The mouse movement data.
 * @returns 
 */
export function handleFireTrailLeftClick(movement) {
    // const cartesian = this.viewer.scene.pickPosition(movement.position);
    // if (!Cesium.defined(cartesian)) return;
    // this.coordinate = cartesian;

    const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    determineClickAction.call(this, pickedObjectType, pickedObject);
}

/**
 * Determines the action based on the type of clicked primitive.
 * @param {string} pickedObjectType - The type of the clicked primitive.
 * @param {Object} pickedObject - The clicked primitive object.
 */
function determineClickAction(pickedObjectType, pickedObject) {
    switch (pickedObjectType) {
        case "label":
            handleLabelClick.call(this, pickedObject);
            break;
        case "point":
            handlePointClick.call(this, pickedObject);
            break;
        case "line":
            handleLineClick.call(this, pickedObject);
            break;
        case "other":
            break;
        default:
            handleDefaultClick.call(this);
            break;
    }
}

/**
 * Handles label click actions.
 * @param {Object} pickedObject - The clicked primitive object.
 */
function handleLabelClick(pickedObject) {
    if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
        editableLabel(this.viewer.container, pickedObject.primitive);
    }
}

/**
 * Handles point click actions.
 * @param {Object} pickedObject - The clicked primitive object.
 */
function handlePointClick(pickedObject) {
    const pointPrimitive = pickedObject.primitive;

    if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {    // When the measure is complete and not in add mode
        selectFireTrail.call(this, pointPrimitive);
    }

    if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {    // it is during measuring
        removeActionByPointMeasuring.call(this, pointPrimitive);
    }

    //TODO:  feat: picked up first or last point and continue that group coordinate measure
}

/**
 * Handles line click actions.
 * @param {Object} pickedObject - The clicked primitive object.
 */
function handleLineClick(pickedObject) {
    const linePrimitive = pickedObject.primitive;

    if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
        selectFireTrail.call(this, linePrimitive);
    }
}

/**
 * Handles default click actions when no specific primitive type is identified.
 */
function handleDefaultClick() {
    if (!this.flags.isDragMode && !this.flags.isAddMode) {
        startMeasure.call(this);
    }
    if (this.flags.isAddMode) {
        addAction.call(this, this.interactivePrimitives.selectedLine);
    }
}

// remove point during measuring
function removeActionByPointMeasuring(pointPrimitive) {
    // the drawing one should be the latest one
    const pointPosition = pointPrimitive.position.clone();
    const group = this.coords.groups[this.coords.groups.length - 1];

    // compare if the pickpoint is from the latest one in group that is still drawing
    const isFromMeasuring = group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition));

    if (isFromMeasuring) {
        // find line and label primitives by the point position
        const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
            pointPosition,
            "annotate_fire_trail",
            this.viewer.scene,
            this.pointCollection,
            this.labelCollection
        );

        // Remove relevant point, line, and label primitives
        this.pointCollection.remove(pointPrimitive);
        linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
        labelPrimitives.forEach(l => this.labelCollection.remove(l));

        // Remove moving line and label primitives
        this.removeMovingPrimitives();

        // Create reconnect primitives
        const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

        this._createReconnectPrimitives(neighbourPositions, { coordinates: this.coords.cache }, true);

        // Update coords cache
        const pointIndex = this.coords.cache.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, pointPosition)
        );
        if (pointIndex !== -1) this.coords.cache.splice(pointIndex, 1);

        // Update following label primitives
        const followingPositions = this.coords.cache.slice(pointIndex);
        const followingIndex = pointIndex;
        this._updateFollowingLabelPrimitives(
            followingPositions,
            followingIndex,
            { coordinates: this.coords.cache }
        );

        if (group.coordinates.length === 0) {
            this.flags.isMeasurementComplete = true; // When removing the only point, consider the measure ended
        }
    }
}

function startMeasure() {
    if (this.flags.isMeasurementComplete) {
        this.flags.isMeasurementComplete = false;
    }

    // Initiate cache if it is empty, start a new group and assign cache to it
    if (this.coords.cache.length === 0) {
        // Create a new group with trailId and coordinates
        const newGroup = {
            trailId: generateIdByTimestamp(),
            coordinates: [],
            labelNumberIndex: this.coords.groupCounter, // Assign unique labelNumberIndex to the group
        };
        this.coords.groups.push(newGroup);
        // Link cache to the coordinates array of the new group
        this.coords.cache = newGroup.coordinates;
        this.coords.groupCounter++;
    }

    // reset select to highlight to default color
    if (this.coords.groupToSubmit && this.coords.groupToSubmit?.coordinates) {
        const lines = this.lookupLinesByPositions(this.coords.groupToSubmit.coordinates);
        lines.forEach(line => {
            if (!line.isSubmitted) {    // don't change submitted line color
                // Reset line color
                this.changeLinePrimitiveColor(line, 'default');
            }
        });
    }

    // Create point primitive
    const isNearPoint = this.coords.groups
        .flatMap(group => group.coordinates)
        .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);

    let firstPointPosition;
    if (!isNearPoint) {
        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "fire_trail_point_pending");
        const pointPrimitive = this.pointCollection.add(point);
        firstPointPosition = pointPrimitive.position.clone();
        // Update coordinate data cache
        this.coords.cache.push(this.coordinate);
    }

    if (this.coords.cache.length > 1) {
        continueMeasure.call(this, firstPointPosition);
    }
}

function continueMeasure(position) {
    // Remove the moving line and label primitives
    this.removeMovingPrimitives();

    //TODO: the conitnue measure logic should handle the case either it is the first point or the last point

    const group = this.coords.groups.find(group => group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, position)));

    const prevIndex = group.coordinates.length - 2;
    const currIndex = group.coordinates.length - 1;
    const prevPointCartesian = group.coordinates[prevIndex];
    const currPointCartesian = group.coordinates[currIndex];

    // Create line primitive
    const lineGeometryInstance = createClampedLineGeometryInstance(
        [prevPointCartesian, currPointCartesian],
        "fire_trail_line_pending"
    );
    const linePrimitive = createClampedLinePrimitive(
        lineGeometryInstance,
        Cesium.Color.YELLOWGREEN,
        this.cesiumPkg.GroundPolylinePrimitive
    );
    linePrimitive.isSubmitted = false;
    this.viewer.scene.primitives.add(linePrimitive);

    // Create label primitive
    const { distance } = calculateClampedDistance(
        prevPointCartesian,
        currPointCartesian,
        this.viewer.scene,
        4
    );
    const midPoint = Cesium.Cartesian3.midpoint(
        prevPointCartesian,
        currPointCartesian,
        new Cesium.Cartesian3()
    );

    // FIXME: getLabelProperties is less reusbale, 
    // consider lookup outside the function and pass necessary parameter to genereate that label properties
    const { currentLetter, labelNumberIndex } = this._getLabelProperties(
        this.coordinate,
        this.coords.cache,
    );

    const label = createLabelPrimitive(
        prevPointCartesian,
        currPointCartesian,
        distance
    );
    label.show = this.flags.isShowLabels;
    label.showBackground = this.flags.isShowLabels;
    label.id = generateId(midPoint, "fire_trail_label_pending");
    label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
    this.labelCollection.add(label);
}

function addAction(linePrimitive) {
    const linePositions = linePrimitive.geometryInstances.geometry._positions;

    // Find the group that contains the line positions
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, linePositions[0]))
    );
    if (!group || group.coordinates.length === 0) return;

    // Find the indices of the line positions in the group's coordinates
    const linePositionIndex1 = group.coordinates.findIndex(cart =>
        Cesium.Cartesian3.equals(cart, linePositions[0])
    );
    const linePositionIndex2 = group.coordinates.findIndex(cart =>
        Cesium.Cartesian3.equals(cart, linePositions[1])
    );
    const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);

    // Check if there is already a point near the coordinate to avoid duplicates
    const isNearPoint = this.coords.groups.some(g =>
        g.coordinates.some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3)
    );

    if (!isNearPoint) {
        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
        point.id = generateId(this.coordinate, "fire_trail_point");
        this.pointCollection.add(point);

        // Insert the new coordinate into the group's coordinates at the correct position
        group.coordinates.splice(positionIndex + 1, 0, this.coordinate);
    }

    // Create line and label primitives
    const neighbourPositions = this.findNeighbourPosition(
        group.coordinates[positionIndex + 1],
        group
    );

    // Remove selected line and its label
    this.viewer.scene.primitives.remove(linePrimitive);
    const midPoint = Cesium.Cartesian3.midpoint(
        linePositions[0],
        linePositions[1],
        new Cesium.Cartesian3()
    );
    const existedLabel = this.labelCollection._labels.find(l =>
        l.id &&
        l.id.includes("fire_trail_label") &&
        Cesium.Cartesian3.equals(l.position, midPoint)
    );
    if (existedLabel) this.labelCollection.remove(existedLabel);

    if (neighbourPositions.length === 3) {
        neighbourPositions.forEach((pos, i) => {
            // Create line primitives
            if (i < neighbourPositions.length - 1) {
                const lineGeometryInstance = createClampedLineGeometryInstance(
                    [pos, neighbourPositions[i + 1]],
                    "fire_trail_line"
                );
                const newLinePrimitive = createClampedLinePrimitive(
                    lineGeometryInstance,
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                );
                newLinePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(newLinePrimitive);

                // Create label primitives
                const { distance } = calculateClampedDistance(
                    pos,
                    neighbourPositions[i + 1],
                    this.viewer.scene,
                    4
                );
                const newMidPoint = Cesium.Cartesian3.midpoint(
                    pos,
                    neighbourPositions[i + 1],
                    new Cesium.Cartesian3()
                );
                const label = createLabelPrimitive(pos, neighbourPositions[i + 1], distance);
                label.show = this.flags.isShowLabels;
                label.showBackground = this.flags.isShowLabels;
                label.id = generateId(newMidPoint, "fire_trail_label");

                // Use the updated _getLabelProperties method
                const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                    neighbourPositions[i + 1],
                    group.coordinates
                );
                label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
                this.labelCollection.add(label);
            }
        });
    }

    // Update following label primitives
    const followingIndex = positionIndex + 1;
    const followingPositions = group.coordinates.slice(positionIndex + 1);
    this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

    // Recalculate distances and total distance
    const { distances, totalDistance } = calculateClampedDistanceFromArray(
        group.coordinates,
        this.viewer.scene,
        4
    );

    // Update total distance label
    const totalLabel = this.labelCollection._labels.find(
        label =>
            label.id &&
            label.id.includes("fire_trail_label_total") &&
            Cesium.Cartesian3.equals(
                label.position,
                group.coordinates[group.coordinates.length - 1]
            )
    );
    if (totalLabel) {
        totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        totalLabel.position = group.coordinates[group.coordinates.length - 1];
    }

    // update selected line color
    this.updateSelectedLineColor(group);

    // Update log records
    this.updateMultiDistancesLogRecords(distances, totalDistance);
    this.coords.groupToSubmit = group;

    // Reset flags
    this.flags.isAddMode = false;
    this.interactivePrimitives.selectedLine = null;
}

function selectFireTrail(primitive) {
    let primitivePosition = [];
    if (primitive.geometryInstances) { // if it is line primitive
        primitivePosition = primitive.geometryInstances.geometry._positions;
    } else {  // it is point primitive
        primitivePosition = [primitive.position];
    }

    if (primitivePosition && primitivePosition.length > 0) {
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePosition[0]))
        );

        // show notification
        showCustomNotification(`selected line: ${group.trailId}`, this.viewer.container)

        // Reset previous selection
        if (this.interactivePrimitives.selectedLines.length > 0) {
            // use selectedLines that is before update to look up previous selected lines
            // lookup the previous selected group
            const pos = this.interactivePrimitives.selectedLines[0].geometryInstances.geometry._positions;
            const prevGroup = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pos[0]))
            );
            // lookup the previous selected lines
            const prevLines = this.lookupLinesByPositions(prevGroup.coordinates);
            // reset the previous selected lines
            prevLines.forEach(line => {
                // don't change submitted line color
                if (!line.isSubmitted) {    // don't change submitted line color
                    // reset line color
                    this.changeLinePrimitiveColor(line, 'default');
                }
            });
        }

        // Highlight the current selected lines
        const lines = this.lookupLinesByPositions(group.coordinates);
        lines.forEach(line => {
            // don't change submitted line color
            if (!line.isSubmitted) {    // don't change submitted line color
                // reset line color
                this.changeLinePrimitiveColor(line, 'select');
            }
        });

        // Update selectedGroup to current group's coordinates
        this.coords.groupToSubmit = group;
        // Update selected lines
        this.interactivePrimitives.selectedLines = lines;
    }
}

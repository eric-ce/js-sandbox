import * as Cesium from "cesium";
import {
    formatDistance,
    generateId,
    calculateClampedDistanceFromArray,
    getPickedObjectType,
    getPrimitiveByPointPosition,
    showCustomNotification,
} from "../../helper/helper.js";

/***********************
 * DOUBLE CLICK ACTION *
 ***********************/
export function handleFireTrailDoubleClick(movement) {
    // don't allow middle click when during other actions
    if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

    const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    // Handle different scenarios based on the clicked primitive type and the state of the tool
    determineDoubleClickAction.call(this, pickedObject, pickedObjectType);
}

function determineDoubleClickAction(pickedObject, pickedObjectType) {
    switch (pickedObjectType) {
        case "point":
            handlePointDoubleClick.call(this, pickedObject);
            break;
        case "line":
            handleLineDoubleClick.call(this, pickedObject);
            break;
    }
}

function handlePointDoubleClick(pickedObject) {
    const pointPrimitive = pickedObject.primitive;
    removeActionByPoint.call(this, pointPrimitive);
}

function handleLineDoubleClick(pickedObject) {
    const linePrimitive = pickedObject.primitive;
    setAddModeByLine.call(this, linePrimitive);
}

function removeActionByPoint(pointPrimitive) {
    // Prompt the user for confirmation before removing the point
    const confirmRemoval = confirm("Do you want to remove this point?");
    if (!confirmRemoval) {
        return; // User canceled the removal; do nothing
    }

    const pointPosition = pointPrimitive.position.clone();

    const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
        pointPosition,
        "annotate_fire_trail",
        this.viewer.scene,
        this.pointCollection,
        this.labelCollection
    );

    // Remove point, line, and label primitives
    this.pointCollection.remove(pointPrimitive);
    linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
    labelPrimitives.forEach(l => this.labelCollection.remove(l));

    // Remove moving line and label primitives
    this.removeMovingPrimitives();

    if (this.coords.groups.length > 0 && this.flags.isMeasurementComplete) {
        // When the measure is ended
        const groupIndex = this.coords.groups.findIndex(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
        );
        const group = this.coords.groups[groupIndex];

        // Remove total label
        const lastPoint = group.coordinates[group.coordinates.length - 1];
        const targetTotalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
                Cesium.Cartesian3.equals(label.position, lastPoint)
        );

        // Create reconnect primitives
        const neighbourPositions = this.findNeighbourPosition(pointPosition, group);

        this._createReconnectPrimitives(neighbourPositions, group);

        // Update group's coordinates
        const pointIndex = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, pointPosition)
        );
        if (pointIndex !== -1) group.coordinates.splice(pointIndex, 1);

        // Update following label primitives
        const followingPositions = group.coordinates.slice(pointIndex);
        const followingIndex = pointIndex;
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

        const { distances, totalDistance } = calculateClampedDistanceFromArray(
            group.coordinates,
            this.viewer.scene,
            4
        );

        // Update total distance label
        if (targetTotalLabel) {
            const newLastPoint = group.coordinates[group.coordinates.length - 1];
            targetTotalLabel.id = generateId(newLastPoint, "fire_trail_label_total");
            targetTotalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            targetTotalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            targetTotalLabel.position = newLastPoint;
        }

        // Update selected line color
        this.updateSelectedLineColor(group);

        // Log distance result
        this.updateMultiDistancesLogRecords(distances, totalDistance);
        this.coords.groupToSubmit = group;

        // Remove point and total label when there is only one point left in the group
        if (group.coordinates.length === 1) {
            // Remove the point and the total label
            const targetPoint = this.pointCollection._pointPrimitives.find(
                p => p && Cesium.Cartesian3.equals(p.position, group.coordinates[0])
            );
            if (targetPoint) this.pointCollection.remove(targetPoint);
            const targetTotalLabel = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.includes("fire_trail_label_total") &&
                    Cesium.Cartesian3.equals(label.position, group.coordinates[0])
            );
            if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

            // Remove the group from coords.groups
            this.coords.groups.splice(groupIndex, 1);

            // Log distance result (empty distances and totalDistance)
            this.updateMultiDistancesLogRecords([], 0);
            this.coords.groupToSubmit = null;

            // reset selected lines
            this.interactivePrimitives.selectedLines = [];
        }
    }
}


function setAddModeByLine(linePrimitive) {
    // Reset previous hovered line if any
    if (
        this.interactivePrimitives.hoveredLine &&
        this.interactivePrimitives.hoveredLine !== linePrimitive
    ) {
        resetLineColor(this.interactivePrimitives.hoveredLine);
        this.changeLinePrimitiveColor(this.interactivePrimitives.hoveredLine, 'default');
        this.interactivePrimitives.hoveredLine = null;
    }

    // Reset previous selected line if different
    if (
        this.interactivePrimitives.selectedLine &&
        this.interactivePrimitives.selectedLine !== linePrimitive
    ) {
        // resetLineColor(this.interactivePrimitives.selectedLine);
        this.changeLinePrimitiveColor(this.interactivePrimitives.selectedLine, 'default');
    }

    // Change line color to indicate selection
    this.changeLinePrimitiveColor(linePrimitive, 'add');
    this.interactivePrimitives.selectedLine = linePrimitive;

    // Set flag to indicate add mode
    if (this.interactivePrimitives.selectedLine) {
        this.flags.isAddMode = true;
        showCustomNotification('you have entered add line mode', this.viewer.container);
    }
}

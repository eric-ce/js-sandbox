import * as Cesium from "cesium";
import {
    formatDistance,
    generateId,
    calculateClampedDistanceFromArray,
    getPickedObjectType,
    getPrimitiveByPointPosition,
    showCustomNotification,
    positionKey,
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

/**
 * Removes the specified point and its associated primitives from the fire trail.
 * Handles the removal of related lines, labels, and updates the log accordingly.
 * @param {Cesium.Primitive} pointPrimitive - The point primitive to be removed.
 */
async function removeActionByPoint(pointPrimitive) {
    // Prompt the user for confirmation before removing the point
    const confirmRemoval = confirm("Do you want to remove this point?");
    if (!confirmRemoval) {
        return; // User canceled the removal; do nothing
    }

    // Clone the position of the point to avoid mutating the original
    const pointPosition = pointPrimitive.position.clone();

    // Retrieve associated line and label primitives based on the point's position
    const { linePrimitives, labelPrimitives } = getPrimitiveByPointPosition(
        pointPosition,
        "annotate_fire_trail",
        this.viewer.scene,
        this.pointCollection,
        this.labelCollection
    );

    // Remove the point, associated lines, and associated labels primitives
    this.pointCollection.remove(pointPrimitive);
    linePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
    labelPrimitives.forEach(l => this.labelCollection.remove(l));

    // Remove any moving line and label primitives
    this.removeMovingPrimitives();

    // Proceed only if there are existing groups and the measurement is complete
    if (this.coords.groups.length > 0 && this.flags.isMeasurementComplete) {    // when the measure is complete
        // Find the group that contains the point being removed
        const groupIndex = this.coords.groups.findIndex(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
        );
        // Exit if no matching group is found
        if (groupIndex === -1) return;

        const group = this.coords.groups[groupIndex];

        // Identify the last point in the group to update the total label later
        const lastPoint = group.coordinates[group.coordinates.length - 1];

        // Find the total label associated with the last point
        const targetTotalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
                Cesium.Cartesian3.equals(label.position, lastPoint)
        );

        // Identify neighboring positions to reconnect the remaining points, lines, and labels
        const neighbourPositions = this.findNeighbourPosition(pointPosition, group);
        this._createReconnectPrimitives(neighbourPositions, group);

        // Remove the point from the group's coordinates
        const pointIndex = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, pointPosition)
        );
        if (pointIndex !== -1) group.coordinates.splice(pointIndex, 1);

        // Update labels for the remaining points after removal
        const followingPositions = group.coordinates.slice(pointIndex);
        const followingIndex = pointIndex;
        this._updateFollowingLabelPrimitives(followingPositions, followingIndex, group);

        // Calculate the updated distances and total distance after removal
        const { distances, totalDistance } = calculateClampedDistanceFromArray(
            group.coordinates,
            this.viewer.scene,
            4
        );

        // Update the total label
        if (targetTotalLabel) {
            const newLastPoint = group.coordinates[group.coordinates.length - 1];
            targetTotalLabel.id = generateId(newLastPoint, "fire_trail_label_total");
            targetTotalLabel.text = `Total: ${formatDistance(totalDistance)}`;
            targetTotalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
            targetTotalLabel.position = newLastPoint;
        }

        // Reset the submission status of all associated lines
        const lines = this.lookupLinesByPositions(group.coordinates)
        lines.forEach(line => line.isSubmitted = false);

        // Update the color of selected lines to indicate selection change
        this.updateSelectedLineColor(group);

        // If the group still has more than one coordinate, update the log records
        if (group.coordinates.length > 1) {
            this.updateMultiDistancesLogRecords(distances, totalDistance);
            this.coords.groupToSubmit = group;
        }

        // If only one coordinate remains, perform additional cleanup
        if (group.coordinates.length === 1) {
            // Remove the last remaining point from the point collection
            const lastPoint = this.pointCollection._pointPrimitives.find(
                p => p && Cesium.Cartesian3.equals(p.position, group.coordinates[0])
            );
            if (lastPoint) this.pointCollection.remove(lastPoint);

            // Remove the total label
            const targetTotalLabel = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.includes("fire_trail_label_total") &&
                    Cesium.Cartesian3.equals(label.position, group.coordinates[0])
            );
            if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);

            // check this.sentGroupKeys Set to see if the point was existed in the set
            if (this.sentGroupKeys.size > 0) {
                const posKey = positionKey(group.coordinates[0])

                // Determine if the position key exists in any submitted groupKeys
                const isLineSubmittedBefore = Array.from(this.sentGroupKeys).some(groupKey =>
                    groupKey.split('|').includes(posKey)
                );

                // If the line was submitted before, log the removal action
                if (isLineSubmittedBefore) {
                    const payload = {
                        trailId: group.trailId,
                        coordinates: "",
                        comp_length: 0.0,
                    }
                    try {
                        // Submit the removal action and handle the response
                        const response = await this.actionLogger("annotateTracks_V5", payload);
                        console.log("✅ Remove action submitted:", response);
                        // Update the log with a successful removal status
                        this.logRecordsCallback({ submitStatus: `${group.trailId} Remove From Server Success` });
                    } catch (error) {
                        console.error("❌ Error logging action:", error);
                        alert(`Fire Trail ${group.trailId} Submission Failed`);
                        // Update the log with a failed removal status
                        this.logRecordsCallback({ submitStatus: `${group.trailId} Remove From Server Failed` });
                    }
                }
            }

            // Clear the group's coordinates as all points have been removed
            group.coordinates = [];

            // Reset submission-related properties to their default states
            this.coords.groupToSubmit = null;
            this.interactivePrimitives.selectedLines = [];

            // Log the removal of the trail
            this.logRecordsCallback(`${group.trailId} Removed`);
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

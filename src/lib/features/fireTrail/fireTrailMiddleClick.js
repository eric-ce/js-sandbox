import * as Cesium from "cesium";
import {
    calculateClampedDistanceFromArray,
    getPickedObjectType,
    positionKey,
} from "../../helper/helper.js";

/***********************
 * DOUBLE CLICK ACTION *
 ***********************/
export function handleFireTrailMiddleClick(movement) {
    // don't allow middle click when during other actions
    if (!this.flags.isMeasurementComplete || this.flags.isAddMode || this.flags.isDragMode) return;

    const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    // Handle different scenarios based on the clicked primitive type and the state of the tool
    determineMiddleClickAction.call(this, pickedObject, pickedObjectType);
}

function determineMiddleClickAction(pickedObject, pickedObjectType) {
    switch (pickedObjectType) {
        case "point":
            handlePointMiddleClick.call(this, pickedObject);
            break;
        case "line":
            handleLineMiddleClick.call(this, pickedObject);
            break;
    }
}

function handlePointMiddleClick(pickedObject) {
    const pointPrimitive = pickedObject.primitive;
    removeActionByPoint.call(this, pointPrimitive);
}

function handleLineMiddleClick(pickedObject) {
    const linePrimitive = pickedObject.primitive;
    removeLineSetByPrimitive.call(this, linePrimitive, "line");
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
    const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
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
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
        );
        // Exit if no matching group is found
        if (!group) return;

        // Identify neighboring positions to reconnect the remaining points, lines, and labels
        const neighbourPositions = this.findNeighbourPosition(pointPosition, group);
        this._createReconnectPrimitives(neighbourPositions, group);

        // Remove the point from the group's coordinates
        const pointIndex = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, pointPosition)
        );
        if (pointIndex === -1) return;

        const isRemoveLastPoint = group.coordinates.length - 1 === pointIndex;
        if (isRemoveLastPoint) {
            // clone the position
            const lastPoint = group.coordinates[pointIndex].clone();
            // find the total label and remove it
            const targetTotalLabel = this.labelCollection._labels.find(
                label =>
                    label.id &&
                    label.id.includes("fire_trail_label_total") &&
                    Cesium.Cartesian3.equals(label.position, lastPoint)
            );
            if (targetTotalLabel) this.labelCollection.remove(targetTotalLabel);
        }

        // Remove the point from the group's coordinates
        group.coordinates.splice(pointIndex, 1);

        // update or create labels for the group
        this.updateOrCreateLabels(group);

        // Calculate the updated distances and total distance after removal
        const { distances, totalDistance } = calculateClampedDistanceFromArray(
            group.coordinates,
            this.viewer.scene,
            4
        );

        // Update or create the total label for the group
        this.updateOrCreateTotalLabel(group, totalDistance);

        // Reset the submission status of all associated lines
        const lines = this.findLinesByPositions(group.coordinates)
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
                        coordinates: [],
                        comp_length: 0.0,
                        email: this.app?.currentUser?.sessions?.navigator?.userId || "",
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


/**
 * Remove the line set by the point or line primitive
 * @param {Cesium.Primitive} primitive - The primitive to lookup group coordinates
 * 
 */
async function removeLineSetByPrimitive(primitive, primitiveType) {
    let primitivePosition;
    if (primitiveType === "point") {
        primitivePosition = primitive.position;
    } else if (primitiveType === "line") {
        primitivePosition = primitive.positions[0];
    }

    // Find the index of the group that contains the primitive position
    const groupIndex = this.coords.groups.findIndex(group =>
        group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePosition))
    );
    if (groupIndex === -1) return; // Error handling: no group found

    const group = this.coords.groups[groupIndex];

    // Confirm removal with the user
    if (!confirm(`Do you want to remove the ENTIRE fire trail ${group.trailId}?`)) return;

    // Retrieve associated primitives for the group
    const { pointPrimitives, linePrimitives, labelPrimitives } = this.findPrimitivesByPositions(group.coordinates);

    // Reset color of previously selected lines if they are not submitted
    this.interactivePrimitives.selectedLines.forEach(line => {
        if (!line.isSubmitted) {
            this.changeLinePrimitiveColor(line, 'default');
        }
    });

    // Update selected lines to the current group's line primitives and update their colors
    this.interactivePrimitives.selectedLines = linePrimitives;
    this.updateSelectedLineColor(group);

    // Remove point, line, and label primitives
    pointPrimitives.forEach(p => this.pointCollection.remove(p));
    linePrimitives.forEach(l => this.viewer.scene.primitives.remove(l));
    labelPrimitives.forEach(l => this.labelCollection.remove(l));

    // If in add mode, exit add mode and notify the user
    if (this.flags.isAddMode) {
        this.flags.isAddMode = false;
        showCustomNotification("You have exited add line mode", this.viewer.container);
    }

    // Determine if the position key exists in any submitted groupKeys
    const posKey = positionKey(group.coordinates[0])
    const isLineSubmittedBefore = Array.from(this.sentGroupKeys).some(groupKey =>
        groupKey.split('|').includes(posKey)
    );

    // If the line set was submitted, log the removal action
    if (isLineSubmittedBefore) {
        const payload = {
            trackId: group.trailId, // Associate with the correct trail ID
            content: [],
            comp_length: 0.0,
            email: this.app?.currentUser?.sessions?.navigator?.userId || "",
        };

        try {
            // Await the actionLogger promise and handle the response
            const response = await this.actionLogger("annotateTracks_V5", payload);
            console.log("✅ Remove action submitted:", response);
            this.logRecordsCallback({ submitStatus: `${group.trailId} Removed From Server Successfully` });
        } catch (error) {
            console.error("❌ Error logging action:", error);
            alert(`Fire Trail ${group.trailId} Submission Failed`);
            this.logRecordsCallback({ submitStatus: `${group.trailId} Removal From Server Failed` });
        }
    }

    // Remove the group coordinates from the coords.groups array
    group.coordinates = [];

    // Reset submission-related properties to their default states
    this.coords.groupToSubmit = null;
    this.interactivePrimitives.selectedLines = [];

    // Log the removal of the trail
    this.logRecordsCallback(`${group.trailId} Removed`);
}

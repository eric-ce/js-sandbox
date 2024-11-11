
import * as Cesium from "cesium";
import {
    formatDistance,
    createClampedLineGeometryInstance,
    createClampedLinePrimitive,
    createLabelPrimitive,
    createPointPrimitive,
    generateId,
    calculateClampedDistance,
    calculateClampedDistanceFromArray,
} from "../../helper/helper.js";

/************************
 * RIGHT CLICK FEATURES *
 ************************/
export function handleFireTrailRightClick(movement) {
    // Place last point and place last line
    if (!this.flags.isMeasurementComplete && this.coords.cache.length > 0) {
        // Use mouse move position to control only one pickPosition is used
        const cartesian = this.coordinate;
        if (!Cesium.defined(cartesian)) return;

        // Update pending points id
        const pendingPoints = this.pointCollection._pointPrimitives.filter(
            p => p.id && p.id.includes("pending")
        );
        pendingPoints.forEach(p => {
            p.id = p.id.replace("_pending", "");
        });

        // Update pending lines id
        const pendingLines = this.viewer.scene.primitives._primitives.filter(
            p =>
                p.geometryInstances &&
                p.geometryInstances.id &&
                p.geometryInstances.id.includes("pending")
        );
        pendingLines.forEach(p => {
            const position = p.geometryInstances.geometry._positions;
            this.viewer.scene.primitives.remove(p);
            const lineGeometryInstance = createClampedLineGeometryInstance(
                position,
                "fire_trail_line"
            );
            const linePrimitive = createClampedLinePrimitive(
                lineGeometryInstance,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            linePrimitive.isSubmitted = false;
            this.viewer.scene.primitives.add(linePrimitive);
        });

        // Update pending labels id
        const pendingLabels = this.labelCollection._labels.filter(
            l => l.id && l.id.includes("pending")
        );
        pendingLabels.forEach(l => {
            l.id = l.id.replace("_pending", "");
        });

        // Remove moving line and label primitives
        this.removeMovingPrimitives();

        const pickedObjects = this.viewer.scene.drillPick(movement.position, 3, 1, 1);
        const isPoint = pickedObjects.find(p => {
            const primitiveId = p.primitive.id;
            return (
                typeof primitiveId === "string" &&
                primitiveId.startsWith("annotate_fire_trail_point") &&
                !primitiveId.includes("moving")
            );
        });

        if (!isPoint) {
            // Create last point
            const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED);
            lastPoint.id = generateId(this.coordinate, "fire_trail_point");
            this.pointCollection.add(lastPoint);

            // Create last line
            let referencePointCartesian = null;
            if (this.flags.isReverse) {
                referencePointCartesian = this.coords.cache[0];
                this.coords.cache.unshift(this.coordinate);
            } else {
                referencePointCartesian = this.coords.cache[this.coords.cache.length - 1];
                // Update coordinate data cache
                this.coords.cache.push(this.coordinate);
            }
            const lineGeometryInstance = createClampedLineGeometryInstance(
                [referencePointCartesian, this.coordinate],
                "fire_trail_line"
            );
            const linePrimitive = createClampedLinePrimitive(
                lineGeometryInstance,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            linePrimitive.isSubmitted = false;
            this.viewer.scene.primitives.add(linePrimitive);

            // Create last label
            const group = this.coords.groups.find(g => g.coordinates.some(cart => Cesium.Cartesian3.equals(this.coordinate, cart)));

            this.updateOrCreateLabels(group);

            // Total distance label
            const { distances, totalDistance } = calculateClampedDistanceFromArray(
                this.coords.cache,
                this.viewer.scene,
                4
            );
            // Create or update total label
            this.updateOrCreateTotalLabel(group, totalDistance);

            // Log distance result
            this.updateMultiDistancesLogRecords(distances, totalDistance);
        }

        // Set selectedGroup to current group's coordinates
        const currentGroup = this.coords.groups[this.coords.groups.length - 1];
        this.coords.groupToSubmit = currentGroup

        // update selected line
        const lines = this.findLinesByPositions(currentGroup.coordinates);
        this.interactivePrimitives.selectedLines = lines;
        lines.forEach(line => {
            if (!line.isSubmitted) {    // don't change submitted line color
                this.changeLinePrimitiveColor(line, 'select');
            }
        });

        // set flags
        this.flags.isMeasurementComplete = true; // set to true to prevent further measurement
        this.flags.isReverse = false; // reset reverse flag

        // Clear cache
        this.coords.cache = [];
    }
}

// function createOrUpdateTotalLabel(group, totalDistance) {
//     const currentPosition = group.coordinates[group.coordinates.length - 1];

//     let totalLabel = this.labelCollection._labels.find(
//         label =>
//             label.id &&
//             label.id.includes("fire_trail_label_total") &&
//             group.coordinates.some(pos => Cesium.Cartesian3.equals(label.position, pos))
//     );

//     if (!totalLabel) {
//         const label = createLabelPrimitive(
//             currentPosition,
//             currentPosition,
//             totalDistance
//         );
//         totalLabel = this.labelCollection.add(label);
//     }

//     // Update label properties for both new and existing labels
//     totalLabel.id = generateId(currentPosition, "fire_trail_label_total");
//     totalLabel.show = this.flags.isShowLabels;
//     totalLabel.showBackground = this.flags.isShowLabels;
//     totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
//     totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
//     totalLabel.position = currentPosition;

//     return totalLabel;
// }
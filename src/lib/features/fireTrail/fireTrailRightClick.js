
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
            const firstPoint = this.coords.cache[this.coords.cache.length - 1];
            const lineGeometryInstance = createClampedLineGeometryInstance(
                [firstPoint, this.coordinate],
                "fire_trail_line"
            );
            const linePrimitive = createClampedLinePrimitive(
                lineGeometryInstance,
                Cesium.Color.YELLOWGREEN,
                this.cesiumPkg.GroundPolylinePrimitive
            );
            linePrimitive.isSubmitted = false;
            this.viewer.scene.primitives.add(linePrimitive);

            // Update coordinate data cache
            this.coords.cache.push(this.coordinate);

            // Create last label
            const { distance } = calculateClampedDistance(
                firstPoint,
                this.coordinate,
                this.viewer.scene,
                4
            );
            const midPoint = Cesium.Cartesian3.midpoint(
                firstPoint,
                this.coordinate,
                new Cesium.Cartesian3()
            );
            const label = createLabelPrimitive(firstPoint, this.coordinate, distance);
            const { currentLetter, labelNumberIndex } = this._getLabelProperties(
                this.coordinate,
                this.coords.cache
            );
            label.show = this.flags.isShowLabels;
            label.showBackground = this.flags.isShowLabels;
            label.id = generateId(midPoint, "fire_trail_label");
            label.text = `${currentLetter}${labelNumberIndex}: ${formatDistance(distance)}`;
            this.labelCollection.add(label);
        }

        // Total distance label
        const { distances, totalDistance } = calculateClampedDistanceFromArray(
            this.coords.cache,
            this.viewer.scene,
            4
        );
        const totalLabel = createLabelPrimitive(
            this.coordinate,
            this.coordinate,
            totalDistance
        );
        totalLabel.show = this.flags.isShowLabels;
        totalLabel.showBackground = this.flags.isShowLabels;
        totalLabel.id = generateId(this.coordinate, "fire_trail_label_total");
        totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
        totalLabel.position = this.coords.cache[this.coords.cache.length - 1];
        this.labelCollection.add(totalLabel);

        // Log distance result
        this.updateMultiDistancesLogRecords(distances, totalDistance);

        // Set selectedGroup to current group's coordinates
        const currentGroup = this.coords.groups[this.coords.groups.length - 1];
        this.coords.groupToSubmit = currentGroup

        // update selected line
        const lines = this.lookupLinesByPositions(currentGroup.coordinates);
        this.interactivePrimitives.selectedLines = lines;
        lines.forEach(line => {
            if (!line.isSubmitted) {    // don't change submitted line color
                this.changeLinePrimitiveColor(line, 'select');
            }
        });

        this.flags.isMeasurementComplete = true;
        // Clear cache
        this.coords.cache = [];
    }
}
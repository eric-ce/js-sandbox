
import * as Cesium from "cesium";
import {
    createPointPrimitive,
    generateId,
    calculateClampedDistanceFromArray,
    createGroundPolylinePrimitive,
    showCustomNotification,
} from "../../lib/helper/helper.js";

/************************
 * RIGHT CLICK FEATURES *
 ************************/
export function handleFireTrailRightClick() {
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
                p.id &&
                p.id.startsWith("annotate") &&
                p.id.includes("pending") &&
                p.id.includes("line")
        );

        pendingLines.forEach(p => {
            p.id = p.id.replace("_pending", "");
            this.changeLinePrimitiveColor(p, 'default');
            p.isSubmitted = false;
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

        // Check if the last point is near any existing point
        const isNearPoint = this.coords.groups
            .flatMap(group => group.coordinates)
            .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
        if (isNearPoint) return;

        // Create last point
        const lastPoint = createPointPrimitive(this.coordinate, Cesium.Color.RED, "fire_trail_point");
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

        const linePrimitive = createGroundPolylinePrimitive(
            [referencePointCartesian, this.coordinate],
            "fire_trail_line",
            Cesium.Color.YELLOWGREEN,
            this.cesiumPkg.GroundPolylinePrimitive
        )
        linePrimitive.isSubmitted = false;
        this.viewer.scene.primitives.add(linePrimitive);

        // Create last label
        const group = this.coords.groups.find(g => g.coordinates.some(cart => Cesium.Cartesian3.equals(this.coordinate, cart)));
        if (!group) return;
        this.measure = group;

        // Update or create labels for the group
        const { distances, totalDistance, clampedPositions } = this.updateOrCreateLabels(group);

        // Create or update total label
        this.updateOrCreateTotalLabel(group, totalDistance);

        // update selected line
        const lines = this.findLinesByPositions(group.coordinates);
        this.interactivePrimitives.selectedLines = lines;
        lines.forEach(line => {
            if (!line.isSubmitted) {    // don't change submitted line color
                this.changeLinePrimitiveColor(line, 'select');
            }
        });

        // Update group interpolated points
        group.interpolatedPoints = clampedPositions;

        // Update this.measure status and records
        group.status = "completed";
        group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];

        // show notification the group id selected
        showCustomNotification(`selected line: ${group.id}`, this.viewer.container);

        // update log records for distance, total distance, and selected line
        const logTable = this.stateManager.getElementState("logTable");
        logTable & logTable._handleDataAdded({ ...this.measure });
        // logTable & logTable._handleModeSelected([{ "line selected": group.id }]);

        // Set selectedGroup to current group's coordinates
        // const currentGroup = this.coords.groups[this.coords.groups.length - 1];
        this.coords.groupToSubmit = group

        // set flags
        this.flags.isMeasurementComplete = true; // set to true to prevent further measurement
        this.flags.isReverse = false; // reset reverse flag

        // Clear cache
        this.coords.cache = [];
    }
}

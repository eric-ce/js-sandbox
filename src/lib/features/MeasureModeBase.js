import * as Cesium from 'cesium';
import {
    positionKey,
    removeInputActions,
    calculateDistance,
    formatDistance,
    createLabelPrimitive,
    generateId,
    changeLineColor,
    calculateClampedDistance
} from '../helper/helper';

export default class MeasureModeBase {
    constructor(viewer, handler, stateManager, logRecordsCallback, cesiumPkg) {
        this.viewer = viewer;
        this.handler = handler;

        this.stateManager = stateManager;

        this.logRecordsCallback = logRecordsCallback;

        this.cesiumPkg = cesiumPkg;

        this.coordinate = new Cesium.Cartesian3();

        this.flags = {};

        // common used coordinates data
        this.coords = {
            cache: [],
            groups: [],
            groupCounter: 0,
            dragStart: null,
            dragStartToCanvas: null,
            dragStartTop: null,
            dragStartBottom: null,
        };

        this.pointCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_point_collection"));
        this.labelCollection = this.viewer.scene.primitives._primitives.find(p => p.id && p.id.startsWith("annotate_label_collection"));

        // common used interactive primitives
        this.interactivePrimitives = {
            dragPoint: null,        // Currently dragged point primitive
            dragLabel: null,        // Currently dragged label primitive
            dragPolyline: null,     // Line that visualizes dragging
            dragPolygon: null,      // Currently dragged polygon primitive
            dragPolygonOutline: null, // Currently dragged polygon outline primitive
            dragPoints: [],         // Array of dragged points
            dragPolylines: [],      // Array of dragging polylines
            dragLabels: [],         // Array of dragging labels
            hoveredPoint: null,     // Point that is currently hovered
            hoveredLabel: null,     // Label that is currently hovered
            hoveredLine: null,      // Line that is currently hovered
            movingPolyline: null,   // Line that visualizes dragging or moving
            movingLabel: null,      // Label that updates during moving or dragging
            movingPolygon: null,    // Polygon primitive that updates during moving
            movingPolygonOutline: null, // Polygon outline primitive that updates during moving
            movingPoint: null,      // Point primitive that updates during moving or dragging
            movingPoints: [],       // Array of moving points
            movingPolylines: [],    // Array of moving polylines
            movingLabels: [],       // Array of moving labels
            draggingPoint: null,    // Currently dragged point primitive
            selectedLine: null,     // Selected line primitive
            selectedLines: [],      // Array of selected line primitives
            addModeLine: null,      // Selected line primitive in add mode
            chartHoveredPoint: null
        };
    }

    setupInputActions() {
        removeInputActions(this.handler);
        this.handler.setInputAction((movement) => this.handleLeftClick(movement), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        this.handler.setInputAction((movement) => this.handleMouseMove(movement), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        this.handler.setInputAction((movement) => this.handleDragStart(movement), Cesium.ScreenSpaceEventType.LEFT_DOWN);
        this.handler.setInputAction(() => this.handleDragEnd(), Cesium.ScreenSpaceEventType.LEFT_UP);
        this.handler.setInputAction((movement) => this.handleRightClick(movement), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        this.handler.setInputAction((movement) => this.handleDoubleClick(movement), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        this.handler.setInputAction((movement) => this.handleMiddleClick(movement), Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
    }

    handleLeftClick(movement) { /* Default click behavior; override in subclass */ }
    handleMouseMove(movement) { /* Default move behavior; override in subclass */ }
    handleRightClick(movement) { /* Default right click; override in subclass */ }
    handleDragStart(movement) { /* Default drag start; override in subclass */ }
    handleDragMove(movement) { /* Default drag move; override in subclass */ }
    handleDragEnd() { /* Default drag end; override in subclass */ }
    handleDoubleClick(movement) { /* Default double click; override in subclass */ }
    handleMiddleClick(movement) { /* Default middle click; override in subclass */ }

    resetValue() {
        this.coordinate = null;

        const pointer = this.stateManager.getOverlayState("pointer");
        pointer && (pointer.style.display = "none");

        // this.flags = {};

        this.coords = {
            cache: [],
            groups: this.coords.groups,             // Preserve the value of this.coords.groups
            groupCounter: this.coords.groupCounter, // Preserve the value of this.coords.groupCounter
            dragStart: null,
            dragStartToCanvas: null,
            dragStartTop: null,
            dragStartBottom: null,
        }

        this.interactivePrimitives = {
            dragPoint: null,
            dragLabel: null,
            dragPolyline: null,
            dragPolygon: null,
            dragPolygonOutline: null,
            dragPoints: [],
            dragPolylines: [],
            dragLabels: [],
            hoveredPoint: null,
            hoveredLabel: null,
            hoveredLine: null,
            movingPolyline: null,
            movingLabel: null,
            movingPolygon: null,
            movingPolygonOutline: null,
            movingPoint: null,
            movingPoints: [],
            movingPolylines: [],
            movingLabels: [],
            draggingPoint: null,
            selectedLine: null,
            selectedLines: this.interactivePrimitives.selectedLines, // Preserve the value of this.interactivePrimitives.selectedLines
            addModeLine: null,
            chartHoveredPoint: null
        };
    }

    /******************
     * HELPER METHODS *
     ******************/
    /**
     * remove moving primitives: lines and labels
     */
    removeMovingPrimitives() {
        this.interactivePrimitives.movingPolylines.forEach(primitive =>
            this.viewer.scene.primitives.remove(primitive)
        );
        this.interactivePrimitives.movingPolylines.length = 0;
        this.interactivePrimitives.movingLabels.forEach(label =>
            this.labelCollection.remove(label)
        );
        this.interactivePrimitives.movingLabels.length = 0;
    }

    /**
     * find the point, line, and label primitive by position
     * @param {Cesium.Cartesian3} position - the position
     * @param {String} modeString - The mode string to filter the lines.
     * @returns {Cesium.PointPrimitive} pointPrimitive - The point primitive that matches the position.
     * @returns {Cesium.Primitive[]} linePrimitives - The array of line primitives that match the position.
     * @returns {Cesium.LabelPrimitive[]} labelPrimitives - The array of label primitives that match the position.
     */
    findPrimitiveByPosition(position, modeString) {
        // get point primitive by position
        const pointPrimitive = this.pointCollection._pointPrimitives.find(p => p.id && p.id.startsWith(modeString) &&
            !p.id.includes("moving") &&
            Cesium.Cartesian3.equals(p.position, position)
        );

        // get line primitives by position
        const linePrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.includes(modeString) &&
            !p.id.includes("moving") &&
            p.positions.some(cart => Cesium.Cartesian3.equals(cart, position))
        );

        // get label primitives by lines positions
        // it can only be 1 lines or 2 lines, each line has 2 positions [[1,2],[3,4]] | [[1,2]]
        const linePositions = linePrimitives.map(p => p.positions);
        const midPoints = linePositions.map((positions) => Cesium.Cartesian3.midpoint(positions[0], positions[1], new Cesium.Cartesian3()));
        const labelPrimitives = midPoints.map(midPoint =>
            this.labelCollection._labels.find(l => l.id && l.id.startsWith(modeString) &&
                !l.id.includes("moving") &&
                Cesium.Cartesian3.equals(l.position, midPoint)
            )
        ).filter(label => label !== undefined);

        // Sort labelPrimitives by their text
        labelPrimitives.sort((a, b) => a.text.toUpperCase().localeCompare(b.text.toUpperCase()));

        return { pointPrimitive, linePrimitives, labelPrimitives };
    }

    /**
     * Lookup the line primitives array by the positions array
     * @param {Cesium.Cartesian3[]} positions - The array of Cartesian3 positions to lookup the lines.
     * @param {string} modeString - The mode string to filter the lines.
     * @returns {Cesium.PointPrimitive[]} pointPrimitive - The array of point primitives that match the position.
     * @returns {Cesium.Primitive[]} linePrimitives - The array of line primitives that match the position.
     * @returns {Cesium.LabelPrimitive[]} labelPrimitives - The array of label primitives that match the position.
     */
    findPrimitivesByPositions(positions, modeString) {
        // lookup points primitives
        const pointPrimitives = this.pointCollection._pointPrimitives
            .filter(p =>
                p.id &&
                p.id.startsWith(`annotate_${modeString}_point`) &&
                !p.id.includes("moving") &&
                positions.some(pos => Cesium.Cartesian3.equals(p.position, pos))
            )
        // lookup line primitives
        const linePrimitives = this.findLinesByPositions(positions, modeString);

        // lookup label primitives
        const midPoints = positions.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, positions[i + 1], new Cesium.Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels
            .filter(l =>
                l.id &&
                l.id.startsWith(`annotate_${modeString}_label`) &&
                midPoints.some(pos => Cesium.Cartesian3.equals(l.position, pos))
            );
        const totalLabelPrimitive = this.labelCollection._labels.find(l =>
            l.id &&
            l.id.includes(`${modeString}_label_total`) &&
            Cesium.Cartesian3.equals(l.position, positions[positions.length - 1])
        );
        if (totalLabelPrimitive) {
            labelPrimitives.push(totalLabelPrimitive);
        }

        return { pointPrimitives, linePrimitives, labelPrimitives };
    }

    /**
     * Lookup the line primitives array by the positions array
     * @param {Cesium.Cartesian3[]} positions - The array of Cartesian3 positions to lookup the lines.
     * @param {string} modeString - The mode string to filter the lines.
     * @returns {Cesium.Primitive[]} - The array of line primitives that match the positions.
     */
    findLinesByPositions(positions, modeString) {
        // Create a set of position keys from the input positions for quick lookup
        const positionKeys = new Set(positions.map(pos => positionKey(pos)));

        // Initialize a set to store matching line primitives
        const linePrimitives = new Set();

        // Filter the primitives to find lines that match certain criteria
        const linesPrimitives = this.viewer.scene.primitives._primitives.filter(p =>
            p.id &&
            p.id.startsWith("annotate") &&
            p.id.includes(`${modeString}_line`) &&
            !p.id.includes("moving") // Exclude moving lines
        );

        // Iterate over the filtered lines
        linesPrimitives.forEach(line => {
            // Get the positions of the line (array of Cartesian3)
            const linePositions = line.positions; // [Cartesian3, Cartesian3]

            // Check if any position of the line matches the input positions
            linePositions.forEach(linePos => {
                if (positionKeys.has(positionKey(linePos))) {
                    // If a match is found, add the line to the set of line primitives
                    linePrimitives.add(line);
                }
            });
        });

        // Convert the set of line primitives to an array and return it
        return Array.from(linePrimitives);
    }

    /**
    * Create or update the labels based on the group of data
    * Intended to be used for all the multiple distance tools.
    * @param {Object} group - The group of data for which labels are to be created or updated.
    * @param {number} group.id - The unique identifier for the group.
    * @param {Cesium.Cartesian3[]} group.coordinates - An array of Cartesian3 coordinates defining the points.
    * @param {number} group.labelIndex - The index used for labeling purposes.    
    * @param {String} modeString - the mode string
    */
    updateOrCreateLabels(group, modeString, isClamped = false) {
        const midPoints = group.coordinates.slice(0, -1).map((pos, i) =>
            Cesium.Cartesian3.midpoint(pos, group.coordinates[i + 1], new Cesium.Cartesian3())
        );
        const labelPrimitives = this.labelCollection._labels.filter(
            l => l.id && l.id.includes(`${modeString}_label`)
        );

        midPoints.forEach((midPoint, index) => {
            let relativeLabelPrimitives = labelPrimitives.filter(l =>
                Cesium.Cartesian3.equals(l.position, midPoint)
            );

            // Wrap the letter back to 'a' after 'z'
            const currentLetter = String.fromCharCode(97 + index % 26); // 'a' to 'z' to 'a' to 'z'...

            // Don't use getLabelProperties currentLetter in here as midPoint index is not the group coordinate index
            // const { labelNumberIndex } = this._getLabelProperties(
            //     group.coordinates[index],
            //     group

            // calculate distance based on whether is clamped to ground distance or not
            let distance = null;
            if (isClamped) {
                distance = calculateClampedDistance(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                    this.viewer.scene,
                    4
                ).distance;
            } else {
                distance = calculateDistance(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                );
            };
            // error handling for no distance
            if (!distance) return; // Skip if distance is null or undefined

            // create the label text
            const labelText = `${currentLetter}${group.labelNumberIndex}: ${formatDistance(distance)}`;

            if (relativeLabelPrimitives.length > 0) {
                // Update existing labels
                relativeLabelPrimitives.forEach(label => {
                    label.text = labelText;
                    label.show = this.flags.isShowLabels;
                    label.showBackground = this.flags.isShowLabels;
                });
            } else {
                // Create new label
                const newLabel = createLabelPrimitive(
                    group.coordinates[index],
                    group.coordinates[index + 1],
                    distance
                );
                newLabel.text = labelText;
                newLabel.show = this.flags.isShowLabels;
                newLabel.showBackground = this.flags.isShowLabels;
                newLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
                newLabel.position = midPoint;
                newLabel.id = generateId(midPoint, `${modeString}_label`);
                this.labelCollection.add(newLabel);
            }
        });
    }

    /**
     * Get the label text properties based on the position and group.
     * @param {Cesium.Cartesian3} position - The current position.
     * @param {Array} group - The group.
     * @returns {{ currentLetter: String, labelNumberIndex: Number }} - The label text properties.
     */
    _getLabelProperties(position, group) {
        // Find the index of the position in group
        const positionIndex = group.coordinates.findIndex(cart => Cesium.Cartesian3.equals(cart, position));
        if (positionIndex === -1 || positionIndex === 0) return { currentLetter: "", labelNumberIndex: 0 }; // label exist when there is at least 2 position.

        // Calculate label index
        const labelIndex = positionIndex - 1;

        // Map index to alphabet letters starting from 'a'
        const currentLetter = String.fromCharCode(97 + (labelIndex % 26));

        // Use labelNumberIndex from the group
        const labelNumberIndex = group.labelNumberIndex;

        return { currentLetter, labelNumberIndex };
    }

    /**
     * Create or update the total distance label based on the group of data.
     * Intended to be used for all the multiple distance tools
     * @param {Object} group - The group of data for which labels are to be created or updated.
     * @param {number} group.id - The unique identifier for the group.
     * @param {Cesium.Cartesian3[]} group.coordinates - An array of Cartesian3 coordinates defining the points.
     * @param {number} group.labelIndex - The index used for labeling purposes.
     * @param {number} totalDistance - The total distance calculated from the group of points.
     * @param {string} modeString - The mode string used to categorize and generate unique IDs for labels.
     */
    updateOrCreateTotalLabel(group, totalDistance, modeString) {
        const currentPosition = group.coordinates[group.coordinates.length - 1];

        let totalLabel = this.labelCollection._labels.find(
            label =>
                label.id &&
                label.id.includes(`${modeString}_label_total`) &&
                group.coordinates.some(pos => Cesium.Cartesian3.equals(label.position, pos))
        );

        if (!totalLabel) {
            const label = createLabelPrimitive(
                currentPosition,
                currentPosition,
                totalDistance
            );
            totalLabel = this.labelCollection.add(label);
        }

        // Update label properties for both new and existing labels
        totalLabel.id = generateId(currentPosition, `${modeString}_label_total`);
        totalLabel.show = this.flags.isShowLabels;
        totalLabel.showBackground = this.flags.isShowLabels;
        totalLabel.text = `Total: ${formatDistance(totalDistance)}`;
        totalLabel.pixelOffset = new Cesium.Cartesian2(0, -20);
        totalLabel.position = currentPosition;

        return totalLabel;
    }

    /**
     * reset the highlighting feature
     * @return {Object} - The object containing the reset highlighting cesium primitives.
     */
    resetHighlighting() {
        const { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel } = this.interactivePrimitives;
        // when mouse move out of the line, reset the line color
        // Reset hovered line if it's not the selected line
        if (
            hoveredLine &&
            hoveredLine !== addModeLine   // don't change selected line color
        ) {
            let colorToSet;
            if (selectedLines.includes(hoveredLine)) {
                colorToSet = this.stateManager.getColorState("select");
            } else {
                colorToSet = this.stateManager.getColorState("default");
            }

            if (!colorToSet) console.error('color is not defined');

            changeLineColor(hoveredLine, colorToSet);
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

        return { hoveredLine, addModeLine, selectedLines, hoveredPoint, hoveredLabel };
    }
}
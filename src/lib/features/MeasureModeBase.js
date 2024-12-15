import * as Cesium from 'cesium';
import { positionKey, removeInputActions } from '../helper/helper';

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

        this.flags = {};

        this.coords = {
            cache: [],
            groups: this.coords.groups, // Preserve the value of this.coords.groups
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

}
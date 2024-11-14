
import * as Cesium from "cesium";
import {
    editableLabel,
    createPointPrimitive,
    generateId,
    calculateClampedDistanceFromArray,
    getPickedObjectType,

    generateIdByTimestamp,
    showCustomNotification,
    createGroundPolylinePrimitive,
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
    const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    // Determine the action based on the type of clicked primitive
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
 * Handles actions when a point is clicked.
 * Depending on the measurement state and mode, it selects, removes, or continues measurements.
 * @param {Object} pickedObject - The clicked primitive object.
 */
function handlePointClick(pickedObject) {
    const pointPrimitive = pickedObject.primitive;

    // If the measurement is complete and not in add mode, select the fire trail
    if (this.flags.isMeasurementComplete && !this.flags.isAddMode) {
        selectFireTrail.call(this, pointPrimitive);
    }

    // If currently measuring (measurement not complete) and cache has points, remove action
    if (this.coords.cache.length > 0 && !this.flags.isMeasurementComplete) {
        removeActionByPointMeasuring.call(this, pointPrimitive);
    }

    // If the measurement is complete, check if clicked point is first or last in the group to allow continue measurement
    if (this.flags.isMeasurementComplete) {
        // Find the group that contains the clicked point
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPrimitive.position))
        );

        // If no group is found, exit the function
        if (!group) {
            console.warn("Clicked point does not belong to any group.");
            return;
        }

        // Find the index of the clicked point within the group
        const pointIndex = group.coordinates.findIndex(cart =>
            Cesium.Cartesian3.equals(cart, pointPrimitive.position)
        );

        // Determine if the clicked point is the first or last point in the group
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === group.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            // Remove the total distance label associated with the group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
                Cesium.Cartesian3.equals(label.position, group.coordinates[group.coordinates.length - 1])
            );

            if (totalLabel) {
                this.labelCollection.remove(totalLabel);
            }

            // Reset measurement state to allow continuation
            this.flags.isMeasurementComplete = false;
            this.coords.cache = group.coordinates;
            this.flags.isReverse = isFirstPoint; // Reverse if the first point was clicked
        }
    }
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
        addAction.call(this, this.interactivePrimitives.addModeLine);
    }
}

// remove point during measuring
function removeActionByPointMeasuring(pointPrimitive) {
    // find the group that contains the clicked point
    const pointPosition = pointPrimitive.position.clone();
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition))
    );
    if (!group) {
        console.warn("Clicked point does not belong to any group.");
        return;
    }

    // compare if the pick point is from the latest one in group that is still drawing
    const isFromMeasuring = group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pointPosition));

    if (isFromMeasuring) {
        // find line and label primitives by the point position
        const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
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

        // Update or create labels for the group
        this.updateOrCreateLabels(group);

        if (group.coordinates.length === 0) {
            this.flags.isMeasurementComplete = true; // When removing the only point, consider the measure ended
            this.interactivePrimitives.selectedLines = [];
            this.coords.groupToSubmit = null;
        }
    }
}

/**
 * Starts a new measurement by initializing necessary parameters and creating point primitives.
 */
function startMeasure() {
    // Reset the measurement completion flag if the measurement was previously complete
    if (this.flags.isMeasurementComplete) {
        this.flags.isMeasurementComplete = false;
    }

    // Initialize a new group if the coordinate cache is empty
    if (this.coords.cache.length === 0) {
        const newGroup = {
            trailId: generateIdByTimestamp(),
            coordinates: [],
            labelNumberIndex: this.coords.groupCounter, // Unique index for labeling
        };
        this.coords.groups.push(newGroup);
        this.coords.cache = newGroup.coordinates; // Link cache to the new group's coordinates
        this.coords.groupCounter++;
    }

    // Reset the selection highlight to the default color for lines to submit
    if (this.coords.groupToSubmit?.coordinates) {
        const lines = this.findLinesByPositions(this.coords.groupToSubmit.coordinates);
        lines.forEach(line => {
            if (!line.isSubmitted) { // Do not change color of submitted lines
                this.changeLinePrimitiveColor(line, 'default');
            }
        });
    }

    // Check if the current coordinate is near any existing point (distance < 0.3)
    const isNearPoint = this.coords.groups
        .flatMap(group => group.coordinates)
        .some(cart => Cesium.Cartesian3.distance(cart, this.coordinate) < 0.3);
    if (isNearPoint) return; // Do not create a new point if near an existing one

    // Create a new point primitive at the current coordinate with red color
    const point = createPointPrimitive(this.coordinate, Cesium.Color.RED);
    point.id = generateId(this.coordinate, "fire_trail_point_pending");
    const pointPrimitive = this.pointCollection.add(point);
    const firstPointPosition = pointPrimitive.position.clone();

    // Update the coordinate cache based on the measurement direction
    if (this.flags.isReverse) {
        this.coords.cache.unshift(this.coordinate);
    } else {
        this.coords.cache.push(this.coordinate);
    }

    // Continue measurement if there are enough points in the cache
    if (this.coords.cache.length > 1) {
        continueMeasure.call(this, firstPointPosition);
    }
}

/**
 * Continues the measurement by adding a new line primitive and updating labels.
 * @param {Cesium.Cartesian3} position - The position to continue measuring from.
 */
function continueMeasure(position) {
    // Remove the moving line and label primitives to continue measurement
    this.removeMovingPrimitives();

    // Find the group that contains the given position
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, position))
    );

    if (!group) {
        console.warn("Group not found for the given position.");
        //TODO: here it can picked fire trail in the layer and continue, assign new id and set it to the cache
        return;
    }

    // Determine the indices of the previous and current points based on the measurement direction
    const [prevIndex, currIndex] = this.flags.isReverse
        ? [0, 1] // If reversing, use the first two points
        : [group.coordinates.length - 2, group.coordinates.length - 1]; // Otherwise, use the last two points

    const prevPointCartesian = group.coordinates[prevIndex];
    const currPointCartesian = group.coordinates[currIndex];

    const linePrimitive = createGroundPolylinePrimitive(
        [prevPointCartesian, currPointCartesian],
        "fire_trail_line_pending",
        Cesium.Color.YELLOWGREEN,
        this.cesiumPkg.GroundPolylinePrimitive
    )

    // Mark the line as not submitted and add it to the scene
    linePrimitive.isSubmitted = false;
    this.viewer.scene.primitives.add(linePrimitive);

    // Update or create the associated labels for the group
    this.updateOrCreateLabels(group);
}

function addAction(linePrimitive) {
    const linePositions = linePrimitive.positions;

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

    // Create reconnect primitives
    if (neighbourPositions.length === 3) {
        neighbourPositions.forEach((pos, i) => {
            // Create line primitives
            if (i < neighbourPositions.length - 1) {
                const newLinePrimitive = createGroundPolylinePrimitive(
                    [pos, neighbourPositions[i + 1]],
                    "fire_trail_line",
                    Cesium.Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                )
                newLinePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(newLinePrimitive);
            }
        });
    }

    // Update or create labels for the group
    this.updateOrCreateLabels(group);

    // Recalculate distances and total distance
    const { distances, totalDistance } = calculateClampedDistanceFromArray(
        group.coordinates,
        this.viewer.scene,
        4
    );

    // Update or create total distance label
    this.updateOrCreateTotalLabel(group, totalDistance);

    // update selected line color
    this.updateSelectedLineColor(group);

    // Update log records
    this.updateMultiDistancesLogRecords(distances, totalDistance);
    this.coords.groupToSubmit = group;

    // Reset flags
    this.flags.isAddMode = false;
    this.interactivePrimitives.addModeLine = null;
}

function selectFireTrail(primitive) {
    let primitivePosition = [];

    if (primitive && primitive.id && primitive.id.includes("line")) { // if it is line primitive
        primitivePosition = primitive.positions;
    } else {  // it is point primitive
        primitivePosition = [primitive.position];
    }

    if (primitivePosition && primitivePosition.length > 0) {
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, primitivePosition[0]))
        );

        // show notification
        showCustomNotification(`selected line: ${group.trailId}`, this.viewer.container)

        // update log records callback for the current selected line
        this.logRecordsCallback(`${group.trailId} selected`);

        // Reset previous selection
        if (this.interactivePrimitives.selectedLines.length > 0) {
            // use selectedLines that is before update to look up previous selected lines
            // lookup the previous selected group
            const pos = this.interactivePrimitives.selectedLines[0].positions;
            const prevGroup = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, pos[0]))
            );
            // lookup the previous selected lines
            const prevLines = this.findLinesByPositions(prevGroup.coordinates);
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
        const lines = this.findLinesByPositions(group.coordinates);
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

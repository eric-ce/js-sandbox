
import {
    Cartesian2,
    Cartesian3,
    Color,
} from "cesium";
import {
    editableLabel,
    createPointPrimitive,
    generateId,
    getPickedObjectType,
    generateIdByTimestamp,
    showCustomNotification,
    createGroundPolylinePrimitive,
    convertCartesianArrayToClamped,
    positionKey,
} from "../../lib/helper/helper.js";

/***********************
 * LEFT CLICK FEATURES *
 ***********************/
/**
 * The method to handle left-click Cesium handler events 
 *
 * @param {{position: Cartesian2}} movement - The mouse movement data.
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
    if (this.coords.cache.length === 0 || this.flags.isMeasurementComplete) {
        // Find the group that contains the clicked point
        const group = this.coords.groups.find(group =>
            group.coordinates.some(cart =>
                Cartesian3.equals(cart, pointPrimitive.position))
        )
        if (!group) return;
        this.measure = group // set the current measure to the group

        // Find the index of the clicked point within the group
        const pointIndex = group.coordinates.findIndex(cart =>
            Cartesian3.equals(cart, pointPrimitive.position)
        );

        // Determine if the clicked point is the first or last point in the group
        const isFirstPoint = pointIndex === 0;
        const isLastPoint = pointIndex === group.coordinates.length - 1;

        if (isFirstPoint || isLastPoint) {
            // Remove the total distance label associated with the group
            const totalLabel = this.labelCollection._labels.find(label =>
                label.id &&
                label.id.includes("fire_trail_label_total") &&
                Cartesian3.equals(label.position, group.coordinates[group.coordinates.length - 1])
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
    const { primitive } = pickedObject; // line primitive

    if (
        !this.flags.isAddMode &&  // not in add mode
        (this.coords.cache.length === 0 && !this.flags.isMeasurementComplete) ||  // measurement not started
        this.flags.isMeasurementComplete // not during measurement
    ) {
        selectFireTrail.call(this, primitive);
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
        group.coordinates.some(cart => Cartesian3.equals(cart, pointPosition))
    );
    if (!group) return; // error handling
    this.measure = group // set the current measure to the group

    // Check if the clicked point is from the same group
    const isFromSameGroup = group.coordinates.some(cart =>
        Cartesian3.equals(cart, this.coords.cache[0])
    );
    if (!isFromSameGroup) return; // error handling

    // find line and label primitives by the point position
    const { linePrimitives, labelPrimitives } = this.findPrimitiveByPosition(
        pointPosition,
        "fire_trail",
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
        Cartesian3.equals(cart, pointPosition)
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
        // Reset for a new measure using the default structure
        this.measure = this._createDefaultMeasure();

        // Set values for the new measure
        this.measure.id = generateIdByTimestamp();
        this.measure.mode = this.mode;
        this.measure.labelNumberIndex = this.coords.measureCounter;
        this.measure.status = "pending";

        // Establish data relation
        this.coords.groups.push(this.measure);
        this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
        this.coords.measureCounter++;
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
        .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);
    if (isNearPoint) return; // Do not create a new point if near an existing one

    // Create a new point primitive at the current coordinate with red color
    const point = createPointPrimitive(this.coordinate, Color.RED);
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
 * @param {Cartesian3} position - The position to continue measuring from.
 */
function continueMeasure(position) {
    // Remove the moving line and label primitives to continue measurement
    this.removeMovingPrimitives();

    // Find the group that contains the given position
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cartesian3.equals(cart, position))
    );
    if (!group) return; // error handling
    this.measure = group; // set the current measure to the group

    // Determine the indices of the previous and current points based on the measurement direction
    const [prevIndex, currIndex] = this.flags.isReverse
        ? [0, 1] // If reversing, use the first two points
        : [group.coordinates.length - 2, group.coordinates.length - 1]; // Otherwise, use the last two points

    const prevPointCartesian = group.coordinates[prevIndex];
    const currPointCartesian = group.coordinates[currIndex];

    const linePrimitive = createGroundPolylinePrimitive(
        [prevPointCartesian, currPointCartesian],
        "fire_trail_line_pending",
        Color.YELLOWGREEN,
        this.cesiumPkg.GroundPolylinePrimitive
    )

    // Mark the line as not submitted and add it to the scene
    linePrimitive.isSubmitted = false;
    this.viewer.scene.primitives.add(linePrimitive);

    // Update or create the associated labels for the group
    const { distances, clampedPositions, totalDistance } = this.updateOrCreateLabels(group);

    // Update group interpolated points
    group.interpolatedPoints = clampedPositions;

    // Update group status and records
    group.status = "pending";
    group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];
}

function addAction(linePrimitive) {
    const linePositions = linePrimitive.positions;

    // Find the group that contains the line positions
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cartesian3.equals(cart, linePositions[0]))
    );
    if (!group || group.coordinates.length === 0) return;
    this.measure = group; // set the current measure to the group

    // Find the indices of the line positions in the group's coordinates
    const linePositionIndex1 = group.coordinates.findIndex(cart => Cartesian3.equals(cart, linePositions[0]));
    const linePositionIndex2 = group.coordinates.findIndex(cart => Cartesian3.equals(cart, linePositions[1]));
    const positionIndex = Math.min(linePositionIndex1, linePositionIndex2);

    // Check if there is already a point near the coordinate to avoid duplicates
    const isNearPoint = this.coords.groups
        .flatMap(group => group.coordinates)
        .some(cart => Cartesian3.distance(cart, this.coordinate) < 0.3);

    if (!isNearPoint) {
        // Create a new point primitive
        const point = createPointPrimitive(this.coordinate, Color.RED, "fire_trail_point");
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
    const midPoint = Cartesian3.midpoint(
        linePositions[0],
        linePositions[1],
        new Cartesian3()
    );
    const existedLabel = this.labelCollection._labels.find(l =>
        l.id &&
        l.id.includes("fire_trail_label") &&
        Cartesian3.equals(l.position, midPoint)
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
                    Color.YELLOWGREEN,
                    this.cesiumPkg.GroundPolylinePrimitive
                )
                newLinePrimitive.isSubmitted = false;
                this.viewer.scene.primitives.add(newLinePrimitive);
            }
        });
    }

    // Update or create labels for the group
    const { distances, totalDistance, clampedPositions } = this.updateOrCreateLabels(group);

    // Update or create total distance label
    this.updateOrCreateTotalLabel(group, totalDistance);

    // update selected line color
    this.updateSelectedLineColor(group);

    // Update the interpolated points of the group
    group.interpolatedPoints = clampedPositions;

    // Update groups status and records
    group.status = "completed";
    group._records = [{ distances: [...distances], totalDistance: [totalDistance] }];

    // Find the log table
    const logTable = this.stateManager.getElementState("logTable");
    // Update the log table with the new group
    logTable && logTable._handleDataAdded({ ...this.measure });

    this.coords.groupToSubmit = group;

    // Reset flags
    this.flags.isAddMode = false;
    this.interactivePrimitives.addModeLine = null;
}

async function selectFireTrail(primitive) {
    let primitivePositions = [];

    const isLayerLine = (primitive?.feature?.type === "fireTrail") ?? false;
    const isAnnotateLine = typeof primitive?.id === 'string' && primitive.id.includes("fire_trail_line");

    // Determine the type of primitive and extract positions accordingly
    if (isAnnotateLine) { // Line primitive from annotations
        primitivePositions = primitive.positions;
    } else if (isLayerLine) { // Line primitive from layer
        primitivePositions = primitive.geometryInstances[0].geometry._positions;
    } else {  // Point primitive
        primitivePositions = [primitive.position];
    }

    if (primitivePositions && primitivePositions.length > 0) {
        let group;

        // for the line from annotation
        if (isAnnotateLine) {
            // Find existing group containing the first position
            group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, primitivePositions[0]))
            );
            this.measure = group; // set the current measure to the group
        };

        // for the line from layer
        if (isLayerLine) {
            // show notification for the layer line
            showCustomNotification(`selected line: ${primitive?.feature?.id}`, this.viewer.container)

            const logTable = this.stateManager.getElementState("logTable");
            logTable && logTable._handleModeSelected([{ "select layer line": primitive?.feature?.id }]);

            // Clamp positions to terrain height using sampleTerrainMostDetailed(), because sampleHeight cannot convert all positions
            const clampedPosArray = await convertCartesianArrayToClamped(primitivePositions, this.viewer.scene)

            // Find existing group with the clamped first position
            group = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, clampedPosArray[0])) &&
                group.coordinates.some(cart => Cartesian3.equals(cart, clampedPosArray[clampedPosArray.length - 1]))
            );

            if (!group) {
                // Reuse ID from layer line if it's a valid number, otherwise generate a new one
                const trailId = Number(primitive?.feature?.id) || generateIdByTimestamp();

                // Create a new measure if none exists
                this.measure = this._createDefaultMeasure();

                // Set values for the new measure
                this.measure.id = trailId;
                this.measure.mode = this.mode;
                this.measure.labelNumberIndex = this.coords.measureCounter;
                this.measure.status = "pending";

                // Establish data relation
                this.coords.groups.push(this.measure);
                this.measure.coordinates = this.coords.cache; // when cache changed groups will be changed due to reference by address
                this.coords.measureCounter++;

                // update the newly added group with clamped positions
                newGroup.coordinates = clampedPosArray;

                // find the new group in this.coords.groups to make sure it is added to the group
                group = this.coords.groups.find(group =>
                    group.coordinates.some(cart => Cartesian3.equals(cart, clampedPosArray[0]))
                );

                // Create point primitives for each clamped position
                clampedPosArray.forEach(cart => {
                    const pointPrimitive = createPointPrimitive(cart, Color.RED);
                    pointPrimitive.id = generateId(cart, "fire_trail_point");
                    this.pointCollection.add(pointPrimitive);
                });

                // Create line primitives connecting consecutive clamped positions
                for (let i = 0; i < clampedPosArray.length - 1; i++) {
                    const newLinePrimitive = createGroundPolylinePrimitive(
                        [clampedPosArray[i], clampedPosArray[i + 1]],
                        "fire_trail_line",
                        this.stateColors.submitted,
                        this.cesiumPkg.GroundPolylinePrimitive
                    )
                    newLinePrimitive.isSubmitted = true;
                    newLinePrimitive.positions = [clampedPosArray[i], clampedPosArray[i + 1]];
                    this.viewer.scene.primitives.add(newLinePrimitive);
                }

                // treat it as a drawn line with the tool so that it won't affect other editing feature from the start
                this.flags.isMeasurementComplete = true; // Set measurement complete after creating the line

                // treat layer fireTrail as submitted fireTrail line
                // update the send group key to include the new line created from layer
                const groupKey = group.coordinates.map(pos => positionKey(pos)).join('|');
                this.sentGroupKeys.add(groupKey);
            }
        }

        // find the group that the point primitive belongs to
        group = this.coords.groups.find(group =>
            group.coordinates.some(cart => Cartesian3.equals(cart, primitivePositions[0]))
        );
        if (!group) return;
        this.measure = group; // set the current measure to the group

        // Display notification for the selected group
        showCustomNotification(`selected line: ${group.id}`, this.viewer.container)

        // Update log records for the current selected line
        const logTable = this.stateManager.getElementState("logTable");
        logTable && logTable._handleModeSelected([{ "selected line": group.id }]);

        // Reset the previous selection if any
        if (this.interactivePrimitives.selectedLines.length > 0) {
            // Use this.interactivePrimitive.selectedLines before assigning the current one to look up previous selected lines
            // Find the previous selected group
            const pos = this.interactivePrimitives.selectedLines[0].positions;
            const prevGroup = this.coords.groups.find(group =>
                group.coordinates.some(cart => Cartesian3.equals(cart, pos[0]))
            );
            if (!prevGroup) return; // Exit if no previous group is found

            // Find the previous selected lines
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

        // Find the current selected lines
        const currentLines = this.findLinesByPositions(group.coordinates);

        // Highlight the currently selected lines
        currentLines.forEach(line => {
            if (!line.isSubmitted) {    // don't change submitted line color
                this.changeLinePrimitiveColor(line, 'select'); // reset line color
            }
        });

        // Update the selected group and lines
        this.coords.groupToSubmit = group;
        this.interactivePrimitives.selectedLines = currentLines;
    }
}


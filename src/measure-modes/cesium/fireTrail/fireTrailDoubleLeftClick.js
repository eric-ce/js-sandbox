import * as Cesium from "cesium";
import {
    getPickedObjectType,
    showCustomNotification,
} from "../../lib/helper/cesiumHelper.js";


export function handleFireTrailDoubleClick(movement) {
    // don't allow middle click when during other actions
    if (!this.flags.isMeasurementComplete || this.flags.isDragMode) return;

    const pickedObject = this.viewer.scene.pick(movement.position, 1, 1);
    const pickedObjectType = getPickedObjectType(pickedObject, "fire_trail");

    switch (pickedObjectType) {
        case "line":
            setAddModeByLine.call(this, pickedObject.primitive);
            break
    }
}

/**
 * Sets the application to "Add Mode" by selecting the specified line primitive.
 * It resets the previous hovered and selected lines, updates their colors accordingly,
 * and notifies the user about entering add line mode.
 * 
 * @param {Object} linePrimitive - The line primitive object that was selected.
 */
function setAddModeByLine(linePrimitive) {
    // Reset the previously selected line if it exists and is different from the current selection
    if (
        this.interactivePrimitives.addModeLine &&
        this.interactivePrimitives.addModeLine !== linePrimitive
    ) {
        const previousSelectedLine = this.interactivePrimitives.addModeLine;

        let colorToSet;
        if (this.interactivePrimitives.addModeLine.isSubmitted) {
            colorToSet = 'submitted';
        } else if (this.interactivePrimitives.selectedLines.includes(this.interactivePrimitives.addModeLine)) {
            colorToSet = 'select';
        } else {
            colorToSet = 'default';
        }

        this.changeLinePrimitiveColor(previousSelectedLine, colorToSet);
        this.interactivePrimitives.addModeLine = null;
    }

    // reset previous selected lines if any
    this.interactivePrimitives.selectedLines.forEach(line => {
        if (!line.isSubmitted) {
            this.changeLinePrimitiveColor(line, 'default');
        }
    });


    // update the selected lines to the selected line and update its highlight color
    const group = this.coords.groups.find(group =>
        group.coordinates.some(cart => Cesium.Cartesian3.equals(cart, linePrimitive.positions[0]))
    );
    if (!group) return; // error handling: exit if no group is found
    this.measure = group; // set the group as the current measure

    const lines = this.findLinesByPositions(group.coordinates)
    this.interactivePrimitives.selectedLines = lines;
    this.updateSelectedLineColor(group);

    // Change the color of the newly selected line to indicate it is being added
    this.changeLinePrimitiveColor(linePrimitive, 'add');
    // Update the reference to the currently selected line
    this.interactivePrimitives.addModeLine = linePrimitive;

    // Enable add mode if a line is selected
    if (this.interactivePrimitives.addModeLine) {
        this.flags.isAddMode = true;
        // Display a custom notification to inform the user
        showCustomNotification(`Trail id ${group.id} have entered add line mode`, this.viewer.container);

        // Update log table for the current selected line
        const logTable = this.stateManager.getElementState("logTable");
        logTable && logTable._handleModeSelected([{ "line selected": group.id }]);

        // Update group status
        group.status = "pending";
    }
}
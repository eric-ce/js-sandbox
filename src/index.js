import * as Cesium from "cesium";
import 'mainStyle';
// import { MeasureToolbox } from "./MeasureToolbox.js";
import { MapCesium } from "./MapCesium.js";
import { MapLeaflet } from "./MapLeaflet.js";
import { MapGoogle } from "./MapGoogle.js";
import { mapStyle } from "./styles/mapStyle.js";
import EventEmitter from "eventemitter3";
class Navigator {
    constructor() {
        this.div = null;
        this.tabular = null;

        this.activeMapOrder = [];

        this.mapCollection = [
            {
                mapName: "map-cesium",
                map: null,
                activated: false,
            },
            {
                mapName: "map-leaflet",
                map: null,
                activated: false,
            },
            {
                mapName: "map-google",
                map: null,
                activated: false,
            }
        ];

        this.mapEmitter = new EventEmitter();
    }

    async initialMap() {
        // setup map style
        document.adoptedStyleSheets = [mapStyle];

        this.tabular = this._setupTabular();
        this.div = this._setupContainer();
        // this._setupMaps();
        this._setupButtons();
    }
    _setupTabular() {
        this.tabular = document.createElement("div");
        this.tabular.className = "tabular";
        return document.body.appendChild(this.tabular);
    }

    _setupContainer() {
        // the navigator container
        this.div = document.createElement("div");
        this.div.classList.add("navigator-container");

        return document.body.appendChild(this.div);
    }

    _setupButtons() {
        // error handling: if tabular is not setup, setup tabular
        if (!this.tabular) {
            this.tabular = this._setupTabular();
        }

        // create buttons for each map
        this.mapCollection.forEach((map) => {
            const button = document.createElement("button");
            button.innerText = map.mapName;
            button.classList.add(`${map.mapName}-button`, "visible");
            button.addEventListener("click", () => {
                this._toggleMap(map.mapName);
            });
            this.tabular.appendChild(button);
        });
    }

    _toggleMap(mapName) {
        const map = this.mapCollection.find((map) => map.mapName === mapName);
        const button = document.querySelector(`.${mapName}-button`);


        if (map.activated) {
            this._deactivateMap(map, button);
            // Remove from active map order
            this.activeMapOrder = this.activeMapOrder.filter(name => name !== mapName);
        } else {
            this._activateMap(map, button);
            // Add to active map order
            this.activeMapOrder.push(mapName);
        }

        this._updateMapLayout();
    }

    _activateMap(map, button) {
        // Add active class to button
        if (button) {
            button.classList.add('active');
        }

        // Recreate the map element if it doesn't exist or was previously removed
        if (!map.map) {
            // If map exists but was removed, create a new one
            const newMapElement = document.createElement(`${map.mapName}`);
            newMapElement.classList.add(`${map.mapName}`);
            this.div.appendChild(newMapElement);

            // set emitter to the map
            newMapElement.mapEmitter = this.mapEmitter;
            // update this.mapCollection
            map.map = newMapElement;
            console.log(map.map.parentElement)
        }
        map.activated = true;
    }

    _deactivateMap(map, button) {
        // Remove active class from button
        if (button) {
            button.classList.remove('active');
        }

        if (map.map) {
            this.div.removeChild(map.map);
        }
        map.map = null;
        map.activated = false;
    }

    _updateMapLayout() {
        // Order active maps according to activeMapOrder
        const activeMaps = this.activeMapOrder.map(mapName =>
            this.mapCollection.find(map => map.mapName === mapName && map.activated)
        ).filter(Boolean);

        const mapCount = activeMaps.length;

        // Set up the grid container
        if (mapCount > 0) {
            this.div.style.display = "grid";

            if (mapCount === 1) {
                // One map takes full width and height
                this.div.style.gridTemplateColumns = "1fr";
                this.div.style.gridTemplateRows = "1fr";

                activeMaps[0].map.style.gridColumn = "1";
                activeMaps[0].map.style.gridRow = "1";
            }
            else if (mapCount === 2) {
                // Two maps side by side
                this.div.style.gridTemplateColumns = "1fr 1fr";
                this.div.style.gridTemplateRows = "1fr";

                activeMaps[0].map.style.gridColumn = "1"; // First clicked map on left
                activeMaps[0].map.style.gridRow = "1";

                activeMaps[1].map.style.gridColumn = "2"; // Second clicked map on right
                activeMaps[1].map.style.gridRow = "1";
            }
            else if (mapCount >= 3) {
                // Three maps: two on top row, one on bottom
                this.div.style.gridTemplateColumns = "1fr 1fr";
                this.div.style.gridTemplateRows = "1fr 1fr";

                activeMaps[0].map.style.gridColumn = "1"; // First clicked on top left
                activeMaps[0].map.style.gridRow = "1";

                activeMaps[1].map.style.gridColumn = "2"; // Second clicked on top right
                activeMaps[1].map.style.gridRow = "1";

                activeMaps[2].map.style.gridColumn = "1 / span 2"; // Third clicked on bottom
                activeMaps[2].map.style.gridRow = "2";
            }
        } else {
            // No active maps, hide the container or set display to none
            this.div.style.display = "block";
        }
    }
}

// instantiate navigator
const navigator = new Navigator();
navigator.initialMap();


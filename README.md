# Introduction
This is the test environment for `cesium-measure tool`

# Installation
1. `git clone <repo-url>` clone the repo
2. `npm i` to install dependencies
3. `npm run dev` to start local development

# Description
This is a test environment for `cesium-measure tool` using web components, `cesium`, `chart.js`, `turf` and other libraries.


<hr />

# Version

## v3.0 
coming up

## v2.0
### Description:
This version, the tool supports cesium, google maps, and leaflet. The summary of the logic would be `UI -> button -> handler -> mode -> handler -> action logic`. 
The mode contain what it is and how it works, data stored at central place and use single truth data to manage.

### structure:
```
src/
├── assets/
│   └── icons.mjs
├── components/
│   ├── AnnotationComponentBase.mjs
│   ├── CesiumAnnotation.mjs
│   ├── GoogleAnnotation.mjs
│   ├── LeafletAnnotation.mjs
│   ├── AnnotationToolbox.mjs
│   └── shared/
│       ├── DataLogTable.mjs
│       └── InstructionsTable.mjs
├── index.html
├── index.mjs
├── lib/
│   ├── data/
│   │   ├── DataPool.mjs
│   ├── input/
│   │   ├── CesiumInputHandler.mjs
│   │   ├── GoogleMapsInputHandler.mjs
│   │   └── LeafletInputHandler.mjs
│   ├── helper/
│   │   ├── cesiumHelper.mjs
│   │   ├── googleHelper.mjs
│   │   ├── leafletHelper.mjs
│   │   ├── helper.mjs
│   ├── interaction/
│   │   ├── index.mjs
│   │   ├── CesiumDragHandler.mjs
│   │   ├── CesiumHighlightHandler.mjs
│   │   ├── GoogleDragHandler.mjs
│   │   ├── GoogleHighlightHandler.mjs
│   │   ├── LeafletDragHandler.mjs
│   │   └── LeafletHighlightHandler.mjs
│   ├── measure-modes/
│   │   ├── cesium/
│   │   │   ├── HeightCesium.mjs
│   │   │   ├── MultiDistancesCesium.mjs
│   │   │   ├── MultiDistancesClampedCesium.mjs
│   │   │   ├── PickerCesium.mjs
│   │   │   ├── PointInfoCesium.mjs
│   │   │   ├── PolygonCesium.mjs
│   │   │   ├── ProfileCesium.mjs
│   │   │   ├── ProfileDistancesCesium.mjs
│   │   │   ├── ThreePointsCurveCesium.mjs
│   │   │   └── TwoPointsDistanceCesium.mjs
│   │   ├── google/
│   │   │   ├── MultiDistanceGoogle.mjs
│   │   │   ├── PickerGoogle.mjs
│   │   │   ├── PointInfoGoogle.mjs
│   │   │   ├── PolygonGoogle.mjs
│   │   │   └── TwoPointsDistanceGoogle.mjs
│   │   ├── leaflet/
│   │   │   ├── MultiDistanceLeaflet.mjs
│   │   │   ├── PickerLeaflet.mjs
│   │   │   ├── PointInfoLeaflet.mjs
│   │   │   ├── PolygonLeaflet.mjs
│   │   │   └── TwoPointsDistanceLeaflet.mjs
│   ├── index.mjs
│   └── MeasureModeBase.mjs
└── styles/
    ├── sharedStyle.mjs
    └── style.css
```

## v1.0
### Description:
This version, the tool supports only cesium. The summary of the logic would be `UI -> button -> mode -> action logic`.
The mode contain what it is and how it works, measure stored in each mode.

### File Structure
```
src/
│
├── assets/
│   ├── icons.mjs
└── lib/
    ├── features/
    │   ├── fireTrail/
    │   │   ├── FireTrail.mjs
    │   │   ├── fireTrailDoubleLeftClick.mjs
    │   │   ├── fireTrailLeftClick.mjs
    │   │   ├── fireTrailMiddleClick.mjs
    │   │   ├── fireTrailMouseMove.mjs
    │   │   └── fireTrailRightClick.mjs
    │   │
    │   ├── Height.mjs
    │   ├── MeasureModeBase.mjs
    │   ├── MultiDistance.mjs
    │   ├── MultiDistanceClamped.mjs
    │   ├── Picker.mjs
    │   ├── Points.mjs
    │   ├── Polygon.mjs
    │   ├── Profile.mjs
    │   ├── ProfileDistances.mjs
    │   ├── StateManager.mjs
    │   ├── ThreePointsCurve.mjs
    │   └── TwoPointsDistance.mjs
    │
    ├── helper/
    │   ├── helper.mjs
    │   └── MeasureToolbox.mjs
    │
    ├── index.mjs
    └── sharedStyle.mjs
```


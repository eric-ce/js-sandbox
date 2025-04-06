# Introduction
This is the test environment for `cesium-measure tool`

# How to use
1. Clone the repository `git clone <url>`
2. Install dependencies `npm install`
3. Run `npm run dev` to start 

# Description
This is a test environment for `cesium-measure tool` using web components, cesium, chart.js and other libraries.

<br />

Here is the structure of the project:
- `measure-modes` folder contains all the measure modes that is written in class format. Each of the measure modes handle its own data.
- `lib` folder is to handle shared used data and relevant structural features.
- `index`, `MapCesium`, `MapGoogle`, and `mapLeaflet` is to mimic the `Navigator` environment.
- `MeasureToolbox` is the main component that contains the whole application including different measure tools including `cesium measure tool`, `leaflet measure tool` and `google map measure tool`.



# Measure Modes
Here is the list of measure modes:
- `point` mode is to bookmark a point on the map.
- `Distance` mode is to measure the distance between two points.
- `curve` mode is to measure the distance of a curve using three points of start, middle and end.
- `Area` mode is to measure the area of a polygon.
- `Height` mode is to measure the height of a point.
- `multi-distances` mode is to measure the distance of multiple points. 
- `multi-distances-clamped` mode is to measure the distance of multiple points with clamped to ground.
- `profile` mode is to measure the profile of terrain between two points.
- `profile-distances` mode is to measure the profile of terrain between multiple points.

## Extra Modes
- `fire-trail` mode is to measure the distance of multiple points with clamped to ground, and be used to place fire trail on the map.
- `fly-through` mode is to fly and record camera fly path on the map.



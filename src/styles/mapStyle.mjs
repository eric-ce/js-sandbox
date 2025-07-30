export const mapStyle = new CSSStyleSheet();

mapStyle.replaceSync(`
    body{
        height: 90vh;
        width: 100vw;
        max-width: 100%;
    }
    .tabular{
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center; 
        gap: 20px;
        position: sticky;
        top: 0;
        margin: auto;
        width: 100%;
        padding: 5px 0px;
        height: 60px;
        background-color: #de8348;
    }
    .tabular button{
        padding: 5px 10px;
        opacity : 0.95;
        display: flex;
        justify-content: center;
        align-items: center;
        background: rgba(38, 38, 38, 0.95);
        border: 1px solid #444;
        color: #edffff;
        fill: #edffff;
        border-radius: 4px;
        cursor: pointer;
    }
    .tabular button:hover{
        transform: scale(1.1);
        fill: #fff;
        background: #48b;
        border-color: #aef;
        box-shadow: 0 0 8px #fff;
    }
    .tabular button.active {
        color: #000;
        fill: #000;
        background: #adf;
        border-color: #fff;
        box-shadow: 0 0 8px #fff;
        opacity: 0.95
    }
    .navigator-container{
        display: grid;
        height: calc(100% - 50px);
        width: 100%;
        grid-gap: 2px;
    }
    .map-cesium, .map-leaflet, .map-google{
        width: 100%;
        height: 100%;
        min-height: 0;
        min-width: 0;
    }
    .hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none; /* Disable interaction when hidden */
        transition: opacity 0.2s ease-in, transform 0.2s ease-in;
    }
    .visible {
        opacity: 0.95;
        visibility: visible;
        pointer-events: auto; /* Enable interaction when visible */
        transition: opacity 0.2s ease-in-out, transform 0.2s ease-in;
    }
`);
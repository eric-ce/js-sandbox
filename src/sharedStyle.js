export const sharedStyleSheet = new CSSStyleSheet();
// replace the contents of the sharedStyleSheet with the following CSS
sharedStyleSheet.replaceSync(`
    *{
        font-family:Roboto, sans-serif;
    }
    .measure-toolbar{ 
        position:absolute;
        bottom: 6rem;
        left: 10rem;
        display: flex;
    }
    .measure-toolbar button,
    .fire-trail-container button{
        height: 40px;
        width: 45px;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.3s, transform 0.2s; /* Existing transitions */
        color: #e6f8f8;
        opacity: 0.9;
        position: relative; /* For tooltip positioning */
    }
    .measure-toolbar button.active, 
    .fire-trail-container button.active {
        color: #000;
        fill: #000;
        background: #adf;
        border-color: #fff;
        box-shadow: 0 0 8px #fff;
    }
    .measure-toolbar button:hover{
        transform: scale(1.1);
    }
    .measure-tools{
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .measure-mode-button { 
        display: none;
        opacity: 0;
        position: relative;
    }
    .measure-mode-button.show {
        opacity: 0.9;
        display: flex; 
        justify-content: center; /* Center the icon */
        align-items: center;     /* Center the icon */
        height: 40px;
        width: 45px;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.3s, transform 0.2s;
        color: rgb(230, 248, 248);
    }
    .cesium-button{
        margin: 0;
        padding: 0;
    }
    .cesium-button:hover{
        z-index: 2;
    }
    .fire-trail-container{
        position: absolute;
        bottom: 11rem;
        left: 10rem;
        display: flex;
        flex-direction: row;
    }
    .fly-through-container{
        position: absolute;
        bottom: 16rem;
        left: 10rem; 
        display: flex;
        flex-direction: column-reverse;
    }
    .fly-path-container, 
    .kml-container, 
    .screen-recording-container{
        display: flex;
        flex-direction: row;
    }
    .cesium-infoBox{
        width: 250px;
        padding: 5px;
        font-size: 0.8rem;
        border-radius: 7px;
        cursor: grab; /* Indicates it can be moved */  
    }
    .cesium-infoBox table{
        width: 100%;
    }
    .cesium-infoBox td{
        padding: 5px 0;
        border: none;
    }
    .log-box {
        position: absolute;
        height: 250px;
        overflow-y: auto;
        z-index: 2;
        cursor: grab; /* Indicates it can be moved */
        scrollbar-width: thin;
        scrollbar-color: #888 rgba(38, 38, 38, 0.95);
    }
    .toggle-log-box-button{
        cursor : pointer;
        transition : all 0.2s ease-in-out;
        color :  #e6f8f8;
        opacity : 0.9;
        padding: 3px 7px;
    }
    .helpBox-expanded{
        width: 250px;
        background-color: rgba(38, 38, 38, 0.95);
    }
    .messageBox-collapsed{
        width: fit-content;
        height: fit-content;
        background-color: transparent;
        border: none;
        box-shadow: none;
    }
    .logBox-expanded{
        width: 250px;
        height: 250px;
        background-color: rgba(38, 38, 38, 0.95);
    }
    .disabled-button{
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: #46808c;
        padding: 0px;
        border: none;
    }
    .disabled-button:hover{
        cursor: not-allowed;
    }
`);

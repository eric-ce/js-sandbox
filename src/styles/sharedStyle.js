export const sharedStyleSheet = new CSSStyleSheet();
// replace the contents of the sharedStyleSheet with the following CSS
sharedStyleSheet.replaceSync(`
    *{
        font-family: Roboto, sans-serif;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    .measure-toolbar{ 
        display: flex;
        flex-direction: row;
    }
    .measure-toolbar button.active, 
    .fire-trail-toolbar button.active {
        background-color: #adf;
        border-color: #fff;
        color: #000;
        fill: #000;
        box-shadow: 0px 2px 6px rgba(0, 0, 0, 0.2); 
        transform: scale(0.98); 
        z-index: 4;
    }
    .measure-toolbar button:hover,
    .fire-trail-toolbar button:hover,
    .fly-through-toolbar button:hover{
        transform: scale(1.05);
    }
    .measure-tools{
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
    }
    .toolbar-container{
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
    }
    .fire-trail-toolbar{
        position: absolute;
        // bottom: 200px;
        // left: 135px;
        display: flex;
        flex-direction: row;
    }
    .fly-through-toolbar{
        position: absolute;
        // bottom: 240px;
        // left: 135px; 
        display: flex;
        flex-direction: column-reverse;
        height: fit-content;
    }
    .fly-path-container, 
    .kml-container, 
    .screen-recording-container{
        display: flex;
        flex-direction: row;
    }
    .info-box {
        padding: 5px;
        font-size: 0.8rem;
        max-width: 250px;
        height: 250px;
        background: rgba(38, 38, 38, 0.95);
        color: #edffff;
        border: 1px solid #444;
        border-radius: 5px;
        box-shadow: 0 0 10px 1px #000;
        opacity: 0; /* Hidden by default */
    }
    .log-box,
    .help-box{
        width: 250px;
        max-width: 250px;
        max-height: 250px;
        background-color: rgba(38, 38, 38, 0.95);
        opacity: 0.95;
        cursor: grab; /* Indicates it can be moved */ 
        scrollbar-width: thin;
        scrollbar-color: #edffff rgba(38, 38, 38, 0) ;
        z-index: 2;
        overflow: scroll; 
    }
    .help-box{
        max-height: 150px;
    }
    .log-box table, 
    .help-box table{
        width: 100%;
    }
    .log-box td, 
    .help-box td{
        padding: 5px 0;
        border: none;
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
    .annotate-button{
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        background-color: rgba(38, 38, 38, 0.95);
        color: #edffff;
        fill: #edffff;
        border: 1px solid #444;
        border-radius: 12px; 
        cursor: pointer;
        overflow: hidden;
        user-select: none;
        height: 44px; 
        width: 44px;
        transition: background-color 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease;
        z-index: 2;
    }
    .annotate-button:hover {
        background-color: #4488bb;
        border-color: #aaeeff;
        fill: #ffffff;
        box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.15); 
        transform: scale(1.05); 
        z-index: 3;
    }
    .annotate-button.animate-on-show.visible {
        animation: jumpIn 0.3s ease-out;
    }
    .disabled-button{
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        background-color: #46808c;
        padding: 0px;
        border: none;
    }
    .disabled-button:hover{
        cursor: not-allowed;
    }
    @keyframes jumpIn {
        0% {
            transform: translateY(15px);
            opacity: 0;
        }
        50% {
            transform: translateY(-5px);
            opacity: 0.95;
        }
        100% {
            transform: translateY(0);
        }
    }
`);

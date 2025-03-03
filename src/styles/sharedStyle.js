export const sharedStyleSheet = new CSSStyleSheet();
// replace the contents of the sharedStyleSheet with the following CSS
sharedStyleSheet.replaceSync(`
    *{
        font-family: Roboto, sans-serif;
    }
    .measure-toolbar{ 
        position: absolute;
        bottom: 120px;
        left: 135px;
        display: flex;
    }
    .measure-toolbar button.active, 
    .fire-trail-container button.active {
        color: #000;
        fill: #000;
        background: #adf;
        border-color: #fff;
        box-shadow: 0 0 8px #fff;
    }
    .measure-toolbar button:hover,
    .fire-trail-container button:hover,
    .fly-through-container button:hover{
        transform: scale(1.1);
    }
    .measure-tools{
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .fire-trail-container{
        position: absolute;
        bottom: 200px;
        left: 135px;
        display: flex;
        flex-direction: row;
    }
    .fly-through-container{
        position: absolute;
        bottom: 240px;
        left: 135px; 
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
        max-height: 250px;
        background-color: rgba(38, 38, 38, 0.95);
        opacity: 0.95;
        cursor: grab; /* Indicates it can be moved */ 
        scrollbar-width: thin;
        scrollbar-color: #edffff rgba(38, 38, 38, 0) ;
        z-index: 2;
        overflow: scroll; 
        user-select: text;
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
        overflow: hidden;
        user-select: none;
        height: 40px;
        width: 45px;
        border-radius: 5px;
        z-index: 2;
    }
    .annotate-button:hover{
        transform: scale(1.1);
        fill: #fff;
        background: #48b;
        border-color: #aef;
        box-shadow: 0 0 8px #fff;
        z-index: 3;
    }
    .annotate-button.animate-on-show.visible {
        animation: jumpIn 0.3s ease-out;
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

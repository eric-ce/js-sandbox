const template = document.createElement("template");
template.innerHTML = `
    <style>
        label {
            color: red;
            display: block;
        }
        .description{
            font-size: .65rem;
             font-weight: lighter;
             color: #777;
        }
    </style>
    <label>
    <input type="checkbox" />
    <slot></slot> 
    <div class="description">
        <slot name="description"></slot>
</div>
    </label>
`;

class itemsList extends HTMLElement {
    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open" });
        shadow.appendChild(template.content.cloneNode(true));
        this.checkbox = shadow.querySelector("input");
    }

    static get observedAttributes() {
        return ["checked"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "checked") {
            this.updateChecked(newValue);
        }
    }

    connectedCallback() {
        console.log("connected");
    }

    disconnectedCallback() {
        console.log("disconnected");
    }

    updateChecked(value) {
        if (value != null && value !== false) {
            this.checkbox.checked = value;
        }
        // this.checkbox.checked = value != null && value !== false;
    }
}

customElements.define("items-list", itemsList);

//get the first item-list element
const item = document.querySelector("items-list");
let checked = true;
setInterval(() => {
    checked = !checked;
    item.setAttribute("checked", checked);
}, 1500);

// item.remove();

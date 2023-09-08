class HellowWorld extends HTMLElement{
    constructor() {
        super();
        this.innerHTML = '<h1>Hello World</h1>';
    }
}

customElements.define('hello-world', HellowWorld);
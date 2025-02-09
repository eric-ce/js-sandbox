export default class ListenerClass {
    constructor(emitter) {
        this.emitter = emitter;
        this.setupListener();
    }

    setupListener() {
        this.emitter.on('actionPerformed', (data) => console.log("catch msg", data));
    }
}
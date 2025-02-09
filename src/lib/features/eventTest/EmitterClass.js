import EventEmitter from "eventemitter3";

export default class EmitterClass extends EventEmitter {
    constructor() {
        super();
    }

    performAction() {
        // const data1 = [1, 2, 3];
        // const data2= this.testAction();
        // const combinedData = [...data1, ...data2];
        // console.log(combinedData, "emitter is running");
        this.emit('actionPerformed', this.testAction());
    }

    testAction() {
        const data2 = [4, 5, 6];
        console.log(data2, "emitter is running");
        return data2;
    }
}
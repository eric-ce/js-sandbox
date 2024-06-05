class Car {
    constructor() {
        this.model = 'Toyota Camry';
        this.year = 2021;
        this.fuel = 'Gasoline';
    }

    // Method to display information
    displayInfo() {

        console.log(`Model: ${this.model}, Year: ${this.year}`);
        this.updateYear(2022)
        console.log(`Model: ${this.model}, Year: ${this.year}`);
    }

    // Method to update the model
    updateModel(newModel) {
        this.model = newModel;
        console.log(`Model updated to: ${this.model}`);
    }

    // Method to update the year
    updateYear(newYear) {
        this.year = newYear;
    }
}

class ElectricCar extends Car {
    constructor(model, year, batteryCapacity) {
        super(model, year);  // Call the parent class constructor
        this.model = model;  // Overriding the model property
        this.year = year;    // Overriding the year property
        this.batteryCapacity = batteryCapacity;  // New property specific to ElectricCar
    }

    displayInfo() {
        // Overriding the displayInfo method to include battery capacity
        super.displayInfo(); // Call the parent method
        console.log(`Battery Capacity: ${this.batteryCapacity} kWh`);
    }

    updateBattery(newCapacity) {
        this.batteryCapacity = newCapacity;
        console.log(`Battery capacity updated to: ${this.batteryCapacity} kWh`);
    }
}

// Example usage:
const myCar = new Car();
myCar.displayInfo();

const myElectricCar = new ElectricCar('Tesla Model 3', 2024, 75);
myElectricCar.displayInfo(); // Output: Model: Tesla Model 3, Year: 2021
//         Battery Capacity: 75 kWh


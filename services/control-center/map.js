const WIDTH = 20;
const HEIGHT = 20;

const islandMap = [];

for (let y = 0; y < HEIGHT; y++) {

    const row = [];

    for (let x = 0; x < WIDTH; x++) {

        row.push({
            x,
            y,
            type: Math.random() > 0.3 ? "land" : "water",
            infrastructure: null,
            incidents: []
        });
    }

    islandMap.push(row);
}

function placeInfrastructure(x, y, type) {

    islandMap[y][x].type = "land";

    islandMap[y][x].infrastructure = {
        type
    };
}

placeInfrastructure(2, 2, "charging_station"); // C
placeInfrastructure(5, 8, "bridge"); // B
placeInfrastructure(10, 4, "harbor"); // H
placeInfrastructure(15, 15, "depot"); // D

module.exports = {
    islandMap,
    WIDTH,
    HEIGHT
};
const http = require("http");

function sendIncident() {

    const waterLevel = Math.floor(
        Math.random() * 120
    );

    console.log(
        "Water level:",
        waterLevel
    );

    if (waterLevel > 80) {

        const data = JSON.stringify({
            type: "water_level_alert",
            sensor: "water-sensor-1",
            value: waterLevel,
            x: Math.floor(Math.random() * 20),
            y: Math.floor(Math.random() * 20)
        });

        const req = http.request({
            hostname: "control-center",
            port: 8080,
            path: "/incident",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length
            }
        });

        req.write(data);

        req.end();

        console.log("Incident sent");
    }
}

setInterval(sendIncident, 5000);
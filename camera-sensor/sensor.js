const http = require("http");

function sendIncident() {

    const confidence = Math.random();

    console.log(
        "Person confidence:",
        confidence
    );

    if (confidence > 0.8) {

        const data = JSON.stringify({
            type: "person_detected",
            sensor: "camera-1",
            confidence,
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

setInterval(sendIncident, 7000);
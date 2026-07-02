const { randomUUID } = require("crypto");
const http = require("http");
const mqtt = require("mqtt");

const sensorId = "water-sensor-1";
const mqttUrl = process.env.MQTT_URL || "mqtt://mqtt-broker:1883";
const eventTopic = `island/events/water-sensor/${sensorId}`;
const statusTopic = `island/status/${sensorId}`;
let measurementInterval;

const client = mqtt.connect(mqttUrl, {
    clientId: sensorId,
    clean: true,
    will: {
        topic: statusTopic,
        payload: JSON.stringify({ componentId: sensorId, status: "offline" }),
        qos: 1,
        retain: true
    }
});

function registerSensor() {
    const data = JSON.stringify({
        id: sensorId,
        type: "water-level",
        measurement: "water_level_cm"
    });
    const req = http.request({
        hostname: "control-center",
        port: 8080,
        path: "/sensor",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
        }
    }, (res) => {
        console.log(`Registered ${sensorId}: HTTP ${res.statusCode}`);
        res.resume();
    });

    req.on("error", (error) => {
        console.error("Sensor registration failed:", error.message);
        setTimeout(registerSensor, 3000);
    });
    req.write(data);
    req.end();
}

function publishMeasurement() {
    const waterLevel = Math.floor(Math.random() * 120);
    let eventType = "water_level_reading";
    if (waterLevel > 105) eventType = "bridge_damage";
    else if (waterLevel > 80) eventType = "water_level_alert";
    else if (waterLevel < 10) eventType = "material_request";

    const event = {
        messageId: randomUUID(),
        timestamp: new Date().toISOString(),
        sourceId: sensorId,
        sourceType: "water-sensor",
        eventType,
        x: Math.floor(Math.random() * 20),
        y: Math.floor(Math.random() * 20),
        measurement: {
            name: "water_level_cm",
            value: waterLevel,
            unit: "cm",
            threshold: 80
        }
    };

    client.publish(eventTopic, JSON.stringify(event), { qos: 1 }, (error) => {
        if (error) {
            console.error("MQTT publish failed:", error.message);
            return;
        }
        console.log(`${event.eventType}: ${waterLevel} cm`);
    });
}

client.on("connect", () => {
    console.log(`${sensorId} connected to MQTT`);
    client.publish(statusTopic, JSON.stringify({
        componentId: sensorId,
        status: "online",
        timestamp: new Date().toISOString()
    }), { qos: 1, retain: true });

    registerSensor();
    if (!measurementInterval) {
        publishMeasurement();
        measurementInterval = setInterval(publishMeasurement, 5000);
    }
});

client.on("error", error => console.error("MQTT error:", error.message));

process.on("SIGTERM", () => {
    clearInterval(measurementInterval);
    client.publish(statusTopic, JSON.stringify({
        componentId: sensorId,
        status: "offline",
        timestamp: new Date().toISOString()
    }), { qos: 1, retain: true }, () => client.end());
});

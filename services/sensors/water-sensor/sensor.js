const { randomUUID } = require("crypto");
const env = require("../../shared/config");
const { createRegistration } = require("../../shared/registration");
const mqtt = require("mqtt");

const sensorId = env.identifier("SENSOR_ID", "water-sensor-1");
const mqttUrl = env.mqttUrl();
const controlCenterHost = env.text("CONTROL_CENTER_HOST", "control-center");
const controlCenterPort = env.port("CONTROL_CENTER_HTTP_PORT", 8080);
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

function getEventType(waterLevel) {
    if (waterLevel > 105) return "bridge_damage";
    if (waterLevel > 80) return "water_level_alert";
    if (waterLevel < 10) return "material_request";
    return "water_level_reading";
}

function publishStatus(status, done) {
    client.publish(statusTopic, JSON.stringify({
        componentId: sensorId,
        status,
        timestamp: new Date().toISOString()
    }), { qos: 1, retain: true }, done);
}

const registration = createRegistration({
    host: controlCenterHost,
    port: controlCenterPort,
    path: "/sensor",
    label: sensorId,
    getPayload: () => ({
        id: sensorId,
        type: "water-level",
        measurement: "water_level_cm"
    })
});

function publishMeasurement() {
    const waterLevel = Math.floor(Math.random() * 120);

    const event = {
        messageId: randomUUID(),
        timestamp: new Date().toISOString(),
        sourceId: sensorId,
        sourceType: "water-sensor",
        eventType: getEventType(waterLevel),
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
    publishStatus("online");

    registration.start();
    if (!measurementInterval) {
        publishMeasurement();
        measurementInterval = setInterval(publishMeasurement, 5000);
    }
});

client.on("error", error => console.error("MQTT error:", error.message));

process.on("SIGTERM", () => {
    registration.stop();
    clearInterval(measurementInterval);
    publishStatus("offline", () => client.end());
});

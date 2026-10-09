const { randomUUID } = require("crypto");
const env = require("../../shared/config");
const { createRegistration } = require("../../shared/registration");
const mqtt = require("mqtt");

const sensorId = env.identifier("SENSOR_ID", "camera-1");
const mqttUrl = env.mqttUrl();
const controlCenterHost = env.text("CONTROL_CENTER_HOST", "control-center");
const controlCenterPort = env.port("CONTROL_CENTER_HTTP_PORT", 8080);
const eventTopic = `island/events/camera/${sensorId}`;
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

function getEventType(confidence) {
    if (confidence > 0.95) return "structure_damage";
    if (confidence > 0.8) return "person_detected";
    if (confidence < 0.05) return "supply_low";
    return "camera_observation";
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
        type: "camera",
        measurement: "person_confidence"
    })
});

function publishMeasurement() {
    const confidence = Number(Math.random().toFixed(3));

    const event = {
        messageId: randomUUID(),
        timestamp: new Date().toISOString(),
        sourceId: sensorId,
        sourceType: "camera",
        eventType: getEventType(confidence),
        x: Math.floor(Math.random() * 20),
        y: Math.floor(Math.random() * 20),
        measurement: {
            name: "person_confidence",
            value: confidence,
            threshold: 0.8
        }
    };

    client.publish(eventTopic, JSON.stringify(event), { qos: 1 }, (error) => {
        if (error) {
            console.error("MQTT publish failed:", error.message);
            return;
        }
        console.log(`${event.eventType}: confidence ${confidence}`);
    });
}

client.on("connect", () => {
    console.log(`${sensorId} connected to MQTT`);
    publishStatus("online");

    registration.start();
    if (!measurementInterval) {
        publishMeasurement();
        measurementInterval = setInterval(publishMeasurement, 7000);
    }
});

client.on("error", error => console.error("MQTT error:", error.message));

process.on("SIGTERM", () => {
    registration.stop();
    clearInterval(measurementInterval);
    publishStatus("offline", () => client.end());
});

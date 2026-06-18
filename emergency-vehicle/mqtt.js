const { randomUUID } = require("crypto");
const mqtt = require("mqtt");

function createVehicleMqtt({ config, state }) {
    const processedHazards = new Set();
    const telemetryTopic = `island/telemetry/${config.vehicleId}`;
    const statusTopic = `island/status/${config.vehicleId}`;
    let telemetryInterval;

    const client = mqtt.connect(config.mqttUrl, {
        clientId: config.vehicleId,
        clean: true,
        will: {
            topic: statusTopic,
            payload: JSON.stringify({ componentId: config.vehicleId, status: "offline" }),
            qos: 1,
            retain: true
        }
    });

    function publishTelemetry(message, extra = {}) {
        const telemetry = {
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
            vehicleId: config.vehicleId,
            type: config.type,
            role: config.role,
            rpcHost: config.rpcHost,
            rpcPort: config.rpcPort,
            capabilities: config.capabilities,
            missionId: state.missionId,
            status: state.status,
            progress: state.progress,
            position: state.position,
            message,
            ...extra
        };
        client.publish(telemetryTopic, JSON.stringify(telemetry), { qos: 1 }, error => {
            if (error) console.error("Telemetry publish failed:", error.message);
        });
    }

    function handleHazard(payload) {
        if (
            config.role === "drone" ||
            payload.eventType !== "water_level_alert" ||
            processedHazards.has(payload.messageId)
        ) return;

        processedHazards.add(payload.messageId);
        if (processedHazards.size > 100) {
            processedHazards.delete(processedHazards.values().next().value);
        }
        publishTelemetry(`${config.vehicleId} passt die Route wegen Hochwasser an`, {
            event: "hazard_avoided",
            hazard: {
                type: payload.eventType,
                x: payload.x,
                y: payload.y,
                action: "route_adjusted"
            }
        });
    }

    client.on("connect", () => {
        console.log(`${config.vehicleId} connected to MQTT`);
        client.publish(statusTopic, JSON.stringify({
            componentId: config.vehicleId,
            status: "online",
            timestamp: new Date().toISOString()
        }), { qos: 1, retain: true });
        client.subscribe("island/events/+/+", { qos: 1 }, error => {
            if (error) console.error("Hazard subscription failed:", error.message);
        });
        publishTelemetry(`${config.vehicleId} ist einsatzbereit`);
        if (!telemetryInterval) {
            telemetryInterval = setInterval(
                () => publishTelemetry(`${config.vehicleId} heartbeat`),
                5000
            );
        }
    });
    client.on("message", (_topic, message) => {
        try {
            handleHazard(JSON.parse(message.toString()));
        } catch (error) {
            console.error("Invalid hazard message:", error.message);
        }
    });
    client.on("error", error => console.error("MQTT error:", error.message));

    function stop() {
        clearInterval(telemetryInterval);
        client.publish(statusTopic, JSON.stringify({
            componentId: config.vehicleId,
            status: "offline",
            timestamp: new Date().toISOString()
        }), { qos: 1, retain: true }, () => client.end());
    }

    return { publishTelemetry, stop };
}

module.exports = { createVehicleMqtt };

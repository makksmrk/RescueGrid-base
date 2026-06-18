const mqtt = require("mqtt");

function startMqtt({ mqttUrl, state, missions }) {
    const processedMessageIds = new Map();
    const componentConnections = new Map();

    function acceptMessage(payload) {
        if (!payload.messageId || !payload.timestamp) {
            throw new Error("MQTT message requires messageId and timestamp");
        }
        if (processedMessageIds.has(payload.messageId)) {
            state.mqttState.duplicatesIgnored++;
            return false;
        }

        const messageTime = Date.parse(payload.timestamp);
        if (!Number.isFinite(messageTime) || Date.now() - messageTime > 60_000) {
            state.mqttState.oldMessagesIgnored++;
            return false;
        }

        processedMessageIds.set(payload.messageId, Date.now());
        for (const [messageId, receivedAt] of processedMessageIds) {
            if (Date.now() - receivedAt > 300_000) processedMessageIds.delete(messageId);
        }
        state.mqttState.processedMessages++;
        state.mqttState.lastMessageAt = new Date().toISOString();
        return true;
    }

    function addConnectionState(component) {
        const connection = componentConnections.get(component.id);
        if (connection) {
            component.connectionStatus = connection.status;
            component.connectionUpdatedAt = connection.timestamp;
        }
        return component;
    }

    function handleSensorEvent(payload) {
        if (!acceptMessage(payload)) return;

        missions.upsertSensor(addConnectionState({
            id: payload.sourceId,
            type: payload.sourceType === "water-sensor" ? "water-level" : payload.sourceType,
            sourceType: payload.sourceType,
            status: "online",
            lastSeenAt: payload.timestamp,
            lastEventType: payload.eventType,
            lastMeasurement: payload.measurement
        }));

        if (!missions.getMissionType({ type: payload.eventType, hardToReach: payload.hardToReach })) return;

        const result = missions.createIncident({
            type: payload.eventType,
            sensor: payload.sourceId,
            x: payload.x,
            y: payload.y,
            measurement: payload.measurement,
            value: payload.measurement ? payload.measurement.value : undefined,
            messageId: payload.messageId,
            createdAt: payload.timestamp,
            hardToReach: payload.hardToReach === true
        }, "mqtt");

        console.log(result.merged
            ? `Merged MQTT incident ${result.incident.id}`
            : `Created MQTT incident ${result.incident.id}`);
    }

    function handleVehicleTelemetry(payload) {
        if (!acceptMessage(payload)) return;

        const update = addConnectionState({
            id: payload.vehicleId,
            type: payload.type,
            role: payload.role,
            rpcHost: payload.rpcHost,
            rpcPort: payload.rpcPort,
            capabilities: payload.capabilities,
            status: payload.status,
            position: payload.position,
            progress: payload.progress,
            currentMissionId: payload.status === "IDLE" ? null : payload.missionId,
            lastTelemetryAt: payload.timestamp,
            lastMessage: payload.message
        });
        if (payload.error) update.lastError = payload.error;
        if (payload.hazard) update.lastHazardAction = payload.hazard;

        const unit = missions.upsertUnit(update);
        if (payload.missionId) {
            const mission = state.missions.find(item => item.id === payload.missionId);
            if (mission) {
                mission.status = payload.status;
                mission.progress = payload.progress;
                mission.message = payload.message;
                mission.position = payload.position;
                mission.updatedAt = payload.timestamp;
                if (payload.error) mission.error = payload.error;
            }
        }
        console.log(`Telemetry ${unit.id}: ${unit.status}, ${unit.progress}%`);
    }

    function handleComponentStatus(payload) {
        const connection = {
            status: payload.status,
            timestamp: payload.timestamp || new Date().toISOString()
        };
        componentConnections.set(payload.componentId, connection);

        const component = state.units.find(item => item.id === payload.componentId) ||
            state.sensors.find(item => item.id === payload.componentId);
        if (component) Object.assign(component, {
            connectionStatus: connection.status,
            connectionUpdatedAt: connection.timestamp
        });
    }

    const client = mqtt.connect(mqttUrl, { clientId: "control-center", clean: true });
    client.on("connect", () => {
        state.mqttState.connected = true;
        console.log(`Control center connected to MQTT at ${mqttUrl}`);
        client.subscribe(["island/events/+/+", "island/telemetry/+", "island/status/+"],
            { qos: 1 },
            error => {
                if (error) console.error("MQTT subscription failed:", error.message);
            });
    });
    client.on("reconnect", () => state.mqttState.connected = false);
    client.on("close", () => state.mqttState.connected = false);
    client.on("error", error => console.error("MQTT error:", error.message));
    client.on("message", (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            if (topic.startsWith("island/events/")) handleSensorEvent(payload);
            else if (topic.startsWith("island/telemetry/")) handleVehicleTelemetry(payload);
            else if (topic.startsWith("island/status/")) handleComponentStatus(payload);
        } catch (error) {
            console.error(`Invalid MQTT message on ${topic}:`, error.message);
        }
    });

    return client;
}

module.exports = { startMqtt };

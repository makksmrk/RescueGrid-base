const mqtt = require("mqtt");
const { validateSensor, validateTelemetry, validateComponentStatus } = require("./validation");
const { MAX_MESSAGE_AGE_MS, validateEnvelope, validateCoordination, validateSensorEvent, compareRequests } = require("../shared/mqtt");

const MESSAGE_TTL_MS = 300_000;
const MAX_COORDINATION_MESSAGES = 100;

function startMqtt({ mqttUrl, state, missions, width, height }) {
    const processedMessageIds = new Map();
    const componentConnections = new Map();
    const coordinationClocks = new Map();
    const coordinationTopic = `island/coordination/${state.coordination.resourceId}`;

    function acceptMessage(payload) {
        const messageTime = validateEnvelope(payload);
        if (processedMessageIds.has(payload.messageId)) {
            state.mqttState.duplicatesIgnored++;
            return false;
        }

        if (Date.now() - messageTime > MAX_MESSAGE_AGE_MS) {
            state.mqttState.oldMessagesIgnored++;
            return false;
        }

        processedMessageIds.set(payload.messageId, Date.now());
        for (const [messageId, receivedAt] of processedMessageIds) {
            if (Date.now() - receivedAt > MESSAGE_TTL_MS) processedMessageIds.delete(messageId);
        }
        state.mqttState.processedMessages++;
        state.mqttState.lastMessageAt = new Date().toISOString();
        return true;
    }

    function findComponent(componentId) {
        return state.units.find(item => item.id === componentId) ||
            state.sensors.find(item => item.id === componentId);
    }

    function addConnectionState(component) {
        const connection = componentConnections.get(component.id);
        if (connection) {
            component.connectionStatus = connection.status;
            component.connectionUpdatedAt = connection.timestamp;
        }
        return component;
    }

    function handleSensorEvent(payload, topic) {
        validateSensorEvent(payload, topic, width, height);
        const sensor = validateSensor({
            id: payload.sourceId,
            type: payload.sourceType === "water-sensor" ? "water-level" : payload.sourceType,
            measurement: payload.measurement?.name
        });
        if (!missions.getMissionType({ type: payload.eventType }) &&
            !["water_level_reading", "camera_observation"].includes(payload.eventType)) {
            throw new Error("Unknown sensor event type");
        }
        if (!acceptMessage(payload)) return;
        const existing = state.sensors.find(item => item.id === sensor.id);
        if (existing && Date.parse(payload.timestamp) < Date.parse(existing.lastSeenAt)) return;
        const result = missions.getMissionType({ type: payload.eventType })
            ? missions.createIncident({
                type: payload.eventType,
                sensor: payload.sourceId,
                x: payload.x,
                y: payload.y,
                measurement: payload.measurement,
                value: payload.measurement?.value,
                messageId: payload.messageId,
                createdAt: payload.timestamp,
                hardToReach: payload.hardToReach
            }, "mqtt") : null;

        missions.upsertSensor(addConnectionState({
            ...sensor,
            sourceType: payload.sourceType,
            status: "online",
            lastSeenAt: payload.timestamp,
            lastEventType: payload.eventType,
            lastMeasurement: payload.measurement
        }));
        if (!result) return;
        console.log(result.merged
            ? `Merged MQTT incident ${result.incident.id}`
            : `Created MQTT incident ${result.incident.id}`);
    }

    function handleVehicleTelemetry(payload, topic) {
        const unitData = validateTelemetry(payload, topic, width, height);
        if (payload.charging.resourceId !== state.coordination.resourceId) throw new Error("Unknown charging resource");
        if (!acceptMessage(payload)) return;

        const update = addConnectionState({
            ...unitData,
            battery: payload.battery,
            position: payload.position,
            progress: payload.progress,
            charging: payload.charging,
            currentMissionId: payload.status === "IDLE" ? null : payload.missionId,
            lastTelemetryAt: payload.timestamp,
            lastMessage: payload.message
        });
        if (payload.error) update.lastError = payload.error;
        if (payload.reportError) update.lastReportError = payload.reportError;
        if (payload.hazard) update.lastHazardAction = payload.hazard;

        const unit = missions.upsertUnit(update, payload.missionReport);
        console.log(`Telemetry ${unit.id}: ${unit.status},work progress: ${unit.progress}%`);
    }

    function handleComponentStatus(payload, topic) {
        validateComponentStatus(payload, topic);
        const connection = {
            status: payload.status,
            timestamp: payload.timestamp || new Date().toISOString()
        };
        const previous = componentConnections.get(payload.componentId);
        if (previous && Date.parse(connection.timestamp) < Date.parse(previous.timestamp)) return;
        componentConnections.set(payload.componentId, connection);

        const component = findComponent(payload.componentId);
        if (component) {
            const update = {
                id: component.id,
                connectionStatus: connection.status,
                connectionUpdatedAt: connection.timestamp
            };
            if (state.units.includes(component)) missions.upsertUnit(update);
            else Object.assign(component, update);
        }
    }

    function rememberCoordinationMessage(payload) {
        state.coordination.messages.push({
            type: payload.type,
            vehicleId: payload.vehicleId,
            toVehicleId: payload.toVehicleId,
            requestId: payload.requestId,
            logicalTime: payload.logicalTime,
            timestamp: payload.timestamp
        });
        if (state.coordination.messages.length > MAX_COORDINATION_MESSAGES) {
            state.coordination.messages.shift();
        }
    }

    function sortPendingRequests() {
        state.coordination.pendingRequests.sort(compareRequests);
    }

    function upsertPendingRequest(payload) {
        const existing = state.coordination.pendingRequests.find(request =>
            request.vehicleId === payload.vehicleId
        );
        const request = {
            vehicleId: payload.vehicleId,
            requestId: payload.requestId,
            logicalTime: payload.logicalTime,
            requestedAt: payload.timestamp
        };

        if (existing) Object.assign(existing, request);
        else state.coordination.pendingRequests.push(request);

        sortPendingRequests();
    }

    function removePendingRequest(payload) {
        state.coordination.pendingRequests = state.coordination.pendingRequests.filter(request =>
            request.vehicleId !== payload.vehicleId || request.requestId !== payload.requestId
        );
    }

    function handleCoordinationMessage(payload) {
        validateCoordination(payload, state.coordination.resourceId);
        const unit = state.units.find(item => item.id === payload.vehicleId);
        if (!unit) throw new Error("Unknown coordination participant");
        if (!acceptMessage(payload)) return;
        if (payload.logicalTime <= (coordinationClocks.get(payload.vehicleId) || 0)) return;
        coordinationClocks.set(payload.vehicleId, payload.logicalTime);
        rememberCoordinationMessage(payload);

        unit.lastCoordinationEvent = payload.type;
        unit.logicalClock = payload.logicalTime;

        switch (payload.type) {
            case "REQUEST":
                upsertPendingRequest(payload);
                break;
            case "ENTER":
                removePendingRequest(payload);
                state.coordination.currentUser = payload.vehicleId;
                state.coordination.currentRequestId = payload.requestId;
                state.coordination.currentOrder = {
                    logicalTime: payload.requestLogicalTime,
                    vehicleId: payload.vehicleId
                };
                state.coordination.enteredAt = payload.timestamp;
                break;
            case "LEAVE":
                removePendingRequest(payload);
                if (state.coordination.currentUser === payload.vehicleId && state.coordination.currentRequestId === payload.requestId) {
                    state.coordination.currentUser = null;
                    state.coordination.currentRequestId = null;
                    state.coordination.currentOrder = null;
                    state.coordination.leftAt = payload.timestamp;
                    state.coordination.completedAccesses++;
                }
                break;
        }
    }

    const client = mqtt.connect(mqttUrl, { clientId: "control-center", clean: true });
    client.on("connect", () => {
        state.mqttState.connected = false;
        console.log(`Control center connected to MQTT at ${mqttUrl}`);
        client.subscribe(["island/events/+/+", "island/telemetry/+", "island/status/+", coordinationTopic],
            { qos: 1 },
            error => {
                if (error) console.error("MQTT subscription failed:", error.message);
                else state.mqttState.connected = true;
            });
    });
    client.on("reconnect", () => state.mqttState.connected = false);
    client.on("close", () => state.mqttState.connected = false);
    client.on("error", error => console.error("MQTT error:", error.message));
    client.on("message", (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            if (topic.startsWith("island/events/")) handleSensorEvent(payload, topic);
            else if (topic.startsWith("island/telemetry/")) handleVehicleTelemetry(payload, topic);
            else if (topic.startsWith("island/status/")) handleComponentStatus(payload, topic);
            else if (topic === coordinationTopic) handleCoordinationMessage(payload);
        } catch (error) {
            console.error(`Invalid MQTT message on ${topic}:`, error.message);
        }
    });

    return client;
}

module.exports = { startMqtt };

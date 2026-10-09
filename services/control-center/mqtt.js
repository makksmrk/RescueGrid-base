const mqtt = require("mqtt");

const MESSAGE_TTL_MS = 300_000;
const MAX_COORDINATION_MESSAGES = 100;

function startMqtt({ mqttUrl, state, missions }) {
    const processedMessageIds = new Map();
    const componentConnections = new Map();
    const coordinationTopic = `island/coordination/${state.coordination.resourceId}`;

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
            battery: payload.battery,
            position: payload.position,
            progress: payload.progress,
            charging: payload.charging || payload.resourceUse,
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
                mission.position = payload.position;
                mission.updatedAt = payload.timestamp;
                if (payload.error) mission.error = payload.error;
            }
        }
        console.log(`Telemetry ${unit.id}: ${unit.status},work progress: ${unit.progress}%`);
    }

    function handleComponentStatus(payload) {
        const connection = {
            status: payload.status,
            timestamp: payload.timestamp || new Date().toISOString()
        };
        componentConnections.set(payload.componentId, connection);

        const component = findComponent(payload.componentId);
        if (component) Object.assign(component, {
            connectionStatus: connection.status,
            connectionUpdatedAt: connection.timestamp
        });
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
        state.coordination.pendingRequests.sort((left, right) => {
            if (left.logicalTime !== right.logicalTime) return left.logicalTime - right.logicalTime;
            return left.vehicleId.localeCompare(right.vehicleId);
        });
    }

    function upsertPendingRequest(payload) {
        const existing = state.coordination.pendingRequests.find(request =>
            request.vehicleId === payload.vehicleId && request.requestId === payload.requestId
        );
        const request = {
            vehicleId: payload.vehicleId,
            requestId: payload.requestId,
            logicalTime: Number(payload.logicalTime) || 0,
            requestedAt: payload.timestamp
        };

        if (existing) Object.assign(existing, request);
        else state.coordination.pendingRequests.push(request);

        sortPendingRequests();
    }

    function removePendingRequest(payload) {
        state.coordination.pendingRequests = state.coordination.pendingRequests.filter(request =>
            request.requestId !== payload.requestId
        );
    }

    function handleCoordinationMessage(payload) {
        if (!acceptMessage(payload)) return;
        rememberCoordinationMessage(payload);

        const unit = state.units.find(item => item.id === payload.vehicleId);
        if (unit) {
            unit.lastCoordinationEvent = payload.type;
            unit.logicalClock = payload.logicalTime;
        }

        switch (payload.type) {
            case "REQUEST":
                upsertPendingRequest(payload);
                break;
            case "ENTER":
                removePendingRequest(payload);
                state.coordination.currentUser = payload.vehicleId;
                state.coordination.currentRequestId = payload.requestId;
                state.coordination.currentOrder = {
                    logicalTime: payload.requestLogicalTime || payload.logicalTime,
                    vehicleId: payload.vehicleId
                };
                state.coordination.enteredAt = payload.timestamp;
                break;
            case "LEAVE":
                if (state.coordination.currentRequestId === payload.requestId) {
                    state.coordination.currentUser = null;
                    state.coordination.currentRequestId = null;
                    state.coordination.currentOrder = null;
                    state.coordination.leftAt = payload.timestamp;
                }
                state.coordination.completedAccesses++;
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
            if (topic.startsWith("island/events/")) handleSensorEvent(payload);
            else if (topic.startsWith("island/telemetry/")) handleVehicleTelemetry(payload);
            else if (topic.startsWith("island/status/")) handleComponentStatus(payload);
            else if (topic === coordinationTopic) handleCoordinationMessage(payload);
        } catch (error) {
            console.error(`Invalid MQTT message on ${topic}:`, error.message);
        }
    });

    return client;
}

module.exports = { startMqtt };

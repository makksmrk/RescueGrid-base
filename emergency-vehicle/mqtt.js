const { randomUUID } = require("crypto");
const mqtt = require("mqtt");

const MAX_PROCESSED_HAZARDS = 100;

function createVehicleMqtt({ config, state }) {
    const processedHazards = new Set();
    const telemetryTopic = `island/telemetry/${config.vehicleId}`;
    const statusTopic = `island/status/${config.vehicleId}`;
    const coordinationTopic = `island/coordination/${config.chargingResourceId}`;
    const peerVehicles = config.coordinationPeers.filter(peer => peer !== config.vehicleId);
    const deferredReplies = new Map();
    const receivedReplies = new Set();
    let telemetryInterval;
    let chargingInterval;
    let chargingTimeout;
    let logicalClock = 0;
    let currentRequest = null;
    let requestingResource = false;
    let usingResource = false;

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
            battery: state.battery,
            position: state.position,
            charging: state.charging,
            message,
            ...extra
        };
        client.publish(telemetryTopic, JSON.stringify(telemetry), { qos: 1 }, error => {
            if (error) console.error("Telemetry publish failed:", error.message);
        });
    }

    function publishStatus(status, done) {
        client.publish(statusTopic, JSON.stringify({
            componentId: config.vehicleId,
            status,
            timestamp: new Date().toISOString()
        }), { qos: 1, retain: true }, done);
    }

    function tickClock(remoteClock = 0) {
        logicalClock = Math.max(logicalClock, Number(remoteClock) || 0) + 1;
        return logicalClock;
    }

    function publishCoordination(type, data = {}) {
        const message = {
            messageId: randomUUID(),
            timestamp: new Date().toISOString(),
            type,
            resourceId: config.chargingResourceId,
            vehicleId: config.vehicleId,
            logicalTime: tickClock(),
            ...data
        };

        client.publish(coordinationTopic, JSON.stringify(message), { qos: 1 }, error => {
            if (error) console.error("Coordination publish failed:", error.message);
        });
    }

    function updateCharging(status, extra = {}) {
        state.charging = {
            resourceId: config.chargingResourceId,
            status,
            logicalTime: logicalClock,
            requestId: currentRequest ? currentRequest.requestId : null,
            ...extra
        };
        publishTelemetry(`${config.vehicleId}: charging ${status}`, {
            resourceUse: state.charging
        });
    }

    function sendReply(toVehicleId, requestId) {
        publishCoordination("REPLY", {
            toVehicleId,
            requestId
        });
    }

    function hasOwnRequestPriority(otherRequest) {
        if (usingResource) return true;
        if (!requestingResource || !currentRequest) return false;

        if (currentRequest.logicalTime !== otherRequest.logicalTime) {
            return currentRequest.logicalTime < otherRequest.logicalTime;
        }
        return config.vehicleId < otherRequest.vehicleId;
    }

    function requestChargingStation() {
        if (
            state.status !== "IDLE" ||
            state.missionId ||
            state.battery >= 100 ||
            requestingResource ||
            usingResource ||
            peerVehicles.length === 0
        ) return;

        receivedReplies.clear();
        requestingResource = true;
        currentRequest = {
            requestId: `${config.vehicleId}-${Date.now()}`,
            vehicleId: config.vehicleId,
            logicalTime: tickClock()
        };

        updateCharging("WAITING", {
            requestId: currentRequest.requestId,
            requestedAt: new Date().toISOString(),
            waitingFor: peerVehicles
        });
        publishCoordination("REQUEST", {
            requestId: currentRequest.requestId,
            logicalTime: currentRequest.logicalTime
        });
    }

    function enterChargingStation() {
        if (!requestingResource || usingResource || receivedReplies.size < peerVehicles.length) return;

        usingResource = true;
        updateCharging("USING", {
            enteredAt: new Date().toISOString(),
            order: {
                logicalTime: currentRequest.logicalTime,
                vehicleId: config.vehicleId
            }
        });
        publishCoordination("ENTER", {
            requestId: currentRequest.requestId,
            requestLogicalTime: currentRequest.logicalTime
        });

        chargingTimeout = setTimeout(leaveChargingStation, config.chargingUseDurationMs);
    }

    function leaveChargingStation() {
        if (!usingResource) return;

        publishCoordination("LEAVE", {
            requestId: currentRequest.requestId,
            requestLogicalTime: currentRequest.logicalTime
        });

        usingResource = false;
        requestingResource = false;
        state.battery = 100;
        updateCharging("NOT_REQUESTING", {
            releasedAt: new Date().toISOString()
        });
        currentRequest = null;
        receivedReplies.clear();

        for (const [vehicleId, requestId] of deferredReplies) {
            sendReply(vehicleId, requestId);
        }
        deferredReplies.clear();
    }

    function handleCoordinationMessage(payload) {
        if (!payload || payload.vehicleId === config.vehicleId || payload.resourceId !== config.chargingResourceId) {
            return;
        }

        tickClock(payload.logicalTime);

        if (payload.type === "REQUEST") {
            const otherRequest = {
                vehicleId: payload.vehicleId,
                logicalTime: Number(payload.logicalTime) || 0
            };

            if (hasOwnRequestPriority(otherRequest)) {
                deferredReplies.set(payload.vehicleId, payload.requestId);
            } else {
                sendReply(payload.vehicleId, payload.requestId);
            }
            return;
        }

        if (
            payload.type === "REPLY" &&
            payload.toVehicleId === config.vehicleId &&
            currentRequest &&
            (!payload.requestId || payload.requestId === currentRequest.requestId)
        ) {
            receivedReplies.add(payload.vehicleId);
            updateCharging("WAITING", {
                requestId: currentRequest.requestId,
                waitingFor: peerVehicles.filter(peer => !receivedReplies.has(peer)),
                replies: [...receivedReplies]
            });
            enterChargingStation();
        }
    }

    function handleHazard(payload) {
        if (
            config.role === "drone" ||
            payload.eventType !== "water_level_alert" ||
            processedHazards.has(payload.messageId)
        ) return;

        processedHazards.add(payload.messageId);
        if (processedHazards.size > MAX_PROCESSED_HAZARDS) {
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
        publishStatus("online");
        client.subscribe(["island/events/+/+", coordinationTopic], { qos: 1 }, error => {
            if (error) console.error("MQTT subscription failed:", error.message);
        });
        publishTelemetry(`${config.vehicleId} ist einsatzbereit`);
        if (!telemetryInterval) {
            telemetryInterval = setInterval(
                () => publishTelemetry(`${config.vehicleId} heartbeat`),
                5000
            );
        }
        if (!chargingInterval) {
            const peerIndex = Math.max(0, config.coordinationPeers.indexOf(config.vehicleId));
            setTimeout(requestChargingStation, 3000 + peerIndex * 250);
            chargingInterval = setInterval(
                requestChargingStation,
                config.chargingRequestIntervalMs
            );
        }
    });
    client.on("message", (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            if (topic === coordinationTopic) handleCoordinationMessage(payload);
            else handleHazard(payload);
        } catch (error) {
            console.error("Invalid MQTT message:", error.message);
        }
    });
    client.on("error", error => console.error("MQTT error:", error.message));

    function stop() {
        clearInterval(telemetryInterval);
        clearInterval(chargingInterval);
        clearTimeout(chargingTimeout);
        publishStatus("offline", () => client.end());
    }

    return { publishTelemetry, stop };
}

module.exports = { createVehicleMqtt };

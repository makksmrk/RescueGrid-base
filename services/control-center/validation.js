const { requestError } = require("./errors");
const { validateEnvelope, validateTimestamp, logicalTime } = require("../shared/mqtt");
const { vehicleStatusForMission } = require("../shared/missions");

function requireValue(condition, message) {
    if (!condition) throw requestError(400, message);
}

function object(value, name = "Body") {
    requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
}

function text(value, name, max = 128) {
    requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= max &&
        !/[\x00-\x1f\x7f]/.test(value), `${name} must be a non-empty string of at most ${max} characters`);
    return value;
}

function identifier(value, name) {
    text(value, name);
    requireValue(/^[a-zA-Z0-9_-]+$/.test(value), `${name} must contain only letters, digits, underscores or hyphens`);
    return value;
}

function number(value, name, min = -Infinity, max = Infinity) {
    const description = min === -Infinity && max === Infinity
        ? "a finite number" : `a finite number between ${min} and ${max}`;
    requireValue(Number.isFinite(value) && value >= min && value <= max, `${name} must be ${description}`);
    return value;
}

function validateUnit(data) {
    object(data);
    const id = identifier(data.id, "id");
    const role = data.role ?? data.type;
    requireValue(["drone", "repair_rover", "supply_rover"].includes(role), "Unknown vehicle role");
    requireValue(data.type === undefined || data.type === role, "type must match role");
    const rpcHost = text(data.rpcHost, "rpcHost", 253);
    requireValue(/^(?:[a-zA-Z0-9_.-]+|\[[0-9a-fA-F:]+\])$/.test(rpcHost), "rpcHost must be a hostname, IPv4 address or bracketed IPv6 address");
    try {
        new URL(`http://${rpcHost}`);
    } catch {
        throw requestError(400, "Invalid rpcHost");
    }
    requireValue(Number.isInteger(data.rpcPort) && data.rpcPort >= 1 && data.rpcPort <= 65535, "rpcPort must be an integer between 1 and 65535");
    const status = data.status ?? "IDLE";
    requireValue(["IDLE", "ASSIGNED", "BUSY", "ERROR"].includes(status), "Unknown vehicle status");
    const unit = { id, type: role, role, rpcHost, rpcPort: data.rpcPort, status };
    if (data.battery !== undefined) unit.battery = number(data.battery, "battery", 0, 100);
    if (data.capabilities !== undefined) {
        requireValue(Array.isArray(data.capabilities) && data.capabilities.length <= 32, "capabilities must be an array of at most 32 identifiers");
        unit.capabilities = data.capabilities.map(value => identifier(value, "capability"));
    }
    return unit;
}

function validateSensor(data) {
    object(data);
    requireValue(["camera", "water-level"].includes(data.type), "Unknown sensor type");
    const sensor = { id: identifier(data.id, "id"), type: data.type };
    if (data.measurement !== undefined) sensor.measurement = identifier(data.measurement, "measurement");
    return sensor;
}

function validateIncident(data, width, height, knownTypes, source) {
    object(data);
    requireValue(typeof data.type === "string" && Object.hasOwn(knownTypes, data.type), "Unknown incident type");
    requireValue(Number.isInteger(data.x) && data.x >= 0 && data.x < width &&
        Number.isInteger(data.y) && data.y >= 0 && data.y < height, "Coordinates must be integers inside the map");
    const incident = { type: data.type, x: data.x, y: data.y };
    if (data.sensor !== undefined) incident.sensor = identifier(data.sensor, "sensor");
    if (data.hardToReach !== undefined) {
        requireValue(typeof data.hardToReach === "boolean", "hardToReach must be a boolean");
        incident.hardToReach = data.hardToReach;
    }
    if (data.value !== undefined) incident.value = number(data.value, "value");
    if (data.measurement !== undefined) {
        object(data.measurement, "measurement");
        incident.measurement = {
            name: identifier(data.measurement.name, "measurement.name"),
            value: number(data.measurement.value, "measurement.value")
        };
        if (data.measurement.unit !== undefined) incident.measurement.unit = text(data.measurement.unit, "measurement.unit", 32);
        if (data.measurement.threshold !== undefined) incident.measurement.threshold = number(data.measurement.threshold, "measurement.threshold");
    }
    if (source === "mqtt") {
        incident.messageId = identifier(data.messageId, "messageId");
        requireValue(typeof data.createdAt === "string" && Number.isFinite(Date.parse(data.createdAt)), "Invalid event timestamp");
        incident.createdAt = new Date(data.createdAt).toISOString();
    }
    return incident;
}

function validateDeletion(data) {
    object(data);
    return identifier(data.id, "id");
}

function validateTelemetry(data, topic, width, height) {
    validateEnvelope(data);
    requireValue(["IDLE", "ASSIGNED", "BUSY", "ERROR"].includes(data.status), "Unknown telemetry status");
    const unit = validateUnit({ ...data, id: data.vehicleId });
    requireValue(topic === `island/telemetry/${unit.id}`, "Telemetry topic does not match sender");
    number(data.battery, "battery", 0, 100);
    requireValue(Number.isInteger(data.progress), "progress must be an integer");
    number(data.progress, "progress", 0, 100);
    object(data.position, "position");
    requireValue(Number.isInteger(data.position.x) && data.position.x >= 0 && data.position.x < width &&
        Number.isInteger(data.position.y) && data.position.y >= 0 && data.position.y < height, "Invalid vehicle position");
    requireValue(data.missionId === null || typeof data.missionId === "string", "Invalid missionId");
    if (data.missionId !== null) identifier(data.missionId, "missionId");
    const charging = data.charging;
    object(charging, "charging");
    identifier(charging.resourceId, "charging.resourceId");
    requireValue(["NOT_REQUESTING", "WAITING", "USING"].includes(charging.status) && logicalTime(charging.logicalTime), "Invalid charging status or clock");
    if (charging.requestId !== null || charging.status !== "NOT_REQUESTING") identifier(charging.requestId, "charging.requestId");
    for (const key of ["waitingFor", "replies"]) {
        if (charging[key] === undefined) continue;
        requireValue(Array.isArray(charging[key]), `charging.${key} must be an array`);
        charging[key].forEach(value => identifier(value, `charging.${key}`));
    }
    for (const key of ["requestedAt", "enteredAt", "releasedAt"]) {
        if (charging[key] !== undefined) validateTimestamp(charging[key]);
    }
    if (charging.order !== undefined) {
        object(charging.order, "charging.order");
        identifier(charging.order.vehicleId, "charging.order.vehicleId");
        requireValue(logicalTime(charging.order.logicalTime), "Invalid charging order clock");
    }
    if (data.missionReport !== null && data.missionReport !== undefined) {
        const report = data.missionReport;
        object(report, "missionReport");
        identifier(report.missionId, "missionReport.missionId");
        requireValue(vehicleStatusForMission(report.status) && Number.isInteger(report.progress) && report.progress >= 0 && report.progress <= 100 &&
            (report.status !== "COMPLETED" || report.progress === 100), "Invalid missionReport status or progress");
        text(report.message, "missionReport.message", 1024);
    }
    for (const key of ["message", "error", "reportError"]) {
        if (data[key] !== undefined) text(data[key], key, 1024);
    }
    if (data.hazard !== undefined) {
        object(data.hazard, "hazard");
        identifier(data.hazard.type, "hazard.type");
        identifier(data.hazard.action, "hazard.action");
        requireValue(Number.isInteger(data.hazard.x) && data.hazard.x >= 0 && data.hazard.x < width &&
            Number.isInteger(data.hazard.y) && data.hazard.y >= 0 && data.hazard.y < height, "Invalid hazard coordinates");
    }
    return unit;
}

function validateComponentStatus(data, topic) {
    object(data);
    identifier(data.componentId, "componentId");
    requireValue(topic === `island/status/${data.componentId}` && ["online", "offline"].includes(data.status), "Invalid component status or topic");
    // MQTT Last Will has no send-time timestamp; use its arrival time.
    if (data.timestamp === undefined) requireValue(data.status === "offline", "Online status requires timestamp");
    else validateTimestamp(data.timestamp);
}

module.exports = { validateUnit, validateSensor, validateIncident, validateDeletion, validateTelemetry, validateComponentStatus };

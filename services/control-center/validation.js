const { requestError } = require("./errors");

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

module.exports = { validateUnit, validateSensor, validateIncident, validateDeletion };

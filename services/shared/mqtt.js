const MAX_FUTURE_SKEW_MS = 5000;
const MAX_MESSAGE_AGE_MS = 60_000;

function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

function identifier(value) {
    return typeof value === "string" && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

function logicalTime(value) {
    return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

function validateTimestamp(value) {
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    requireValue(Number.isFinite(time) && time <= Date.now() + MAX_FUTURE_SKEW_MS, "Invalid MQTT timestamp");
    return time;
}

function validateEnvelope(payload) {
    requireValue(payload !== null && typeof payload === "object" && !Array.isArray(payload), "MQTT payload must be an object");
    requireValue(identifier(payload.messageId), "Invalid MQTT messageId");
    return validateTimestamp(payload.timestamp);
}

function validateCoordination(payload, resourceId) {
    const time = validateEnvelope(payload);
    requireValue(payload.resourceId === resourceId && identifier(payload.vehicleId) && identifier(payload.requestId), "Invalid coordination participant or request");
    requireValue(["REQUEST", "REPLY", "ENTER", "LEAVE"].includes(payload.type) && logicalTime(payload.logicalTime) && payload.logicalTime > 0, "Invalid coordination type or logical time");
    if (payload.type === "REPLY") {
        requireValue(identifier(payload.toVehicleId) && payload.toVehicleId !== payload.vehicleId, "Invalid reply recipient");
    }
    if (["ENTER", "LEAVE"].includes(payload.type)) {
        requireValue(logicalTime(payload.requestLogicalTime) && payload.requestLogicalTime > 0 && payload.requestLogicalTime <= payload.logicalTime, "Invalid request logical time");
    }
    return time;
}

function validateSensorEvent(payload, topic, width = Infinity, height = Infinity) {
    const time = validateEnvelope(payload);
    requireValue(["water-sensor", "camera"].includes(payload.sourceType) && identifier(payload.sourceId) && topic === `island/events/${payload.sourceType}/${payload.sourceId}`, "Sensor topic does not match sender");
    requireValue(identifier(payload.eventType), "Invalid sensor event type");
    requireValue(Number.isInteger(payload.x) && payload.x >= 0 && payload.x < width && Number.isInteger(payload.y) && payload.y >= 0 && payload.y < height, "Invalid sensor coordinates");
    const measurement = payload.measurement;
    requireValue(measurement !== null && typeof measurement === "object" && identifier(measurement.name) && Number.isFinite(measurement.value), "Invalid sensor measurement");
    requireValue(measurement.threshold === undefined || Number.isFinite(measurement.threshold), "Invalid measurement threshold");
    requireValue(measurement.unit === undefined || (typeof measurement.unit === "string" && measurement.unit.trim().length > 0 && measurement.unit.length <= 32 && !/[\x00-\x1f\x7f]/.test(measurement.unit)), "Invalid measurement unit");
    requireValue(payload.hardToReach === undefined || typeof payload.hardToReach === "boolean", "Invalid hardToReach flag");
    return time;
}

function compareRequests(left, right) {
    return left.logicalTime - right.logicalTime || (left.vehicleId < right.vehicleId ? -1 : left.vehicleId > right.vehicleId ? 1 : 0);
}

module.exports = { MAX_MESSAGE_AGE_MS, identifier, logicalTime, validateTimestamp, validateEnvelope, validateCoordination, validateSensorEvent, compareRequests };

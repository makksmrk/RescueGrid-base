function text(name, fallback) {
    const value = (process.env[name] ?? fallback).trim();
    if (!value) throw new Error(`${name} must not be empty`);
    return value;
}

function integer(name, fallback, max = 2147483647) {
    const value = Number(text(name, String(fallback)));
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new Error(`${name} must be an integer between 1 and ${max}`);
    }
    return value;
}

function port(name, fallback) {
    return integer(name, fallback, 65535);
}

function identifier(name, fallback) {
    const value = text(name, fallback);
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        throw new Error(`${name} must contain only letters, digits, underscores or hyphens`);
    }
    return value;
}

function mqttUrl() {
    const value = text("MQTT_URL", "mqtt://mqtt-broker:1883");
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("MQTT_URL must be a valid URL");
    }
    if (!["mqtt:", "mqtts:"].includes(url.protocol) || !url.hostname) {
        throw new Error("MQTT_URL must be a mqtt:// or mqtts:// URL with a hostname");
    }
    return value;
}

module.exports = { text, integer, port, identifier, mqttUrl };

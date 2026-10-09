const env = require("../shared/config");

const roleConfig = {
    drone: {
        type: "drone",
        capabilities: ["aerial_inspection", "search_person", "water_crossing"],
        behavior: "inspiziert die Zielposition aus der Luft"
    },
    repair_rover: {
        type: "repair_rover",
        capabilities: ["repair_route", "repair_structure"],
        behavior: "repariert Wege und Infrastruktur"
    },
    supply_rover: {
        type: "supply_rover",
        capabilities: ["deliver_supplies", "restock_material"],
        behavior: "liefert Material zur Zielposition"
    }
};

const role = env.text("VEHICLE_ROLE", "drone");
if (!Object.hasOwn(roleConfig, role)) {
    throw new Error(`VEHICLE_ROLE must be one of: ${Object.keys(roleConfig).join(", ")}`);
}
const selectedRole = roleConfig[role];
const vehicleId = env.identifier("VEHICLE_ID", "drone-1");
const coordinationPeers = env.text("COORDINATION_PEERS", "drone-1,repair-rover-1,supply-rover-1")
    .split(",")
    .map(peer => peer.trim());
if (coordinationPeers.length < 2 ||
    coordinationPeers.some(peer => !/^[a-zA-Z0-9_-]+$/.test(peer)) ||
    new Set(coordinationPeers).size !== coordinationPeers.length ||
    !coordinationPeers.includes(vehicleId)) {
    throw new Error("COORDINATION_PEERS must contain at least two unique IDs, including VEHICLE_ID");
}

module.exports = {
    vehicleId,
    role,
    rpcPort: env.port("RPC_PORT", 50052),
    rpcHost: env.text("RPC_HOST", vehicleId),
    controlCenterHost: env.text("CONTROL_CENTER_HOST", "control-center"),
    controlCenterHttpPort: env.port("CONTROL_CENTER_HTTP_PORT", 8080),
    controlCenterRpcPort: env.port("CONTROL_CENTER_RPC_PORT", 50051),
    mqttUrl: env.mqttUrl(),
    coordinationPeers,
    chargingResourceId: env.identifier("CHARGING_RESOURCE_ID", "charging_station"),
    chargingRequestIntervalMs: env.integer("CHARGING_REQUEST_INTERVAL_MS", 15000),
    chargingUseDurationMs: env.integer("CHARGING_USE_DURATION_MS", 4000),
    ...selectedRole
};

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

const role = process.env.VEHICLE_ROLE || "drone";
const selectedRole = roleConfig[role] || roleConfig.drone;
const coordinationPeers = (process.env.COORDINATION_PEERS || "drone-1,repair-rover-1,supply-rover-1")
    .split(",")
    .map(peer => peer.trim())
    .filter(Boolean);

module.exports = {
    vehicleId: process.env.VEHICLE_ID || "vehicle-1",
    role,
    rpcPort: Number(process.env.RPC_PORT || 50052),
    rpcHost: process.env.RPC_HOST || process.env.VEHICLE_ID || "vehicle-1",
    controlCenterHost: process.env.CONTROL_CENTER_HOST || "control-center",
    controlCenterHttpPort: Number(process.env.CONTROL_CENTER_HTTP_PORT || 8080),
    controlCenterRpcPort: Number(process.env.CONTROL_CENTER_RPC_PORT || 50051),
    mqttUrl: process.env.MQTT_URL || "mqtt://mqtt-broker:1883",
    coordinationPeers,
    chargingResourceId: process.env.CHARGING_RESOURCE_ID || "charging_station",
    chargingRequestIntervalMs: Number(process.env.CHARGING_REQUEST_INTERVAL_MS || 15000),
    chargingUseDurationMs: Number(process.env.CHARGING_USE_DURATION_MS || 4000),
    ...selectedRole
};

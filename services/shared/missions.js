const MISSION_BATTERY_COST = 20;
const RPC_TIMEOUT_MS = 3000;

function isActiveMission(status) {
    return ["WAITING", "ASSIGNED", "IN_PROGRESS"].includes(status);
}

function isTerminalMission(status) {
    return ["COMPLETED", "FAILED"].includes(status);
}

function vehicleStatusForMission(status) {
    const states = { ASSIGNED: "ASSIGNED", IN_PROGRESS: "BUSY", COMPLETED: "IDLE", FAILED: "ERROR" };
    return Object.hasOwn(states, status) ? states[status] : null;
}

function canAcceptMission(vehicle, currentMissionId) {
    return vehicle.status === "IDLE" && !currentMissionId &&
        vehicle.battery >= MISSION_BATTERY_COST &&
        vehicle.charging?.status === "NOT_REQUESTING";
}

module.exports = {
    MISSION_BATTERY_COST, RPC_TIMEOUT_MS,
    isActiveMission, isTerminalMission, vehicleStatusForMission, canAcceptMission
};

const { createRegistration } = require("../shared/registration");
const config = require("./config");
const { createMissionExecution } = require("./missions");
const { createVehicleMqtt } = require("./mqtt");

const state = {
    status: "IDLE",
    missionId: null,
    progress: 0,
    battery: 100,
    position: { x: 0, y: 0 },
    charging: {
        resourceId: config.chargingResourceId,
        status: "NOT_REQUESTING",
        logicalTime: 0,
        requestId: null
    }
};

const registration = createRegistration({
    host: config.controlCenterHost,
    port: config.controlCenterHttpPort,
    path: "/unit",
    label: config.vehicleId,
    getPayload: () => ({
        id: config.vehicleId,
        type: config.type,
        role: config.role,
        status: state.status,
        battery: state.battery,
        rpcHost: config.rpcHost,
        rpcPort: config.rpcPort,
        capabilities: config.capabilities
    })
});

const vehicleMqtt = createVehicleMqtt({ config, state });
const missionExecution = createMissionExecution({
    config,
    state,
    publishTelemetry: vehicleMqtt.publishTelemetry
});

missionExecution.start(registration.start);

process.on("SIGTERM", () => {
    registration.stop();
    vehicleMqtt.stop();
    missionExecution.stop();
});

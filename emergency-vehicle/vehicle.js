const http = require("http");
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

function registerVehicle() {
    const data = JSON.stringify({
        id: config.vehicleId,
        type: config.type,
        role: config.role,
        status: state.status,
        battery: state.battery,
        rpcHost: config.rpcHost,
        rpcPort: config.rpcPort,
        capabilities: config.capabilities
    });
    const req = http.request({
        hostname: config.controlCenterHost,
        port: config.controlCenterHttpPort,
        path: "/unit",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
        }
    }, response => {
        console.log(`Registered ${config.vehicleId} as ${config.role}: HTTP ${response.statusCode}`);
        response.resume();
    });
    req.on("error", error => {
        console.error("Registration failed:", error.message);
        setTimeout(registerVehicle, 3000);
    });
    req.write(data);
    req.end();
}

const vehicleMqtt = createVehicleMqtt({ config, state });
const missionExecution = createMissionExecution({
    config,
    state,
    publishTelemetry: vehicleMqtt.publishTelemetry
});

missionExecution.start(registerVehicle);

process.on("SIGTERM", () => {
    vehicleMqtt.stop();
    missionExecution.stop();
});

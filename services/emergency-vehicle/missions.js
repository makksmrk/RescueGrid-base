const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const MISSION_BATTERY_COST = 20;

function createMissionExecution({ config, state, publishTelemetry }) {
    const protoPath = path.join(__dirname, "..", "..", "proto", "mission.proto");
    const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
    const missionProto = grpc.loadPackageDefinition(packageDefinition).mission;
    const controlCenterClient = new missionProto.ControlCenterService(
        `${config.controlCenterHost}:${config.controlCenterRpcPort}`,
        grpc.credentials.createInsecure()
    );

    function reportMission(missionId, status, progress, message) {
        state.status = status;
        state.progress = progress;
        state.missionId = status === "IDLE" ? null : missionId;
        publishTelemetry(message, { missionId });

        controlCenterClient.ReportMissionStatus({
            missionId,
            vehicleId: config.vehicleId,
            status,
            progress,
            message
        }, error => {
            if (!error) return;
            console.error("Mission report failed:", error.message);
            state.status = "ERROR";
            state.missionId = missionId;
            publishTelemetry("Mission report failed", { error: error.message });
        });
    }

    function simulateMission(mission) {
        const steps = [
            {
                delay: 4000,
                status: "BUSY",
                progress: 80,
                position: mission.target,
                message: `${config.vehicleId} ${config.behavior}`
            },
            {
                delay: 9000,
                status: "IDLE",
                progress: 100,
                position: mission.target,
                message: `${config.vehicleId} hat ${mission.type} abgeschlossen`
            }
        ];

        for (const step of steps) {
            setTimeout(() => {
                state.position = step.position;
                if (step.status === "BUSY") {
                    state.battery = Math.max(0, state.battery - MISSION_BATTERY_COST);
                }
                reportMission(mission.missionId, step.status, step.progress, step.message);
            }, step.delay);
        }
    }

    function assignMission(call, callback) {
        const mission = call.request;
        if (state.status !== "IDLE" ||
            state.charging.status === "WAITING" ||
            state.charging.status === "USING" ||
            state.battery <= 0) {
            callback(null, {
                accepted: false,
                vehicleId: config.vehicleId,
                status: state.status,
                message: state.battery <= 0 ? "Vehicle battery is empty" : "Vehicle is not available"
            });
            return;
        }

        state.status = "ASSIGNED";
        state.missionId = mission.missionId;
        state.progress = 0;
        console.log(`Assigned mission ${mission.missionId} (${mission.type})`);
        publishTelemetry(`${config.vehicleId} hat den Einsatz angenommen`);
        callback(null, {
            accepted: true,
            vehicleId: config.vehicleId,
            status: state.status,
            message: `${config.vehicleId} accepted mission ${mission.missionId}`
        });
        simulateMission(mission);
    }

    const server = new grpc.Server();
    server.addService(missionProto.VehicleService.service, { AssignMission: assignMission });

    function start(onStarted) {
        server.bindAsync(`0.0.0.0:${config.rpcPort}`, grpc.ServerCredentials.createInsecure(), error => {
            if (error) {
                console.error(error);
                process.exit(1);
            }
            console.log(`${config.vehicleId} gRPC server listening on ${config.rpcPort}`);
            onStarted();
        });
    }

    function stop() {
        controlCenterClient.close();
        server.tryShutdown(() => {});
    }

    return { start, stop };
}

module.exports = { createMissionExecution };

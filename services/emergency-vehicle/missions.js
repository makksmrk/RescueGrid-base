const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { MISSION_BATTERY_COST, RPC_TIMEOUT_MS, isTerminalMission, vehicleStatusForMission, canAcceptMission } = require("../shared/missions");

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

    const missionTimers = new Set();

    function reportMission(missionId, status, progress, message) {
        state.status = vehicleStatusForMission(status);
        state.progress = progress;
        state.missionId = isTerminalMission(status) ? null : missionId;
        state.missionReport = { missionId, status, progress, message };
        publishTelemetry(message);

        controlCenterClient.ReportMissionStatus({
            ...state.missionReport,
            vehicleId: config.vehicleId
        }, { deadline: Date.now() + RPC_TIMEOUT_MS }, error => {
            if (!error) return;
            console.error("Mission report failed:", error.message);
            // Delivery failure does not change the physical execution state.
            // Heartbeat telemetry also carries the latest mission report.
            publishTelemetry("Mission report delivery failed", { reportError: error.message });
        });
    }

    function simulateMission(mission) {
        const steps = [
            {
                delay: 4000,
                status: "IN_PROGRESS",
                progress: 80,
                position: mission.target,
                message: `${config.vehicleId} ${config.behavior}`
            },
            {
                delay: 9000,
                status: "COMPLETED",
                progress: 100,
                position: mission.target,
                message: `${config.vehicleId} hat ${mission.type} abgeschlossen`
            }
        ];

        for (const step of steps) {
            const timer = setTimeout(() => {
                missionTimers.delete(timer);
                if (state.missionId !== mission.missionId) return;
                state.position = step.position;
                if (step.status === "IN_PROGRESS") {
                    state.battery = Math.max(0, state.battery - MISSION_BATTERY_COST);
                }
                reportMission(mission.missionId, step.status, step.progress, step.message);
            }, step.delay);
            missionTimers.add(timer);
        }
    }

    function assignmentAck(accepted, message) {
        return {
            accepted,
            vehicleId: config.vehicleId,
            status: state.status,
            message,
            currentMissionId: state.missionId || "",
            chargingStatus: state.charging.status,
            battery: state.battery
        };
    }

    function assignMission(call, callback) {
        const mission = call.request;
        if (state.missionId === mission.missionId) {
            callback(null, assignmentAck(true, "Mission already accepted"));
            return;
        }
        if (!canAcceptMission(state, state.missionId)) {
            callback(null, assignmentAck(false, state.battery < MISSION_BATTERY_COST
                ? "Insufficient battery for mission" : "Vehicle is not available"));
            return;
        }

        state.status = "ASSIGNED";
        state.missionId = mission.missionId;
        state.progress = 0;
        console.log(`Assigned mission ${mission.missionId} (${mission.type})`);
        const message = `${config.vehicleId} accepted mission ${mission.missionId}`;
        state.missionReport = { missionId: mission.missionId, status: "ASSIGNED", progress: 0, message };
        publishTelemetry(message);
        callback(null, assignmentAck(true, message));
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
        for (const timer of missionTimers) clearTimeout(timer);
        missionTimers.clear();
        controlCenterClient.close();
        server.tryShutdown(() => {});
    }

    return { start, stop };
}

module.exports = { createMissionExecution };

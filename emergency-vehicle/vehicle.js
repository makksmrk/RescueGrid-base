const http = require("http");
const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const vehicleId = process.env.VEHICLE_ID || "vehicle-1";
const role = process.env.VEHICLE_ROLE || "drone";
const rpcPort = Number(process.env.RPC_PORT || 50052);
const rpcHost = process.env.RPC_HOST || vehicleId;
const controlCenterHost = process.env.CONTROL_CENTER_HOST || "control-center";
const controlCenterHttpPort = Number(process.env.CONTROL_CENTER_HTTP_PORT || 8080);
const controlCenterRpcPort = Number(process.env.CONTROL_CENTER_RPC_PORT || 50051);

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

const config = roleConfig[role] || roleConfig.drone;
let currentStatus = "IDLE";

const protoPath = path.join(__dirname, "..", "proto", "mission.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const missionProto = grpc.loadPackageDefinition(packageDefinition).mission;

const controlCenterClient = new missionProto.ControlCenterService(
    `${controlCenterHost}:${controlCenterRpcPort}`,
    grpc.credentials.createInsecure()
);

function registerVehicle() {
    const data = JSON.stringify({
        id: vehicleId,
        type: config.type,
        role,
        status: currentStatus,
        rpcHost,
        rpcPort,
        capabilities: config.capabilities
    });

    const req = http.request({
        hostname: controlCenterHost,
        port: controlCenterHttpPort,
        path: "/unit",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
        }
    }, (res) => {
        console.log(`Registered ${vehicleId} as ${role}: HTTP ${res.statusCode}`);
    });

    req.on("error", (err) => {
        console.error("Registration failed:", err.message);
        setTimeout(registerVehicle, 3000);
    });

    req.write(data);
    req.end();
}

function reportMission(missionId, status, progress, message) {
    currentStatus = status;

    controlCenterClient.ReportMissionStatus({
        missionId,
        vehicleId,
        status,
        progress,
        message
    }, (err) => {
        if (err) {
            console.error("Mission report failed:", err.message);
        }
    });
}

// Arbeit simulieren mit sleep

function simulateMission(mission) {
    const steps = [
        { delay: 1000, status: "BUSY", progress: 25, message: `${vehicleId} ist unterwegs` },
        { delay: 3000, status: "BUSY", progress: 65, message: `${vehicleId} ${config.behavior}` },
        { delay: 5000, status: "IDLE", progress: 100, message: `${vehicleId} hat ${mission.type} abgeschlossen` }
    ];

    for (const step of steps) {
        setTimeout(() => {
            reportMission(
                mission.missionId,
                step.status,
                step.progress,
                step.message
            );
        }, step.delay);
    }
}

function assignMission(call, callback) {
    const mission = call.request;

    if (currentStatus !== "IDLE") {
        callback(null, {
            accepted: false,
            vehicleId,
            status: currentStatus,
            message: "Vehicle is not available"
        });
        return;
    }

    currentStatus = "ASSIGNED";
    console.log(`Assigned mission ${mission.missionId} (${mission.type})`);

    callback(null, {
        accepted: true,
        vehicleId,
        status: currentStatus,
        message: `${vehicleId} accepted mission ${mission.missionId}`
    });

    simulateMission(mission);
}

const server = new grpc.Server();
server.addService(missionProto.VehicleService.service, {
    AssignMission: assignMission
});
server.bindAsync(`0.0.0.0:${rpcPort}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
        console.error(err);
        return;
    }

    console.log(`${vehicleId} gRPC server listening on ${rpcPort}`);
    registerVehicle();
});

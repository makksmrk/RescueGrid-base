const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { startHttpServer } = require("./http");
const { islandMap, WIDTH, HEIGHT } = require("./map");
const { createMissionService } = require("./missions");
const { startMqtt } = require("./mqtt");

const PORT = 8080;
const RPC_PORT = 50051;
const MQTT_URL = process.env.MQTT_URL || "mqtt://mqtt-broker:1883";

const state = {
    units: [],
    sensors: [],
    incidents: [],
    missions: [],
    mqttState: {
        connected: false,
        lastMessageAt: null,
        processedMessages: 0,
        duplicatesIgnored: 0,
        oldMessagesIgnored: 0,
        mergedIncidents: 0
    },
    coordination: {
        resourceId: "charging_station",
        currentUser: null,
        currentRequestId: null,
        currentOrder: null,
        pendingRequests: [],
        completedAccesses: 0,
        messages: []
    }
};

const protoPath = path.join(__dirname, "..", "proto", "mission.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const missionProto = grpc.loadPackageDefinition(packageDefinition).mission;

const missions = createMissionService({
    state,
    islandMap,
    width: WIDTH,
    height: HEIGHT,
    missionProto
});

startMqtt({ mqttUrl: MQTT_URL, state, missions });
startHttpServer({
    port: PORT,
    state,
    islandMap,
    width: WIDTH,
    height: HEIGHT,
    missions
});

const rpcServer = new grpc.Server();
rpcServer.addService(missionProto.ControlCenterService.service, {
    ReportMissionStatus: missions.reportMissionStatus
});
rpcServer.bindAsync(`0.0.0.0:${RPC_PORT}`, grpc.ServerCredentials.createInsecure(), error => {
    if (error) {
        console.error(error);
        return;
    }
    console.log(`Control center gRPC server listening on ${RPC_PORT}`);
});

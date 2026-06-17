const net = require("net");
const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const { islandMap, WIDTH, HEIGHT } = require("./map");
const { parseRequest } = require("./requestParser");
const { generateDashboard } = require("./dashboard");

const PORT = 8080;
const RPC_PORT = 50051;

const units = [];
const sensors = [];
const incidents = [];
const missions = [];

const protoPath = path.join(__dirname, "..", "proto", "mission.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const missionProto = grpc.loadPackageDefinition(packageDefinition).mission;

function sendResponse(
    socket,
    statusCode,
    statusText,
    contentType,
    body
) {

    socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body
    );

    socket.end();
    socket.destroy();
}

function getCell(x, y) {

    if (
        x < 0 ||
        y < 0 ||
        x >= WIDTH ||
        y >= HEIGHT
    ) {
        return null;
    }

    return islandMap[y][x];
}

function upsertUnit(unit) {

    const existingUnit = units.find(
        currentUnit => currentUnit.id === unit.id
    );

    if (existingUnit) {
        Object.assign(existingUnit, unit);
        return existingUnit;
    }

    units.push(unit);
    return unit;
}

// Fuer den Einsatz eines richtigen Fahrzeugs (haengt von Typ der Mission ab)

function getMissionType(incident) {

    if (
        incident.type === "person_detected" ||
        incident.type === "water_level_alert" ||
        incident.hardToReach === true
    ) {
        return {
            missionType: "aerial_inspection",
            role: "drone",
            priority: incident.type === "person_detected" ? 10 : 8
        };
    }

    if (
        incident.type === "blocked_route" ||
        incident.type === "structure_damage" ||
        incident.type === "bridge_damage"
    ) {
        return {
            missionType: "repair_route",
            role: "repair_rover",
            priority: 7
        };
    }

    if (
        incident.type === "supply_low" ||
        incident.type === "material_request"
    ) {
        return {
            missionType: "deliver_supplies",
            role: "supply_rover",
            priority: 6
        };
    }

    return null;
}

// RPC (Zuweisung fuer den Einsatz)

function assignMissionForIncident(incident) {

    const assignment = getMissionType(incident);

    if (!assignment) {
        return null;
    }

    const unit = units.find(currentUnit =>
        currentUnit.role === assignment.role &&
        currentUnit.status === "IDLE" &&
        currentUnit.rpcHost &&
        currentUnit.rpcPort
    );

    const mission = {
        id: `mission-${Date.now()}-${missions.length + 1}`,
        incidentId: incident.id,
        type: assignment.missionType,
        target: {
            x: incident.x,
            y: incident.y
        },
        priority: assignment.priority,
        requiredRole: assignment.role,
        vehicleId: unit ? unit.id : null,
        status: unit ? "ASSIGNED" : "ERROR",
        progress: 0,
        message: unit ? "Mission assigned via gRPC" : "No suitable idle vehicle available",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    missions.push(mission);

    if (!unit) {
        return mission;
    }

    unit.status = "ASSIGNED";
    unit.currentMissionId = mission.id;

    const client = new missionProto.VehicleService(
        `${unit.rpcHost}:${unit.rpcPort}`,
        grpc.credentials.createInsecure()
    );

    client.AssignMission({
        missionId: mission.id,
        incidentId: incident.id,
        type: mission.type,
        target: mission.target,
        priority: mission.priority
    }, (err, response) => {
        mission.updatedAt = new Date().toISOString();

        if (err || !response.accepted) {
            mission.status = "ERROR";
            mission.message = err ? err.message : response.message;
            unit.status = "ERROR";
            return;
        }

        mission.status = response.status;
        mission.message = response.message;
        unit.status = response.status;
    });

    return mission;
}

// das Fahrzeug meldet Abschluss oder Fehler an die Leitstelle zurueck.

function reportMissionStatus(call, callback) {

    const report = call.request;
    const mission = missions.find(
        currentMission => currentMission.id === report.missionId
    );
    const unit = units.find(
        currentUnit => currentUnit.id === report.vehicleId
    );

    if (mission) {
        mission.status = report.status;
        mission.progress = report.progress;
        mission.message = report.message;
        mission.updatedAt = new Date().toISOString();
    }

    if (unit) {
        unit.status = report.status;
        unit.currentMissionId = report.status === "IDLE" ? null : report.missionId;
    }

    callback(null, {
        received: true
    });
}


// HTTP SERVER (REST) FOR HANDLE REQUEST (INKL. REGISTRATION OF UNITS, INFRASTRUCTURE AND SENSORS)

const server = net.createServer((socket) => {

    socket.on("data", (data) => {

        try {

            const requestText = data.toString();

            console.log(requestText);

            const request = parseRequest(requestText);

            const method = request.method;
            const path = request.path;

            // GET /

            if (method === "GET" && path === "/") {

                const html = generateDashboard({
                    map: islandMap,
                    units,
                    sensors,
                    incidents,
                    missions,
                    width: WIDTH,
                    height: HEIGHT
                });

                sendResponse(
                    socket,
                    200,
                    "OK",
                    "text/html",
                    html
                );

                return;
            }

            // GET STATUS

            if (method === "GET" && path === "/status") {

                const body = JSON.stringify({
                    status: "running",
                    units: units.length,
                    sensors: sensors.length,
                    incidents: incidents.length,
                    missions: missions.length,
                    activeMissions: missions.filter(
                        mission => mission.status !== "IDLE" && mission.status !== "ERROR"
                    ).length
                }, null, 2);

                sendResponse(
                    socket,
                    200,
                    "OK",
                    "application/json",
                    body
                );

                return;
            }

            // GET map

            if (method === "GET" && path === "/map") {

                sendResponse(
                    socket,
                    200,
                    "OK",
                    "application/json",
                    JSON.stringify(islandMap, null, 2)
                );

                return;
            }

            // POST /unit

            if (method === "POST" && path === "/unit") {

                const unit = JSON.parse(request.body);

                unit.registeredAt = new Date().toISOString();
                unit.status = unit.status || "IDLE";

                const registeredUnit = upsertUnit(unit);

                sendResponse(
                    socket,
                    201,
                    "Created",
                    "application/json",
                    JSON.stringify({
                        message: "Unit registered",
                        unit: registeredUnit
                    }, null, 2)
                );

                return;
            }

            // POST /sensor

            if (method === "POST" && path === "/sensor") {

                const sensor = JSON.parse(request.body);

                sensor.registeredAt = new Date().toISOString();

                sensors.push(sensor);

                sendResponse(
                    socket,
                    201,
                    "Created",
                    "application/json",
                    JSON.stringify({
                        message: "Sensor registered",
                        sensor
                    }, null, 2)
                );

                return;
            }

            // POST /incident

            if (method === "POST" && path === "/incident") {

                const incident = JSON.parse(request.body);

                incident.id = incident.id || `incident-${Date.now()}-${incidents.length + 1}`;
                incident.createdAt = new Date().toISOString();

                incidents.push(incident);

                const cell = getCell(
                    incident.x,
                    incident.y
                );

                if (cell) {
                    cell.incidents.push(incident);
                }

                const mission = assignMissionForIncident(incident);

                sendResponse(
                    socket,
                    201,
                    "Created",
                    "application/json",
                    JSON.stringify({
                        message: "Incident created",
                        incident,
                        mission
                    }, null, 2)
                );

                return;
            }

            // 405

            if (
                method !== "GET" &&
                method !== "POST"
            ) {

                sendResponse(
                    socket,
                    405,
                    "Method Not Allowed",
                    "text/plain",
                    "Method Not Allowed"
                );

                return;
            }

            // 404

            sendResponse(
                socket,
                404,
                "Not Found",
                "text/plain",
                "Route not found"
            );

        } catch (err) {

            console.error(err);

            sendResponse(
                socket,
                500,
                "Internal Server Error",
                "text/plain",
                "Internal Server Error"
            );
        }
    });
});

server.listen(PORT, () => {

    console.log(`
--
CONTROL CENTER RUNNING
--

http://localhost:${PORT}

--
`);
});

const rpcServer = new grpc.Server();
rpcServer.addService(missionProto.ControlCenterService.service, {
    ReportMissionStatus: reportMissionStatus
});
rpcServer.bindAsync(`0.0.0.0:${RPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
        console.error(err);
        return;
    }

    console.log(`Control center gRPC server listening on ${RPC_PORT}`);
});


// docker compose up --build
// curl http://localhost:8080/status
// curl http://localhost:8080/map
//
/*

for i in {1..50}
do
curl -X POST http://localhost:8080/unit \
-H "Content-Type: application/json" \
-d "{\"id\":\"drone-$i\",\"type\":\"drone\"}"
done


 */

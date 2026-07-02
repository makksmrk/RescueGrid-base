const net = require("net");
const { generateDashboard } = require("./dashboard");
const { parseRequest } = require("./requestParser");

function sendResponse(socket, statusCode, statusText, contentType, body) {
    socket.end(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "Connection: close\r\n\r\n" +
        body
    );
}

function startHttpServer({ port, state, islandMap, width, height, missions }) {
    const server = net.createServer(socket => {
        socket.on("data", data => {
            try {
                const requestText = data.toString();
                console.log(requestText);
                const request = parseRequest(requestText);
                const method = request.method;
                const path = request.path;

                if (method === "GET" && path === "/") {
                    const html = generateDashboard({
                        map: islandMap,
                        units: state.units,
                        sensors: state.sensors,
                        incidents: state.incidents,
                        missions: state.missions,
                        mqttState: state.mqttState,
                        coordination: state.coordination,
                        width,
                        height
                    });
                    sendResponse(socket, 200, "OK", "text/html", html);
                    return;
                }

                if (method === "GET" && path === "/status") {
                    const body = JSON.stringify({
                        status: "running",
                        units: state.units.length,
                        sensors: state.sensors.length,
                        incidents: state.incidents.length,
                        missions: state.missions.length,
                        activeMissions: state.missions.filter(
                            mission => mission.status !== "IDLE" && mission.status !== "ERROR"
                        ).length,
                        mqtt: state.mqttState,
                        coordination: state.coordination
                    }, null, 2);
                    sendResponse(socket, 200, "OK", "application/json", body);
                    return;
                }

                if (method === "GET" && path === "/map") {
                    sendResponse(socket, 200, "OK", "application/json", JSON.stringify(islandMap, null, 2));
                    return;
                }

                if (method === "POST" && path === "/unit") {
                    const unit = JSON.parse(request.body);
                    unit.registeredAt = new Date().toISOString();
                    unit.status = unit.status || "IDLE";
                    const registeredUnit = missions.upsertUnit(unit);
                    sendResponse(socket, 201, "Created", "application/json", JSON.stringify({
                        message: "Unit registered",
                        unit: registeredUnit
                    }, null, 2));
                    return;
                }

                if (method === "POST" && path === "/sensor") {
                    const sensor = JSON.parse(request.body);
                    sensor.registeredAt = new Date().toISOString();
                    const registeredSensor = missions.upsertSensor(sensor);
                    sendResponse(socket, 201, "Created", "application/json", JSON.stringify({
                        message: "Sensor registered",
                        sensor: registeredSensor
                    }, null, 2));
                    return;
                }

                if (method === "POST" && path === "/incident") {
                    const result = missions.createIncident(JSON.parse(request.body));
                    sendResponse(socket, 201, "Created", "application/json", JSON.stringify({
                        message: "Incident created",
                        incident: result.incident,
                        mission: result.mission
                    }, null, 2));
                    return;
                }

                if (method !== "GET" && method !== "POST") {
                    sendResponse(socket, 405, "Method Not Allowed", "text/plain", "Method Not Allowed");
                    return;
                }

                sendResponse(socket, 404, "Not Found", "text/plain", "Route not found");
            } catch (error) {
                console.error(error);
                sendResponse(socket, 500, "Internal Server Error", "text/plain", "Internal Server Error");
            }
        });
    });

    server.listen(port, () => {
        console.log(`\n--\nCONTROL CENTER RUNNING\n--\n\nhttp://localhost:${port}\n\n--\n`);
    });
    return server;
}

module.exports = { startHttpServer };

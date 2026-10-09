const net = require("net");
const { generateDashboard } = require("./dashboard");
const { STATUS_CODES } = require("http");
const { parseRequest, MAX_HEADER_BYTES, MAX_BODY_BYTES, REQUEST_TIMEOUT_MS } = require("./requestParser");
const { requestError } = require("./errors");
const { validateUnit, validateSensor, validateDeletion } = require("./validation");
const { isActiveMission } = require("../shared/missions");

function sendResponse(socket, statusCode, statusText, contentType, body) {
    socket.end(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        `Content-Type: ${contentType}; charset=utf-8\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        (statusCode === 405 ? "Allow: GET, POST\r\n" : "") +
        "Connection: close\r\n\r\n" +
        body
    );
    socket.destroySoon();
}

function sendJson(socket, statusCode, statusText, data) {
    sendResponse(socket, statusCode, statusText, "application/json", JSON.stringify(data, null, 2));
}

function parseJson(body) {
    try {
        return JSON.parse(body);
    } catch {
        throw requestError(400, "Body must contain valid JSON");
    }
}

function startHttpServer({ port, state, islandMap, width, height, missions }) {
    const server = net.createServer({ allowHalfOpen: true }, socket => {
        let buffer = Buffer.alloc(0);
        let handled = false;
        const timer = setTimeout(() => respondError(requestError(408, "Request timed out after 5 seconds")), REQUEST_TIMEOUT_MS);

        function respondError(error) {
            handled = true;
            clearTimeout(timer);
            buffer = Buffer.alloc(0);
            if (socket.destroyed || socket.writableEnded) return;
            const code = error.statusCode || 500;
            if (code === 500) console.error(error);
            sendJson(socket, code, STATUS_CODES[code], {
                message: code === 500 ? "Internal Server Error" : error.message
            });
        }

        socket.on("error", () => socket.destroy());
        socket.on("close", () => clearTimeout(timer));
        socket.on("end", () => {
            if (!handled) respondError(requestError(400, "Connection ended before the request was complete"));
        });
        socket.on("data", data => {
            if (handled) return;
            try {
                if (buffer.length + data.length > MAX_HEADER_BYTES + MAX_BODY_BYTES) {
                    throw requestError(413, "Request exceeds size limits");
                }
                buffer = Buffer.concat([buffer, data]);
                const request = parseRequest(buffer);
                if (!request) return;
                handled = true;
                clearTimeout(timer);
                buffer = Buffer.alloc(0);
                const method = request.method;
                const path = request.path;
                const body = request.body;

                if (method === "GET" && path === "/health") {
                    const ready = state.rpcReady && state.mqttState.connected;
                    sendJson(socket, ready ? 200 : 503, ready ? "OK" : "Service Unavailable", {
                        ready,
                        grpc: state.rpcReady,
                        mqtt: state.mqttState.connected
                    });
                    return;
                }

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
                    sendJson(socket, 200, "OK", {
                        status: "running",
                        units: state.units.length,
                        sensors: state.sensors.length,
                        incidents: state.incidents.length,
                        missions: state.missions.length,
                        activeMissions: state.missions.filter(
                            mission => isActiveMission(mission.status)
                        ).length,
                        mqtt: state.mqttState,
                        coordination: state.coordination
                    });
                    return;
                }

                if (method === "GET" && path === "/map") {
                    sendJson(socket, 200, "OK", islandMap);
                    return;
                }

                if (method === "POST" && path === "/unit") {
                    const unit = validateUnit(parseJson(body));
                    unit.registeredAt = new Date().toISOString();
                    const registeredUnit = missions.upsertUnit(unit);
                    sendJson(socket, 201, "Created", {
                        message: "Unit registered",
                        unit: registeredUnit
                    });
                    return;
                }

                if (method === "POST" && path === "/sensor") {
                    const sensor = validateSensor(parseJson(body));
                    sensor.registeredAt = new Date().toISOString();
                    const registeredSensor = missions.upsertSensor(sensor);
                    sendJson(socket, 201, "Created", {
                        message: "Sensor registered",
                        sensor: registeredSensor
                    });
                    return;
                }

                if (method === "POST" && path === "/incident") {
                    const result = missions.createIncident(parseJson(body));
                    sendJson(socket, 201, "Created", {
                        message: "Incident created",
                        incident: result.incident,
                        mission: result.mission
                    });
                    return;
                }

                if (method === "POST" && path === "/incident/delete") {
                    const deletedIncident = missions.deleteIncident(validateDeletion(parseJson(body)));
                    if (!deletedIncident) {
                        sendJson(socket, 404, "Not Found", { message: "Incident not found" });
                        return;
                    }
                    sendJson(socket, 200, "OK", {
                        message: "Incident deleted",
                        incident: deletedIncident
                    });
                    return;
                }

                sendJson(socket, 404, "Not Found", { message: "Route not found" });
            } catch (error) {
                respondError(error);
            }
        });
    });

    server.listen(port, () => {
        console.log(`\n--\nCONTROL CENTER RUNNING\n--\n\nhttp://localhost:${port}\n\n--\n`);
    });
    return server;
}

module.exports = { startHttpServer };

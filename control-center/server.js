const net = require("net");

const { islandMap, WIDTH, HEIGHT } = require("./map");
const { parseRequest } = require("./requestParser");
const { generateDashboard } = require("./dashboard");

const PORT = 8080;

const units = [];
const sensors = [];
const incidents = [];

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

const server = net.createServer((socket) => {

    socket.on("data", (data) => {

        try {

            const requestText = data.toString();

            console.log(requestText);

            const request = parseRequest(requestText);

            const method = request.method;
            const path = request.path;

            /*
            ============================================
            GET /
            ============================================
            */

            if (method === "GET" && path === "/") {

                const html = generateDashboard({
                    map: islandMap,
                    units,
                    sensors,
                    incidents,
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
                    incidents: incidents.length
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

                units.push(unit);

                sendResponse(
                    socket,
                    201,
                    "Created",
                    "application/json",
                    JSON.stringify({
                        message: "Unit registered",
                        unit
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

                incident.createdAt = new Date().toISOString();

                incidents.push(incident);

                const cell = getCell(
                    incident.x,
                    incident.y
                );

                if (cell) {
                    cell.incidents.push(incident);
                }

                sendResponse(
                    socket,
                    201,
                    "Created",
                    "application/json",
                    JSON.stringify({
                        message: "Incident created",
                        incident
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
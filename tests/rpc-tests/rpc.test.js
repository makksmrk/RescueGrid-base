const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const grpc = require("../../control-center/node_modules/@grpc/grpc-js");
const protoLoader = require("../../control-center/node_modules/@grpc/proto-loader");

const protoPath = path.join(__dirname, "..", "..", "proto", "mission.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    defaults: true
});
const missionProto = grpc.loadPackageDefinition(packageDefinition).mission;
const controlCenterClient = new missionProto.ControlCenterService(
    "localhost:50051",
    grpc.credentials.createInsecure()
);

function request(method, requestPath, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: "localhost",
            port: 8080,
            path: requestPath,
            method,
            headers: payload ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            } : {}
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function readDashboardSection(html, section) {
    const expression = new RegExp(`<h2>${section}</h2>\\s*<pre>([\\s\\S]*?)</pre>`);
    const match = html.match(expression);
    assert(match, `Dashboard section ${section} not found`);
    return JSON.parse(match[1]);
}

async function getDashboardState() {
    const response = await request("GET", "/");
    assert.strictEqual(response.statusCode, 200);
    return {
        missions: readDashboardSection(response.body, "Missions"),
        units: readDashboardSection(response.body, "Units"),
        incidents: readDashboardSection(response.body, "Incidents")
    };
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function observeMission(missionId, behaviorText) {
    const deadline = Date.now() + 8000;
    const observedStatuses = new Set(["ASSIGNED"]);
    let behaviorObserved = false;

    while (Date.now() < deadline) {
        const state = await getDashboardState();
        const mission = state.missions.find(item => item.id === missionId);

        if (mission) {
            observedStatuses.add(mission.status);
            behaviorObserved ||= mission.message.includes(behaviorText);

            if (mission.status === "IDLE" && mission.progress === 100) {
                assert(observedStatuses.has("BUSY"), "BUSY state was not observed");
                assert(behaviorObserved, `Behavior message was not observed: ${behaviorText}`);

                const unit = state.units.find(item => item.id === mission.vehicleId);
                assert(unit, "Assigned vehicle not found");
                assert.strictEqual(unit.status, "IDLE");

                const incident = state.incidents.find(item => item.id === mission.incidentId);
                assert(incident, "Related incident not found");
                assert.strictEqual(incident.status, "RESOLVED");
                assert(incident.resolvedAt, "Resolved timestamp is missing");
                return mission;
            }
        }

        await sleep(200);
    }

    throw new Error(`Mission ${missionId} did not finish within 8 seconds`);
}

async function testRoleAssignment(testCase) {
    const response = await request("POST", "/incident", testCase.incident);
    assert.strictEqual(response.statusCode, 201);

    const mission = JSON.parse(response.body).mission;
    assert(mission, "No mission was created");
    assert.strictEqual(mission.requiredRole, testCase.role);
    assert.strictEqual(mission.type, testCase.missionType);
    assert.strictEqual(mission.priority, testCase.priority);
    assert.strictEqual(mission.status, "ASSIGNED");
    assert(mission.vehicleId, "No vehicle was assigned");

    return observeMission(mission.id, testCase.behavior);
}

function reportMissionStatus(report) {
    return new Promise((resolve, reject) => {
        controlCenterClient.ReportMissionStatus(report, (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
}

async function testBusyVehicle() {
    const first = await request("POST", "/incident", {
        type: "person_detected", x: 3, y: 3, confidence: 0.95
    });
    assert.strictEqual(first.statusCode, 201);
    const firstMission = JSON.parse(first.body).mission;
    assert.strictEqual(firstMission.status, "ASSIGNED");

    const second = await request("POST", "/incident", {
        type: "person_detected", x: 4, y: 4, confidence: 0.96
    });
    assert.strictEqual(second.statusCode, 201);
    const secondMission = JSON.parse(second.body).mission;
    assert.strictEqual(secondMission.status, "ERROR");
    assert.strictEqual(secondMission.vehicleId, null);
    assert(secondMission.message.includes("No suitable idle vehicle"));

    await observeMission(firstMission.id, "inspiziert die Zielposition aus der Luft");
}

async function testRpcReports() {
    const durations = [];

    for (let index = 0; index < 20; index++) {
        const startedAt = Date.now();
        const response = await reportMissionStatus({
            missionId: `rpc-load-${index}`,
            vehicleId: "rpc-test-client",
            status: "BUSY",
            progress: index,
            message: "RPC load test"
        });
        durations.push(Date.now() - startedAt);
        assert.strictEqual(response.received, true);
    }

    const maximum = Math.max(...durations);
    const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    assert(maximum < 1000, `Maximum RPC response time was ${maximum} ms`);
    return { requests: durations.length, average, maximum };
}

async function main() {
    try {
        console.log("\nRPC TESTS - AUFGABE 2\n");

        const proto = fs.readFileSync(protoPath, "utf8");
        for (const requiredPart of [
            "rpc AssignMission", "rpc ReportMissionStatus", "string mission_id",
            "string type", "Position target", "int32 priority"
        ]) {
            assert(proto.includes(requiredPart), `Missing IDL definition: ${requiredPart}`);
        }
        console.log("PASS: IDL contains both RPC methods and all required mission fields");

        const roleCases = [
            {
                incident: { type: "person_detected", x: 5, y: 5, confidence: 0.95 },
                role: "drone", missionType: "aerial_inspection", priority: 10,
                behavior: "inspiziert die Zielposition aus der Luft"
            },
            {
                incident: { type: "blocked_route", x: 6, y: 6 },
                role: "repair_rover", missionType: "repair_route", priority: 7,
                behavior: "repariert Wege und Infrastruktur"
            },
            {
                incident: { type: "supply_low", x: 7, y: 7, remaining: 10 },
                role: "supply_rover", missionType: "deliver_supplies", priority: 6,
                behavior: "liefert Material zur Zielposition"
            }
        ];

        let lastCompletedMission;
        for (const roleCase of roleCases) {
            lastCompletedMission = await testRoleAssignment(roleCase);
            console.log(`PASS: ${roleCase.role} assignment, behavior and state transitions`);
        }

        await testBusyVehicle();
        console.log("PASS: busy vehicle causes an ERROR mission");

        const reportAck = await reportMissionStatus({
            missionId: lastCompletedMission.id,
            vehicleId: lastCompletedMission.vehicleId,
            status: "IDLE",
            progress: 100,
            message: "Completion confirmed by RPC test"
        });
        assert.strictEqual(reportAck.received, true);
        console.log("PASS: completion report is acknowledged via gRPC");

        const performance = await testRpcReports();
        console.log(
            `PASS: ${performance.requests} RPC reports, average ${performance.average.toFixed(1)} ms, ` +
            `maximum ${performance.maximum} ms`
        );

        console.log("\nALL RPC TESTS PASSED\n");
    } catch (error) {
        console.error("\nRPC TEST FAILED:", error.message);
        process.exitCode = 1;
    } finally {
        controlCenterClient.close();
    }
}

main();

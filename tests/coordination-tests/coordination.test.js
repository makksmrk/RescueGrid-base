const assert = require("assert");
const { execFile } = require("child_process");
const http = require("http");

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(check, message, timeout = 10000) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const result = await check();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        await sleep(200);
    }
    throw new Error(lastError ? `${message}: ${lastError.message}` : message);
}

function requestJson(path) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "localhost", port: 8080, path }, response => {
            let body = "";
            response.on("data", chunk => body += chunk);
            response.on("end", () => {
                try {
                    assert.strictEqual(response.statusCode, 200);
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function runDockerCompose(...args) {
    return new Promise((resolve, reject) => {
        execFile("docker", ["compose", ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`docker compose ${args.join(" ")} failed: ${stderr || error.message}`));
                return;
            }
            resolve(stdout);
        });
    });
}

function eventKey(event) {
    return [
        event.type,
        event.vehicleId,
        event.toVehicleId || "",
        event.requestId || "",
        event.logicalTime,
        event.timestamp
    ].join("|");
}

async function waitForCoordinationReady() {
    return waitFor(async () => {
        const status = await requestJson("/status");
        const coordination = status.coordination;
        if (
            status.mqtt.connected &&
            status.units >= 3 &&
            coordination &&
            coordination.messages.some(event => event.type === "REQUEST") &&
            coordination.messages.some(event => event.type === "REPLY")
        ) {
            return status;
        }
        return null;
    }, "Coordination system is not ready", 20000);
}

async function testSafety() {
    const initial = await requestJson("/status");
    const seen = new Set(initial.coordination.messages.map(eventKey));
    let activeUser = initial.coordination.currentUser
        ? {
            vehicleId: initial.coordination.currentUser,
            requestId: initial.coordination.currentRequestId
        }
        : null;
    let enterCount = 0;
    let requestSeen = false;
    let replySeen = false;

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const status = await requestJson("/status");
        for (const event of status.coordination.messages) {
            const key = eventKey(event);
            if (seen.has(key)) continue;
            seen.add(key);

            requestSeen ||= event.type === "REQUEST";
            replySeen ||= event.type === "REPLY";

            if (event.type === "ENTER") {
                assert.strictEqual(
                    activeUser,
                    null,
                    `Safety violation: ${event.vehicleId} entered while ${activeUser ? activeUser.vehicleId : "none"} was active`
                );
                activeUser = { vehicleId: event.vehicleId, requestId: event.requestId };
                enterCount++;
            }

            if (event.type === "LEAVE" && activeUser && event.requestId === activeUser.requestId) {
                activeUser = null;
            }
        }

        await sleep(200);
    }

    assert(enterCount >= 2, "Too few critical-section entries were observed");
    assert(requestSeen, "No REQUEST message was observed");
    assert(replySeen, "No REPLY message was observed");
}

async function testLiveness() {
    const pendingRequest = await waitFor(async () => {
        const status = await requestJson("/status");
        return status.coordination.pendingRequests[0] || null;
    }, "No waiting vehicle was observed", 15000);

    const entered = await waitFor(async () => {
        const status = await requestJson("/status");
        return status.coordination.messages.find(event =>
            event.type === "ENTER" &&
            event.requestId === pendingRequest.requestId &&
            event.vehicleId === pendingRequest.vehicleId
        );
    }, `Waiting vehicle ${pendingRequest.vehicleId} did not enter the charging station`, 20000);

    assert.strictEqual(entered.vehicleId, pendingRequest.vehicleId);
}

async function testProcessCrashBehavior() {
    await waitFor(async () => {
        const status = await requestJson("/status");
        return status.coordination.currentUser !== "supply-rover-1" ? status : null;
    }, "supply-rover-1 did not leave the charging station before the crash test", 12000);

    await runDockerCompose("stop", "supply-rover-1");

    const blockedState = await waitFor(async () => {
        const before = await requestJson("/status");
        await sleep(5000);
        const after = await requestJson("/status");

        if (
            !after.coordination.currentUser &&
            after.coordination.pendingRequests.length > 0 &&
            after.coordination.completedAccesses === before.coordination.completedAccesses
        ) {
            return after;
        }

        return null;
    }, "Process crash did not create the expected waiting state", 30000);

    assert(blockedState.coordination.pendingRequests.length > 0);
    assert.strictEqual(blockedState.coordination.currentUser, null);

    await runDockerCompose("restart", "control-center", "drone-1", "repair-rover-1", "supply-rover-1");
    await waitForCoordinationReady();
}

async function testCoordinationLatency() {
    const initial = await requestJson("/status");
    const seen = new Set(initial.coordination.messages.map(eventKey));
    const requests = new Map();
    const durations = [];

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && durations.length < 3) {
        const status = await requestJson("/status");
        for (const event of status.coordination.messages) {
            const key = eventKey(event);
            if (seen.has(key)) continue;
            seen.add(key);

            if (event.type === "REQUEST") {
                requests.set(event.requestId, Date.parse(event.timestamp));
            }

            if (event.type === "ENTER" && requests.has(event.requestId)) {
                durations.push(Date.parse(event.timestamp) - requests.get(event.requestId));
            }
        }

        await sleep(200);
    }

    assert(durations.length >= 3, "Too few coordination latencies were measured");
    const maximum = Math.max(...durations);
    const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    assert(maximum < 12000, `Maximum coordination latency was ${maximum} ms`);
    return { count: durations.length, average, maximum };
}

async function main() {
    try {
        console.log("\nCOORDINATION TESTS - AUFGABE 4\n");

        await waitForCoordinationReady();
        console.log("PASS: Coordination system is ready and all three vehicles participate");

        await testSafety();
        console.log("PASS: Safety - no two vehicles used the charging station at the same time");

        await testLiveness();
        console.log("PASS: Liveness - a waiting vehicle entered after another vehicle left");

        await testProcessCrashBehavior();
        console.log("PASS: Fehlerbetrachtung - process crash blocks progress until the system is restarted");

        const latency = await testCoordinationLatency();
        console.log(
            `PASS: Non-functional latency - ${latency.count} accesses, ` +
            `average ${latency.average.toFixed(1)} ms, maximum ${latency.maximum} ms`
        );

        console.log("\nALL COORDINATION TESTS PASSED\n");
    } catch (error) {
        console.error("\nCOORDINATION TEST FAILED:", error.message);
        process.exitCode = 1;
    }
}

main();

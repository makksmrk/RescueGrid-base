const assert = require("assert");
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

function requestDashboardSection(section) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "localhost", port: 8080, path: "/" }, response => {
            let html = "";
            response.on("data", chunk => html += chunk);
            response.on("end", () => {
                try {
                    assert.strictEqual(response.statusCode, 200);
                    const expression = new RegExp(`<summary>${section}</summary>\\s*<pre>([\\s\\S]*?)</pre>`);
                    const match = html.match(expression);
                    assert(match, `Dashboard section ${section} not found`);
                    resolve(JSON.parse(match[1]));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function postJson(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const request = http.request({
            hostname: "localhost",
            port: 8080,
            path,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, response => {
            let responseBody = "";
            response.on("data", chunk => responseBody += chunk);
            response.on("end", () => {
                try {
                    assert(response.statusCode >= 200 && response.statusCode < 300);
                    resolve(JSON.parse(responseBody));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on("error", reject);
        request.write(payload);
        request.end();
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

async function waitForSystemReady() {
    return waitFor(async () => {
        const status = await requestJson("/status");
        if (!status.mqtt.connected || status.units < 3) return null;

        const units = await requestDashboardSection("Units");
        const expectedUnits = ["drone-1", "repair-rover-1", "supply-rover-1"];
        const allReady = expectedUnits.every(id => {
            const unit = units.find(item => item.id === id);
            return unit && unit.connectionStatus === "online";
        });

        return allReady ? status : null;
    }, "System is not ready", 30000);
}

async function waitForRoleAvailable(role) {
    return waitFor(async () => {
        const units = await requestDashboardSection("Units");
        const unit = units.find(item => item.role === role);
        const chargingStatus = unit && unit.charging ? unit.charging.status : "NOT_REQUESTING";

        if (
            unit &&
            unit.status === "IDLE" &&
            !unit.currentMissionId &&
            chargingStatus !== "WAITING" &&
            chargingStatus !== "USING" &&
            unit.battery > 0
        ) {
            return unit;
        }

        return null;
    }, `No available ${role} found`, 90000);
}

async function triggerBatteryUse() {
    await postJson("/incident", {
        type: "person_detected",
        x: 2,
        y: 2,
        confidence: 0.95
    });
    await postJson("/incident", {
        type: "blocked_route",
        x: 3,
        y: 3
    });
    await postJson("/incident", {
        type: "supply_low",
        x: 4,
        y: 4,
        remaining: 10
    });
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
    }, "Coordination system is not ready", 45000);
}

async function testBatteryIsUsedDuringMission() {
    await waitForRoleAvailable("repair_rover");
    const unitsBeforeWork = await requestDashboardSection("Units");
    const batteryBeforeByUnit = new Map(
        unitsBeforeWork
            .filter(unit => Number.isFinite(unit.battery))
            .map(unit => [unit.id, unit.battery])
    );

    await triggerBatteryUse();

    const busyUnit = await waitFor(async () => {
        const units = await requestDashboardSection("Units");
        return units.find(unit =>
            unit.status === "BUSY" &&
            batteryBeforeByUnit.has(unit.id) &&
            unit.battery < batteryBeforeByUnit.get(unit.id)
        );
    }, "No vehicle used battery while working", 90000);

    const batteryBeforeWork = batteryBeforeByUnit.get(busyUnit.id);
    assert(
        busyUnit.battery < batteryBeforeWork,
        `Battery did not decrease during work: before ${batteryBeforeWork}, after ${busyUnit.battery}`
    );
    assert.notStrictEqual(busyUnit.charging && busyUnit.charging.status, "USING");
    assert.notStrictEqual(busyUnit.charging && busyUnit.charging.status, "WAITING");

    return {
        vehicleId: busyUnit.id,
        batteryAfterWork: busyUnit.battery
    };
}

async function testNoVehicleWorksWhileCharging() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const units = await requestDashboardSection("Units");
        const overlappingUnit = units.find(unit =>
            unit.status === "BUSY" &&
            unit.charging &&
            (unit.charging.status === "WAITING" || unit.charging.status === "USING")
        );

        assert(
            !overlappingUnit,
            `${overlappingUnit ? overlappingUnit.id : "A vehicle"} is working and charging at the same time`
        );

        await sleep(200);
    }
}

async function testChargingRestoresBattery() {
    await triggerBatteryUse();

    const using = await waitFor(async () => {
        const units = await requestDashboardSection("Units");
        return units.find(unit =>
            unit.charging &&
            unit.charging.status === "USING" &&
            unit.battery < 100
        );
    }, "No vehicle started charging with battery below 100", 90000);

    assert.notStrictEqual(using.status, "BUSY");
    assert(!using.currentMissionId, `${using.id} is charging while a mission is active`);

    const charged = await waitFor(async () => {
        const units = await requestDashboardSection("Units");
        return units.find(unit =>
            unit.id === using.id &&
            unit.charging &&
            unit.charging.status === "NOT_REQUESTING" &&
            unit.battery === 100
        );
    }, `${using.id} was not fully charged`, 30000);

    assert.strictEqual(charged.battery, 100);
}

async function testSafety() {
    const seen = new Set();
    let activeUser = null;
    let enterCount = 0;
    let requestSeen = false;
    let replySeen = false;

    const deadline = Date.now() + 60000;
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
    await triggerBatteryUse();

    const initial = await requestJson("/status");
    const seen = new Set(initial.coordination.messages.map(eventKey));
    const requests = new Set();

    const entered = await waitFor(async () => {
        const status = await requestJson("/status");
        for (const event of status.coordination.messages) {
            const key = eventKey(event);
            if (seen.has(key)) continue;
            seen.add(key);

            if (event.type === "REQUEST") {
                requests.add(event.requestId);
            }

            if (event.type === "ENTER" && requests.has(event.requestId)) {
                return event;
            }
        }
        return null;
    }, "Requested vehicle did not enter the charging station", 60000);

    assert(entered.vehicleId);
}

async function testCoordinationLatency() {
    await triggerBatteryUse();

    const initial = await requestJson("/status");
    const seen = new Set(initial.coordination.messages.map(eventKey));
    const requests = new Map();
    const durations = [];

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && durations.length < 1) {
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

    assert(durations.length >= 1, "No coordination latency was measured");
    const maximum = Math.max(...durations);
    const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
    assert(maximum < 12000, `Maximum coordination latency was ${maximum} ms`);
    return { count: durations.length, average, maximum };
}

async function main() {
    try {
        console.log("\nCOORDINATION TESTS\n");

        await waitForSystemReady();

        const batteryResult = await testBatteryIsUsedDuringMission();
        console.log(
            `PASS: ${batteryResult.vehicleId} uses battery during work ` +
            `(after work ${batteryResult.batteryAfterWork}%)`
        );

        await testNoVehicleWorksWhileCharging();
        console.log("PASS: vehicles do not work while waiting for or using the charging station");

        await testChargingRestoresBattery();
        console.log("PASS: charging station restores vehicle battery to 100%");

        await triggerBatteryUse();
        await waitForCoordinationReady();
        console.log("PASS: Coordination system is ready and all three vehicles participate");

        await testSafety();
        console.log("PASS: Safety - no two vehicles used the charging station at the same time");

        await testLiveness();
        console.log("PASS: Liveness - a waiting vehicle entered after another vehicle left");

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

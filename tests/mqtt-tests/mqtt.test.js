const assert = require("assert");
const http = require("http");
const mqtt = require("../../services/control-center/node_modules/mqtt");
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const TEST_ID = `mqtt-test-${Date.now()}`;
const receivedMessages = [];

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(check, message, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await check();
        if (result) return result;
        await sleep(100);
    }
    throw new Error(message);
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

function requestDashboard() {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "localhost", port: 8080, path: "/" }, response => {
            let html = "";
            response.on("data", chunk => html += chunk);
            response.on("end", () => {
                try {
                    assert.strictEqual(response.statusCode, 200);
                    const readSection = name => {
                        const match = html.match(new RegExp(`<summary>${name}</summary>\\s*<pre>([\\s\\S]*?)</pre>`));
                        assert(match, `Dashboard section ${name} not found`);
                        return JSON.parse(match[1]);
                    };
                    resolve({
                        sensors: readSection("Sensors"),
                        incidents: readSection("Incidents"),
                        units: readSection("Units"),
                        missions: readSection("Missions")
                    });
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function publish(client, topic, payload, options = { qos: 1 }) {
    return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(payload), options, error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function createEvent(overrides = {}) {
    return {
        messageId: `${TEST_ID}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        sourceId: TEST_ID,
        sourceType: "water-sensor",
        eventType: "water_level_alert",
        x: 18,
        y: 18,
        measurement: { name: "water_level_cm", value: 95, unit: "cm", threshold: 80 },
        ...overrides
    };
}

async function main() {
    const client = mqtt.connect(MQTT_URL, {
        clientId: TEST_ID,
        clean: true,
        reconnectPeriod: 500
    });

    client.on("message", (topic, buffer) => {
        try {
            receivedMessages.push({ topic, payload: JSON.parse(buffer.toString()) });
        } catch (_error) {
            // Invalid JSON is tested by the control center and is irrelevant to this subscriber.
        }
    });

    try {
        console.log("\nMQTT TESTS\n");

        await waitFor(() => client.connected, "MQTT broker is not reachable");
        await new Promise((resolve, reject) => client.subscribe(
            ["island/telemetry/+", "island/status/+"],
            { qos: 1 },
            error => error ? reject(error) : resolve()
        ));

        const initialStatus = await requestJson("/status");
        assert.strictEqual(initialStatus.status, "running");
        assert.strictEqual(initialStatus.mqtt.connected, true);
        assert(Array.isArray(await requestJson("/map")));
        console.log("PASS: Broker, GET /status and GET /map are available");

        const observation = createEvent({
            messageId: `${TEST_ID}-observation`,
            sourceType: "camera",
            eventType: "camera_observation",
            x: 17,
            y: 17,
            measurement: { name: "person_confidence", value: 0.2, threshold: 0.8 }
        });
        await publish(client, `island/events/camera/${TEST_ID}`, observation);
        await waitFor(async () => {
            const state = await requestDashboard();
            return state.sensors.some(sensor =>
                sensor.id === TEST_ID && sensor.lastEventType === "camera_observation"
            );
        }, "Camera observation was not processed");
        let dashboard = await requestDashboard();
        assert(!dashboard.incidents.some(incident => incident.messageId === observation.messageId));

        const alert = createEvent({ messageId: `${TEST_ID}-alert` });
        await publish(client, `island/events/water-sensor/${TEST_ID}`, alert);
        await waitFor(async () => {
            const state = await requestDashboard();
            return state.incidents.some(incident => incident.messageId === alert.messageId);
        }, "Threshold alert did not create an incident");
        console.log("PASS: Sensor values create incidents only when the event threshold is exceeded");

        const duplicate = createEvent({ messageId: `${TEST_ID}-duplicate`, x: 16, y: 16 });
        const beforeDuplicate = await requestJson("/status");
        await publish(client, `island/events/water-sensor/${TEST_ID}`, duplicate);
        await publish(client, `island/events/water-sensor/${TEST_ID}`, duplicate);
        await waitFor(async () => (await requestJson("/status")).mqtt.duplicatesIgnored >
            beforeDuplicate.mqtt.duplicatesIgnored, "Duplicate was not detected");
        dashboard = await requestDashboard();
        assert.strictEqual(
            dashboard.incidents.filter(incident => incident.messageId === duplicate.messageId).length,
            1
        );
        console.log("PASS: Duplicate messages are ignored");

        const oldEvent = createEvent({
            messageId: `${TEST_ID}-old`,
            timestamp: new Date(Date.now() - 120000).toISOString(),
            x: 15,
            y: 15
        });
        const beforeOld = await requestJson("/status");
        await publish(client, `island/events/water-sensor/${TEST_ID}`, oldEvent);
        await waitFor(async () => (await requestJson("/status")).mqtt.oldMessagesIgnored >
            beforeOld.mqtt.oldMessagesIgnored, "Old message was not rejected");
        dashboard = await requestDashboard();
        assert(!dashboard.incidents.some(incident => incident.messageId === oldEvent.messageId));
        console.log("PASS: Messages older than 60 seconds are ignored");

        const mergeOne = createEvent({ messageId: `${TEST_ID}-merge-1`, x: 14, y: 14 });
        const mergeTwo = createEvent({ messageId: `${TEST_ID}-merge-2`, x: 14, y: 14 });
        const beforeMerge = await requestJson("/status");
        await publish(client, `island/events/water-sensor/${TEST_ID}`, mergeOne);
        await publish(client, `island/events/water-sensor/${TEST_ID}`, mergeTwo);
        await waitFor(async () => (await requestJson("/status")).mqtt.mergedIncidents >
            beforeMerge.mqtt.mergedIncidents, "Events at the same position were not merged");
        dashboard = await requestDashboard();
        const merged = dashboard.incidents.filter(incident =>
            incident.type === "water_level_alert" && incident.x === 14 && incident.y === 14
        );
        assert.strictEqual(merged.length, 1);
        assert.strictEqual(merged[0].reportCount, 2);
        console.log("PASS: Repeated events at the same position are merged");

        const telemetry = {
            messageId: `${TEST_ID}-telemetry`,
            timestamp: new Date().toISOString(),
            vehicleId: `${TEST_ID}-vehicle`,
            type: "repair_rover",
            role: "repair_rover",
            status: "BUSY",
            progress: 55,
            position: { x: 9, y: 10 },
            message: "Automated MQTT telemetry test"
        };
        await publish(client, `island/telemetry/${telemetry.vehicleId}`, telemetry);
        const updatedUnit = await waitFor(async () => {
            const state = await requestDashboard();
            return state.units.find(unit => unit.id === telemetry.vehicleId && unit.progress === 55);
        }, "Vehicle telemetry was not reflected in the dashboard");
        assert.deepStrictEqual(updatedUnit.position, telemetry.position);
        console.log("PASS: Vehicle position and progress are updated from MQTT telemetry");

        const hazard = createEvent({ messageId: `${TEST_ID}-hazard`, x: 13, y: 13 });
        await publish(client, `island/events/water-sensor/${TEST_ID}`, hazard);
        const avoidance = await waitFor(() => receivedMessages.find(item =>
            item.topic === "island/telemetry/repair-rover-1" &&
            item.payload.hazard &&
            item.payload.hazard.action === "route_adjusted" &&
            item.payload.hazard.x === hazard.x &&
            item.payload.hazard.y === hazard.y
        ), "Repair rover did not react autonomously to the hazard");
        assert.strictEqual(avoidance.payload.event, "hazard_avoided");
        console.log("PASS: Ground vehicle autonomously adjusts its route for flood hazards");

        const processedBeforeLoad = (await requestJson("/status")).mqtt.processedMessages;
        const loadStartedAt = Date.now();
        const loadMessages = Array.from({ length: 50 }, (_, index) => createEvent({
            messageId: `${TEST_ID}-load-${index}`,
            sourceType: "camera",
            eventType: "camera_observation",
            measurement: { name: "person_confidence", value: 0.1, threshold: 0.8 },
            x: index % 20,
            y: Math.floor(index / 20)
        }));
        await Promise.all(loadMessages.map(message =>
            publish(client, `island/events/camera/${TEST_ID}`, message)
        ));
        await waitFor(async () => (await requestJson("/status")).mqtt.processedMessages >=
            processedBeforeLoad + loadMessages.length, "Not all load-test messages were processed", 10000);
        const loadDuration = Date.now() - loadStartedAt;
        assert(loadDuration < 10000, `MQTT load test took ${loadDuration} ms`);
        console.log(`PASS: 50 QoS-1 messages processed in ${loadDuration} ms`);

        const publisherId = `${TEST_ID}-publisher`;
        const statusTopic = `island/status/${publisherId}`;
        const failedPublisher = mqtt.connect(MQTT_URL, {
            clientId: publisherId,
            reconnectPeriod: 0,
            will: {
                topic: statusTopic,
                payload: JSON.stringify({ componentId: publisherId, status: "offline" }),
                qos: 1,
                retain: true
            }
        });
        await waitFor(() => failedPublisher.connected, "Test publisher did not connect");
        await publish(failedPublisher, statusTopic, {
            componentId: publisherId,
            status: "online",
            timestamp: new Date().toISOString()
        }, { qos: 1, retain: true });
        failedPublisher.stream.destroy();
        await waitFor(() => receivedMessages.find(item =>
            item.topic === statusTopic && item.payload.status === "offline"
        ), "Publisher failure did not trigger the MQTT last will");

        const restartedPublisher = mqtt.connect(MQTT_URL, { clientId: publisherId, reconnectPeriod: 0 });
        await waitFor(() => restartedPublisher.connected, "Publisher could not restart");
        await publish(restartedPublisher, statusTopic, {
            componentId: publisherId,
            status: "online",
            timestamp: new Date().toISOString()
        }, { qos: 1, retain: true });
        await waitFor(() => receivedMessages.slice().reverse().find(item =>
            item.topic === statusTopic && item.payload.status === "online"
        ), "Restarted publisher did not return online");
        restartedPublisher.end(true);
        console.log("PASS: Publisher failure and restart are detected");

        console.log("\nALL MQTT TESTS PASSED\n");
    } catch (error) {
        console.error("\nMQTT TEST FAILED:", error.message);
        process.exitCode = 1;
    } finally {
        client.end(true);
    }
}

main();

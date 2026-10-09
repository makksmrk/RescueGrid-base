# Running RescueGrid

RescueGrid runs as seven services with Docker Compose: a Mosquitto broker, the Control Center, three vehicles, and two sensors. Run all commands below from the repository root.

## Docker quick start

Install Docker Engine with the Compose plugin on Linux, or Docker Desktop on Windows, and start Docker. A host Node.js installation is not required for the Docker workflow.

```bash
docker compose up --build -d
docker compose ps
```

Open [the dashboard](http://localhost:8080). The Control Center becomes healthy once its HTTP endpoint, gRPC listener, and MQTT subscription are ready. Vehicles and sensors wait for that healthcheck before starting. Registration requests time out after five seconds and retry failures every three seconds. This handles startup delays; it does not implement recovery of in-memory state after a Control Center restart.

Stop the system:

```bash
docker compose down
```

Inspect logs:

```bash
docker compose logs -f
docker compose logs -f control-center
docker compose logs -f drone-1
```

## Ports

| Interface | Default host port | Container port |
| --- | --- | --- |
| Dashboard / HTTP API | 8080 | 8080 |
| Control Center gRPC | 50051 | 50051 |
| MQTT broker | 1883 | 1883 |

Vehicle gRPC ports 50052–50054 are internal to the Compose network.

To change host ports, copy `.env.example` to `.env` and edit `HOST_HTTP_PORT`, `HOST_RPC_PORT`, or `HOST_MQTT_PORT`. Internal service addresses and ports stay unchanged. For example, `HOST_HTTP_PORT=8081` exposes the dashboard at `http://localhost:8081`.

## Local Node.js development

Use Node.js 22, matching the Docker images and package engines. `.nvmrc` selects that major version for version managers that support it. The root package manages all four services as npm workspaces, with one committed `package-lock.json`.

Install dependencies for every service with:

```bash
npm ci
```

After intentionally changing a dependency, update the root lockfile with `npm install`. Do not maintain separate lockfiles inside services. Docker installs only the selected service's production dependencies from the root lockfile.

Start a service from the root with:

```bash
npm start --workspace=control-center
npm start --workspace=emergency-vehicle
npm start --workspace=water-sensor
npm start --workspace=camera-sensor
```

For native execution, configure the addresses first: the defaults use Docker DNS names. A local MQTT broker must already be available. Set environment variables using your shell's syntax.

Linux example:

```bash
MQTT_URL=mqtt://localhost:1883 npm start --workspace=control-center
```

PowerShell example:

```powershell
$env:MQTT_URL = "mqtt://localhost:1883"
npm start --workspace=control-center
```

For a native sensor, also set `CONTROL_CENTER_HOST=localhost`. Native vehicles require a reachable `RPC_HOST` (such as `localhost`), distinct `VEHICLE_ID` and `RPC_PORT` values, and a consistent `COORDINATION_PEERS` list. Start all configured peers for charging coordination to progress. Avoid running native services and Compose services on the same occupied ports.

## Service configuration

These variables configure service processes directly. Compose supplies the standard topology; its `.env` file currently overrides only the three host ports described above.

| Variable | Applies to | Default |
| --- | --- | --- |
| `MQTT_URL` | All Node services | `mqtt://mqtt-broker:1883` |
| `HTTP_PORT` | Control Center | `8080` |
| `RPC_PORT` | Control Center / vehicle | `50051` / `50052` |
| `CONTROL_CENTER_HOST` | Vehicles / sensors | `control-center` |
| `CONTROL_CENTER_HTTP_PORT` | Vehicles / sensors | `8080` |
| `CONTROL_CENTER_RPC_PORT` | Vehicles | `50051` |
| `VEHICLE_ID` | Vehicles | `drone-1` |
| `VEHICLE_ROLE` | Vehicles | `drone` |
| `RPC_HOST` | Vehicles; advertised gRPC address | Vehicle ID |
| `COORDINATION_PEERS` | Vehicles | `drone-1,repair-rover-1,supply-rover-1` |
| `CHARGING_RESOURCE_ID` | Vehicles | `charging_station` |
| `CHARGING_REQUEST_INTERVAL_MS` | Vehicles | `15000` |
| `CHARGING_USE_DURATION_MS` | Vehicles | `4000` |
| `SENSOR_ID` | Water / camera sensor | `water-sensor-1` / `camera-1` |

Ports must be integers between 1 and 65535. Durations must be positive integers within Node's timer range. Component IDs use letters, digits, underscores, and hyphens. Vehicle roles are `drone`, `repair_rover`, or `supply_rover`. The coordination list must contain unique IDs, include the vehicle itself, and contain at least two participants. Invalid configuration stops startup with an error.

Keep `CHARGING_RESOURCE_ID=charging_station` in the standard topology: the Control Center currently observes that resource. Custom resource observation and multi-host deployment are outside the current scope.

## Readiness and troubleshooting

```bash
curl http://localhost:8080/health
curl http://localhost:8080/status
```

PowerShell:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/status
```

`GET /health` returns 200 when ready and 503 otherwise. It reports gRPC and MQTT readiness; it does not assert that every vehicle or sensor is available. MQTT disconnects make it return 503. Compose startup dependencies do not automatically restart already-running services after a later dependency failure.

If startup fails, inspect `docker compose ps` and the relevant service logs. If a host port is occupied, select another port in `.env`. For manual API examples, see `tests/rest-tests/api-examples.http`.

## HTTP interface

The Control Center deliberately implements a limited HTTP/1.1 interface on TCP sockets. It handles one request per connection and sends `Connection: close`. Persistent connections, pipelining, `Transfer-Encoding` (including chunked bodies), and `Expect` are not supported. Any bytes following the first complete request are not processed as another request.

Requests need a single valid `Host` header and an origin-form target such as `/status`. Header names are case-insensitive; duplicate headers are rejected. Query strings do not change route selection. GET requests have no body. POST requests need `Content-Length` in bytes and `Content-Type: application/json`, optionally with `charset=utf-8`. Bodies must be uncompressed UTF-8 JSON objects.

Headers are limited to 8 KiB including the final separator, and bodies to 64 KiB. A request must arrive completely within five seconds of connecting. Error responses use JSON with a `message` field: 400 for malformed requests or invalid input, 404 for an unknown route or incident, 405 for an unsupported method, 408 for timeout, 409 for a deletion conflict, 411 for missing POST length, 413 for size limits, 415 for unsupported content format, 417 for `Expect`, 501 for `Transfer-Encoding`, and 505 for an unsupported HTTP version. Unexpected server errors return 500 without exposing internal details.

Vehicle registration requires `id`, a supported `role` (or matching `type`), `rpcHost`, and integer `rpcPort`. Optional `status`, `battery`, and `capabilities` are validated. Sensor registration requires `id` and `type` (`camera` or `water-level`), with an optional measurement name. IDs contain letters, digits, underscores or hyphens and are at most 128 characters.

For example, the vehicle registration body is:

```json
{
  "id": "drone-1",
  "role": "drone",
  "rpcHost": "drone-1",
  "rpcPort": 50052,
  "status": "IDLE",
  "battery": 100
}
```

An incident needs a supported `type` and integer `x`, `y` coordinates inside the map. Optional fields are `sensor`, `hardToReach` (boolean), `value` (finite number), and `measurement` (name, numeric value, optional unit and numeric threshold). Supported types are `person_detected`, `water_level_alert`, `blocked_route`, `structure_damage`, `bridge_damage`, `supply_low`, and `material_request`. The same incident validation applies to MQTT incident events before creation or merging.

Only these input fields are stored. Additional properties are ignored; incident IDs, source, lifecycle status, timestamps, mission links and registration timestamps are controlled by the server. MQTT event IDs and timestamps come from the event envelope. Historical API examples may need adjustment to this contract when the deferred test material is updated.

## Mission lifecycle

Mission states are `WAITING`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, and `FAILED`. Vehicle states remain `IDLE`, `ASSIGNED`, `BUSY`, and `ERROR`; charging is tracked separately. A mission consumes 20 battery points, so an available vehicle needs at least 20 points and must not be waiting for or using the charging station.

Assignment and status-report RPCs have a three-second deadline. Temporary rejection leaves the mission waiting. If an assignment acknowledgement is lost, its outcome is uncertain: the mission stays assigned to that vehicle and is not automatically sent elsewhere. A subsequent gRPC report or MQTT mission report can confirm progress or completion. If neither arrives, the assignment remains reserved; automatic crash/restart recovery is outside the current scope.

Failure to deliver a gRPC status report does not change the vehicle's execution state. MQTT heartbeat telemetry also carries its latest mission report. Incidents can be deleted only after resolution and without an active mission; other deletion requests return HTTP 409.

## Existing test workflow (deferred)

The test workflow has not been migrated in this change. Some scripts still import dependencies from a service-local `node_modules` path and need adjustment for workspace installation in a later stage. The existing instructions below are retained for reference, not a verified workflow.

## Automatisierte Tests

Vorbedingung: Das System läuft bereits mit Docker.

```bash
docker compose up --build -d
```

Dann Tests starten:

```bash
node tests/rest-tests/testRunner.js
node tests/rpc-tests/rpc.test.js
npm run test:mqtt
npm run test:coordination
```

Die Tests starten und stoppen die Container nicht selbst.

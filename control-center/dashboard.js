function generateDashboard(state) {

    const {
        map,
        units,
        sensors,
        incidents,
        missions,
        mqttState,
        coordination,
        width,
        height
    } = state;

    function getUnitSymbol(unit) {
        if (unit.role === "drone") return "D";
        if (unit.role === "repair_rover") return "R";
        if (unit.role === "supply_rover") return "S";
        return "U";
    }

    function getUnitStatus(role) {
        const unit = units.find(item => item.role === role);
        if (!unit) return "not registered";
        const chargingStatus = unit.charging ? unit.charging.status : "unknown";
        const battery = Number.isFinite(unit.battery) ? `${unit.battery}%` : "unknown battery";
        const workingStatus = unit.status ? unit.status : "unknown";
        return `charging status: ${chargingStatus}, battery ${battery}; working status: ${workingStatus}`;
    }

    function isUnitWorking(unit) {
        return unit.currentMissionId && unit.status === "BUSY";
    }

    function renderIncidentButtons() {
        const activeIncidents = incidents.filter(incident => incident.status !== "RESOLVED");
        if (activeIncidents.length === 0) return "<p>No active incidents</p>";
        return activeIncidents.map(incident => `
            <li>
                ${incident.id}:
                ${incident.type} at (${incident.x}, ${incident.y}) - ${incident.status}
                <button type="button" onclick="deleteIncident('${incident.id}')">Delete</button>
            </li>
        `).join("");
    }

    function getUnitMapPosition(unit) {
        if (
            (unit.status === "IDLE" && !unit.currentMissionId) ||
            unit.status === "ASSIGNED"
        ) {
            return { x: 0, y: 0 };
        }
        return unit.position;
    }

    const unitsByPosition = new Map();
    for (const unit of units) {
        const position = getUnitMapPosition(unit);
        if (!position) continue;
        const key = `${position.x},${position.y}`;
        if (!unitsByPosition.has(key)) unitsByPosition.set(key, []);
        unitsByPosition.get(key).push(unit);
    }

    let html = `
    <html>
    <head>

        <title>Storm Flood Dashboard</title>
        <meta charset="utf-8">

        <style>

            body {
                font-family: Arial;
                padding: 20px;
                background: #f4f4f4;
            }

            table {
                border-collapse: collapse;
            }

            td {
                width: 30px;
                height: 30px;
                text-align: center;
                border: 1px solid #999;
                font-size: 10px;
                position: relative;
            }

            .land {
                background: #8ad66d;
            }

            .water {
                background: #5db5ff;
            }

            .incident {
                background: red !important;
                color: white;
                animation: incidentBlink 0.8s infinite alternate;
            }

            .cell-content {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
                min-height: 30px;
            }

            .unit-marker {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 17px;
                height: 17px;
                border-radius: 50%;
                background: #222;
                color: white;
                font-weight: bold;
                font-size: 10px;
                line-height: 1;
            }

            .unit-working {
                background: #00a676;
                outline: 2px solid white;
                animation: pulse 1s infinite alternate;
            }

            @keyframes pulse {
                from { transform: scale(1); }
                to { transform: scale(1.18); }
            }

            @keyframes incidentBlink {
                from { background: #ff0000; }
                to { background: #8b0000; }
            }

            .charging-active {
                background: #ffd966 !important;
                color: black;
            }

            .infra {
                border: 3px solid black;
            }

            pre {
                background: white;
                padding: 10px;
            }

            details {
                margin-top: 12px;
                background: white;
                border: 1px solid #ccc;
                padding: 8px 10px;
            }

            summary {
                cursor: pointer;
                font-weight: bold;
            }

            .test-controls {
                margin: 16px 0;
                padding: 10px;
                background: white;
                border: 1px solid #ccc;
            }

            button {
                margin: 2px 4px 2px 0;
                cursor: pointer;
            }

        </style>

    </head>

    <body>

        <h1>Storm Flood Dashboard</h1>
        
        <h3>Vorsicht: Wenn auf der Seite Text markiert oder Informationsblock offen ist, passiert kein Refresh auf der Seite</h3>

        <h2>Status</h2>

        <ul id="status-list">
            <li>Units: ${units.length}</li>
            <li>Sensors: ${sensors.length}</li>
            <li>Incidents: ${incidents.length}</li>
            <li>Missions: ${missions.length}</li>
            <li>MQTT: ${mqttState.connected ? "connected" : "disconnected"}</li>
            <li>MQTT messages: ${mqttState.processedMessages}</li>
            <li>Charging station: ${coordination.currentUser || "free"}</li>
            <li>Drone: ${getUnitStatus("drone")}</li>
            <li>Repair Rover: ${getUnitStatus("repair_rover")}</li>
            <li>Supply Rover: ${getUnitStatus("supply_rover")}</li>
        </ul>

        <div class="test-controls">
            <h2>Active Incidents</h2>
            <ul>
                ${renderIncidentButtons()}
            </ul>
        </div>

        <p>
            <b>Legende:</b>
            <p>
                C = Ladestation,
                H = Hafen,
                D = Depot,
                B = Brücke,
            </p>
            <p>
                ! = offener Vorfall,
                D = Drohne,
                R = Reparatur-Rover,
                S = Versorgungs-Rover,
            </p>
            <p>
                grün pulsierend = Unit arbeitet,
                C gelb pulsierend = Unit wird an der Ladestation geladen.
            </p>
        </p>

        <h2>Island Map</h2>

        <table id="island-map">
    `;

    for (let y = 0; y < height; y++) {

        html += "<tr>";

        for (let x = 0; x < width; x++) {

            const cell = map[y][x];
            const hasOpenIncident = cell.incidents.some(incident => incident.status !== "RESOLVED");
            const cellUnits = unitsByPosition.get(`${x},${y}`) || [];

            let className = cell.type;

            if (cell.infrastructure) {
                className += " infra";
            }

            if (
                cell.infrastructure &&
                cell.infrastructure.type === "charging_station" &&
                coordination.currentUser
            ) {
                className += " charging-active";
            }

            if (hasOpenIncident) {
                className += " incident";
            }

            let symbol = ".";

            if (cell.type === "water") {
                symbol = "~";
            }

            if (cell.infrastructure) {

                switch (cell.infrastructure.type) {

                    case "charging_station":
                        symbol = "C";
                        break;

                    case "bridge":
                        symbol = "B";
                        break;

                    case "harbor":
                        symbol = "H";
                        break;

                    case "depot":
                        symbol = "D";
                        break;
                }
            }

            if (hasOpenIncident) {
                symbol = "!";
            }

            const unitSymbols = cellUnits.map(unit => `
                <span class="unit-marker ${isUnitWorking(unit) ? "unit-working" : ""}" title="${unit.id}: ${unit.status}, ${unit.progress || 0}%">
                    ${getUnitSymbol(unit)}
                </span>
            `).join("");

            html += `
                <td class="${className}">
                    <div class="cell-content">
                        <span>${symbol}</span>
                        ${unitSymbols}
                    </div>
                </td>
            `;
        }

        html += "</tr>";
    }

    html += `
        </table>

        <details data-section="charging">
            <summary>Charging Coordination</summary>
            <pre>${JSON.stringify(coordination, null, 2)}</pre>
        </details>

        <details data-section="units">
            <summary>Units</summary>
            <pre>${JSON.stringify(units, null, 2)}</pre>
        </details>

        <details data-section="sensors">
            <summary>Sensors</summary>
            <pre>${JSON.stringify(sensors, null, 2)}</pre>
        </details>

        <details data-section="incidents">
            <summary>Incidents</summary>
            <pre>${JSON.stringify(incidents, null, 2)}</pre>
        </details>

        <details data-section="missions">
            <summary>Missions</summary>
            <pre>${JSON.stringify(missions, null, 2)}</pre>
        </details>

        <script>
            async function deleteIncident(id) {
                await fetch("/incident/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id })
                });
                window.location.reload();
            }

            setInterval(() => {
                const hasOpenDetails = document.querySelector("details[open]");
                const selectedText = window.getSelection().toString();

                if (!hasOpenDetails && !selectedText) {
                    window.location.reload();
                }
            }, 1000);
        </script>

    </body>
    </html>
    `;

    return html;
}

module.exports = {
    generateDashboard
};

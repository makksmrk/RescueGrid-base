function generateDashboard(state) {

    const {
        map,
        units,
        sensors,
        incidents,
        missions,
        mqttState,
        width,
        height
    } = state;

    let html = `
    <html>
    <head>

        <title>Storm Flood Dashboard</title>

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
            }

            .infra {
                border: 3px solid black;
            }

            pre {
                background: white;
                padding: 10px;
            }

        </style>

        <meta http-equiv="refresh" content="5">

    </head>

    <body>

        <h1>Storm Flood Dashboard</h1>

        <h2>Status</h2>

        <ul>
            <li>Units: ${units.length}</li>
            <li>Sensors: ${sensors.length}</li>
            <li>Incidents: ${incidents.length}</li>
            <li>Missions: ${missions.length}</li>
            <li>MQTT: ${mqttState.connected ? "connected" : "disconnected"}</li>
            <li>MQTT messages: ${mqttState.processedMessages}</li>
        </ul>

        <h2>Island Map</h2>

        <table>
    `;

    for (let y = 0; y < height; y++) {

        html += "<tr>";

        for (let x = 0; x < width; x++) {

            const cell = map[y][x];
            const hasOpenIncident = cell.incidents.some(incident => incident.status !== "RESOLVED");

            let className = cell.type;

            if (cell.infrastructure) {
                className += " infra";
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

            html += `
                <td class="${className}">
                    ${symbol}
                </td>
            `;
        }

        html += "</tr>";
    }

    html += `
        </table>

        <h2>Units</h2>
        <pre>${JSON.stringify(units, null, 2)}</pre>

        <h2>Sensors</h2>
        <pre>${JSON.stringify(sensors, null, 2)}</pre>

        <h2>Incidents</h2>
        <pre>${JSON.stringify(incidents, null, 2)}</pre>

        <h2>Missions</h2>
        <pre>${JSON.stringify(missions, null, 2)}</pre>

    </body>
    </html>
    `;

    return html;
}

module.exports = {
    generateDashboard
};

const grpc = require("@grpc/grpc-js");

function createMissionService({ state, islandMap, width, height, missionProto }) {
    function getCell(x, y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return null;
        return islandMap[y][x];
    }

    function upsertUnit(unit) {
        const existingUnit = state.units.find(item => item.id === unit.id);
        if (existingUnit) {
            Object.assign(existingUnit, unit);
            retryWaitingMissions();
            return existingUnit;
        }
        state.units.push(unit);
        retryWaitingMissions();
        return unit;
    }

    function upsertSensor(sensor) {
        const existingSensor = state.sensors.find(item => item.id === sensor.id);
        if (existingSensor) {
            Object.assign(existingSensor, sensor);
            return existingSensor;
        }
        state.sensors.push(sensor);
        return sensor;
    }

    function getMissionType(incident) {
        if (
            incident.type === "person_detected" ||
            incident.type === "water_level_alert" ||
            incident.hardToReach === true
        ) {
            return {
                missionType: "aerial_inspection",
                role: "drone",
                priority: incident.type === "person_detected" ? 10 : 8
            };
        }

        if (["blocked_route", "structure_damage", "bridge_damage"].includes(incident.type)) {
            return { missionType: "repair_route", role: "repair_rover", priority: 7 };
        }

        if (["supply_low", "material_request"].includes(incident.type)) {
            return { missionType: "deliver_supplies", role: "supply_rover", priority: 6 };
        }

        return null;
    }

    function assignMissionForIncident(incident) {
        const assignment = getMissionType(incident);
        if (!assignment) return null;

        const unit = findIdleUnit(assignment.role);

        const mission = {
            id: `mission-${Date.now()}-${state.missions.length + 1}`,
            incidentId: incident.id,
            type: assignment.missionType,
            target: { x: incident.x, y: incident.y },
            priority: assignment.priority,
            requiredRole: assignment.role,
            vehicleId: unit ? unit.id : null,
            status: unit ? "ASSIGNED" : "WAITING",
            progress: 0,
            message: unit ? "Mission assigned via gRPC" : "Waiting for suitable vehicle",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        state.missions.push(mission);
        if (unit) dispatchMission(mission, unit);
        return mission;
    }

    function findIdleUnit(role) {
        return state.units.find(item =>
            item.role === role &&
            item.status === "IDLE" &&
            item.rpcHost &&
            item.rpcPort
        );
    }

    function dispatchMission(mission, unit) {
        mission.vehicleId = unit.id;
        mission.status = "ASSIGNED";
        mission.message = "Mission assigned via gRPC";
        mission.updatedAt = new Date().toISOString();
        unit.status = "ASSIGNED";
        unit.currentMissionId = mission.id;

        const client = new missionProto.VehicleService(
            `${unit.rpcHost}:${unit.rpcPort}`,
            grpc.credentials.createInsecure()
        );

        client.AssignMission({
            missionId: mission.id,
            incidentId: mission.incidentId,
            type: mission.type,
            target: mission.target,
            priority: mission.priority
        }, (error, response) => {
            mission.updatedAt = new Date().toISOString();
            if (error || !response.accepted) {
                mission.status = "ERROR";
                mission.message = error ? error.message : response.message;
                unit.status = "ERROR";
            } else {
                mission.status = response.status;
                mission.message = response.message;
                unit.status = response.status;
            }
            client.close();
        });
    }

    function retryWaitingMissions() {
        const waitingMissions = state.missions
            .filter(mission => mission.status === "WAITING")
            .sort((left, right) => right.priority - left.priority || Date.parse(left.createdAt) - Date.parse(right.createdAt));

        for (const mission of waitingMissions) {
            const unit = findIdleUnit(mission.requiredRole);
            if (unit) dispatchMission(mission, unit);
        }
    }

    function reportMissionStatus(call, callback) {
        const report = call.request;
        const mission = state.missions.find(item => item.id === report.missionId);
        const unit = state.units.find(item => item.id === report.vehicleId);

        if (mission) {
            mission.status = report.status;
            mission.progress = report.progress;
            mission.message = report.message;
            mission.updatedAt = new Date().toISOString();

            if (report.status === "IDLE" && report.progress === 100) {
                const incident = state.incidents.find(item => item.id === mission.incidentId);
                if (incident) {
                    incident.status = "RESOLVED";
                    incident.resolvedAt = new Date().toISOString();
                }
            }
        }

        if (unit) {
            unit.status = report.status;
            unit.currentMissionId = report.status === "IDLE" ? null : report.missionId;
        }

        retryWaitingMissions();
        callback(null, { received: true });
    }

    function createIncident(incidentData, source = "rest") {
        const now = new Date();

        if (source === "mqtt") {
            const existingIncident = [...state.incidents].reverse().find(incident =>
                incident.status !== "RESOLVED" &&
                incident.type === incidentData.type &&
                incident.x === incidentData.x &&
                incident.y === incidentData.y &&
                now.getTime() - Date.parse(incident.lastReportedAt || incident.createdAt) < 30_000
            );

            if (existingIncident) {
                existingIncident.lastReportedAt = now.toISOString();
                existingIncident.reportCount = (existingIncident.reportCount || 1) + 1;
                existingIncident.measurement = incidentData.measurement;
                existingIncident.messageId = incidentData.messageId;
                state.mqttState.mergedIncidents++;
                return {
                    incident: existingIncident,
                    mission: state.missions.find(item => item.id === existingIncident.missionId) || null,
                    merged: true
                };
            }
        }

        const incident = {
            ...incidentData,
            id: incidentData.id || `incident-${Date.now()}-${state.incidents.length + 1}`,
            source,
            status: "OPEN",
            reportCount: 1,
            createdAt: incidentData.createdAt || now.toISOString(),
            lastReportedAt: now.toISOString()
        };

        state.incidents.push(incident);
        const cell = getCell(incident.x, incident.y);
        if (cell) cell.incidents.push(incident);

        const mission = assignMissionForIncident(incident);
        if (mission) incident.missionId = mission.id;
        return { incident, mission, merged: false };
    }

    return {
        upsertUnit,
        upsertSensor,
        getMissionType,
        createIncident,
        reportMissionStatus
    };
}

module.exports = { createMissionService };

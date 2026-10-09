const grpc = require("@grpc/grpc-js");

const MISSION_RULES = {
    person_detected: { missionType: "aerial_inspection", role: "drone", priority: 10 },
    water_level_alert: { missionType: "aerial_inspection", role: "drone", priority: 8 },
    blocked_route: { missionType: "repair_route", role: "repair_rover", priority: 7 },
    structure_damage: { missionType: "repair_route", role: "repair_rover", priority: 7 },
    bridge_damage: { missionType: "repair_route", role: "repair_rover", priority: 7 },
    supply_low: { missionType: "deliver_supplies", role: "supply_rover", priority: 6 },
    material_request: { missionType: "deliver_supplies", role: "supply_rover", priority: 6 }
};

const HARD_TO_REACH_RULE = { missionType: "aerial_inspection", role: "drone", priority: 8 };

function createMissionService({ state, islandMap, width, height, missionProto }) {
    function now() {
        return new Date().toISOString();
    }

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
        return MISSION_RULES[incident.type] || (incident.hardToReach ? HARD_TO_REACH_RULE : null);
    }

    function assignMissionForIncident(incident) {
        const assignment = getMissionType(incident);
        if (!assignment) return null;

        const unit = findIdleUnit(assignment.role);
        const createdAt = now();

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
            createdAt,
            updatedAt: createdAt
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
        mission.updatedAt = now();
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
            mission.updatedAt = now();
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
            mission.updatedAt = now();

            if (report.status === "IDLE" && report.progress === 100) {
                const incident = state.incidents.find(item => item.id === mission.incidentId);
                if (incident) {
                    incident.status = "RESOLVED";
                    incident.resolvedAt = now();
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

    function deleteIncident(incidentId) {
        const incident = state.incidents.find(item => item.id === incidentId);
        if (!incident) return null;

        state.incidents = state.incidents.filter(item => item.id !== incidentId);
        state.missions = state.missions.filter(item => item.incidentId !== incidentId);

        const cell = getCell(incident.x, incident.y);
        if (cell) {
            cell.incidents = cell.incidents.filter(item => item.id !== incidentId);
        }

        return incident;
    }

    return {
        upsertUnit,
        upsertSensor,
        getMissionType,
        createIncident,
        deleteIncident,
        reportMissionStatus
    };
}

module.exports = { createMissionService };

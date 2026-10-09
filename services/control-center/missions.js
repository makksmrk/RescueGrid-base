const grpc = require("@grpc/grpc-js");
const { RPC_TIMEOUT_MS, isActiveMission, isTerminalMission, vehicleStatusForMission, canAcceptMission } = require("../shared/missions");

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

    function upsertUnit(update, missionReport) {
        let unit = state.units.find(item => item.id === update.id);
        if (unit && update.lastTelemetryAt && unit.lastTelemetryAt &&
            Date.parse(update.lastTelemetryAt) < Date.parse(unit.lastTelemetryAt)) return unit;

        if (!unit) {
            unit = { id: update.id };
            state.units.push(unit);
        }
        const assignedMission = state.missions.find(mission =>
            mission.vehicleId === unit.id && ["ASSIGNED", "IN_PROGRESS"].includes(mission.status)
        );
        const reportedMission = state.missions.find(mission => mission.id === update.currentMissionId);
        const lifecycle = { status: unit.status, currentMissionId: unit.currentMissionId, progress: unit.progress };
        Object.assign(unit, update);
        // Registration and telemetry must not erase an assignment in flight,
        // or resurrect a finished mission from a delayed vehicle snapshot.
        if (assignedMission) {
            unit.status = vehicleStatusForMission(assignedMission.status);
            unit.currentMissionId = assignedMission.id;
            unit.progress = assignedMission.progress;
        } else if (reportedMission && isTerminalMission(reportedMission.status)) {
            Object.assign(unit, lifecycle);
        }
        if (missionReport && state.missions.some(mission => mission.id === missionReport.missionId)) {
            try {
                updateMissionStatus({ ...missionReport, vehicleId: unit.id, position: update.position });
            } catch (error) {
                console.error(`Ignored mission telemetry: ${error.message}`);
            }
        }
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

        const createdAt = now();

        const mission = {
            id: `mission-${Date.now()}-${state.missions.length + 1}`,
            incidentId: incident.id,
            type: assignment.missionType,
            target: { x: incident.x, y: incident.y },
            priority: assignment.priority,
            requiredRole: assignment.role,
            vehicleId: null,
            status: "WAITING",
            progress: 0,
            message: "Waiting for suitable vehicle",
            createdAt,
            updatedAt: createdAt
        };

        state.missions.push(mission);
        retryWaitingMissions();
        return mission;
    }

    function findIdleUnit(role) {
        return state.units.find(unit =>
            unit.role === role &&
            canAcceptMission(unit, unit.currentMissionId) &&
            unit.connectionStatus === "online" &&
            unit.rpcHost && unit.rpcPort &&
            !state.missions.some(mission => mission.vehicleId === unit.id &&
                ["ASSIGNED", "IN_PROGRESS"].includes(mission.status))
        );
    }

    function dispatchMission(mission, unit) {
        mission.vehicleId = unit.id;
        mission.status = "ASSIGNED";
        mission.assignmentConfirmed = false;
        mission.message = "Mission assigned via gRPC";
        mission.updatedAt = now();
        unit.status = "ASSIGNED";
        unit.currentMissionId = mission.id;
        unit.progress = 0;

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
        }, { deadline: Date.now() + RPC_TIMEOUT_MS }, (error, response) => {
            client.close();
            // A report may arrive before the acknowledgement.
            if (mission.status !== "ASSIGNED" || mission.assignmentConfirmed || mission.vehicleId !== unit.id) return;
            mission.updatedAt = now();
            if (error) {
                // Delivery is uncertain: retain the assignment, never resend blindly.
                mission.message = `Assignment outcome unknown: ${error.message}`;
                return;
            }
            if (!response.accepted) {
                mission.status = "WAITING";
                mission.vehicleId = null;
                mission.message = response.message;
                if (unit.currentMissionId === mission.id) {
                    unit.status = response.status;
                    unit.currentMissionId = response.currentMissionId || null;
                    unit.battery = response.battery;
                    unit.charging = { ...unit.charging, status: response.chargingStatus };
                }
            } else {
                mission.assignmentConfirmed = true;
            }
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

    function updateMissionStatus(report) {
        const mission = state.missions.find(item => item.id === report.missionId);
        const unit = state.units.find(item => item.id === report.vehicleId);
        function reject(code, message) {
            throw Object.assign(new Error(message), { code });
        }
        if (!mission || !unit) reject(grpc.status.NOT_FOUND, "Unknown mission or vehicle");
        if (mission.vehicleId !== report.vehicleId) {
            reject(grpc.status.FAILED_PRECONDITION, "Report is not from the assigned vehicle");
        }
        if (!vehicleStatusForMission(report.status) ||
            !Number.isInteger(report.progress) || report.progress < 0 || report.progress > 100 ||
            (report.status === "COMPLETED" && report.progress !== 100)) {
            reject(grpc.status.INVALID_ARGUMENT, "Invalid mission status or progress");
        }
        // Duplicates and older reports are acknowledged without modifying state.
        if (isTerminalMission(mission.status) ||
            (mission.status === "IN_PROGRESS" && report.status === "ASSIGNED") ||
            (report.status !== "FAILED" && report.progress < mission.progress)) return;

        mission.status = report.status;
        mission.assignmentConfirmed = true;
        mission.progress = Math.max(mission.progress, report.progress);
        mission.message = report.message;
        if (report.position) mission.position = report.position;
        mission.updatedAt = now();
        if (report.status === "COMPLETED") {
            const incident = state.incidents.find(item => item.id === mission.incidentId);
            if (incident) {
                incident.status = "RESOLVED";
                incident.resolvedAt = now();
            }
        }
        if (unit.currentMissionId === mission.id) {
            unit.status = vehicleStatusForMission(report.status);
            unit.progress = mission.progress;
            unit.currentMissionId = isTerminalMission(report.status) ? null : mission.id;
        }
    }

    function reportMissionStatus(call, callback) {
        try {
            updateMissionStatus(call.request);
            retryWaitingMissions();
            callback(null, { received: true });
        } catch (error) {
            callback(error);
        }
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
        if (incident.status !== "RESOLVED" || state.missions.some(mission =>
            mission.incidentId === incidentId && isActiveMission(mission.status))) {
            throw Object.assign(new Error("Only resolved incidents without active missions can be deleted"), {
                statusCode: 409
            });
        }

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

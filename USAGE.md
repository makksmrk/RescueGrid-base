# System nutzen und debuggen

Kurze Anleitung zum Starten, Testen und Debuggen des Projekts.

## Voraussetzungen

| Tool | Windows | Linux |
| ---- | ------- | ----- |
| Docker | Docker Desktop installieren und starten | Docker Engine + Docker Compose Plugin installieren |
| Node.js | Node.js LTS installieren | Node.js LTS installieren |
| REST-Client | IntelliJ/WebStorm `.http` Datei oder VS Code REST Client | IntelliJ/WebStorm `.http` Datei oder VS Code REST Client |

Wichtig: Docker muss laufen, bevor das System gestartet wird.

## Dependencies installieren

Normalerweise baut Docker alles selbst. Für lokale Tests oder lokale Starts trotzdem einmal installieren:

```bash
npm install
npm install --prefix control-center
npm install --prefix emergency-vehicle
npm install --prefix water-sensor
npm install --prefix camera-sensor
```

Unter Windows können die gleichen Befehle in PowerShell benutzt werden.

## Build und Start mit Docker

```bash
docker compose up --build
```

Im Hintergrund starten:

```bash
docker compose up --build -d
```

Dashboard öffnen:

```text
http://localhost:8080
```

System stoppen:

```bash
docker compose down
```

Komplett neu bauen:

```bash
docker compose down
docker compose build --no-cache
docker compose up
```

## Container

| Container | Aufgabe |
| --------- | ------- |
| `mqtt-broker` | MQTT-Broker |
| `control-center` | REST, Dashboard, MQTT-Listener, gRPC |
| `drone-1` | Drohne |
| `repair-rover-1` | Reparatur-Rover |
| `supply-rover-1` | Versorgungs-Rover |
| `water-sensor` | Wassersensor |
| `camera-sensor` | Kamerasensor |

## Wichtige Ports

| Port | Bedeutung |
| ---- | --------- |
| `8080` | Dashboard und REST-API |
| `1883` | MQTT-Broker |
| `50051` | gRPC Control Center |
| `50052-50054` | gRPC Fahrzeuge, intern in Docker |

## REST manuell testen

Datei:

```text
tests/rest-tests/api-examples.http
```

Dort kannst du z. B. Status prüfen, Incidents erstellen oder Incidents löschen.

Wichtige Endpunkte:

```text
GET  http://localhost:8080/status
GET  http://localhost:8080/map
POST http://localhost:8080/incident
POST http://localhost:8080/incident/delete
```

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

## Logs ansehen

Alle Logs:

```bash
docker compose logs -f
```

Nur Control Center:

```bash
docker compose logs -f control-center
```

Nur ein Fahrzeug:

```bash
docker compose logs -f drone-1
docker compose logs -f repair-rover-1
docker compose logs -f supply-rover-1
```

Containerstatus:

```bash
docker compose ps
```

## Typische Debug-Schritte

1. Prüfen, ob alle Container laufen:

```bash
docker compose ps
```

2. Dashboard öffnen:

```text
http://localhost:8080
```

3. Systemstatus prüfen:

```bash
curl http://localhost:8080/status
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://localhost:8080/status
```

4. Logs prüfen:

```bash
docker compose logs -f control-center
```

5. Wenn Ports blockiert sind, altes System stoppen:

```bash
docker compose down
```

## Was im Dashboard beobachtet werden kann

- offene Incidents blinken rot
- passende Unit erscheint am Incident-Feld
- Unit-Status wechselt z. B. `ASSIGNED`, `BUSY`, `IDLE`
- Batterie sinkt während der Arbeit
- Charging Station zeigt, welches Fahrzeug lädt
- nach der Lösung wird das Kartenfeld wieder normal

## Lokaler Start ohne Docker

Für normale Nutzung ist Docker einfacher. Lokal geht es nur, wenn ein MQTT-Broker läuft und die Umgebungsvariablen passend gesetzt sind.

Beispiel Control Center:

```bash
cd control-center
set MQTT_URL=mqtt://localhost:1883
node server.js
```

Linux/macOS:

```bash
cd control-center
MQTT_URL=mqtt://localhost:1883 node server.js
```

Für Fahrzeuge müssen zusätzlich `VEHICLE_ID`, `VEHICLE_ROLE`, `RPC_PORT` und `COORDINATION_PEERS` gesetzt werden. Für das Praktikum ist deshalb Docker der empfohlene Weg.

## Häufige Probleme

| Problem | Lösung |
| ------- | ------ |
| Dashboard nicht erreichbar | `docker compose ps` und Logs vom `control-center` prüfen |
| Port `8080` oder `1883` belegt | anderes Programm stoppen oder `docker compose down` ausführen |
| Incidents werden nicht gelöst | prüfen, ob passende Fahrzeuge laufen |
| Batterie bleibt leer | prüfen, ob Fahrzeug `IDLE` ist und Charging-Logs vorhanden sind |
| Tests schlagen fehl | erst System starten, kurz warten, dann Tests ausführen |


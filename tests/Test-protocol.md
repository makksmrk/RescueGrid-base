# Testprotokoll - Aufgabe 1

## Allgemeine Angaben

- **Aufgabe:** Leitstelle und Registrierung über Sockets, HTTP und REST
- **Testdatum:** 07.05.2026
- **Basis-URL:** `http://localhost:8080`
- **Start des Systems:** `docker compose up --build -d`

## Test 1 - Manueller REST-Test

**Aufgabe / Meilenstein:** Aufgabe 1

**Testtyp:** Funktional, manuell

**Titel:** Prüfung der REST-Endpunkte

**Ziel:** Prüfung der Registrierung, Vorfallerzeugung, Karte, Statusanzeige und HTTP-Fehlerbehandlung.

**Vorbedingungen / Setup:**

- Die Docker-Container laufen.
- Die Leitstelle ist über Port `8080` erreichbar.
- Die Datei `tests/rest-tests/api-examples.http` wird mit dem HTTP-Client der IDE ausgeführt.

**Durchführung:**

1. Dashboard, Status und Karte mit `GET /`, `GET /status` und `GET /map` abrufen.
2. Fahrzeuge mit `POST /unit` registrieren.
3. Wasserstands- und Kamerasensor mit `POST /sensor` registrieren.
4. Wasserstandsalarm und Personenerkennung mit `POST /incident` melden.
5. Eine unbekannte Route und eine nicht unterstützte Methode aufrufen.

**Erwartetes Ergebnis:**

- GET-Anfragen liefern HTTP `200`.
- Registrierungen und Vorfälle liefern HTTP `201`.
- Die Karte besteht aus 20x20 Land- und Wasserfeldern und enthält feste Infrastruktur.
- Eine unbekannte Route liefert HTTP `404`.
- Eine nicht unterstützte Methode liefert HTTP `405`.

**Tatsächliches Ergebnis:**

- Dashboard lieferte HTTP `200`. (GET)

[Dashboard Response File](protocol-attachements/2026-06-16T221641.200.html)
- Karte lieferte HTTP `200`. (GET)

[Map Response File](protocol-attachements/2026-06-18T013540.200.json)
- Status lieferte HTTP `200`. (GET)
```
{
  "status": "running",
  "units": 0,
  "sensors": 0,
  "incidents": 0
}
```
- Fahrzeug, Sensoren und Vorfälle wurden mit HTTP `201` angenommen.
```
{
  "message": "Unit registered",
  "unit": {
    "id": "supply-1",
    "type": "supply_vehicle",
    "registeredAt": "2026-06-16T20:18:31.461Z"
  }
}
```
```
{
  "message": "Unit registered",
  "unit": {
    "id": "rover-1",
    "type": "rover",
    "registeredAt": "2026-06-16T20:18:29.755Z"
  }
}
```
```
{
  "message": "Sensor registered",
  "sensor": {
    "id": "water-sensor-1",
    "type": "water-level",
    "registeredAt": "2026-06-16T20:18:14.864Z"
  }
}
```
```
{
  "message": "Sensor registered",
  "sensor": {
    "id": "camera-1",
    "type": "camera",
    "registeredAt": "2026-06-16T20:18:18.605Z"
  }
}
```
```
{
  "message": "Incident created",
  "incident": {
    "type": "water_level_alert",
    "sensor": "water-sensor-1",
    "x": 5,
    "y": 7,
    "value": 91,
    "createdAt": "2026-06-16T20:18:23.093Z"
  }
}
```
- Die Karte enthielt 400 Felder sowie Ladestation, Brücke, Hafen und Depot.
- Das Dashboard wurde im Browser korrekt dargestellt.


  ![dashboard-screenshot](protocol-attachements/aufgabe1-dashboard-screenshot.png)


- Die Fehlerfälle lieferten HTTP `404` beziehungsweise `405`.
```
DELETE http://localhost:8080/unit

HTTP/1.1 405 Method Not Allowed
Content-Type: text/plain
Content-Length: 18
Connection: close

Method Not Allowed
```
```
GET http://localhost:8080/does-not-exist

HTTP/1.1 404 Not Found
Content-Type: text/plain
Content-Length: 15
Connection: close

Route not found
```

**Artefakte / Nachweise:**

- [`rest-tests/api-examples.http`](rest-tests/api-examples.http)
- [`../control-center/server.js`](../control-center/server.js)
- [`../control-center/map.js`](../control-center/map.js)

**Bewertung:** PASS

---

## Test 2 - Automatisierter Funktionstest

**Aufgabe / Meilenstein:** Aufgabe 1

**Testtyp:** Funktional, automatisiert

**Titel:** Automatisierter Test der wichtigsten REST-Funktionen

**Ziel:** Automatische Prüfung von Statusabfrage, Fahrzeugregistrierung und Vorfallerzeugung.

**Vorbedingungen / Setup:**

- Die Leitstelle läuft auf `localhost:8080`.

**Durchführung:**

```powershell
node tests/rest-tests/testRunner.js
```

Der Test prüft:

- `GET /status`
- `POST /unit`
- `POST /incident`

**Erwartetes Ergebnis:** Alle drei Tests werden mit `PASS` abgeschlossen.

**Tatsächliches Ergebnis:**

```
=================================
FUNCTIONAL TESTS
=================================

TEST 1: GET /status
PASS

TEST 2: POST /unit
PASS

TEST 3: POST /incident
PASS

Functional tests finished.
```


**Bewertung:** PASS

---

## Test 3 - Lasttest

**Aufgabe / Meilenstein:** Aufgabe 1

**Testtyp:** Nicht-funktional, automatisiert

**Titel:** 100 parallele Fahrzeugregistrierungen

**Ziel:** Prüfung der Stabilität der Leitstelle bei mehreren gleichzeitigen Requests.

**Vorbedingungen / Setup:**

- Die Leitstelle läuft auf `localhost:8080`.

**Durchführung:**

Der Test Runner sendet 100 parallele `POST /unit`-Requests und zählt die erfolgreichen Antworten.

```powershell
node tests/rest-tests/testRunner.js
```

**Erwartetes Ergebnis:** Alle 100 Requests liefern HTTP `201` und der Test endet ohne Fehler.

**Tatsächliches Ergebnis:**

```text
=================================
LOAD TEST
=================================

Requests: 100
Successful: 100
Time: 157 ms

PASS

=================================
ALL TESTS FINISHED
=================================
```

**Bewertung:** PASS

## Gesamtbewertung

Alle dokumentierten Tests wurden erfolgreich abgeschlossen. Die Anforderungen aus Aufgabe 1 wurden sowohl manuell als auch automatisiert geprüft.

---

# Aufgabe 2 - Einsatzvergabe über RPC

## Allgemeine Angaben

- **Aufgabe:** Einsatzvergabe via Remote Procedure Call (RPC)
- **Testdatum:** 17.06.2026
- **Basis-URL:** `http://localhost:8080`
- **Start des Systems:** `docker compose up --build -d`

## Test 4 - RPC und Fahrzeugverhalten

**Aufgabe / Meilenstein:** Aufgabe 2

**Testtyp:** Funktional, automatisiert

**Titel:** Prüfung der Einsatzvergabe und Fahrzeugzustände

**Ziel:** Prüfung der gRPC-Schnittstelle, Rollenzuordnung und Zustände `ASSIGNED`, `BUSY`, `IDLE` und `ERROR`.

**Vorbedingungen / Setup:** Die Leitstelle sowie Drohne, Reparatur-Rover und Versorgungs-Rover laufen über Docker Compose.

**Durchführung:**

```powershell
node tests/rpc-tests/rpc.test.js
```

Der Test erzeugt passende Einsätze für alle drei Rollen und beobachtet deren Bearbeitung. Zusätzlich wird ein zweiter Auftrag an ein belegtes Fahrzeug gesendet.

**Erwartetes Ergebnis:** Jeder Einsatz wird der richtigen Rolle zugewiesen. Die Fahrzeuge wechseln von `ASSIGNED` über `BUSY` zurück zu `IDLE` und melden ihr rollenspezifisches Verhalten. Ein belegtes Fahrzeug führt zu einer Mission mit `ERROR`.

**Tatsächliches Ergebnis:** Alle drei Rollen wurden korrekt gewählt. Die Zustände `ASSIGNED`, `BUSY` und `IDLE`, das jeweilige Verhalten sowie der Fehlerfall `ERROR` wurden erfolgreich beobachtet. Abschlussmeldungen wurden von der Leitstelle bestätigt.

**Bewertung:** PASS

## Test 5 - RPC-Antwortzeit

**Aufgabe / Meilenstein:** Aufgabe 2

**Testtyp:** Nicht-funktional, automatisiert

**Titel:** Antwortzeit bei 20 RPC-Statusmeldungen

**Ziel:** Prüfung, ob 20 Statusmeldungen zuverlässig und mit weniger als `1000 ms` maximaler Antwortzeit bestätigt werden.

**Vorbedingungen / Setup:** Die Leitstelle läuft und der gRPC-Port `50051` ist erreichbar.

**Durchführung:** Der Befehl aus Test 4 sendet zusätzlich 20 aufeinanderfolgende `ReportMissionStatus`-Aufrufe.

**Erwartetes Ergebnis:** Alle Aufrufe werden bestätigt; die maximale Antwortzeit liegt unter `1000 ms`.

**Tatsächliches Ergebnis:** Alle 20 RPC-Aufrufe wurden bestätigt. Die durchschnittliche Antwortzeit betrug `2,5 ms`, die maximale Antwortzeit `4 ms`.

```text
RPC TESTS - AUFGABE 2

PASS: IDL contains both RPC methods and all required mission fields
PASS: drone assignment, behavior and state transitions
PASS: repair_rover assignment, behavior and state transitions
PASS: supply_rover assignment, behavior and state transitions
PASS: busy vehicle causes an ERROR mission
PASS: completion report is acknowledged via gRPC
PASS: 20 RPC reports, average 2.2 ms, maximum 4 ms

ALL RPC TESTS PASSED
```

**Bewertung:** PASS

---

# Aufgabe 3 - Ereignisse und Telemetrie über MQTT

## Allgemeine Angaben

- **Aufgabe:** Ereignisse und Telemetrie über Message-oriented Middleware (MQTT)
- **Testdatum:** 18.06.2026
- **MQTT-Broker:** `mqtt://localhost:1883`
- **Basis-URL:** `http://localhost:8080`
- **Start des Systems:** `docker compose up --build -d`

## Test 6 - MQTT-Ereignisverarbeitung

**Aufgabe / Meilenstein:** Aufgabe 3

**Testtyp:** Funktional, automatisiert

**Titel:** Prüfung von Ereignissen, Telemetrie und Ausfallszenarien

**Ziel:** Prüfung der MQTT-Kommunikation, Ereignisfilterung, Fahrzeugtelemetrie, Gefahrenreaktion sowie Publisher- und Broker-Neustart.

**Vorbedingungen / Setup:** Der MQTT-Broker, die Leitstelle, Sensoren und Fahrzeuge laufen über Docker Compose. Die Ports `1883` und `8080` sind erreichbar.

**Durchführung:**

```powershell
npm run test:mqtt
```

Der Test prüft:

- Erzeugung von Vorfällen aus Schwellwertüberschreitungen
- Ignorieren von Duplikaten und alten Nachrichten
- Zusammenführen gleicher Ereignisse an derselben Position
- Übernahme von Fahrzeugposition und Fortschritt
- Autonome Gefahrenreaktion eines Bodenfahrzeugs
- Ausfall und Neustart eines Publishers
- Neustart des MQTT-Brokers und Wiederverbindung der Clients
- Verfügbarkeit von `GET /status` und `GET /map`

**Erwartetes Ergebnis:** Gültige Ereignisse und Telemetriedaten werden verarbeitet. Duplikate und alte Nachrichten werden ignoriert. Fahrzeuge reagieren auf Gefahren. Nach Publisher- und Broker-Neustart wird die MQTT-Verbindung wiederhergestellt.

**Tatsächliches Ergebnis:** Alle Ereignisse wurden korrekt verarbeitet. Filterung, Zusammenführung, Telemetrie und Gefahrenreaktion funktionierten. Der Publisher-Ausfall wurde über MQTT Last Will erkannt. Nach dem Broker-Neustart verbanden sich die Clients erneut.

```text
PASS: Broker, GET /status and GET /map are available
PASS: Sensor values create incidents only when the event threshold is exceeded
PASS: Duplicate messages are ignored
PASS: Messages older than 60 seconds are ignored
PASS: Repeated events at the same position are merged
PASS: Vehicle position and progress are updated from MQTT telemetry
PASS: Ground vehicle autonomously adjusts its route for flood hazards
PASS: Publisher failure and restart are detected
PASS: Broker restart is tolerated and clients reconnect
```

**Bewertung:** PASS

## Test 7 - MQTT-Lasttest

**Aufgabe / Meilenstein:** Aufgabe 3

**Testtyp:** Nicht-funktional, automatisiert

**Titel:** Verarbeitung von 50 MQTT-Nachrichten mit QoS 1

**Ziel:** Prüfung, ob die Leitstelle 50 MQTT-Nachrichten zuverlässig und innerhalb von `10 Sekunden` verarbeitet.

**Vorbedingungen / Setup:** Der MQTT-Broker und die Leitstelle laufen. Der Testclient ist mit dem Broker verbunden.

**Durchführung:** Der Befehl aus Test 6 veröffentlicht zusätzlich 50 Nachrichten mit QoS 1 und prüft den Zähler der verarbeiteten Nachrichten über `GET /status`.

**Erwartetes Ergebnis:** Alle 50 Nachrichten werden innerhalb von `10 Sekunden` verarbeitet.

**Tatsächliches Ergebnis:** Alle 50 Nachrichten wurden innerhalb von `50 ms` verarbeitet.

```text
PASS: 50 QoS-1 messages processed in 50 ms

ALL MQTT TESTS PASSED
```

**Bewertung:** PASS

---

# Aufgabe 4 - Verteilte Koordination mit Ricart/Agrawala

## Allgemeine Angaben

- **Aufgabe:** Dezentrale Koordination des Zugriffs auf die Ladestation
- **Testdatum:** 02.07.2026
- **MQTT-Broker:** `mqtt://localhost:1883`
- **Basis-URL:** `http://localhost:8080`
- **Start des Systems:** `docker compose up --build -d`

## Test 8 - Safety, Liveness und Fehlerbetrachtung

**Aufgabe / Meilenstein:** Aufgabe 4

**Testtyp:** Funktional, automatisiert

**Titel:** Prüfung des Ricart/Agrawala-Ausschlussverfahrens

**Ziel:** Prüfung, ob die Fahrzeuge die Ladestation dezentral koordinieren und die Anforderungen Safety, Liveness und Fehlerbetrachtung erfüllt sind.

**Vorbedingungen / Setup:** Die Leitstelle, der MQTT-Broker und die drei Fahrzeuge `drone-1`, `repair-rover-1` und `supply-rover-1` laufen über Docker Compose.

**Durchführung:**

```powershell
npm run test:coordination
```

Der Test beobachtet die Koordinationsnachrichten über `GET /status`. Dabei werden `REQUEST`, `REPLY`, `ENTER` und `LEAVE` sowie die logischen Zeiten ausgewertet. Für die Fehlerbetrachtung wird `supply-rover-1` gestoppt und danach wieder gestartet.

**Erwartetes Ergebnis:**

- Mindestens drei Fahrzeuge nehmen an der Koordination teil.
- Es befindet sich nie mehr als ein Fahrzeug gleichzeitig in der kritischen Ressource.
- Ein wartendes Fahrzeug darf nach dem Freigeben der Ladestation weiterarbeiten.
- Beim Prozessabsturz fehlt ein `REPLY`, wodurch der Fortschritt blockiert wird.
- Nach dem Neustart läuft die Koordination wieder weiter.

**Tatsächliches Ergebnis:** Alle drei Fahrzeuge nahmen teil. Safety und Liveness wurden erfolgreich beobachtet. Beim Stoppen von `supply-rover-1` wurde der erwartete blockierte Zustand erkannt. Nach dem Neustart lief die Koordination wieder.

```text
PASS: Coordination system is ready and all three vehicles participate
PASS: Safety - no two vehicles used the charging station at the same time
PASS: Liveness - a waiting vehicle entered after another vehicle left
PASS: Fehlerbetrachtung - process crash blocks progress until the system is restarted
```

**Bewertung:** PASS

## Test 9 - Koordinationslatenz

**Aufgabe / Meilenstein:** Aufgabe 4

**Testtyp:** Nicht-funktional, automatisiert

**Titel:** Antwortzeit der dezentralen Koordination

**Ziel:** Prüfung, wie lange ein Zugriff von `REQUEST` bis `ENTER` dauert.

**Vorbedingungen / Setup:** Das System läuft über Docker Compose. Die Fahrzeuge koordinieren den Zugriff auf die Ladestation über MQTT.

**Durchführung:** Der Befehl aus Test 8 misst für drei Zugriffe die Zeit zwischen `REQUEST` und `ENTER`.

**Erwartetes Ergebnis:** Die maximale Koordinationslatenz liegt unter `12000 ms`.

**Tatsächliches Ergebnis:** Es wurden drei Zugriffe gemessen. Die durchschnittliche Latenz betrug `3527,3 ms`, die maximale Latenz `6991 ms`.

```text
PASS: Non-functional latency - 3 accesses, average 3527.3 ms, maximum 6991 ms

ALL COORDINATION TESTS PASSED
```

**Bewertung:** PASS

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
# Storm Flood

#### Basis-URL : `http://localhost:8080`

## Beschreibung

Die Leitstelle verwaltet eine Inselkarte, Sensoren, Fahrzeuge und Vorfälle. Sensoren senden regelmäßig Messwerte über MQTT. Wenn ein Messwert kritisch ist, entsteht automatisch ein Incident, zum Beispiel `person_detected`, `blocked_route` oder `supply_low`. Zusätzlich können Incidents manuell über die REST-Beispiele in `tests/rest-tests/api-examples.http` erstellt werden.

Für jeden bekannten Incident-Typ legt die Leitstelle eine passende Mission an. Personenerkennung, Wasserstandsalarm oder schwer erreichbare Orte werden einer Drohne zugeordnet. Blockierte Wege, Struktur- oder Brückenschäden werden einem Reparatur-Rover zugeordnet. Niedrige Bestände oder Materialbedarf werden einem Versorgungs-Rover zugeordnet. Die Mission wird per gRPC an ein freies passendes Fahrzeug geschickt.

Die Fahrzeuge simulieren ihre Arbeit rollenabhängig: Drohnen inspizieren, Reparatur-Rover reparieren und Versorgungs-Rover liefern Material. Während einer Mission wird der Status im Dashboard sichtbar von `ASSIGNED` auf `BUSY` und später wieder auf `IDLE` geändert. Beim Arbeiten verbraucht ein Fahrzeug Batterie, aktuell 20 Prozent pro Mission. Wenn die Batterie leer ist, kann das Fahrzeug keine neue Mission annehmen.

Grafisch wird ein offener Incident auf der Karte rot markiert. Wenn die passende Unit arbeitet, erscheint sie am Incident-Feld. Nach der Lösung verschwindet die rote Markierung wieder und das Feld bekommt seine normale Farbe zurück, also grün für Land oder blau für Wasser.

Die Charging Station ist eine gemeinsam genutzte Ressource. Fahrzeuge dürfen nicht gleichzeitig arbeiten und laden. Wenn ein Fahrzeug frei ist und nicht volle Batterie hat, kann es die Ladestation anfragen. Die Fahrzeuge koordinieren untereinander über MQTT-Nachrichten (`REQUEST`, `REPLY`, `ENTER`, `LEAVE`), sodass immer nur ein Fahrzeug die Charging Station benutzt. Nach dem Laden wird die Batterie wieder auf 100 Prozent gesetzt. Die Leitstelle beobachtet diese Koordination und zeigt den aktuellen Ladezustand im Dashboard an.

## Übersicht der Endpunkte

| Methode | Endpoint           | Beschreibung                    |
| ------- |--------------------|---------------------------------|
| GET     | `/`                | HTML Dashboard                  |
| GET     | `/status`          | Systemstatus                    |
| GET     | `/map`             | Inselkarte                      |
| POST    | `/unit`            | Fahrzeug registrieren           |
| POST    | `/sensor`          | Sensor registrieren             |
| POST    | `/incident`        | Vorfall erzeugen                |
| POST    | `/incident/delete` | Vorfall löschen (Test-endpoint) |

### GET /

Liefert das HTML-Dashboard der Leitstelle.

#### Request

```
GET / HTTP/1.1
```

#### Response

```
HTTP/1.1 200 OK
Content-Type: text/html
```

### GET /status

Liefert den aktuellen Gesamtstatus des Systems.

#### Request
```
GET /status HTTP/1.1
```
#### Beispiel-Response
```
{
  "status": "running",
  "units": 3,
  "sensors": 2,
  "incidents": 5
}
```

#### Statuscodes: `200 Erfolgreich`

### GET /map

Liefert die komplette Inselkarte als JSON.

#### Request
```
GET /map HTTP/1.1
```
#### Beispiel-Response
```
[
  [
    {
      "x": 0,
      "y": 0,
      "type": "land",
      "infrastructure": null,
      "incidents": []
    }
  ]
]
```

#### Statuscodes: `200	Erfolgreich`

### POST /unit

Registriert ein Fahrzeug bei der Leitstelle.

#### Request
```
POST /unit HTTP/1.1
Content-Type: application/json
Beispiel-Body
{
  "id": "drone-1",
  "type": "drone"
}
```
#### Beispiel-Response
```
{
  "message": "Unit registered",
  "unit": {
    "id": "drone-1",
    "type": "drone"
  }
}
```

#### Statuscodes
| Code | Bedeutung               |
| ---- | ----------------------- |
| 201  | Erfolgreich registriert |
| 400  | Ungültige Daten         |
| 500  | Serverfehler            |

### POST /sensor

Registriert einen Sensor.

#### Request
```
POST /sensor HTTP/1.1
Content-Type: application/json
Beispiel-Body
{
  "id": "water-sensor-1",
  "type": "water-level"
}
```
#### Beispiel-Response
```
{
  "message": "Sensor registered"
}
```
#### Statuscodes
| Code | Bedeutung               |
| ---- | ----------------------- |
| 201  | Erfolgreich registriert |
| 400  | Ungültige Daten         |
| 500  | Serverfehler            |

### POST /incident

Erzeugt einen Vorfall auf der Inselkarte.

#### Request
```
POST /incident HTTP/1.1
Content-Type: application/json
Beispiel-Body
{
  "type": "water_level_alert",
  "sensor": "water-sensor-1",
  "x": 5,
  "y": 7,
  "value": 91
}
```
### Beispiel-Response
```
{
  "message": "Incident created"
}
```
#### Statuscodes:

| Code | Bedeutung       |
| ---- | --------------- |
| 201  | Vorfall erzeugt |
| 400  | Ungültige Daten |
| 500  | Serverfehler    |

### POST /incident/delete

Löscht einen bestimmten Vorfall aus der Vorfallliste.
Dies wird in Dashboard für Löschen mit der Taste verwendet, kann aber auch direkt mit incident-id verschickt werden

#### Request
```
POST {{baseUrl}}/incident/delete
Content-Type: application/json

{
  "id": "hier-wird-incident-id-reingefuegt"
}
```

### Beispiel-Response
```
{
  "message": "Incident deleted",
  "incident": {
    "type": "person_detected",
    "sensor": "camera-1",
    "x": 18,
    "y": 9,
    "measurement": {
      "name": "person_confidence",
      "value": 0.855,
      "threshold": 0.8
    },
    "value": 0.855,
    "messageId": "89a80f28-79fa-445f-ba55-5b69dc13cfaf",
    "createdAt": "2026-07-15T14:10:45.147Z",
    "hardToReach": false,
    "id": "incident-1784124645148-4",
    "source": "mqtt",
    "status": "RESOLVED",
    "reportCount": 1,
    "lastReportedAt": "2026-07-15T14:10:45.148Z",
    "missionId": "mission-1784124645148-4",
    "resolvedAt": "2026-07-15T14:10:57.052Z"
  }
}
```

## Unterstützte Incident-Typen

| Incident            | Beschreibung           |
| ------------------- | ---------------------- |
| `water_level_alert` | Kritischer Wasserstand |
| `person_detected`   | Person erkannt         |
| `blocked_route`     | Blockierter Weg        |
| `structure_damage`  | Strukturschaden        |
| `bridge_damage`     | Brückenschaden         |
| `supply_low`        | Niedriger Bestand      |
| `material_request`  | Materialanforderung    |


## Unterstützte Infrastrukturtypen

| Infrastruktur      | Bedeutung   | Abkürzung |
| ------------------ | ----------- | --------- |
| `charging_station` | Ladestation |     C     |
| `bridge`           | Brücke      |     B     |
| `harbor`           | Hafen       | H         |
| `depot`            | Depot       | D         |


## Unterstützte Fahrzeugarten

| Fahrzeug       | Bedeutung                                 | Abkürzung |
|----------------|-------------------------------------------|-----------|
| `drone`        | inspiziert die Zielposition aus der Luft  | D         |
| `repair_rover` | repariert Wege und Infrastruktur          | R         |
| `supply_rover` | liefert Material zur Zielposition         | S         |

## Docker-Container-Struktur

| Container        | Aufgabe |
|------------------|---------|
| `mqtt-broker`    | Mosquitto-Broker für MQTT-Nachrichten zwischen Sensoren, Fahrzeugen und Leitstelle |
| `control-center` | Leitstelle mit Dashboard, REST-Endpunkten, TCP/HTTP-Server und gRPC-Missionsvergabe |
| `drone-1`        | Drohne für Inspektion, Personenerkennung und schwer erreichbare Orte |
| `repair-rover-1` | Reparatur-Rover für Wege, Brücken und Strukturschäden |
| `supply-rover-1` | Versorgungs-Rover für Material- und Nachschubaufgaben |
| `water-sensor`   | Sendet Wasserstandsmessungen und mögliche Wasser-/Brücken-Incidents |
| `camera-sensor`  | Sendet Kameraereignisse wie Personenerkennung oder Strukturschäden |

Die Leitstelle ist über `localhost:8080` erreichbar. gRPC läuft im Control Center auf Port `50051`, die Fahrzeuge stellen ihre eigenen gRPC-Server intern auf `50052`, `50053` und `50054` bereit.

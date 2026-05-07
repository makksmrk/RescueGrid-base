# API Dokumentation — Aufgabe 1

#### Basis-URL : `http://localhost:8080`

## Übersicht der Endpunkte

| Methode | Endpoint    | Beschreibung          |
| ------- | ----------- | --------------------- |
| GET     | `/`         | HTML Dashboard        |
| GET     | `/status`   | Systemstatus          |
| GET     | `/map`      | Inselkarte            |
| POST    | `/unit`     | Fahrzeug registrieren |
| POST    | `/sensor`   | Sensor registrieren   |
| POST    | `/incident` | Vorfall erzeugen      |

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


## Unterstützte Incident-Typen

| Incident            | Beschreibung           |
| ------------------- | ---------------------- |
| `water_level_alert` | Kritischer Wasserstand |
| `person_detected`   | Person erkannt         |


## Unterstützte Infrastrukturtypen

| Infrastruktur      | Bedeutung   | Abkürzung |
| ------------------ | ----------- | --------- |
| `charging_station` | Ladestation |     C     |
| `bridge`           | Brücke      |     B     |
| `harbor`           | Hafen       | H         |
| `depot`            | Depot       | D         |
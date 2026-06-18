# Architektur

## Containerdiagramm

![Grafische Containerarchitektur](architecture.png)

**Legende:** Durchgezogene Linien zeigen MQTT/HTTP-Datenflüsse, gestrichelte Linien die REST-Registrierung und dicke Linien die gRPC-Einsatzkommunikation.

### Kommunikationsübersicht

| Kommunikation | Zweck |
|---|---|
| REST/HTTP | Registrierung von Sensoren und Fahrzeugen sowie Abfrage von Dashboard, Karte und Status |
| gRPC | Zuweisung von Einsätzen und Rückmeldung des Einsatzstatus |
| MQTT mit QoS 1 | Veröffentlichung von Sensorereignissen, Gefahrenmeldungen und Fahrzeugtelemetrie |

## Sequenzdiagramm des Einsatzablaufs

![Sequenzdiagramm des vollständigen Einsatzablaufs](sequence-diagram.png)

Das Diagramm zeigt den zeitlichen Ablauf von einem simulierten Sensorwert bis zur aktualisierten Anzeige im Dashboard. Die Leitstelle filtert MQTT-Nachrichten, erzeugt einen Vorfall, wählt eine Fahrzeugrolle und vergibt den Einsatz per gRPC. Fortschritt und Abschluss werden anschließend über gRPC und MQTT zurückgemeldet.

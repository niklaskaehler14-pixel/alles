# Nordkamm GT

3D-Rennspiel mit offener Welt, das direkt im Browser läuft. Es braucht keine Installation und lädt keine Bilddateien, denn Welt, Texturen und Sounds werden beim Start berechnet.

Gefahren wird auf dem **Seeufer-Ring**, einem 8,1 km langen Rundkurs. Er führt über den Stadt-Boulevard (Start und Ziel), den Pass am Nordkamm, am See entlang und durch den Wald zurück. Abseits der Strecke ist die ganze 4 × 4 km große Welt befahrbar: Hügel, Berge, Seeufer und Stadtstraßen.

## Spielmodi

| Modus | Beschreibung |
| --- | --- |
| **Rennen** | Startaufstellung mit 5 KI-Fahrern, Startampel, 1 bis 3 Runden, Positionen und Ergebnistabelle |
| **Zeitfahren** | Allein auf der Strecke. Die Bestzeit wird im Browser gespeichert. |
| **Freie Fahrt** | Offene Welt mit Gegenverkehr und Drift-Punkten mit Kombo-Multiplikator |

Einstellbar sind außerdem Tageszeit (Tag, Abend, Nacht), Lackierung, Getriebe (Automatik oder manuell) und die Grafikstufe.

## Steuerung

| Aktion | Tastatur | Gamepad | Handy |
| --- | --- | --- | --- |
| Gas / Bremse (Rückwärts) | `W` `S` oder Pfeiltasten | RT / LT | Tasten rechts |
| Lenken | `A` `D` oder Pfeiltasten | linker Stick | Lenkfeld links (analog) |
| Handbremse | Leertaste | A | Taste „Handbremse“ |
| Kamera (Verfolger, weit, Cockpit, Motorhaube) | `C` | Y | Kamera-Taste |
| Zurück auf die Strecke | `R` | B | „Reset“ |
| Hoch- / Runterschalten (manuell) | `E` / `Q` | RB / LB | – |
| Licht, Hupe, Karte, Blick zurück | `L`, `H`, `M`, `B` | – | – |
| Pause | `Esc` | Start | Pause-Taste |

## Technik

- **Fahrphysik** (`src/vehicle.js`): Einspurmodell mit Pacejka-Reifen, Radlastverteilung, Reibungskreis, Drehmomentkurve, 6-Gang-Getriebe mit Automatik und Kupplung, Abtrieb und Luftwiderstand, Stabilitätskontrolle (ESP), Handbremsen-Drifts und Sprünge über Kuppen.
- **Welt** (`src/worldgen.js`, `src/world.js`): Gelände aus Simplex-Noise mit See, Stadtplateau und Bergkranz. Das Höhenprofil der Straße ist geglättet und auf höchstens 6,5 % Steigung begrenzt. Dazu kommen rund 11.500 Bäume (mit Detailstufen), prozedurale Hochhäuser, Laternen, Werbetafeln, Wasser mit Wellen, Himmel mit Wolken und Sternen.
- **Auto** (`src/carModel.js`): modellierte Karosserie mit Klarlack, Glaskabine, detaillierte Felgen, Scheinwerfer, Bremslichter und ein Cockpit mit drehendem Lenkrad und live gezeichneten Instrumenten.
- **Sound** (`src/audio.js`): komplett synthetisch. Dazu gehören ein Reihensechszylinder mit Last und Schiebebetrieb, Fehlzündungen, Turbo und Blow-off, Reifenquietschen, Schotter, Randsteine, Wind, Crashs und die Startampel.
- **KI** (`src/ai.js`): Ideallinie mit Kurvenschneiden, vorausschauende Geschwindigkeitsplanung, Überholen und leichtes Rubber-Banding.
- **Grafik**: Three.js mit Schatten, Bloom, Bewegungsunschärfe bei hohem Tempo und ACES-Tonemapping. Die Auflösung passt sich automatisch an, wenn die Bildrate sinkt.

## Starten

Das Spiel ist eine statische Seite. Wegen der ES-Module braucht sie einen lokalen Webserver:

```bash
npx http-server -c-1 -p 8080 .
# dann http://localhost:8080 öffnen
```

Three.js wird vom CDN jsDelivr geladen (`three@0.186.1`).

## Tests

```bash
npm install                    # three + playwright (nur für Tests)
node tests/physics.test.mjs    # Fahrphysik: Beschleunigung, Bremsweg, Stabilität, Drift, Sprünge
node tests/world.test.mjs      # Weltgenerierung, KI-Rennen über 2 Runden, Autopilot-Runde mit der echten Physik
node tests/audio.mjs           # Motor-Sound offline gerendert: Pegel, Übersteuerung, Zündfrequenz
node tests/e2e.mjs [ordner]    # Browser-Test (Chromium): Menü, Rennen, Kameras, Pause, Nacht, Handy, Screenshots
```

`tools/build-artifact.mjs` erzeugt unter `dist/` eine Variante ohne eigenes `<html>`-Grundgerüst, für Hosts, die die Seite selbst einbetten.

# Nordkamm GT

3D-Rennspiel mit offener Welt, das direkt im Browser läuft. Es braucht keine Installation und lädt keine Bilddateien, denn Welt, Texturen und Sounds werden beim Start berechnet.

Gefahren wird auf dem **Seeufer-Ring**, einem 8,1 km langen Rundkurs, und in einer 4 × 4 km großen offenen Welt im Stil moderner Open-World-Rennspiele. Die Welt hat ein Straßennetz von gut 16 km:

- **Kaminari-Touge**: Bergpass mit 7 Haarnadelkurven, Leitplanken und einem roten Torii auf der Passhöhe
- **Seestraße**: vorbei an einer Kirschblütenallee am Nordufer des Spiegelsees
- **Südwald-Schotter**: Schotterstraße durch den Südwald
- **Nordkamm City**: eine Stadt mit Neonvierteln

Dazu kommen das Nordkamm-Festival mit Riesenrad, Bühne und Showautos, ein schwimmendes Torii im See, ein Leuchtturm und ein schneebedeckter Vulkan am Horizont.

## Spielmodi

| Modus | Beschreibung |
| --- | --- |
| **Open World** | Start am Festival. Freie Fahrt mit Gegenverkehr, 23 Aktivitäten, Skill-Ketten, XP und Fahrerstufen, Bonusschilder, Sehenswürdigkeiten, Weltkarte mit Navi und Schnellreise |
| **Rennen** | Startaufstellung mit 5 KI-Fahrern, Startampel, 1 bis 3 Runden, Positionen und Ergebnistabelle |
| **Zeitfahren** | Allein auf der Strecke. Die Bestzeit wird im Browser gespeichert. |

Einstellbar sind außerdem Tageszeit (Tag, Abend, Nacht), Lackierung, Getriebe (Automatik oder manuell) und die Grafikstufe.

### Open World

**Aktivitäten.** Jede Aktivität bringt bis zu 3 Sterne, insgesamt sind es 69. Jeder neue Stern gibt 1.000 XP.

| Aktivität | Anzahl | So funktioniert's |
| --- | --- | --- |
| **Checkpoint-Lauf** (blau) | 9 | Im leuchtenden Ring anhalten, dann startet der Countdown. Ein Pfeil zeigt zum nächsten Tor, Gold, Silber und Bronze hängen von der Zeit ab. Mit `R` geht es zurück zum letzten Tor. Neu: Kaminari bergauf, Kaminari bergab, Seestraße und Südwald-Rallye. |
| **Drift-Zone** (pink) | 3 | Unter dem Banner beginnt die Wertung, am Ende-Banner wird abgerechnet. |
| **Blitzer** (orange) | 4 | So schnell wie möglich vorbeifahren. |
| **Sprungschanze** (grün) | 4 | Mit Tempo auf die Schanze. Gemessen wird die Weite. |
| **Tempozone** (gelb) | 3 | Gewertet wird das Durchschnittstempo zwischen den beiden gelben Toren. |

**Skill-Ketten.** Drifts, Beinahe-Crashs mit dem Gegenverkehr, Sprünge, Vollgas über 200 km/h, Windschatten und zerstörte Schilder zählen zusammen. Jeder neue Skill erhöht den Multiplikator bis ×10. Nach gut 3 Sekunden ohne neuen Skill wird die Kette gesichert und in XP umgerechnet. Ein Crash lässt sie reißen.

**Fortschritt.** XP gibt es für Sterne, Skill-Ketten, Bonusschilder, neue Orte und neu entdeckte Straßen. Mit jeder Fahrerstufe wird eine neue Lackierung frei (Stufe 2, 3, 4, 6, 8 und 10).

**Sammeln und Entdecken.** In der Welt stehen 16 orange Bonusschilder (durchfahren, +1.000 XP) und 7 Sehenswürdigkeiten. Der Anteil entdeckter Straßen wird mitgezählt.

**Weltkarte (`M`).** Die Karte pausiert das Spiel und lässt sich verschieben und zoomen. Sie zeigt Regionen, alle Aktivitäten mit Sternen, Orte, Bonusschilder und den Verkehr. Filter blenden Gruppen aus. Ein Klick auf ein Symbol öffnet eine Infokarte mit Bestwerten:

- **Route setzen**: Das Navi zeichnet die Route über das Straßennetz in die Minikarte und zeigt Pfeil und Entfernung. Am Ziel steht eine violette Lichtsäule.
- **Schnellreise**: Möglich zum Festival und zu allen Orten, an denen du schon warst. Sind alle Bonusschilder zerstört, geht es an jede Stelle der Karte.

Ein Klick auf eine freie Stelle setzt einen Wegpunkt. Fortschritt und Bestwerte werden im Browser gespeichert.

**Fotomodus (`V` oder im Pausenmenü).** Das Spiel hält an, die Kamera kreist frei um das Auto: ziehen zum Drehen, Mausrad oder zwei Finger für den Abstand, Regler für die Brennweite. Ein Klick auf „Foto“ speichert das Bild als JPEG.

## Steuerung

| Aktion | Tastatur | Gamepad | Handy |
| --- | --- | --- | --- |
| Gas / Bremse (Rückwärts) | `W` `S` oder Pfeiltasten | RT / LT | Pedale rechts (Daumen kann zwischen Gas und Bremse wechseln, ohne abzusetzen) |
| Lenken | `A` `D` oder Pfeiltasten | linker Stick | Lenkfeld links (analog) |
| Handbremse | Leertaste | A | Taste „Handbremse“ |
| Kamera (Verfolger, weit, Cockpit, Motorhaube) | `C` | Y | Kamera-Taste |
| Zurück auf die Strecke | `R` | B | „Reset“ |
| Hoch- / Runterschalten (manuell) | `E` / `Q` | RB / LB | – |
| Licht, Hupe, Karte, Blick zurück | `L`, `H`, `M`, `B` | – | Karten-Taste |
| Pause | `Esc` | Start | Pause-Taste |
| Fotomodus | `V` | – | im Pausenmenü |

**Auf der Weltkarte:** ziehen oder Pfeiltasten/`WASD` zum Verschieben, Mausrad oder `+`/`-` zum Zoomen, Klick zum Auswählen, `Enter` für die Route, `F` für die Schnellreise, Rechtsklick oder `Entf` löscht die Route. Am Gamepad: Stick zum Verschieben, Trigger zum Zoomen, A wählt, X reist, B schließt. Am Handy: mit einem Finger verschieben, mit zwei Fingern zoomen, tippen zum Auswählen.

## Technik

- **Fahrphysik** (`src/vehicle.js`): Einspurmodell mit Pacejka-Reifen, Radlastverteilung, Reibungskreis, Drehmomentkurve, 6-Gang-Getriebe mit Automatik und Kupplung, Abtrieb und Luftwiderstand. Dazu kommen ABS mit Bremskraftverteilung (die Bremse hat Vorrang vor dem Gas), eine Stabilitätskontrolle (ESP), Handbremsen-Drifts und Sprünge über Kuppen und Schanzen. Kurze Kanten werden von der Federung geschluckt. Messwerte: 0–100 km/h in 4,3 s, 100–0 in 32 m, 200–0 in 121 m, 1,2 g Querbeschleunigung.
- **Straßennetz** (`src/roads.js`, `src/track.js`): Offene und geschlossene Splines mit Höhenprofil, begrenzter Steigung und Kuppen-Glättung. Die Serpentinen am Touge werden automatisch entlang der Höhenlinien gesetzt. An Kreuzungen übernimmt die abzweigende Straße die Neigung der Hauptstraße, damit keine Kante entsteht. Das Gelände wird an alle Straßen angepasst, zwischen übereinanderliegenden Kehren wird es weich interpoliert.
- **Open World** (`src/activities.js`, `src/openworld.js`, `src/landmarks.js`, `src/scenery.js`): Checkpoint-Läufe, Drift-Zonen, Blitzer, Sprungschanzen und Tempozonen. Dazu Festival, Torii, Steinlaternen, Leuchtturm, Neonschilder, Kirschbäume und ein Vulkan, außerdem Bonusschilder mit Splitter-Effekt.
- **Karte und Navi** (`src/maprender.js`, `src/worldmap.js`, `src/navigation.js`, `src/gps.js`): Reliefkarte mit Schummerung, Wald, Wasser und Stadt, Straßen als Vektoren, Routensuche über den Straßengraphen (Dijkstra) und entdeckte Straßen in 25-m-Abschnitten.
- **Karriere** (`src/career.js`, `src/skills.js`): XP, Fahrerstufen, Freischaltungen und Skill-Ketten mit Multiplikator.
- **Welt** (`src/worldgen.js`, `src/world.js`): Gelände aus Simplex-Noise mit See, Stadtplateau und Bergkranz. Das Höhenprofil der Straße ist geglättet und auf höchstens 6,5 % Steigung begrenzt. Dazu kommen rund 11.500 Bäume (mit Detailstufen), prozedurale Hochhäuser, Laternen, Werbetafeln, Wasser mit Wellen, Himmel mit Wolken und Sternen.
- **Auto** (`src/carModel.js`): modellierte Karosserie mit Klarlack, Glaskabine und detaillierten Felgen. Scheinwerfer, Rücklichtleiste, Kühlergrill und Kennzeichen werden per Raycast exakt auf die gewölbte Karosserie projiziert. Dazu ein Cockpit mit drehendem Lenkrad und live gezeichneten Instrumenten.
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
node tests/world.test.mjs      # Welt, Straßennetz, Open-World-Layout, KI-Rennen, Autopilot auf allen Straßen, Navi, Stufen, Skill-Ketten
node tests/audio.mjs           # Motor-Sound offline gerendert: Pegel, Übersteuerung, Zündfrequenz
node tests/e2e.mjs [ordner]    # Browser-Test (Chromium): Menü, Rennen, Zieleinlauf, Open World, Karte, Navi, Schnellreise, Nacht, Handy, Screenshots
```

`tools/build-artifact.mjs` erzeugt unter `dist/` eine Variante ohne eigenes `<html>`-Grundgerüst, für Hosts, die die Seite selbst einbetten.

# Nordkamm Linienbus

Ein 3D-Linienbus-Simulator, der direkt im Browser läuft. Du fährst Stadtbusse durch Nordkamm, hältst an Haltestellen, lässt Fahrgäste ein- und aussteigen, verkaufst Fahrkarten, hältst den Fahrplan ein und baust mit dem verdienten Geld deinen Busbetrieb auf. Die Stadt, alle Texturen und alle Geräusche werden beim Start berechnet, es werden keine Bild- oder Tondateien geladen.

## Die Stadt

- Straßenraster von rund 1,2 × 0,8 km mit 8 Nord-Süd- und 6 Ost-West-Straßen, umschlossen von einem Ring mit weiten Kurven
- 30 Haltestellen, teils am Bord, teils als Busbucht, jede mit Wartehäuschen, Haltestellenschild und Namen
- Ampelkreuzungen mit Rot-Gelb-Phase und Fußgängerampeln, Vorfahrtstraßen mit „Vorfahrt achten“ und Stoppschildern, eine Tempo-30-Zone mit „rechts vor links“ und Zebrastreifen am Schulzentrum
- Hauptbahnhof mit Uhrturm und Gleisen, Rathaus, Marienkirche, Theater, Einkaufszentrum, Klinikum, Schulzentrum, Stadion, Stadtpark mit Teich und der Betriebshof
- Autoverkehr mit Fahrzeugfolge-Modell (IDM), Blinkern, Bremslichtern und Vorfahrtsregeln. Autos lassen den Linienbus aus der Haltestelle (§ 20 Abs. 5 StVO)
- Fußgänger auf den Gehwegen, an Ampeln und Zebrastreifen

## Linien

| Linie | Strecke | Freischaltung |
| --- | --- | --- |
| **1** | Hauptbahnhof ⇄ Klinikum: Altstadt, Marktplatz, drei Ampeln, Rechtsabbiegen an der Parkstraße | ab Start |
| **2** | Hauptbahnhof ⇄ Sportpark: Wohngebiet mit Tempo 30, rechts vor links, Zebrastreifen | nach 1 Fahrt |
| **3** | Ringlinie einmal um die Stadt mit 11 Halten | nach 3 Fahrten |

Tageszeit (morgens, mittags, abends, nachts), Schwierigkeit und Verkehrsdichte sind wählbar. Morgens warten mehr Fahrgäste, nachts brauchst du Licht.

| Schwierigkeit | Fahrplan | Fahrkarten | Motor | Tipps |
| --- | --- | --- | --- | --- |
| Einsteiger | großzügig (+30 %) | automatisch | läuft | ja |
| Normal | +12 % | selbst verkaufen | läuft | ja |
| Profi | ohne Puffer | selbst verkaufen, fälliges Rückgeld wird nicht angezeigt | selbst starten | nein |

## Ein Dienst im Linienbus

1. Am ersten Halt steht der Bus mit angezogener Feststellbremse. Türen öffnen, Fahrgäste einsteigen lassen und bei Bedarf Fahrkarten verkaufen.
2. Zur Abfahrtszeit Türen schließen, Feststellbremse lösen, links blinken, Spiegel prüfen, losfahren.
3. Unterwegs zeigt das Fahrerterminal die Fahrplanlage („+1:20“ zu spät, „−0:40“ zu früh). Drückt ein Fahrgast den Haltewunsch, leuchtet „Wagen hält“ und der Gong ertönt.
4. An Haltestellen rechts blinken, im gelben Haltebereich dicht und gerade ans Bord fahren. Gewertet wird der Abstand zum Halteschild und zum Bord. Für Kinderwagen, Rollstühle und Ältere den Bus absenken (Kneeling).
5. Bedarfshalte ohne Wartende und ohne Haltewunsch dürfen durchfahren werden.
6. Am Endhalt steigen alle aus. Dann folgt die Auswertung mit Schulnote.

### Fahrkartenverkauf

Der Fahrgast sagt, was er möchte, und zahlt passend oder mit Schein. Du wählst die Fahrkarte (Einzelfahrt 3,20 €, Kurzstrecke 2,10 €, Kind 1,60 €, Tageskarte 7,90 €, 4-Fahrten-Karte 11,80 €), zahlst das Rückgeld mit Scheinen und Münzen aus und druckst den Fahrschein. Viele Fahrgäste zeigen stattdessen ein Deutschlandticket, eine Monatskarte oder ein Schülerticket.

### Fehler und Abzüge

| Fehler | Punkte | Abzug |
| --- | --- | --- |
| Rote Ampel (länger als 1 s rot) | 25 (40) | 90 € (200 €) |
| Stoppschild nicht angehalten | 10 | 25 € |
| Vorfahrt missachtet | 20 | 100 € |
| Zu schnell (bis 10 / 11–20 / über 20 km/h) | 5 / 12 / 25 | 30 / 70 / 150 € |
| Rechtsabbiegen schneller als Schrittgeschwindigkeit | 12 | 70 € |
| Nicht oder falsch geblinkt, beim Abfahren nicht geblinkt | 4–5 | 10 € |
| Bordstein überfahren | 3 | 15 € |
| Hindernis gestreift, Aufprall, Unfall mit Pkw | 10 / 25 / 30 | 150 / 600 / 900 € |
| Fußgänger angefahren | 60 | 2.000 € |
| Fußgänger am Zebrastreifen nicht durchgelassen, Fußgänger gefährdet | 15 | 80 € |
| Türen außerhalb der Haltestelle geöffnet, Tür auf Fahrgast zugefahren | 5 / 4 | – |
| Nachts ohne Licht, Vollbremsung mit Fahrgästen | 5 / 8 | 20 € / – |
| Haltestelle ausgelassen, Fahrgäste stehen gelassen, zu früh abgefahren | 10 / 8 / 6 | – |
| Linienweg verlassen, schlecht gehalten | 10 / 3 | – |

Die Note (1 bis 6) setzt sich aus Fahrweise (45 %), Pünktlichkeit (20 %), Fahrgastkomfort (15 %) und Service an den Haltestellen (20 %) zusammen. Ruckartiges Anfahren, Bremsen und schnelle Kurven kosten Komfort, besonders mit vielen Stehplatzgästen.

### Betrieb und Fuhrpark

Jede Fahrt bringt eine Grundvergütung für Strecke und Halte, die Fahrkarteneinnahmen, einen Fahrgastbonus und einen Qualitätsbonus nach Note. Abgezogen werden Betriebskosten sowie Bußgelder und Schäden. Mit dem Geld kaufst du weitere Busse:

| Bus | Vorbild | Länge | Plätze | Leistung | Preis |
| --- | --- | --- | --- | --- | --- |
| Stadtbus 12 m | Citaro | 12,1 m | 32 + 58 | 220 kW Diesel | Start |
| Midibus 10,6 m | Citaro K | 10,6 m | 26 + 44 | 220 kW Diesel | 3.000 € |
| E-Bus 12 m | eCitaro | 12,1 m | 30 + 58 | 250 kW elektrisch | 6.500 € |
| Gelenkbus 18 m | Citaro G | 18,1 m | 45 + 100 | 265 kW Diesel | 9.500 € |

Maße, Radstände und Motorleistungen orientieren sich an den Werksangaben des Mercedes-Benz Citaro. Die Wendekreise liegen im Physiktest bei 23,0 m (Werksangabe 22,97 m) und beim Midibus bei 17,4 m (17,28 m). Sechs Lackierungen stehen zur Wahl. Fortschritt und Einstellungen werden im Browser gespeichert.

Die **Vorführfahrt** lässt den Autopiloten eine Linie fahren. Mit `O` übernimmt er auch mitten in einer Fahrt oder gibt sie zurück. Vorführfahrten bringen kein Geld.

## Steuerung

| Aktion | Tastatur | Gamepad | Handy |
| --- | --- | --- | --- |
| Gas, Bremse | `W` `S` oder Pfeiltasten, `Shift` = Vollbremsung | RT, LT | Pedale rechts (analog) |
| Lenken | `A` `D` oder Pfeiltasten | linker Stick | Lenkrad links |
| Türen | `Leertaste` (alle), `1` `2` `3` (einzeln) | A | „Türen“ |
| Blinker, Warnblinker | `Q` `E`, `X` | LB, RB, Steuerkreuz unten | ◀ ▶ „Warn“ |
| Kneeling | `K` | B | „Knie“ |
| Feststellbremse, Rückwärts, Neutral | `P`, `R`, `N` | Steuerkreuz rechts, links | „P“, „R/D“ |
| Motor, Licht, Hupe | `I`, `L`, `H` | X, Steuerkreuz oben, Stick drücken | Licht, Hupe |
| Kamera, Blick nach rechts, Spiegel | `C`, `F`, `V` | Y | „Kamera“ oben rechts |
| Linienplan, Autopilot, Pause | `M`, `O`, `Esc` | Back, –, Start | Buttons oben rechts |

Im Fahrersitz schaust du mit gedrückter Maus umher, ein Doppelklick blickt wieder geradeaus. Kameras: Fahrersitz (mit Live-Außenspiegeln und Kombiinstrument), Verfolger, frei, von oben und Türseite.

## Technik

Eine statische Seite mit ES-Modulen und Three.js (`three@0.186.1` von jsDelivr).

- **Stadt** (`src/citymap.js`, `src/mapdata.js`, `src/layout.js`): Knoten, Straßen, Fahrstreifen, Abbiegebeziehungen mit Konfliktmatrix, Bordsteinkanten mit Radien, Busbuchten, Furten und Häuserzeilen
- **Busphysik** (`src/busPhysics.js`): Einspurmodell, das bei kleinen Geschwindigkeiten ins kinematische Modell übergeht (richtige Schleppkurve, Heckausschwenk), Wandlerautomatik mit 6 Gängen, Geschwindigkeitsbegrenzer bei 80 km/h, Druckluftbremse mit Ansprechzeit, Retarder, Haltestellenbremse, Feststellbremse, Kneeling, Gelenkbus mit Nachläufer und Knickwinkelbegrenzung, Türen mit Reversierautomatik, Bordsteine
- **Verkehr** (`src/traffic.js`, `src/pedestrians.js`): IDM-Fahrzeugfolge, Ampeln, Vorfahrt, rechts vor links, Linksabbieger warten, Belegung der Kreuzungen, Ausweichen am Bus, Fußgänger an Ampeln und Zebrastreifen
- **Regeln** (`src/rules.js`): Fehlerkatalog, Überwachung von Ampeln, Stoppschildern, Vorfahrt, Tempo, Blinker, Rechtsabbiegen, Fußgängern und Kollisionen
- **Fahrt** (`src/trip.js`, `src/tickets.js`, `src/company.js`): Fahrgäste mit Zielen, Fahrkarten, Zeitkarten, Haltewünsche, Fahrplan, Haltequalität, Komfort, Abrechnung, Betrieb
- **Autopilot** (`src/autopilot.js`): Stanley-Lenkregler an der Vorderachse, Ausholen vor dem Rechtsabbiegen, Schrittgeschwindigkeit, Lückensuche an Vorfahrtstraßen, Spiegelblick vor dem Abfahren, Fahrkartenverkauf. Er fährt alle Linien mit allen Bussen fehlerfrei und dient den Tests.
- **Grafik** (`src/cityView.js`, `src/propsView.js`, `src/landmarks.js`, `src/busModel.js`, `src/trafficView.js`, `src/peopleView.js`, `src/environment.js`): prozedurale Texturen, zusammengeführte Geometrie und Instanzen, Schatten, Himmel-Shader mit Wolken und Sternen, Straßenlaternen mit Lichtkegeln, Bus mit Innenraum, Fahrerplatz, Zielanzeigen und Fahrgastinfo
- **Sound** (`src/audio.js`): Diesel mit Obertönen, Nageln und Turbo, E-Motor-Surren, Abrollgeräusch, Druckluft, Türwarnton, Blinkerrelais, Haltewunsch-Gong, Hupe, Rückfahrwarner, Fahrscheindrucker

## Starten und Testen

```bash
npx http-server -c-1 -p 8080 .
# dann http://localhost:8080/bus/ öffnen

npm run test:bus           # Busphysik, Regeln, alle Linien mit allen Bussen per Autopilot
npm run test:bus:browser   # Browser-Test (Chromium): Menü, Vorführfahrt, Fahrersitz, Karte, Auswertung, Fahrkartenverkauf, Fahren per Tastatur
npm run build:bus          # bus/dist/: Variante ohne eigenes <html>-Grundgerüst
```

## Quellen

- Rechtsabbiegen mit Schrittgeschwindigkeit für Fahrzeuge über 3,5 t (§ 9 Abs. 6 StVO): [FLVBW](https://www.flvbw.de/home/info_1800_04__5418_9-absatz-6-stvo-schritttempo-beim-rechtsabbiegen-geaenderte-auslegung), [Polizei NRW Gütersloh](https://guetersloh.polizei.nrw/presse/stvo-novelle-rechtsabbiegen-innerorts-fuer-kraftfahrzeuge-ueber-35-t), [Bußgeldkatalog](https://www.bussgeldkatalog.org/wenden-rueckwaertsfahren-abbiegen/)
- Linienbusse an Haltestellen, Abfahren ermöglichen (§ 20 StVO): [dejure.org](https://dejure.org/gesetze/StVO/20.html), [Kanzlei Voigt: Blinken beim Verlassen der Haltestelle](https://kanzlei-voigt.de/frage-des-tages/muessen-busfahrer-beim-verlassen-der-haltestelle-blinken/)
- Technische Daten Citaro, Citaro K und Citaro G: [Mercedes-Benz Buses](https://www.mercedes-benz-bus.com/de/de/models/citaro/facts-citaro.html)
- Spielmechaniken anderer Bussimulatoren (Kneeling, Fahrkarten mit Wechselgeld, Haltewunsch, Fahrplan, Abzüge): [Bus Simulator 21 Review (TheSixthAxis)](https://www.thesixthaxis.com/2021/09/17/bus-simulator-21-review/), [OMSI 2 Handbuch](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/252530/manuals/Manual_OMSI2_EN.pdf)

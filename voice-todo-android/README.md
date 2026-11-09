# Sprachliste – To-do-Liste per Sprache (Android)

Sag einfach, was ansteht – die App macht daraus saubere Aufgaben und trägt sie in deinen Kalender ein.

> „Ähm, ich möchte heute noch duschen gehen und dann morgen um 10 Uhr Mama anrufen“
> → **Duschen gehen** (Heute) · **Mama anrufen** (Morgen, 10:00 Uhr, im Kalender)

## Funktionen
- 🎙️ **Großer Mikro-Knopf**: Dauer-Diktat – rede so lange du willst (auch 15 Minuten), tippe dann auf *Fertig*.
- ✨ **KI-Auswertung (Claude)**: versteht den Zusammenhang, formuliert kurz um statt wörtlich abzuschreiben,
  erkennt Datum/Uhrzeit. Vorschau zum Abhaken, bevor etwas gespeichert wird.
- 📴 **Offline-Modus** ohne API-Schlüssel: Regel-Parser für „heute/morgen/Freitag/in 3 Tagen/nächste Woche/am Wochenende/um 18 Uhr/halb acht/am 3.12.“.
- 📅 **Google Kalender in beide Richtungen**: Aufgaben mit Datum werden Termine (mit Erinnerung 15 Min. vorher).
  Abhaken (✓ im Termin), Ändern und Löschen in der App wird übertragen. Verschiebst, umbenennst oder löschst du
  den Termin in Google Kalender, übernimmt die App das beim nächsten Öffnen. Deine übrigen Termine der nächsten
  7 Tage siehst du oben in der App (antippen öffnet Google Kalender). Kalender-Auswahl in ⚙️.
- ➕ **Eingabeleiste unten**: „+ Aufgabe hinzufügen …“ antippen und einfach tippen, z. B. „ich muss heute noch
  duschen gehen“ → live erkannt als **Duschen gehen · Heute**. Datum/Uhrzeit per Chip selbst setzen.
  Mehrere Aufgaben in einem Satz → Vorschau zum Abhaken.
- ✏️ Aufgabe antippen = bearbeiten · Kreis antippen = erledigt · nach links wischen = löschen (mit „Rückgängig“).
- **Design**: ruhig und aufgeräumt – neutrale Farben, eine Akzentfarbe, gruppierte Listen, heller und dunkler Modus.
- **Erledigt** ist einklappbar und lässt sich mit einem Tipp aufräumen; Überfälliges ist rot markiert.

## Ansichten & Widget
- **Liste** und **Kalender** oben umschaltbar: Monatsblatt mit Punkten für Tage mit Aufgaben/Terminen,
  Tag antippen zeigt dessen Aufgaben und Termine, „Neue Aufgabe“ legt direkt für diesen Tag an.
- **Widget** für den Startbildschirm: heutige und überfällige Aufgaben abhaken, Plus und Mikrofon.

## Einstellungen
- **Darstellung**: Hell/Dunkel/System, sieben Akzentfarben oder Farben vom Hintergrundbild, kompakte Liste,
  Fortschritt und Termine ein-/ausblenden – mit Live-Vorschau.
- **Kalender & Konten**: Kalender nach Google-Konto gruppiert, Konto hinzufügen, Erinnerungszeit,
  automatische Übernahme neuer Termine.

## Sprachassistenten (Google Assistant / Gemini)
- **Aufgabe per Assistent**: „Hey Google, trag in meinen Kalender ein: morgen um 10 Uhr Zahnarzt.“
  Der Termin landet im Google Kalender, Sprachliste übernimmt ihn beim nächsten Öffnen als Aufgabe
  (Einstellungen → Sprachassistent zeigt, ob alles eingerichtet ist).
- **App öffnen**: „Hey Google, öffne Sprachliste“ · App-Symbol gedrückt halten → **Sprechen**.
- **Weitere Wege**: Text teilen → Sprachliste · Link `sprachliste://add?text=…` (Routinen, Tasker).
- Direktes Diktieren in die App per „Hey Google“ erlaubt Google nur Play-Store-Apps (vorbereitet in
  `res/xml/shortcuts.xml`).

## KI einschalten
1. Auf <https://console.anthropic.com> einen API-Schlüssel erstellen.
2. In der App ⚙️ → Schlüssel einfügen. Er bleibt nur auf deinem Handy.

## Installieren
- **Ohne Programmieren**: Im GitHub-Repo unter *Actions → Android-App bauen* den neuesten Lauf öffnen,
  das Artefakt **Sprachliste-APK** herunterladen, entpacken und die APK auf dem Handy installieren
  („Installation aus unbekannten Quellen“ erlauben).
- **Android Studio**: Ordner `voice-todo-android` öffnen und ▶️ drücken.

## Technik
Kotlin · Jetpack Compose · Android SpeechRecognizer (Deutsch) · Anthropic Java SDK · CalendarContract.
Tests: `./gradlew testDebugUnitTest`

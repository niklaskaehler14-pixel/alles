# Sprachliste – To-do-Liste per Sprache (Android)

Sag einfach, was ansteht – die App macht daraus saubere Aufgaben und trägt sie in deinen Kalender ein.

> „Ähm, ich möchte heute noch duschen gehen und dann morgen um 10 Uhr Mama anrufen“
> → **Duschen gehen** (Heute) · **Mama anrufen** (Morgen, 10:00 Uhr, im Kalender)

## Funktionen
- 🎙️ **Großer Mikro-Knopf**: Dauer-Diktat – rede so lange du willst (auch 15 Minuten), tippe dann auf *Fertig*.
- ✨ **KI-Auswertung (Claude)**: versteht den Zusammenhang, formuliert kurz um statt wörtlich abzuschreiben,
  erkennt Datum/Uhrzeit. Vorschau zum Abhaken, bevor etwas gespeichert wird.
- 📴 **Offline-Modus** ohne API-Schlüssel: Regel-Parser für „heute/morgen/Freitag/um 18 Uhr/halb acht/am 3.12.“.
- 📅 **Kalender**: Aufgaben mit Datum landen automatisch im Gerätekalender (Google/Samsung) inkl. Erinnerung 15 Min. vorher.
- ➕ **Plus-Knopf** zum Eintippen mit Heute/Morgen/Datum/Uhrzeit.
- 👆 Wischen nach rechts = erledigt, nach links = löschen (mit „Rückgängig“).
- 🎨 Material 3, Verlauf-Design, passt sich ab Android 12 deinen Hintergrundfarben an, Dark Mode.

## Sprachassistenten
| Assistent | So geht's |
|---|---|
| Google Assistant / Gemini | „Hey Google, öffne Sprachliste“ · App-Icon lange drücken → **Sprechen** (startet sofort das Zuhören) |
| Bixby | „Hi Bixby, öffne Sprachliste“ – oder in *Bixby-Routinen* die App/den Shortcut „Sprechen“ starten |
| Alle / Tasker / Routinen | Link `sprachliste://add?text=duschen%20gehen` öffnet die App und wertet den Text aus |
| Andere Apps | Text **teilen → Sprachliste** |

Ehrlich gesagt: Dass man *ohne* App-Öffnen direkt „Hey Google, schreib in Sprachliste …“ sagt, erlaubt Google
nur für Apps aus dem Play Store (App Actions, schon vorbereitet in `res/xml/shortcuts.xml`). Alexa kann
Android-Apps nicht direkt steuern.

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

package de.sprachliste.ai

import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.StopReason
import de.sprachliste.data.TaskDraft
import de.sprachliste.data.optStringOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Ergebnis der Auswertung – inkl. Hinweis, ob die KI oder der Offline-Parser benutzt wurde. */
data class Extraction(val drafts: List<TaskDraft>, val usedAi: Boolean, val note: String? = null)

/**
 * Wandelt frei gesprochenen Text (auch sehr lange Monologe) in saubere Aufgaben um.
 * Mit API-Schlüssel: Claude versteht den Kontext. Ohne: lokaler Regel-Parser.
 */
class TaskExtractor(private val apiKeyProvider: () -> String) {

    suspend fun extract(text: String, today: LocalDate = LocalDate.now()): Extraction {
        val key = apiKeyProvider()
        if (key.isBlank()) return Extraction(LocalParser.parse(text, today), usedAi = false)
        return try {
            val drafts = withContext(Dispatchers.IO) { askClaude(key, text, today) }
            Extraction(drafts, usedAi = true)
        } catch (e: Exception) {
            Extraction(LocalParser.parse(text, today), usedAi = false,
                note = "KI nicht erreichbar – offline ausgewertet (${e.javaClass.simpleName})")
        }
    }

    private fun askClaude(key: String, text: String, today: LocalDate): List<TaskDraft> {
        val client = AnthropicOkHttpClient.builder().apiKey(key).build()
        try {
            val weekday = today.format(DateTimeFormatter.ofPattern("EEEE", Locale.GERMAN))
            val params = MessageCreateParams.builder()
                .model("claude-opus-5-5")
                .maxTokens(4000L)
                .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.LOW).build())
                .system(SYSTEM_PROMPT)
                .addUserMessage("Heute ist $weekday, der $today.\n\nGesprochener Text:\n\"\"\"\n$text\n\"\"\"")
                .build()
            val response = client.messages().create(params)
            if (response.stopReason().orElse(null) == StopReason.REFUSAL) {
                throw IllegalStateException("refusal")
            }
            val out = response.content().mapNotNull { b -> b.text().orElse(null)?.text() }.joinToString("")
            return parseJson(out)
        } finally {
            client.close()
        }
    }

    companion object {
        val SYSTEM_PROMPT = """
            Du bist der Assistent einer To-do-App. Der Nutzer diktiert frei und oft unstrukturiert,
            manchmal minutenlang. Ziehe daraus NUR die echten Aufgaben, Termine und Vorhaben heraus.
            Regeln:
            - Formuliere jede Aufgabe kurz und klar (2-6 Wörter), z. B. "Duschen gehen", "Mama anrufen".
              Nicht wörtlich abschreiben, Füllwörter und Erzählungen weglassen.
            - Erkenne Datum (relativ wie "morgen", "Freitag", "nächste Woche") und Uhrzeit.
            - Wiederhole keine Aufgabe doppelt. Wenn nichts zu tun ist, gib eine leere Liste zurück.
            - Zusätzliche nützliche Details kurz in "notes".
            Antworte ausschließlich mit JSON in genau diesem Format, ohne weiteren Text:
            {"tasks":[{"title":"...","date":"YYYY-MM-DD oder null","time":"HH:MM oder null","durationMin":30,"notes":""}]}
        """.trimIndent()

        /** Robust: sucht das JSON-Objekt auch dann, wenn drumherum Text steht. */
        fun parseJson(raw: String): List<TaskDraft> {
            val start = raw.indexOf('{'); val end = raw.lastIndexOf('}')
            require(start >= 0 && end > start) { "Kein JSON in der Antwort" }
            val arr = JSONObject(raw.substring(start, end + 1)).getJSONArray("tasks")
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val title = o.optString("title").trim()
                if (title.isEmpty()) return@mapNotNull null
                TaskDraft(
                    title = title,
                    date = o.optStringOrNull("date")?.let { runCatching { LocalDate.parse(it) }.getOrNull() },
                    time = o.optStringOrNull("time")?.let { runCatching { LocalTime.parse(it) }.getOrNull() },
                    durationMin = o.optInt("durationMin", 30).coerceIn(5, 24 * 60),
                    notes = o.optString("notes", "").takeIf { it != "null" } ?: "",
                )
            }
        }
    }
}

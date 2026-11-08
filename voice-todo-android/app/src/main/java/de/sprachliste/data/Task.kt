package de.sprachliste.data

import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** Eine Aufgabe in der Liste. */
data class Task(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val date: LocalDate? = null,
    val time: LocalTime? = null,
    val durationMin: Int = 30,
    val notes: String = "",
    val done: Boolean = false,
    val calendarEventId: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("title", title)
        put("date", date?.toString() ?: JSONObject.NULL)
        put("time", time?.toString() ?: JSONObject.NULL)
        put("durationMin", durationMin); put("notes", notes); put("done", done)
        put("calendarEventId", calendarEventId ?: JSONObject.NULL)
        put("createdAt", createdAt)
    }

    companion object {
        fun fromJson(o: JSONObject) = Task(
            id = o.getString("id"),
            title = o.getString("title"),
            date = o.optStringOrNull("date")?.let(LocalDate::parse),
            time = o.optStringOrNull("time")?.let(LocalTime::parse),
            durationMin = o.optInt("durationMin", 30),
            notes = o.optString("notes", ""),
            done = o.optBoolean("done", false),
            calendarEventId = if (o.isNull("calendarEventId")) null else o.optLong("calendarEventId"),
            createdAt = o.optLong("createdAt", System.currentTimeMillis()),
        )
    }
}

/** Von der KI / dem Parser erkannte Aufgabe, bevor sie gespeichert wird. */
data class TaskDraft(
    val title: String,
    val date: LocalDate? = null,
    val time: LocalTime? = null,
    val durationMin: Int = 30,
    val notes: String = "",
) {
    fun toTask() = Task(title = title, date = date, time = time, durationMin = durationMin, notes = notes)
}

internal fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }

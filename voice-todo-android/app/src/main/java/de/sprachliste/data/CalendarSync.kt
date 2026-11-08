package de.sprachliste.data

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import androidx.core.content.ContextCompat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

data class CalendarInfo(val id: Long, val name: String, val account: String, val isGoogle: Boolean, val color: Int)

/** Termin aus dem Kalender (für die Anzeige in der App). */
data class CalendarEvent(val id: Long, val title: String, val date: LocalDate, val time: LocalTime?, val color: Int)

/** Was sich im Kalender an einem verknüpften Termin geändert hat. */
sealed interface EventState {
    data object Gone : EventState
    data class Present(val title: String, val date: LocalDate, val time: LocalTime?, val durationMin: Int) : EventState
}

/**
 * Verbindung zum Gerätekalender. Google-Kalender-Konten auf dem Handy sind dort enthalten
 * und werden von Android automatisch mit calendar.google.com synchronisiert.
 */
class CalendarSync(private val context: Context) {

    fun hasPermission(): Boolean = listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
        .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    fun calendars(): List<CalendarInfo> {
        if (!hasPermission()) return emptyList()
        val proj = arrayOf(Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME,
            Calendars.ACCOUNT_TYPE, Calendars.CALENDAR_COLOR, Calendars.IS_PRIMARY)
        val sel = "${Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${Calendars.VISIBLE} = 1"
        val out = mutableListOf<Pair<CalendarInfo, Boolean>>()
        runCatching {
            context.contentResolver.query(Calendars.CONTENT_URI, proj, sel,
                arrayOf(Calendars.CAL_ACCESS_CONTRIBUTOR.toString()), null)?.use { c ->
                while (c.moveToNext()) {
                    out += CalendarInfo(c.getLong(0), c.getString(1) ?: "Kalender", c.getString(2) ?: "",
                        c.getString(3) == "com.google", c.getInt(4)) to (c.getInt(5) == 1)
                }
            }
        }
        // Google-Hauptkalender zuerst
        return out.sortedWith(compareBy({ !it.first.isGoogle }, { !it.second }, { it.first.name })).map { it.first }
    }

    /** Gewählter Kalender oder automatisch der Google-Hauptkalender. */
    fun resolveCalendarId(preferred: Long): Long? {
        val all = calendars()
        return all.firstOrNull { it.id == preferred }?.id ?: all.firstOrNull()?.id
    }

    private fun values(task: Task) = ContentValues().apply {
        val date = task.date!!
        put(Events.TITLE, if (task.done) "✓ ${task.title}" else task.title)
        put(Events.DESCRIPTION, task.notes.ifBlank { "Aufgabe aus Sprachliste" })
        if (task.time == null) {
            val start = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            put(Events.ALL_DAY, 1)
            put(Events.DTSTART, start)
            put(Events.DTEND, start + DAY_MS)
            put(Events.EVENT_TIMEZONE, "UTC")
        } else {
            val zone = ZoneId.systemDefault()
            val start = date.atTime(task.time).atZone(zone).toInstant().toEpochMilli()
            put(Events.ALL_DAY, 0)
            put(Events.DTSTART, start)
            put(Events.DTEND, start + task.durationMin * 60_000L)
            put(Events.EVENT_TIMEZONE, zone.id)
        }
    }

    fun insert(task: Task, preferredCalendar: Long): Long? {
        if (task.date == null || !hasPermission()) return null
        return runCatching {
            val calId = resolveCalendarId(preferredCalendar) ?: return null
            val v = values(task).apply { put(Events.CALENDAR_ID, calId); put(Events.HAS_ALARM, if (task.time != null) 1 else 0) }
            val id = context.contentResolver.insert(Events.CONTENT_URI, v)?.lastPathSegment?.toLongOrNull() ?: return null
            if (task.time != null) addReminder(id)
            id
        }.getOrNull()
    }

    /** Termin an die Aufgabe angleichen. Gibt false zurück, wenn der Termin nicht mehr existiert. */
    fun update(task: Task): Boolean {
        val id = task.calendarEventId ?: return false
        if (!hasPermission() || task.date == null) return false
        return runCatching {
            context.contentResolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, id), values(task), null, null) > 0
        }.getOrDefault(false)
    }

    fun delete(eventId: Long) {
        if (!hasPermission()) return
        runCatching { context.contentResolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), null, null) }
    }

    private fun addReminder(eventId: Long) {
        context.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, ContentValues().apply {
            put(CalendarContract.Reminders.EVENT_ID, eventId)
            put(CalendarContract.Reminders.MINUTES, 15)
            put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
        })
    }

    /** Liest den aktuellen Stand eines verknüpften Termins (für Änderungen in Google Kalender). */
    fun read(eventId: Long): EventState? {
        if (!hasPermission()) return null
        return runCatching {
            context.contentResolver.query(ContentUris.withAppendedId(Events.CONTENT_URI, eventId),
                arrayOf(Events.TITLE, Events.DTSTART, Events.DTEND, Events.ALL_DAY, Events.DELETED), null, null, null)?.use { c ->
                if (!c.moveToFirst() || c.getInt(4) == 1) return EventState.Gone
                val start = c.getLong(1); val end = c.getLong(2); val allDay = c.getInt(3) == 1
                val (d, t) = toDateTime(start, allDay)
                EventState.Present(
                    title = (c.getString(0) ?: "").removePrefix("✓ ").trim(),
                    date = d, time = t,
                    durationMin = if (allDay || end <= start) 30 else ((end - start) / 60_000L).toInt(),
                )
            } ?: EventState.Gone
        }.getOrNull()
    }

    /** Termine der nächsten Tage aus allen sichtbaren Kalendern. */
    fun upcoming(from: LocalDate, days: Int): List<CalendarEvent> {
        if (!hasPermission()) return emptyList()
        val zone = ZoneId.systemDefault()
        val begin = from.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = from.plusDays(days.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, begin); ContentUris.appendId(it, end)
        }.build()
        val proj = arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.DISPLAY_COLOR)
        val out = mutableListOf<CalendarEvent>()
        runCatching {
            context.contentResolver.query(uri, proj, "${CalendarContract.Instances.VISIBLE} = 1", null,
                "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
                while (c.moveToNext()) {
                    val (d, t) = toDateTime(c.getLong(2), c.getInt(3) == 1)
                    if (d >= from) out += CalendarEvent(c.getLong(0), c.getString(1) ?: "(Ohne Titel)", d, t, c.getInt(4))
                }
            }
        }
        return out
    }

    /** Öffnet den Termin in Google Kalender (oder der Standard-Kalender-App). */
    fun openIntent(eventId: Long) = Intent(Intent.ACTION_VIEW, ContentUris.withAppendedId(Events.CONTENT_URI, eventId))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun toDateTime(millis: Long, allDay: Boolean): Pair<LocalDate, LocalTime?> =
        if (allDay) Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate() to null
        else Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).let { it.toLocalDate() to it.toLocalTime().withSecond(0).withNano(0) }

    companion object { private const val DAY_MS = 24L * 60 * 60 * 1000 }
}

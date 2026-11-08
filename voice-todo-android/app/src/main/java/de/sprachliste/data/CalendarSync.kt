package de.sprachliste.data

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import java.time.ZoneId
import java.time.ZoneOffset

/** Trägt Aufgaben mit Datum direkt in den Gerätekalender (z. B. Google Kalender) ein. */
class CalendarSync(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    private fun findCalendarId(): Long? {
        val projection = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY)
        val sel = "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${CalendarContract.Calendars.VISIBLE} = 1"
        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI, projection, sel,
            arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()), null
        )?.use { c ->
            var first: Long? = null
            while (c.moveToNext()) {
                val id = c.getLong(0)
                if (first == null) first = id
                if (c.getInt(1) == 1) return id
            }
            return first
        }
        return null
    }

    /** Gibt die Event-ID zurück oder null, wenn kein Eintrag möglich war. */
    fun insert(task: Task): Long? {
        val date = task.date ?: return null
        if (!hasPermission()) return null
        return try {
            val calId = findCalendarId() ?: return null
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, calId)
                put(CalendarContract.Events.TITLE, task.title)
                put(CalendarContract.Events.DESCRIPTION, task.notes.ifBlank { "Aus Sprachliste" })
                if (task.time == null) {
                    val start = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
                    put(CalendarContract.Events.ALL_DAY, 1)
                    put(CalendarContract.Events.DTSTART, start)
                    put(CalendarContract.Events.DTEND, start + 24L * 60 * 60 * 1000)
                    put(CalendarContract.Events.EVENT_TIMEZONE, "UTC")
                } else {
                    val zone = ZoneId.systemDefault()
                    val start = date.atTime(task.time).atZone(zone).toInstant().toEpochMilli()
                    put(CalendarContract.Events.DTSTART, start)
                    put(CalendarContract.Events.DTEND, start + task.durationMin * 60_000L)
                    put(CalendarContract.Events.EVENT_TIMEZONE, zone.id)
                    put(CalendarContract.Events.HAS_ALARM, 1)
                }
            }
            val uri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values) ?: return null
            val eventId = uri.lastPathSegment?.toLongOrNull() ?: return null
            if (task.time != null) {
                context.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, ContentValues().apply {
                    put(CalendarContract.Reminders.EVENT_ID, eventId)
                    put(CalendarContract.Reminders.MINUTES, 15)
                    put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                })
            }
            eventId
        } catch (e: Exception) { null }
    }

    fun delete(eventId: Long) {
        if (!hasPermission()) return
        runCatching {
            context.contentResolver.delete(
                android.content.ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), null, null
            )
        }
    }
}


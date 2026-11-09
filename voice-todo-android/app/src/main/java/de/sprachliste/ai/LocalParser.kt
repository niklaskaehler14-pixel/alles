package de.sprachliste.ai

import de.sprachliste.data.TaskDraft
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters

/**
 * Offline-Auswertung ohne KI: erkennt deutsche Datums-/Zeitangaben,
 * entfernt Füllwörter und teilt mehrere Aufgaben auf.
 * Beispiel: "ich möchte heute duschen gehen" -> "Duschen gehen" (heute)
 */
object LocalParser {

    private val weekdays = mapOf(
        "montag" to DayOfWeek.MONDAY, "dienstag" to DayOfWeek.TUESDAY,
        "mittwoch" to DayOfWeek.WEDNESDAY, "donnerstag" to DayOfWeek.THURSDAY,
        "freitag" to DayOfWeek.FRIDAY, "samstag" to DayOfWeek.SATURDAY,
        "sonntag" to DayOfWeek.SUNDAY,
    )
    private val numberWords = mapOf(
        "eins" to 1, "ein" to 1, "zwei" to 2, "drei" to 3, "vier" to 4, "fünf" to 5,
        "sechs" to 6, "sieben" to 7, "acht" to 8, "neun" to 9, "zehn" to 10,
        "elf" to 11, "zwölf" to 12,
    )

    private val splitter = Regex(
        """(?i)\s*(?:(?<!\d)\.+\s+|[;!?]+\s+|,?\s+und dann\s+|,?\s+danach\s+|,?\s+außerdem\s+|,?\s+und (?=(?:ich|muss|will|möchte|sollte)\b)|,?\s+dann\s+(?=(?:muss|will|möchte|sollte|noch)\b))"""
    )
    private val fillerStart = Regex(
        """(?i)^(?:(?:also|ähm|äh|ok|okay|ja|und|ach ja|bitte|erinnere mich(?: daran)?,?|denk dran,?|nicht vergessen,?)\s+)*(?:ich\s+(?:möchte|muss|will|sollte|werde|wollte|müsste)|ich\s+habe\s+vor,?|wir\s+(?:müssen|wollen|sollten))?\s*(?:noch\s+|mal\s+|unbedingt\s+|auf jeden fall\s+)*"""
    )
    private val fillerEnd = Regex("""(?i)\s+(?:muss|will|möchte|sollte|noch|mal|bitte)\s*$""")

    fun parse(text: String, today: LocalDate = LocalDate.now()): List<TaskDraft> =
        text.split(splitter).map { it.trim() }.filter { it.length > 1 }
            .mapNotNull { parseOne(it, today) }

    fun parseOne(raw: String, today: LocalDate): TaskDraft? {
        var s = " " + raw.trim().trimEnd('.', '!', '?') + " "
        var date: LocalDate? = null
        var time: LocalTime? = null

        fun cut(r: Regex, onMatch: (MatchResult) -> Unit) {
            r.find(s)?.let { onMatch(it); s = " " + s.replaceRange(it.range, " ").trim() + " " }
        }

        // Datum
        cut(Regex("""(?i)\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?\s""")) { m ->
            val d = m.groupValues[1].toInt(); val mo = m.groupValues[2].toInt()
            val y = m.groupValues[3].takeIf { it.isNotEmpty() }?.toInt()?.let { if (it < 100) 2000 + it else it }
            runCatching {
                var c = LocalDate.of(y ?: today.year, mo, d)
                if (y == null && c.isBefore(today)) c = c.plusYears(1)
                date = c
            }
        }
        if (date == null) cut(Regex("""(?i)\s(übermorgen)\s""")) { date = today.plusDays(2) }
        if (date == null) cut(Regex("""(?i)\s(morgen)(?!\s*früh)\s""")) { date = today.plusDays(1) }
        if (date == null) cut(Regex("""(?i)\s(morgen\s+früh)\s""")) { date = today.plusDays(1); time = LocalTime.of(8, 0) }
        if (date == null) cut(Regex("""(?i)\s(heute(?:\s+noch)?|gleich|nachher|jetzt)\s""")) { date = today }
        if (date == null) cut(Regex("""(?i)\s(?:am\s+)?übernächsten\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s""")) { m ->
            date = today.with(TemporalAdjusters.next(weekdays.getValue(m.groupValues[1].lowercase()))).plusWeeks(1)
        }
        if (date == null) cut(Regex("""(?i)\s(?:am\s+|nächsten\s+|kommenden\s+|diesen\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s""")) { m ->
            val dow = weekdays.getValue(m.groupValues[1].lowercase())
            date = today.with(TemporalAdjusters.next(dow))
        }
        if (date == null) cut(Regex("""(?i)\sin\s+(\d{1,3}|\w+)\s+(tag|tagen|woche|wochen)\s""")) { m ->
            val n = m.groupValues[1].lowercase().let { it.toIntOrNull() ?: numberWords[it] ?: if (it == "einem" || it == "einer") 1 else null }
            if (n != null) date = if (m.groupValues[2].lowercase().startsWith("tag")) today.plusDays(n.toLong()) else today.plusWeeks(n.toLong())
        }
        if (date == null) cut(Regex("""(?i)\s(?:in\s+der\s+|die\s+)?(?:nächsten?|kommenden?)\s+woche\s""")) { date = today.plusWeeks(1) }
        if (date == null) cut(Regex("""(?i)\s(?:am|dieses|übers)\s+wochenende\s""")) {
            date = if (today.dayOfWeek == DayOfWeek.SATURDAY || today.dayOfWeek == DayOfWeek.SUNDAY) today
            else today.with(TemporalAdjusters.next(DayOfWeek.SATURDAY))
        }

        // Uhrzeit
        cut(Regex("""(?i)\s(?:um\s+|gegen\s+|ab\s+)?(\d{1,2})(?::(\d{2})|\s*uhr\s*(\d{1,2})?)\s*(?:uhr)?\s""")) { m ->
            val h = m.groupValues[1].toInt()
            val min = (m.groupValues[2].ifEmpty { m.groupValues[3] }).ifEmpty { "0" }.toInt()
            if (h in 0..23 && min in 0..59) time = LocalTime.of(h, min)
        }
        if (time == null) cut(Regex("""(?i)\s(?:um|gegen|ab)\s+(\d{1,2})\s""")) { m ->
            val h = m.groupValues[1].toInt()
            if (h in 0..23) time = LocalTime.of(h, 0)
        }
        if (time == null) cut(Regex("""(?i)\s(?:um\s+)?halb\s+(\w+)\s""")) { m ->
            val n = m.groupValues[1].lowercase().let { numberWords[it] ?: it.toIntOrNull() }
            if (n != null && n in 1..24) time = LocalTime.of((n - 1 + 24) % 24, 30)
        }
        if (time == null) cut(Regex("""(?i)\sum\s+(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)(?:\s+uhr)?\s""")) { m ->
            time = LocalTime.of(numberWords.getValue(m.groupValues[1].lowercase()), 0)
        }
        // Tageszeit verschiebt Uhrzeit (z. B. "um 7 abends" -> 19:00)
        cut(Regex("""(?i)\s(?:am\s+|heute\s+)?(abends?|nachmittags?|vormittags?|morgens|mittags?|früh)\s""")) { m ->
            val w = m.groupValues[1].lowercase()
            val t = time
            time = when {
                t != null && (w.startsWith("abend") || w.startsWith("nachmittag")) && t.hour < 12 -> t.plusHours(12)
                t != null -> t
                w.startsWith("abend") -> LocalTime.of(19, 0)
                w.startsWith("nachmittag") -> LocalTime.of(15, 0)
                w.startsWith("mittag") -> LocalTime.of(12, 0)
                w.startsWith("vormittag") -> LocalTime.of(10, 0)
                else -> LocalTime.of(8, 0)
            }
            if (date == null) date = today
        }

        var title = s.trim().replace(fillerStart, "").replace(fillerEnd, "")
            .replace(Regex("""\s{2,}"""), " ").trim().trim(',', '.', '-', ' ')
        if (title.length < 2) return null
        title = title.replaceFirstChar { it.uppercase() }
        return TaskDraft(title = title, date = date, time = time)
    }
}

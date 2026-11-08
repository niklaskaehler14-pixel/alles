package de.sprachliste.ui

import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val dayFmt = DateTimeFormatter.ofPattern("EEE, d. MMM", Locale.GERMAN)
private val timeFmt = DateTimeFormatter.ofPattern("HH:mm")

fun formatWhen(date: LocalDate?, time: LocalTime?, today: LocalDate = LocalDate.now()): String? {
    val d = when (date) {
        null -> null
        today -> "Heute"
        today.plusDays(1) -> "Morgen"
        today.minusDays(1) -> "Gestern"
        else -> date.format(dayFmt)
    }
    val t = time?.format(timeFmt)?.let { "$it Uhr" }
    return listOfNotNull(d, t).joinToString(" · ").ifEmpty { null }
}

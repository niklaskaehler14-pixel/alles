package de.sprachliste.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.sprachliste.data.CalendarEvent
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** Erster angezeigter Tag des Monatsblatts (Montag der Woche, in der der Monat beginnt). */
fun gridStart(month: YearMonth): LocalDate =
    month.atDay(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

/**
 * Monatsblatt: Punkt unter einem Tag = dort steht etwas an
 * (Akzentfarbe = offene Aufgabe, grau = Termin aus dem Kalender).
 */
@Composable
fun MonthGrid(
    month: YearMonth, selected: LocalDate, today: LocalDate,
    taskDays: Set<LocalDate>, eventDays: Set<LocalDate>,
    onSelect: (LocalDate) -> Unit, onPrev: () -> Unit, onNext: () -> Unit, onToday: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Column(Modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.GERMAN)),
                    style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(start = 8.dp),
                )
                if (month != YearMonth.from(today) || selected != today) {
                    TextButton(onClick = onToday, contentPadding = PaddingValues(horizontal = 10.dp)) { Text("Heute") }
                }
                IconButton(onClick = onPrev) { Icon(Icons.Rounded.ChevronLeft, "Vorheriger Monat") }
                IconButton(onClick = onNext) { Icon(Icons.Rounded.ChevronRight, "Nächster Monat") }
            }
            Row(Modifier.fillMaxWidth()) {
                listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So").forEach {
                    Text(it, Modifier.weight(1f), textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(4.dp))
            val start = gridStart(month)
            // Nur so viele Wochen zeigen, wie der Monat braucht
            val weeks = if (start.plusDays(35).isAfter(month.atEndOfMonth())) 5 else 6
            for (w in 0 until weeks) {
                Row(Modifier.fillMaxWidth()) {
                    for (d in 0 until 7) {
                        val day = start.plusDays((w * 7 + d).toLong())
                        DayCell(
                            day = day, inMonth = YearMonth.from(day) == month,
                            isSelected = day == selected, isToday = day == today,
                            hasTask = day in taskDays, hasEvent = day in eventDays,
                            onClick = { onSelect(day) }, modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate, inMonth: Boolean, isSelected: Boolean, isToday: Boolean,
    hasTask: Boolean, hasEvent: Boolean, onClick: () -> Unit, modifier: Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier.height(46.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(30.dp).clip(CircleShape).background(if (isSelected) scheme.primary else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${day.dayOfMonth}", style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (isToday || isSelected) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    isSelected -> scheme.onPrimary
                    isToday -> scheme.primary
                    inMonth -> scheme.onSurface
                    else -> scheme.outline
                },
            )
        }
        Row(Modifier.height(6.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
            if (hasTask) Box(Modifier.size(5.dp).clip(CircleShape).background(scheme.primary))
            if (hasEvent) Box(Modifier.size(5.dp).clip(CircleShape).background(scheme.outline))
        }
    }
}

/** Ein Kalendertermin in der Tagesübersicht. */
@Composable
fun DayEventRow(event: CalendarEvent, shape: Shape, showDivider: Boolean, onClick: () -> Unit) {
    Column(Modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceContainer)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(3.dp).height(30.dp).clip(CircleShape).background(Color(event.color or 0xFF000000.toInt())))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(event.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(event.time?.let { "%02d:%02d Uhr".format(it.hour, it.minute) } ?: "Ganztägig",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (showDivider) HorizontalDivider(Modifier.padding(start = 33.dp), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

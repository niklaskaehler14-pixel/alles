package de.sprachliste.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import de.sprachliste.data.Prefs
import de.sprachliste.data.CalendarEvent
import de.sprachliste.data.Task
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class Kind { OVERDUE, TODAY, TOMORROW, LATER, SOMEDAY, DONE }
private data class Section(val kind: Kind, val title: String, val tasks: List<Task>)

private fun group(tasks: List<Task>, today: LocalDate): List<Section> {
    val open = tasks.filterNot { it.done }
        .sortedWith(compareBy<Task>({ it.date ?: LocalDate.MAX }, { it.time ?: LocalTime.MAX }, { it.createdAt }))
    return listOf(
        Section(Kind.OVERDUE, "Überfällig", open.filter { it.date != null && it.date < today }),
        Section(Kind.TODAY, "Heute", open.filter { it.date == today }),
        Section(Kind.TOMORROW, "Morgen", open.filter { it.date == today.plusDays(1) }),
        Section(Kind.LATER, "Demnächst", open.filter { it.date != null && it.date > today.plusDays(1) }),
        Section(Kind.SOMEDAY, "Ohne Datum", open.filter { it.date == null }),
        Section(Kind.DONE, "Erledigt", tasks.filter { it.done }.sortedByDescending { it.createdAt }),
    ).filter { it.tasks.isNotEmpty() }
}

@Composable
fun MainScreen(
    tasks: List<Task>,
    events: List<CalendarEvent>,
    prefs: Prefs,
    snackbar: SnackbarHostState,
    onMic: () -> Unit,
    onPlus: () -> Unit,
    onSettings: () -> Unit,
    onToggle: (Task) -> Unit,
    onEdit: (Task) -> Unit,
    onDelete: (Task) -> Unit,
    onClearDone: () -> Unit,
    onOpenEvent: (CalendarEvent) -> Unit,
) {
    val today = LocalDate.now()
    val sections = remember(tasks, today) { group(tasks, today) }
    val todayAll = tasks.filter { it.date == today }
    val todayDone = todayAll.count { it.done }
    var showDone by rememberSaveable { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val toggle: (Task) -> Unit = { haptics.performHapticFeedback(HapticFeedbackType.LongPress); onToggle(it) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = { InputBar(onPlus = onPlus, onMic = onMic) },
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        ) {
            item(key = "header") { Header(today, todayDone, if (prefs.showProgress) todayAll.size else 0, onSettings) }

            if (prefs.showEvents && events.isNotEmpty()) item(key = "events") { EventStrip(events, today, onOpenEvent) }

            if (sections.isEmpty()) item(key = "empty") { EmptyState(hasEvents = prefs.showEvents && events.isNotEmpty()) }

            sections.forEach { sec ->
                val isDone = sec.kind == Kind.DONE
                item(key = "h_${sec.kind}") {
                    SectionHeader(
                        sec, expanded = !isDone || showDone,
                        onToggleExpand = if (isDone) ({ showDone = !showDone }) else null,
                        onClear = if (isDone && showDone) onClearDone else null,
                    )
                }
                if (!isDone || showDone) {
                    itemsIndexed(sec.tasks, key = { _, t -> t.id }) { i, t ->
                        val shape = rowShape(i, sec.tasks.size)
                        TaskRow(
                            task = t, today = today, compact = prefs.compact, shape = shape, showDivider = i < sec.tasks.lastIndex,
                            onToggle = toggle, onEdit = onEdit, onDelete = onDelete,
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }
}

private fun rowShape(index: Int, count: Int): Shape {
    val r = 14.dp
    return when {
        count == 1 -> RoundedCornerShape(r)
        index == 0 -> RoundedCornerShape(topStart = r, topEnd = r)
        index == count - 1 -> RoundedCornerShape(bottomStart = r, bottomEnd = r)
        else -> RoundedCornerShape(0.dp)
    }
}

@Composable
private fun Header(today: LocalDate, done: Int, total: Int, onSettings: () -> Unit) {
    val progress by animateFloatAsState(if (total == 0) 0f else done / total.toFloat(), label = "progress")
    Column(Modifier.padding(start = 4.dp, bottom = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    today.format(DateTimeFormatter.ofPattern("EEEE, d. MMMM", Locale.GERMAN)),
                    style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("Aufgaben", style = MaterialTheme.typography.headlineLarge)
            }
            IconButton(onClick = onSettings) {
                Icon(Icons.Rounded.Settings, "Einstellungen", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (total > 0) {
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 4.dp)) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.weight(1f).height(6.dp).clip(CircleShape),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    drawStopIndicator = {},
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    if (done == total) "Heute alles erledigt" else "$done von $total heute",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(sec: Section, expanded: Boolean, onToggleExpand: (() -> Unit)?, onClear: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(top = 18.dp).heightIn(min = 36.dp)
            .then(if (onToggleExpand != null) Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onToggleExpand) else Modifier)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            sec.title, style = MaterialTheme.typography.titleSmall,
            color = if (sec.kind == Kind.OVERDUE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.width(6.dp))
        Text("${sec.tasks.size}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.weight(1f))
        if (onClear != null) {
            TextButton(onClick = onClear, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Text("Alle löschen", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (onToggleExpand != null) {
            Icon(
                if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                if (expanded) "Einklappen" else "Ausklappen",
                tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskRow(
    task: Task, today: LocalDate, compact: Boolean, shape: Shape, showDivider: Boolean,
    onToggle: (Task) -> Unit, onEdit: (Task) -> Unit, onDelete: (Task) -> Unit, modifier: Modifier,
) {
    val state = rememberSwipeToDismissBoxState(confirmValueChange = {
        when (it) {
            SwipeToDismissBoxValue.EndToStart -> { onDelete(task); true }
            SwipeToDismissBoxValue.StartToEnd -> { onToggle(task); false }
            else -> false
        }
    })
    SwipeToDismissBox(
        state = state, modifier = modifier.clip(shape),
        backgroundContent = {
            val toDelete = state.dismissDirection == SwipeToDismissBoxValue.EndToStart
            Box(
                Modifier.fillMaxSize()
                    .background(if (toDelete) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 20.dp),
                contentAlignment = if (toDelete) Alignment.CenterEnd else Alignment.CenterStart,
            ) {
                Icon(if (toDelete) Icons.Rounded.Delete else Icons.Rounded.Check, null,
                    tint = if (toDelete) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary)
            }
        },
    ) {
        Column(Modifier.background(MaterialTheme.colorScheme.surfaceContainer)) {
            Row(
                Modifier.fillMaxWidth().clickable { onEdit(task) }.heightIn(min = if (compact) 44.dp else 56.dp)
                    .padding(start = 4.dp, end = 16.dp, top = if (compact) 0.dp else 6.dp, bottom = if (compact) 0.dp else 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CheckCircle(task.done, if (compact) 44.dp else 48.dp) { onToggle(task) }
                Column(Modifier.weight(1f)) {
                    Text(
                        task.title, style = MaterialTheme.typography.bodyLarge,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        textDecoration = if (task.done) TextDecoration.LineThrough else null,
                        color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    )
                    val whenText = formatWhen(task.date, task.time, today)
                    if (whenText != null) {
                        val overdue = !task.done && task.date != null && task.date < today
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                whenText, style = MaterialTheme.typography.bodySmall,
                                color = if (overdue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (task.calendarEventId != null) {
                                Spacer(Modifier.width(6.dp))
                                Icon(Icons.Rounded.Event, "Im Kalender", Modifier.size(13.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (task.notes.isNotBlank() && !compact) {
                        Text(task.notes, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (showDivider) HorizontalDivider(Modifier.padding(start = 52.dp), thickness = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** Runder Haken mit großer Tippfläche (48 dp). */
@Composable
private fun CheckCircle(checked: Boolean, size: Dp, onClick: () -> Unit) {
    val fill by animateColorAsState(if (checked) MaterialTheme.colorScheme.primary else Color.Transparent, label = "fill")
    val ring by animateColorAsState(if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, label = "ring")
    Box(Modifier.size(size).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(22.dp).clip(CircleShape).background(fill).border(1.5.dp, ring, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) Icon(Icons.Rounded.Check, "Erledigt", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(15.dp))
        }
    }
}

@Composable
private fun EmptyState(hasEvents: Boolean) {
    Column(Modifier.fillMaxWidth().padding(top = if (hasEvents) 40.dp else 96.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Rounded.TaskAlt, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(16.dp))
        Text("Keine Aufgaben", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text("Tippe unten auf „Neue Aufgabe“ oder nutze das Mikrofon und sag, was ansteht.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center)
    }
}

/** Eingabeleiste unten: Feld zum Eintippen, Mikrofon zum Sprechen. */
@Composable
private fun InputBar(onPlus: () -> Unit, onMic: () -> Unit) {
    Column(Modifier.background(MaterialTheme.colorScheme.background)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                onClick = onPlus, shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceContainer,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.weight(1f).height(50.dp),
            ) {
                Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Add, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Neue Aufgabe", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                }
            }
            Spacer(Modifier.width(10.dp))
            FilledIconButton(onClick = onMic, modifier = Modifier.size(50.dp), shape = RoundedCornerShape(14.dp)) {
                Icon(Icons.Rounded.Mic, "Aufgabe sprechen")
            }
        }
    }
}

/** Termine aus dem Kalender als waagrechte Leiste. */
@Composable
private fun EventStrip(events: List<CalendarEvent>, today: LocalDate, onOpen: (CalendarEvent) -> Unit) {
    Column(Modifier.padding(top = 10.dp)) {
        Text("Termine", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(events.take(20), key = { "${it.id}_${it.date}_${it.time}" }) { e ->
                Surface(
                    onClick = { onOpen(e) }, shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.widthIn(min = 132.dp, max = 220.dp),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(3.dp).height(32.dp).clip(CircleShape).background(Color(e.color or 0xFF000000.toInt())))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(e.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                            Text(formatWhen(e.date, e.time, today) ?: "", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

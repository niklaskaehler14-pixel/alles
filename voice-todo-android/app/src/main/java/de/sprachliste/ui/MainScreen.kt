package de.sprachliste.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.sprachliste.data.CalendarEvent
import de.sprachliste.data.Task
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private data class Section(val title: String, val accent: Color, val tasks: List<Task>)

private fun group(tasks: List<Task>, today: LocalDate): List<Section> {
    val open = tasks.filterNot { it.done }
        .sortedWith(compareBy<Task>({ it.date ?: LocalDate.MAX }, { it.time ?: LocalTime.MAX }, { it.createdAt }))
    return listOf(
        Section("Überfällig", Pink, open.filter { it.date != null && it.date < today }),
        Section("Heute", Violet, open.filter { it.date == today }),
        Section("Morgen", Teal, open.filter { it.date == today.plusDays(1) }),
        Section("Demnächst", Amber, open.filter { it.date != null && it.date > today.plusDays(1) }),
        Section("Irgendwann", Color.Gray, open.filter { it.date == null }),
        Section("Erledigt", Color.Gray, tasks.filter { it.done }.sortedByDescending { it.createdAt }),
    ).filter { it.tasks.isNotEmpty() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    tasks: List<Task>,
    events: List<CalendarEvent>,
    snackbar: SnackbarHostState,
    onMic: () -> Unit,
    onPlus: () -> Unit,
    onSettings: () -> Unit,
    onToggle: (Task) -> Unit,
    onEdit: (Task) -> Unit,
    onDelete: (Task) -> Unit,
    onOpenEvent: (CalendarEvent) -> Unit,
) {
    val today = LocalDate.now()
    val sections = remember(tasks, today) { group(tasks, today) }
    val todayAll = tasks.filter { it.date == today }
    val todayDone = todayAll.count { it.done }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = { InputBar(onPlus = onPlus, onMic = onMic) },
    ) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(today.format(DateTimeFormatter.ofPattern("EEEE, d. MMMM", Locale.GERMAN)),
                            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(greeting(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    }
                    IconButton(onClick = onSettings) { Icon(Icons.Rounded.Settings, "Einstellungen") }
                }
            }
            item { ProgressCard(todayDone, todayAll.size) }
            if (events.isNotEmpty()) item { CalendarStrip(events, today, onOpenEvent) }
            if (sections.isEmpty() && events.isEmpty()) item { EmptyState() }
            sections.forEach { sec ->
                item(key = "h_${sec.title}") {
                    Row(Modifier.padding(top = 14.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(sec.accent))
                        Spacer(Modifier.width(8.dp))
                        Text(sec.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.width(6.dp))
                        Text("${sec.tasks.size}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall)
                    }
                }
                items(sec.tasks, key = { it.id }) { t ->
                    SwipeTaskRow(t, sec.accent, today, onToggle, onEdit, onDelete, Modifier.animateItem())
                }
            }
        }
    }
}

private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..10 -> "Guten Morgen ☀️"
    in 11..17 -> "Hallo 👋"
    in 18..22 -> "Guten Abend 🌙"
    else -> "Gute Nacht 🌙"
}

@Composable
private fun ProgressCard(done: Int, total: Int) {
    val p by animateFloatAsState(if (total == 0) 0f else done / total.toFloat(), label = "p")
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(Violet, Color(0xFF9B59F5), Pink)))
            .padding(22.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Dein Tag", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelLarge)
                Text(
                    when {
                        total == 0 -> "Noch nichts geplant"
                        done == total -> "Alles erledigt! 🎉"
                        else -> "$done von $total erledigt"
                    },
                    color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text("Tippe unten auf + oder sag einfach, was ansteht.", color = Color.White.copy(alpha = 0.85f),
                    style = MaterialTheme.typography.bodySmall)
            }
            Box(contentAlignment = Alignment.Center) {
                CircularProgressIndicator(progress = { p }, modifier = Modifier.size(64.dp), color = Color.White,
                    trackColor = Color.White.copy(alpha = 0.25f), strokeWidth = 6.dp)
                Text("${(p * 100).toInt()}%", color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("🎙️", style = MaterialTheme.typography.displayMedium)
        Spacer(Modifier.height(12.dp))
        Text("Deine Liste ist leer", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("Sag z. B. „Ich möchte heute duschen gehen\nund morgen um 10 Mama anrufen“",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeTaskRow(
    task: Task, accent: Color, today: LocalDate,
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
        state = state, modifier = modifier,
        backgroundContent = {
            val toDelete = state.dismissDirection == SwipeToDismissBoxValue.EndToStart
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp))
                    .background(if (toDelete) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer)
                    .padding(horizontal = 24.dp),
                contentAlignment = if (toDelete) Alignment.CenterEnd else Alignment.CenterStart,
            ) { Icon(if (toDelete) Icons.Rounded.Delete else Icons.Rounded.Check, null) }
        },
    ) { TaskCard(task, accent, today, onToggle, onEdit) }
}

@Composable
private fun TaskCard(task: Task, accent: Color, today: LocalDate, onToggle: (Task) -> Unit, onEdit: (Task) -> Unit) {
    val bg by animateColorAsState(
        if (task.done) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer, label = "bg")
    Surface(color = bg, shape = RoundedCornerShape(20.dp), tonalElevation = 1.dp, shadowElevation = if (task.done) 0.dp else 1.dp) {
        Row(Modifier.fillMaxWidth().clickable { onEdit(task) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(26.dp).clip(CircleShape).clickable { onToggle(task) }
                    .background(if (task.done) accent else Color.Transparent)
                    .then(if (task.done) Modifier else Modifier.background(accent.copy(alpha = 0.15f))),
                contentAlignment = Alignment.Center,
            ) {
                if (task.done) Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(task.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    textDecoration = if (task.done) TextDecoration.LineThrough else null,
                    color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                val whenText = formatWhen(task.date, task.time, today)
                if (whenText != null || task.notes.isNotBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (whenText != null) {
                            Icon(Icons.Rounded.Schedule, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.width(4.dp))
                            Text(whenText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (task.calendarEventId != null) {
                            Spacer(Modifier.width(8.dp))
                            Icon(Icons.Rounded.Event, "Im Kalender", Modifier.size(14.dp), tint = accent)
                        }
                    }
                    if (task.notes.isNotBlank()) Text(task.notes, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** Eingabeleiste unten: Plus zum Eintippen, Mikro zum Sprechen. */
@Composable
private fun InputBar(onPlus: () -> Unit, onMic: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp, shadowElevation = 8.dp) {
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                onClick = onPlus, shape = RoundedCornerShape(26.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.weight(1f).height(52.dp),
            ) {
                Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(30.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Violet, Pink))),
                        contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.Add, null, tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text("Aufgabe hinzufügen …", color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyLarge)
                }
            }
            Spacer(Modifier.width(10.dp))
            FilledTonalIconButton(onClick = onMic, modifier = Modifier.size(52.dp)) {
                Icon(Icons.Rounded.Mic, "Aufgabe sprechen")
            }
        }
    }
}

/** Termine aus Google Kalender (Heute/Morgen …) als waagrechte Leiste. */
@Composable
private fun CalendarStrip(events: List<CalendarEvent>, today: LocalDate, onOpen: (CalendarEvent) -> Unit) {
    Column(Modifier.padding(top = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Event, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(6.dp))
            Text("Aus deinem Kalender", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(8.dp))
        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(events.take(20), key = { "${it.id}_${it.date}" }) { e ->
                Surface(onClick = { onOpen(e) }, shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 1.dp,
                    modifier = Modifier.widthIn(min = 140.dp, max = 220.dp)) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(4.dp).height(36.dp).clip(CircleShape).background(Color(e.color or 0xFF000000.toInt())))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(e.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium,
                                style = MaterialTheme.typography.bodyMedium)
                            Text(formatWhen(e.date, e.time, today) ?: "", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

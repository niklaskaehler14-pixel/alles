package de.sprachliste.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import de.sprachliste.VoiceFlow
import kotlinx.coroutines.delay
import de.sprachliste.ai.SpeechState
import de.sprachliste.data.TaskDraft
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import de.sprachliste.ai.LocalParser
import de.sprachliste.data.CalendarInfo
import de.sprachliste.data.Task
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceSheet(
    flow: VoiceFlow, speech: SpeechState,
    onDone: () -> Unit, onCancel: () -> Unit, onAccept: (List<TaskDraft>) -> Unit, onRetry: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onCancel, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp)) {
            when (flow) {
                VoiceFlow.Listening -> Listening(speech, onDone, onCancel)
                is VoiceFlow.Thinking -> {
                    Text("Wird ausgewertet", style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(16.dp))
                    LinearProgressIndicator(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape))
                    Spacer(Modifier.height(16.dp))
                    Text(flow.text.take(240) + if (flow.text.length > 240) " …" else "",
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                }
                is VoiceFlow.Review -> Review(flow, onAccept, onRetry, onCancel)
                VoiceFlow.Idle -> {}
            }
        }
    }
}

@Composable
private fun Listening(speech: SpeechState, onDone: () -> Unit, onCancel: () -> Unit) {
    var seconds by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1000); seconds++ } }
    val level by animateFloatAsState(if (speech.listening) speech.level else 0f, label = "level")

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (speech.error != null) "Aufnahme gestoppt" else "Aufnahme läuft",
            style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text("%d:%02d".format(seconds / 60, seconds % 60), style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Text("Sprich frei – so lange du möchtest. Tippe auf „Fertig“, wenn du durch bist.",
        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(20.dp))

    // Pegelanzeige
    Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically) {
        val weights = listOf(0.35f, 0.6f, 0.85f, 1f, 0.85f, 0.6f, 0.35f)
        weights.forEach { w ->
            Box(Modifier.width(5.dp).height((6 + 34 * level * w).dp).clip(CircleShape)
                .background(if (speech.listening) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline))
        }
    }
    Spacer(Modifier.height(16.dp))
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp, max = 240.dp)) {
        val scroll = rememberScrollState()
        LaunchedEffect(speech.fullText) { scroll.animateScrollTo(scroll.maxValue) }
        Text(speech.fullText.ifBlank { "Zum Beispiel: „Ich muss heute noch duschen und morgen um 9 zum Arzt.“" },
            Modifier.padding(14.dp).verticalScroll(scroll), style = MaterialTheme.typography.bodyLarge,
            color = if (speech.fullText.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
    }
    speech.error?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(20.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f).height(50.dp), shape = RoundedCornerShape(14.dp)) {
            Text("Abbrechen")
        }
        Button(onClick = onDone, modifier = Modifier.weight(1f).height(50.dp), shape = RoundedCornerShape(14.dp)) {
            Text("Fertig")
        }
    }
}

@Composable
private fun Review(flow: VoiceFlow.Review, onAccept: (List<TaskDraft>) -> Unit, onRetry: () -> Unit, onCancel: () -> Unit) {
    val drafts = flow.result.drafts
    val selected = remember(flow) { mutableStateListOf(*drafts.map { true }.toTypedArray()) }
    val count = selected.count { it }
    Text(if (drafts.isEmpty()) "Keine Aufgabe erkannt" else "Erkannte Aufgaben", style = MaterialTheme.typography.titleLarge)
    Text(
        when {
            drafts.isEmpty() -> "Versuch es noch einmal oder tippe die Aufgabe ein."
            else -> flow.result.note ?: "Wähle aus, was übernommen werden soll."
        },
        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(16.dp))
    if (drafts.isNotEmpty()) {
        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                drafts.forEachIndexed { i, d ->
                    Row(Modifier.fillMaxWidth().clickable { selected[i] = !selected[i] }.padding(end = 14.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = selected[i], onCheckedChange = { selected[i] = it })
                        Column(Modifier.weight(1f)) {
                            Text(d.title, style = MaterialTheme.typography.bodyLarge)
                            formatWhen(d.date, d.time)?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                            }
                            if (d.notes.isNotBlank()) Text(d.notes, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (i < drafts.lastIndex) HorizontalDivider(Modifier.padding(start = 48.dp), color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
        Spacer(Modifier.height(20.dp))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = if (drafts.isEmpty()) onCancel else onRetry,
            modifier = Modifier.weight(1f).height(50.dp), shape = RoundedCornerShape(14.dp)) {
            Text(if (drafts.isEmpty()) "Schließen" else "Neu aufnehmen")
        }
        Button(enabled = drafts.isEmpty() || count > 0,
            onClick = { if (drafts.isEmpty()) onRetry() else onAccept(drafts.filterIndexed { i, _ -> selected[i] }) },
            modifier = Modifier.weight(1f).height(50.dp), shape = RoundedCornerShape(14.dp)) {
            Text(when { drafts.isEmpty() -> "Nochmal"; count == 1 -> "1 übernehmen"; else -> "$count übernehmen" })
        }
    }
}

private enum class DateMode { AUTO, TODAY, TOMORROW, PICKED, NONE }

/**
 * Neue Aufgabe eintippen oder bestehende bearbeiten.
 * Beim Tippen wird live erkannt: "ich muss heute noch duschen gehen" → Duschen gehen · Heute.
 * Datum/Uhrzeit lassen sich jederzeit per Chip selbst festlegen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskSheet(
    editing: Task?,
    onDismiss: () -> Unit,
    onSave: (text: String, draft: TaskDraft, autoDetect: Boolean) -> Unit,
    onDelete: (Task) -> Unit,
) {
    val today = LocalDate.now()
    var text by remember { mutableStateOf(editing?.title ?: "") }
    var notes by remember { mutableStateOf(editing?.notes ?: "") }
    var mode by remember { mutableStateOf(
        when {
            editing == null -> DateMode.AUTO
            editing.date == null -> DateMode.NONE
            else -> DateMode.PICKED
        }) }
    var picked by remember { mutableStateOf(editing?.date ?: today) }
    // null = automatisch/keine; manualTime gesetzt = vom Nutzer gewählt
    var manualTime by remember { mutableStateOf(editing?.time) }
    var timeTouched by remember { mutableStateOf(editing != null) }
    var showDate by remember { mutableStateOf(false) }
    var showTime by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    val auto = editing == null
    val parsed = remember(text) { if (auto) LocalParser.parseOne(text, today) else null }
    val multi = remember(text) { auto && LocalParser.parse(text, today).size > 1 }
    val title = (parsed?.title ?: text.trim()).replaceFirstChar { it.uppercase() }
    val date: LocalDate? = when (mode) {
        DateMode.AUTO -> parsed?.date
        DateMode.TODAY -> today
        DateMode.TOMORROW -> today.plusDays(1)
        DateMode.PICKED -> picked
        DateMode.NONE -> null
    }
    val time: LocalTime? = if (date == null) null else if (timeTouched) manualTime else parsed?.time

    LaunchedEffect(Unit) { if (editing == null) focus.requestFocus() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).imePadding()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (editing == null) "Neue Aufgabe" else "Aufgabe bearbeiten",
                    style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (editing != null) IconButton(onClick = { onDelete(editing) }) {
                    Icon(Icons.Rounded.Delete, "Löschen", tint = MaterialTheme.colorScheme.error)
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                text, { text = it }, Modifier.fillMaxWidth().focusRequester(focus),
                placeholder = { Text("z. B. Ich muss heute noch duschen gehen") },
                shape = RoundedCornerShape(14.dp), maxLines = 4,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = {
                    if (title.isNotBlank()) onSave(text, TaskDraft(title, date, time, editing?.durationMin ?: 30, notes), auto && mode == DateMode.AUTO)
                }),
            )
            // Live-Vorschau, was gespeichert wird
            if (auto && text.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (multi) "Mehrere Aufgaben erkannt – du siehst gleich eine Übersicht"
                            else listOfNotNull(title.ifBlank { null }, formatWhen(date, time, today)).joinToString(" · "),
                            color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Text("Wann?", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (auto) FilterChip(mode == DateMode.AUTO, { mode = DateMode.AUTO }, { Text("Automatisch") })
                FilterChip(date == today && mode != DateMode.AUTO, { mode = DateMode.TODAY }, { Text("Heute") })
                FilterChip(date == today.plusDays(1) && mode != DateMode.AUTO, { mode = DateMode.TOMORROW }, { Text("Morgen") })
                FilterChip(mode == DateMode.PICKED && picked != today && picked != today.plusDays(1), { showDate = true },
                    { Text(if (mode == DateMode.PICKED && picked != today && picked != today.plusDays(1)) formatWhen(picked, null, today)!! else "Datum …") },
                    leadingIcon = { Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(16.dp)) })
                FilterChip(mode == DateMode.NONE, { mode = DateMode.NONE }, { Text("Ohne Datum") })
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { if (date == null) { mode = DateMode.TODAY }; showTime = true },
                    label = { Text(time?.let { "%02d:%02d Uhr".format(it.hour, it.minute) } ?: "Uhrzeit") },
                    leadingIcon = { Icon(Icons.Rounded.Schedule, null, Modifier.size(16.dp)) })
                if (time != null) AssistChip(onClick = { manualTime = null; timeTouched = true },
                    label = { Text("Ganztägig") }, leadingIcon = { Icon(Icons.Rounded.Close, null, Modifier.size(16.dp)) })
            }
            if (editing != null) {
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Notiz") },
                    shape = RoundedCornerShape(14.dp), maxLines = 3)
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSave(text, TaskDraft(title, date, time, editing?.durationMin ?: 30, notes), auto && mode == DateMode.AUTO) },
                enabled = title.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
            ) { Text(when { editing != null -> "Speichern"; multi -> "Aufgaben prüfen"; else -> "Hinzufügen" }) }
        }
    }

    if (showDate) {
        val st = rememberDatePickerState(initialSelectedDateMillis =
            (date ?: today).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { showDate = false },
            confirmButton = { TextButton({
                st.selectedDateMillis?.let { picked = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate(); mode = DateMode.PICKED }
                showDate = false }) { Text("OK") } },
            dismissButton = { TextButton({ showDate = false }) { Text("Abbrechen") } }) { DatePicker(st) }
    }
    if (showTime) {
        val st = rememberTimePickerState(time?.hour ?: 18, time?.minute ?: 0, is24Hour = true)
        AlertDialog(onDismissRequest = { showTime = false },
            confirmButton = { TextButton({
                manualTime = LocalTime.of(st.hour, st.minute); timeTouched = true
                if (mode == DateMode.AUTO && parsed?.date == null) mode = DateMode.TODAY
                showTime = false }) { Text("OK") } },
            dismissButton = { TextButton({ showTime = false }) { Text("Abbrechen") } },
            text = { TimePicker(st) })
    }
}

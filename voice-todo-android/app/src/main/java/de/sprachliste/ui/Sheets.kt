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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import de.sprachliste.VoiceFlow
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
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            when (flow) {
                VoiceFlow.Listening -> Listening(speech, onDone, onCancel)
                is VoiceFlow.Thinking -> {
                    Text("Ich sortiere deine Gedanken …", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(24.dp))
                    LinearProgressIndicator(Modifier.fillMaxWidth().clip(CircleShape))
                    Spacer(Modifier.height(16.dp))
                    Text("„${flow.text.take(220)}${if (flow.text.length > 220) " …" else ""}“",
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
                is VoiceFlow.Review -> Review(flow, onAccept, onRetry, onCancel)
                VoiceFlow.Idle -> {}
            }
        }
    }
}

@Composable
private fun Listening(speech: SpeechState, onDone: () -> Unit, onCancel: () -> Unit) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val ring by pulse.animateFloat(1f, 1.25f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "ring")
    val level by animateFloatAsState(speech.level, label = "lvl")

    Text(if (speech.listening) "Ich höre zu …" else "Pause", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text("Rede so lange du willst – tippe auf Fertig, wenn du durch bist.",
        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(28.dp))
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(170.dp)) {
        Box(Modifier.size(150.dp).scale(ring + level * 0.25f).clip(CircleShape).background(Violet.copy(alpha = 0.12f)))
        Box(Modifier.size(120.dp).scale(1f + level * 0.15f).clip(CircleShape).background(Pink.copy(alpha = 0.18f)))
        Box(Modifier.size(92.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Violet, Pink))),
            contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Mic, null, tint = Color.White, modifier = Modifier.size(42.dp))
        }
    }
    Spacer(Modifier.height(20.dp))
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp, max = 220.dp)) {
        val scroll = rememberScrollState()
        LaunchedEffect(speech.fullText) { scroll.animateScrollTo(scroll.maxValue) }
        Text(speech.fullText.ifBlank { "Sag zum Beispiel: „Ich muss heute noch duschen und morgen um 9 zum Arzt.“" },
            Modifier.padding(16.dp).verticalScroll(scroll),
            color = if (speech.fullText.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
    }
    speech.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
    Spacer(Modifier.height(20.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onCancel) { Text("Abbrechen") }
        Button(onClick = onDone) { Icon(Icons.Rounded.Check, null); Spacer(Modifier.width(6.dp)); Text("Fertig") }
    }
}

@Composable
private fun Review(flow: VoiceFlow.Review, onAccept: (List<TaskDraft>) -> Unit, onRetry: () -> Unit, onCancel: () -> Unit) {
    val drafts = flow.result.drafts
    val selected = remember(flow) { mutableStateListOf(*drafts.map { true }.toTypedArray()) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.AutoAwesome, null, tint = Violet)
        Spacer(Modifier.width(8.dp))
        Text(if (drafts.isEmpty()) "Keine Aufgabe erkannt" else "Das habe ich verstanden",
            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
    Text(if (flow.result.usedAi) "Mit KI ausgewertet" else (flow.result.note ?: "Offline ausgewertet · KI-Schlüssel in den Einstellungen"),
        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    Spacer(Modifier.height(16.dp))
    Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        drafts.forEachIndexed { i, d ->
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
                onClick = { selected[i] = !selected[i] }) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = selected[i], onCheckedChange = { selected[i] = it })
                    Column(Modifier.weight(1f)) {
                        Text(d.title, fontWeight = FontWeight.SemiBold)
                        formatWhen(d.date, d.time)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Violet) }
                        if (d.notes.isNotBlank()) Text(d.notes, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(20.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onRetry) { Icon(Icons.Rounded.Mic, null); Spacer(Modifier.width(6.dp)); Text("Nochmal") }
        Button(enabled = selected.any { it }, onClick = { onAccept(drafts.filterIndexed { i, _ -> selected[i] }) }) {
            Text("Übernehmen")
        }
    }
    if (drafts.isEmpty()) TextButton(onClick = onCancel) { Text("Schließen") }
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
                shape = RoundedCornerShape(16.dp), maxLines = 4,
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
                        Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (multi) "Mehrere Aufgaben erkannt – du bekommst gleich eine Vorschau"
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
                if (auto) FilterChip(mode == DateMode.AUTO, { mode = DateMode.AUTO }, { Text("Automatisch") },
                    leadingIcon = { Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(16.dp)) })
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
                    shape = RoundedCornerShape(16.dp), maxLines = 3)
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSave(text, TaskDraft(title, date, time, editing?.durationMin ?: 30, notes), auto && mode == DateMode.AUTO) },
                enabled = title.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(16.dp),
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

@Composable
fun SettingsDialog(
    apiKey: String, calendarOn: Boolean, calendarId: Long, calendars: List<CalendarInfo>, hasCalendarPermission: Boolean,
    onRequestPermission: () -> Unit, onDismiss: () -> Unit, onSave: (String, Boolean, Long) -> Unit,
) {
    var key by remember { mutableStateOf(apiKey) }
    var cal by remember { mutableStateOf(calendarOn) }
    var calId by remember { mutableStateOf(calendars.firstOrNull { it.id == calendarId }?.id ?: calendars.firstOrNull()?.id ?: -1L) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Einstellungen") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Mit Google Kalender verbinden", fontWeight = FontWeight.SemiBold)
                        Text("Aufgaben mit Datum erscheinen als Termin. Abhaken, Ändern und Löschen wird übertragen – " +
                            "und Änderungen im Kalender kommen zurück in die App.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(cal, { cal = it })
                }
                if (cal && !hasCalendarPermission) {
                    OutlinedButton(onClick = onRequestPermission) { Text("Kalenderzugriff erlauben") }
                }
                if (cal && calendars.isNotEmpty()) {
                    Text("In welchen Kalender?", style = MaterialTheme.typography.labelLarge)
                    calendars.forEach { c ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { calId = c.id },
                            verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(calId == c.id, { calId = c.id })
                            Box(Modifier.size(10.dp).clip(CircleShape).background(Color(c.color or 0xFF000000.toInt())))
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text(c.name, style = MaterialTheme.typography.bodyMedium)
                                Text(if (c.isGoogle) "Google · ${c.account}" else c.account,
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (cal && hasCalendarPermission && calendars.none { it.isGoogle }) {
                    Text("Kein Google-Konto gefunden. Füge es unter Android-Einstellungen → Konten hinzu " +
                        "und aktiviere dort „Kalender synchronisieren“.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                HorizontalDivider()
                Text("KI-Auswertung (Claude)", fontWeight = FontWeight.SemiBold)
                Text("Mit einem Anthropic-API-Schlüssel versteht die App auch lange, chaotische Sätze. " +
                    "Ohne Schlüssel wird offline mit einfachen Regeln ausgewertet.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(key, { key = it }, label = { Text("API-Schlüssel (sk-ant-…)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton({ onSave(key, cal, calId) }) { Text("Speichern") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

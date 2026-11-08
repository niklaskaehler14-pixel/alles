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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTaskSheet(onDismiss: () -> Unit, onSave: (TaskDraft) -> Unit) {
    var title by remember { mutableStateOf("") }
    var date by remember { mutableStateOf<LocalDate?>(LocalDate.now()) }
    var time by remember { mutableStateOf<LocalTime?>(null) }
    var showDate by remember { mutableStateOf(false) }
    var showTime by remember { mutableStateOf(false) }
    val today = LocalDate.now()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp)) {
            Text("Neue Aufgabe", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Was steht an?") },
                singleLine = true, shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences))
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(date == today, { date = today }, { Text("Heute") })
                FilterChip(date == today.plusDays(1), { date = today.plusDays(1) }, { Text("Morgen") })
                FilterChip(date != null && date != today && date != today.plusDays(1), { showDate = true },
                    { Text(if (date != null && date != today && date != today.plusDays(1)) formatWhen(date, null)!! else "Datum") },
                    leadingIcon = { Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(18.dp)) })
                FilterChip(date == null, { date = null; time = null }, { Text("Ohne") })
            }
            Spacer(Modifier.height(8.dp))
            AssistChip(onClick = { if (date == null) date = today; showTime = true },
                label = { Text(time?.let { "%02d:%02d Uhr".format(it.hour, it.minute) } ?: "Uhrzeit hinzufügen") },
                leadingIcon = { Icon(Icons.Rounded.Schedule, null, Modifier.size(18.dp)) },
                trailingIcon = if (time != null) ({ Icon(Icons.Rounded.Close, "Uhrzeit entfernen",
                    Modifier.size(18.dp).clip(CircleShape).clickable { time = null }) }) else null)
            Spacer(Modifier.height(20.dp))
            Button(onClick = { onSave(TaskDraft(title.trim().replaceFirstChar { it.uppercase() }, date, time)) },
                enabled = title.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(16.dp)) {
                Text("Hinzufügen")
            }
        }
    }

    if (showDate) {
        val st = rememberDatePickerState(initialSelectedDateMillis =
            (date ?: today).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { showDate = false },
            confirmButton = { TextButton({
                st.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
                showDate = false }) { Text("OK") } },
            dismissButton = { TextButton({ showDate = false }) { Text("Abbrechen") } }) { DatePicker(st) }
    }
    if (showTime) {
        val st = rememberTimePickerState(time?.hour ?: 18, time?.minute ?: 0, is24Hour = true)
        AlertDialog(onDismissRequest = { showTime = false },
            confirmButton = { TextButton({ time = LocalTime.of(st.hour, st.minute); showTime = false }) { Text("OK") } },
            dismissButton = { TextButton({ showTime = false }) { Text("Abbrechen") } },
            text = { TimePicker(st) })
    }
}

@Composable
fun SettingsDialog(apiKey: String, calendar: Boolean, onDismiss: () -> Unit, onSave: (String, Boolean) -> Unit) {
    var key by remember { mutableStateOf(apiKey) }
    var cal by remember { mutableStateOf(calendar) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Einstellungen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("KI-Auswertung (Claude): Mit einem Anthropic-API-Schlüssel versteht die App auch lange, " +
                    "chaotische Sätze. Ohne Schlüssel wird offline mit einfachen Regeln ausgewertet.",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(key, { key = it }, label = { Text("API-Schlüssel (sk-ant-…)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("In Kalender eintragen")
                        Text("Aufgaben mit Datum landen im Google-/Samsung-Kalender",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(cal, { cal = it })
                }
            }
        },
        confirmButton = { TextButton({ onSave(key, cal) }) { Text("Speichern") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

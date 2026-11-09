package de.sprachliste

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import de.sprachliste.data.Task
import de.sprachliste.ui.*
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) vm.startListening() else vm.analyzeDenied()
    }
    private val calendarPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        calendarPermissionTick.intValue++
        vm.syncFromCalendar()
    }
    private val calendarPermissionTick = mutableIntStateOf(0)

    override fun onResume() {
        super.onResume()
        vm.syncFromCalendar() // Änderungen aus Google Kalender übernehmen
    }

    private fun requestCalendar() =
        calendarPermission.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (vm.settings.addToCalendar && !vm.calendar.hasPermission()) requestCalendar()
        if (savedInstanceState == null) handleIntent(intent)

        setContent {
            SprachlisteTheme {
                val tasks by vm.tasks.collectAsStateWithLifecycle()
                val flow by vm.flow.collectAsStateWithLifecycle()
                val speech by vm.speech.state.collectAsStateWithLifecycle()
                val message by vm.message.collectAsStateWithLifecycle()
                val events by vm.events.collectAsStateWithLifecycle()
                val snackbar = remember { SnackbarHostState() }
                val scope = rememberCoroutineScope()
                var sheet by remember { mutableStateOf<EditTarget?>(null) }
                var showSettings by remember { mutableStateOf(false) }
                var confirmClear by remember { mutableStateOf(false) }

                LaunchedEffect(message) {
                    message?.let { snackbar.showSnackbar(it); vm.consumeMessage() }
                }
                val deleteWithUndo: (Task) -> Unit = { t ->
                    vm.delete(t)
                    scope.launch {
                        val r = snackbar.showSnackbar("„${t.title}“ gelöscht", "Rückgängig", duration = SnackbarDuration.Short)
                        if (r == SnackbarResult.ActionPerformed) vm.restore(t)
                    }
                }

                MainScreen(
                    tasks = tasks, events = events, snackbar = snackbar,
                    onMic = ::startVoice, onPlus = { sheet = EditTarget(null) }, onSettings = { showSettings = true },
                    onToggle = vm::toggle, onEdit = { sheet = EditTarget(it) }, onDelete = deleteWithUndo,
                    onClearDone = { confirmClear = true },
                    onOpenEvent = { e -> runCatching { startActivity(vm.calendar.openIntent(e.id)) } },
                )
                if (flow != VoiceFlow.Idle) {
                    VoiceSheet(flow, speech, onDone = vm::finishListening, onCancel = vm::cancelVoice,
                        onAccept = vm::accept, onRetry = { vm.cancelVoice(); startVoice() })
                }
                sheet?.let { st ->
                    TaskSheet(
                        editing = st.editing,
                        onDismiss = { sheet = null },
                        onSave = { text, draft, autoDetect ->
                            sheet = null
                            val e = st.editing
                            if (e == null) vm.submitTyped(text, draft, autoDetect)
                            else vm.save(e.copy(title = draft.title, date = draft.date, time = draft.time, notes = draft.notes))
                        },
                        onDelete = { t -> sheet = null; deleteWithUndo(t) },
                    )
                }
                if (confirmClear) {
                    AlertDialog(
                        onDismissRequest = { confirmClear = false },
                        title = { Text("Erledigte löschen?") },
                        text = { Text("Alle erledigten Aufgaben werden entfernt – auch aus dem Kalender.") },
                        confirmButton = { TextButton({ confirmClear = false; vm.clearDone() }) { Text("Löschen") } },
                        dismissButton = { TextButton({ confirmClear = false }) { Text("Abbrechen") } },
                    )
                }
                if (showSettings) {
                    val tick = calendarPermissionTick.intValue
                    val calendars = remember(tick) { vm.calendars() }
                    SettingsDialog(
                        apiKey = vm.settings.apiKey, calendarOn = vm.settings.addToCalendar,
                        calendarId = vm.settings.calendarId, calendars = calendars,
                        hasCalendarPermission = remember(tick) { vm.calendar.hasPermission() },
                        onRequestPermission = ::requestCalendar,
                        onDismiss = { showSettings = false },
                        onSave = { key, cal, calId ->
                            vm.settings.apiKey = key; vm.settings.addToCalendar = cal; vm.settings.calendarId = calId
                            showSettings = false
                            if (cal && !vm.calendar.hasPermission()) requestCalendar() else vm.syncFromCalendar()
                        },
                    )
                }
            }
        }
    }

    /** Welche Aufgabe gerade im Eingabe-Fenster ist (null = neue Aufgabe). */
    private data class EditTarget(val editing: Task?)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /**
     * Einstiegspunkte von außen:
     * - App-Shortcut / "Hey Google, öffne Sprachliste" mit Sprach-Shortcut → direkt zuhören
     * - Teilen-Menü (Text aus anderen Apps) → auswerten
     * - Deep-Link sprachliste://add?text=… (Google Assistant App Actions, Bixby-Routinen, Tasker …)
     */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        when {
            intent.action == ACTION_VOICE -> startVoice()
            intent.action == Intent.ACTION_SEND && intent.type == "text/plain" ->
                intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let(vm::analyze)
            intent.action == Intent.ACTION_VIEW && intent.data?.scheme == "sprachliste" -> {
                val text = intent.data?.getQueryParameter("text")
                if (text.isNullOrBlank()) startVoice() else vm.analyze(text)
            }
        }
    }

    private fun startVoice() {
        if (granted(Manifest.permission.RECORD_AUDIO)) vm.startListening()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    companion object { const val ACTION_VOICE = "de.sprachliste.action.VOICE" }
}

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
    private val calendarPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (vm.settings.addToCalendar && !granted(Manifest.permission.WRITE_CALENDAR)) {
            calendarPermission.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
        }
        if (savedInstanceState == null) handleIntent(intent)

        setContent {
            SprachlisteTheme {
                val tasks by vm.tasks.collectAsStateWithLifecycle()
                val flow by vm.flow.collectAsStateWithLifecycle()
                val speech by vm.speech.state.collectAsStateWithLifecycle()
                val message by vm.message.collectAsStateWithLifecycle()
                val snackbar = remember { SnackbarHostState() }
                val scope = rememberCoroutineScope()
                var showAdd by remember { mutableStateOf(false) }
                var showSettings by remember { mutableStateOf(false) }

                LaunchedEffect(message) {
                    message?.let { snackbar.showSnackbar(it); vm.consumeMessage() }
                }

                MainScreen(
                    tasks = tasks, snackbar = snackbar,
                    onMic = ::startVoice, onPlus = { showAdd = true }, onSettings = { showSettings = true },
                    onToggle = vm::toggle,
                    onDelete = { t: Task ->
                        vm.delete(t)
                        scope.launch {
                            val r = snackbar.showSnackbar("„${t.title}“ gelöscht", "Rückgängig", duration = SnackbarDuration.Short)
                            if (r == SnackbarResult.ActionPerformed) vm.restore(t)
                        }
                    },
                )
                if (flow != VoiceFlow.Idle) {
                    VoiceSheet(flow, speech, onDone = vm::finishListening, onCancel = vm::cancelVoice,
                        onAccept = vm::accept, onRetry = { vm.cancelVoice(); startVoice() })
                }
                if (showAdd) AddTaskSheet(onDismiss = { showAdd = false }, onSave = { vm.addManual(it); showAdd = false })
                if (showSettings) SettingsDialog(vm.settings.apiKey, vm.settings.addToCalendar,
                    onDismiss = { showSettings = false },
                    onSave = { key, cal ->
                        vm.settings.apiKey = key; vm.settings.addToCalendar = cal; showSettings = false
                        if (cal && !granted(Manifest.permission.WRITE_CALENDAR)) calendarPermission.launch(
                            arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
                    })
            }
        }
    }

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

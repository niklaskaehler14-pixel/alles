package de.sprachliste

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.sprachliste.ai.Extraction
import de.sprachliste.ai.SpeechController
import de.sprachliste.ai.TaskExtractor
import de.sprachliste.data.CalendarSync
import de.sprachliste.data.Settings
import de.sprachliste.data.Task
import de.sprachliste.data.TaskDraft
import de.sprachliste.data.TaskRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface VoiceFlow {
    data object Idle : VoiceFlow
    data object Listening : VoiceFlow
    data class Thinking(val text: String) : VoiceFlow
    data class Review(val text: String, val result: Extraction) : VoiceFlow
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val settings = Settings(app)
    private val repo = TaskRepository(app)
    private val calendar = CalendarSync(app)
    private val extractor = TaskExtractor { settings.apiKey }
    val speech = SpeechController(app)

    val tasks = repo.tasks
    private val _flow = MutableStateFlow<VoiceFlow>(VoiceFlow.Idle)
    val flow = _flow.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    fun consumeMessage() { _message.value = null }

    fun analyzeDenied() { _message.value = "Ohne Mikrofon-Berechtigung kann ich nicht zuhören – nutze das Plus" }

    fun startListening() {
        if (!speech.isAvailable()) {
            _message.value = "Auf diesem Gerät ist keine Spracherkennung verfügbar"
            return
        }
        speech.start()
        _flow.value = VoiceFlow.Listening
    }

    fun finishListening() {
        val text = speech.stop()
        if (text.isBlank()) { cancelVoice(); _message.value = "Nichts verstanden – versuch's nochmal"; return }
        analyze(text)
    }

    /** Text auswerten – auch für geteilten Text oder Sprachassistenten-Übergaben. */
    fun analyze(text: String) {
        _flow.value = VoiceFlow.Thinking(text)
        viewModelScope.launch {
            val result = extractor.extract(text)
            _flow.value = VoiceFlow.Review(text, result)
        }
    }

    fun cancelVoice() { speech.destroy(); speech.reset(); _flow.value = VoiceFlow.Idle }

    fun accept(drafts: List<TaskDraft>) {
        _flow.value = VoiceFlow.Idle
        speech.reset()
        addTasks(drafts.map { it.toTask() })
    }

    fun addManual(draft: TaskDraft) = addTasks(listOf(draft.toTask()))

    private fun addTasks(list: List<Task>) {
        if (list.isEmpty()) return
        viewModelScope.launch {
            val withCal = withContext(Dispatchers.IO) {
                list.map { t -> if (settings.addToCalendar && t.date != null) t.copy(calendarEventId = calendar.insert(t)) else t }
            }
            repo.add(withCal)
            val inCal = withCal.count { it.calendarEventId != null }
            _message.value = buildString {
                append(if (list.size == 1) "Aufgabe hinzugefügt" else "${list.size} Aufgaben hinzugefügt")
                if (inCal > 0) append(" · $inCal im Kalender")
            }
        }
    }

    fun toggle(task: Task) = repo.update(task.copy(done = !task.done))

    fun delete(task: Task) {
        repo.delete(task.id)
        task.calendarEventId?.let { id -> viewModelScope.launch(Dispatchers.IO) { calendar.delete(id) } }
    }

    fun restore(task: Task) = repo.add(listOf(task.copy(calendarEventId = null)))

    override fun onCleared() { speech.destroy() }
}

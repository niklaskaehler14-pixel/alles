package de.sprachliste

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.sprachliste.ai.Extraction
import de.sprachliste.ai.LocalParser
import de.sprachliste.ai.SpeechController
import de.sprachliste.ai.TaskExtractor
import de.sprachliste.data.CalendarEvent
import de.sprachliste.data.CalendarInfo
import de.sprachliste.data.CalendarSync
import de.sprachliste.data.EventState
import de.sprachliste.data.Settings
import de.sprachliste.data.Task
import de.sprachliste.data.TaskDraft
import de.sprachliste.data.TaskRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

sealed interface VoiceFlow {
    data object Idle : VoiceFlow
    data object Listening : VoiceFlow
    data class Thinking(val text: String) : VoiceFlow
    data class Review(val text: String, val result: Extraction) : VoiceFlow
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val settings = Settings(app)
    private val repo = TaskRepository(app)
    val calendar = CalendarSync(app)
    private val extractor = TaskExtractor { settings.apiKey }
    val speech = SpeechController(app)

    val tasks = repo.tasks
    private val _flow = MutableStateFlow<VoiceFlow>(VoiceFlow.Idle)
    val flow = _flow.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    /** Termine aus Google Kalender, die nicht von der App stammen. */
    private val _events = MutableStateFlow<List<CalendarEvent>>(emptyList())
    val events = _events.asStateFlow()

    fun consumeMessage() { _message.value = null }
    fun analyzeDenied() { _message.value = "Für die Aufnahme wird der Mikrofonzugriff benötigt" }

    private val calendarOn get() = settings.addToCalendar && calendar.hasPermission()

    // ---------- Sprache ----------
    fun startListening() {
        if (!speech.isAvailable()) { _message.value = "Auf diesem Gerät ist keine Spracherkennung verfügbar"; return }
        speech.start()
        _flow.value = VoiceFlow.Listening
    }

    fun finishListening() {
        val text = speech.stop()
        if (text.isBlank()) { cancelVoice(); _message.value = "Es wurde nichts erkannt"; return }
        analyze(text)
    }

    /** Text auswerten (Sprache, getippter Text mit mehreren Aufgaben, Teilen, Assistant). */
    fun analyze(text: String) {
        _flow.value = VoiceFlow.Thinking(text)
        viewModelScope.launch { _flow.value = VoiceFlow.Review(text, extractor.extract(text)) }
    }

    fun cancelVoice() { speech.destroy(); speech.reset(); _flow.value = VoiceFlow.Idle }

    fun accept(drafts: List<TaskDraft>) {
        _flow.value = VoiceFlow.Idle
        speech.reset()
        addTasks(drafts.map { it.toTask() })
    }

    // ---------- Eintippen ----------
    /**
     * Getippter Text: Ein einzelner Satz wird sofort eingetragen. Mehrere Aufgaben in einem
     * Satz (oder lange Texte, wenn die KI aktiv ist) gehen über die Vorschau.
     */
    fun submitTyped(text: String, draft: TaskDraft, autoDetect: Boolean) {
        val many = autoDetect && (LocalParser.parse(text).size > 1 || (settings.apiKey.isNotBlank() && text.length > 80))
        if (many) analyze(text) else addTasks(listOf(draft.toTask()))
    }

    private fun addTasks(list: List<Task>) {
        if (list.isEmpty()) return
        viewModelScope.launch {
            val withCal = withContext(Dispatchers.IO) {
                list.map { t -> if (calendarOn && t.date != null) t.copy(calendarEventId = calendar.insert(t, settings.calendarId)) else t }
            }
            repo.add(withCal)
            val inCal = withCal.count { it.calendarEventId != null }
            _message.value = buildString {
                append(if (list.size == 1) "„${list[0].title}“ hinzugefügt" else "${list.size} Aufgaben hinzugefügt")
                if (inCal > 0) append(" · im Kalender")
            }
            refreshEvents()
        }
    }

    // ---------- Ändern ----------
    fun toggle(task: Task) = save(task.copy(done = !task.done))

    /** Speichert eine geänderte Aufgabe und hält den Kalender-Termin synchron. */
    fun save(task: Task) {
        repo.update(task)
        viewModelScope.launch {
            val synced = withContext(Dispatchers.IO) {
                when {
                    !calendarOn -> task
                    task.date == null -> { task.calendarEventId?.let(calendar::delete); task.copy(calendarEventId = null) }
                    task.calendarEventId != null && calendar.update(task) -> task
                    else -> task.copy(calendarEventId = calendar.insert(task, settings.calendarId))
                }
            }
            if (synced != task) repo.update(synced)
            refreshEvents()
        }
    }

    fun delete(task: Task) {
        repo.delete(task.id)
        task.calendarEventId?.let { id -> viewModelScope.launch(Dispatchers.IO) { calendar.delete(id); refreshEvents() } }
    }

    /** Entfernt alle erledigten Aufgaben (samt ihrer Kalendertermine). */
    fun clearDone() {
        val done = repo.tasks.value.filter { it.done }
        if (done.isEmpty()) return
        repo.replaceAll(repo.tasks.value.filterNot { it.done })
        viewModelScope.launch {
            withContext(Dispatchers.IO) { done.mapNotNull { it.calendarEventId }.forEach(calendar::delete) }
            _message.value = if (done.size == 1) "1 erledigte Aufgabe gelöscht" else "${done.size} erledigte Aufgaben gelöscht"
            refreshEvents()
        }
    }

    fun restore(task: Task) = addTasks(listOf(task.copy(calendarEventId = null)))

    // ---------- Abgleich mit Google Kalender ----------
    /** Übernimmt Änderungen, die im Google Kalender gemacht wurden (verschoben, umbenannt, gelöscht). */
    fun syncFromCalendar() {
        if (!calendar.hasPermission()) return
        viewModelScope.launch {
            val current = repo.tasks.value
            val updated = withContext(Dispatchers.IO) {
                current.map { t ->
                    val id = t.calendarEventId ?: return@map t
                    when (val st = calendar.read(id)) {
                        null -> t
                        EventState.Gone -> t.copy(calendarEventId = null)
                        is EventState.Present -> t.copy(
                            title = st.title.ifBlank { t.title }, date = st.date, time = st.time,
                            durationMin = if (st.time != null) st.durationMin else t.durationMin,
                        )
                    }
                }
            }
            if (updated != current) {
                // Nur Aufgaben ersetzen, die sich währenddessen nicht in der App geändert haben
                val byId = updated.associateBy { it.id }
                val before = current.associateBy { it.id }
                repo.replaceAll(repo.tasks.value.map { t -> if (before[t.id] == t) byId[t.id] ?: t else t })
            }
            refreshEvents()
        }
    }

    fun refreshEvents() {
        viewModelScope.launch {
            val own = repo.tasks.value.mapNotNull { it.calendarEventId }.toSet()
            _events.value = withContext(Dispatchers.IO) {
                calendar.upcoming(LocalDate.now(), 7).filter { it.id !in own }
            }
        }
    }

    fun calendars(): List<CalendarInfo> = calendar.calendars()

    override fun onCleared() { speech.destroy() }
}

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
    private val repo = TaskRepository.get(app)
    val calendar = CalendarSync(app)
    val prefs = settings.prefs
    private val extractor = TaskExtractor { settings.current.apiKey }
    val speech = SpeechController(app)

    val tasks = repo.tasks
    private val _flow = MutableStateFlow<VoiceFlow>(VoiceFlow.Idle)
    val flow = _flow.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    /** Termine aus Google Kalender, die nicht von der App stammen. */
    private val _events = MutableStateFlow<List<CalendarEvent>>(emptyList())
    val events = _events.asStateFlow()

    /** Termine für die Monatsansicht (ohne die von der App selbst angelegten). */
    private val _monthEvents = MutableStateFlow<List<CalendarEvent>>(emptyList())
    val monthEvents = _monthEvents.asStateFlow()
    private var monthStart: LocalDate? = null

    /** Lädt die Termine für das sichtbare Monatsblatt (6 Wochen ab [gridStart]). */
    fun loadMonth(gridStart: LocalDate) {
        monthStart = gridStart
        viewModelScope.launch {
            val own = repo.tasks.value.mapNotNull { it.calendarEventId }.toSet()
            _monthEvents.value = withContext(Dispatchers.IO) { calendar.upcoming(gridStart, 42).filter { it.id !in own } }
        }
    }

    fun consumeMessage() { _message.value = null }
    fun analyzeDenied() { _message.value = "Für die Aufnahme wird der Mikrofonzugriff benötigt" }

    private val calendarOn get() = settings.current.addToCalendar && calendar.hasPermission()

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
        val many = autoDetect && (LocalParser.parse(text).size > 1 || (settings.current.apiKey.isNotBlank() && text.length > 80))
        if (many) analyze(text) else addTasks(listOf(draft.toTask()))
    }

    private fun addTasks(list: List<Task>) {
        if (list.isEmpty()) return
        viewModelScope.launch {
            val withCal = withContext(Dispatchers.IO) {
                list.map { t -> if (calendarOn && t.date != null) t.copy(calendarEventId = calendar.insert(t, settings.current.calendarId, settings.current.reminderMin)) else t }
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
                    else -> task.copy(calendarEventId = calendar.insert(task, settings.current.calendarId, settings.current.reminderMin))
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
            importNewEvents()
            refreshEvents()
        }
    }

    /**
     * Übernimmt neue Termine aus dem gewählten Kalender als Aufgaben – so landet auch das,
     * was per Google Assistant / Gemini in den Kalender gesprochen wurde, in der Liste.
     * Serientermine und bereits übernommene Termine werden ausgelassen.
     */
    private suspend fun importNewEvents() {
        val p = settings.current
        if (!p.addToCalendar || !p.autoImport) return
        val known = settings.importedEventIds
        val own = repo.tasks.value.mapNotNull { it.calendarEventId }.toSet()
        val fresh = withContext(Dispatchers.IO) {
            val target = calendar.resolveCalendarId(p.calendarId) ?: return@withContext emptyList()
            calendar.upcoming(LocalDate.now(), 14)
                .filter { it.calendarId == target && !it.recurring && it.id !in own && it.id !in known }
                .distinctBy { it.id }
        }
        // Beim allerersten Abgleich nur merken, nicht den ganzen Kalender importieren
        if (!settings.importBaselineDone) {
            settings.importedEventIds = known + fresh.map { it.id }
            settings.importBaselineDone = true
            return
        }
        if (fresh.isEmpty()) return
        settings.importedEventIds = known + fresh.map { it.id }
        repo.add(fresh.map { it.toTask() })
        _message.value = if (fresh.size == 1) "„${fresh[0].title}“ aus dem Kalender übernommen"
        else "${fresh.size} Termine aus dem Kalender übernommen"
    }

    private fun CalendarEvent.toTask() = Task(title = title, date = date, time = time, durationMin = durationMin, calendarEventId = id)

    /** Einen Kalendertermin von Hand als Aufgabe übernehmen. */
    fun adopt(event: CalendarEvent) {
        if (repo.tasks.value.any { it.calendarEventId == event.id }) return
        settings.importedEventIds = settings.importedEventIds + event.id
        repo.add(listOf(event.toTask()))
        _message.value = "„${event.title}“ als Aufgabe übernommen"
        refreshEvents()
    }

    fun updatePrefs(change: de.sprachliste.data.Prefs.() -> de.sprachliste.data.Prefs) {
        val before = settings.current
        settings.update(change)
        val now = settings.current
        // Anderer Kalender oder Übernahme neu eingeschaltet: vorhandene Termine nicht nachträglich importieren
        if (now.calendarId != before.calendarId || (now.autoImport && !before.autoImport)) settings.importBaselineDone = false
        if (now.addToCalendar != before.addToCalendar || now.calendarId != before.calendarId || now.autoImport != before.autoImport) syncFromCalendar()
    }

    fun refreshEvents() {
        viewModelScope.launch {
            val own = repo.tasks.value.mapNotNull { it.calendarEventId }.toSet()
            _events.value = withContext(Dispatchers.IO) {
                calendar.upcoming(LocalDate.now(), 7).filter { it.id !in own }
            }
        }
        monthStart?.let(::loadMonth)
    }

    fun calendars(): List<CalendarInfo> = calendar.calendars()

    override fun onCleared() { speech.destroy() }
}

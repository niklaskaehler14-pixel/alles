package de.sprachliste.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray

/** Speichert Aufgaben lokal als JSON (kein Server, keine Cloud). */
class TaskRepository(context: Context) {
    private val prefs = context.getSharedPreferences("tasks", Context.MODE_PRIVATE)
    private val _tasks = MutableStateFlow(load())
    val tasks: StateFlow<List<Task>> = _tasks.asStateFlow()

    private fun load(): List<Task> = try {
        val arr = JSONArray(prefs.getString("list", "[]"))
        List(arr.length()) { Task.fromJson(arr.getJSONObject(it)) }
    } catch (e: Exception) { emptyList() }

    private fun save(list: List<Task>) {
        _tasks.value = list
        val arr = JSONArray().apply { list.forEach { put(it.toJson()) } }
        prefs.edit().putString("list", arr.toString()).apply()
    }

    fun add(tasks: List<Task>) = save(_tasks.value + tasks)
    fun update(task: Task) = save(_tasks.value.map { if (it.id == task.id) task else it })
    fun delete(id: String) = save(_tasks.value.filterNot { it.id == id })
    fun replaceAll(list: List<Task>) = save(list)
}

/** Alle Einstellungen der App als ein unveränderlicher Wert (für die Oberfläche beobachtbar). */
data class Prefs(
    val apiKey: String = "",
    val addToCalendar: Boolean = true,
    /** -1 = automatisch (Google-Hauptkalender). */
    val calendarId: Long = -1L,
    /** Minuten vor dem Termin; 0 = keine Erinnerung. */
    val reminderMin: Int = 15,
    /** Neue Kalendertermine (z. B. per Google Assistant angelegt) als Aufgaben übernehmen. */
    val autoImport: Boolean = true,
    /** 0 = wie System, 1 = hell, 2 = dunkel. */
    val themeMode: Int = 0,
    val accent: Int = 0,
    val dynamicColor: Boolean = false,
    val compact: Boolean = false,
    val showProgress: Boolean = true,
    val showEvents: Boolean = true,
)

class Settings(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val _prefs = MutableStateFlow(load())
    val prefs: StateFlow<Prefs> = _prefs.asStateFlow()
    val current: Prefs get() = _prefs.value

    private fun load() = Prefs(
        apiKey = sp.getString("apiKey", "") ?: "",
        addToCalendar = sp.getBoolean("calendar", true),
        calendarId = sp.getLong("calendarId", -1L),
        reminderMin = sp.getInt("reminderMin", 15),
        autoImport = sp.getBoolean("autoImport", true),
        themeMode = sp.getInt("themeMode", 0),
        accent = sp.getInt("accent", 0),
        dynamicColor = sp.getBoolean("dynamicColor", false),
        compact = sp.getBoolean("compact", false),
        showProgress = sp.getBoolean("showProgress", true),
        showEvents = sp.getBoolean("showEvents", true),
    )

    fun update(change: Prefs.() -> Prefs) {
        val p = _prefs.value.change().let { it.copy(apiKey = it.apiKey.trim()) }
        _prefs.value = p
        sp.edit()
            .putString("apiKey", p.apiKey).putBoolean("calendar", p.addToCalendar).putLong("calendarId", p.calendarId)
            .putInt("reminderMin", p.reminderMin).putBoolean("autoImport", p.autoImport)
            .putInt("themeMode", p.themeMode).putInt("accent", p.accent).putBoolean("dynamicColor", p.dynamicColor)
            .putBoolean("compact", p.compact).putBoolean("showProgress", p.showProgress).putBoolean("showEvents", p.showEvents)
            .apply()
    }

    /** Kalendertermine, die schon einmal als Aufgabe übernommen wurden (kein zweites Mal importieren). */
    var importedEventIds: Set<Long>
        get() = sp.getStringSet("importedEvents", emptySet()).orEmpty().mapNotNull { it.toLongOrNull() }.toSet()
        set(v) = sp.edit().putStringSet("importedEvents", v.map { it.toString() }.toSet()).apply()

    var importBaselineDone: Boolean
        get() = sp.getBoolean("importBaseline", false)
        set(v) = sp.edit().putBoolean("importBaseline", v).apply()
}

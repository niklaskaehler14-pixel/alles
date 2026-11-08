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
}

/** Einfache Einstellungen. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    var apiKey: String
        get() = prefs.getString("apiKey", "") ?: ""
        set(v) = prefs.edit().putString("apiKey", v.trim()).apply()
    var addToCalendar: Boolean
        get() = prefs.getBoolean("calendar", true)
        set(v) = prefs.edit().putBoolean("calendar", v).apply()
}

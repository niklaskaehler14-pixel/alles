package de.sprachliste.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.compose.ui.graphics.toArgb
import de.sprachliste.MainActivity
import de.sprachliste.R
import de.sprachliste.data.CalendarSync
import de.sprachliste.data.Settings
import de.sprachliste.data.TaskRepository
import de.sprachliste.ui.Accents
import de.sprachliste.ui.formatWhen
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Startbildschirm-Widget: offene Aufgaben für heute (und Überfälliges) zum Abhaken,
 * dazu Plus und Mikrofon für neue Aufgaben.
 */
class TaskWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        render(context, manager, id)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_DONE) return
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val repo = TaskRepository.get(context)
        val task = repo.tasks.value.firstOrNull { it.id == id } ?: return
        val done = task.copy(done = true)
        repo.update(done) // aktualisiert auch das Widget
        // Kalendertermin im Hintergrund als erledigt markieren
        if (done.calendarEventId != null && done.date != null) {
            val pending = goAsync()
            Thread {
                try { CalendarSync(context.applicationContext).update(done) } finally { pending.finish() }
            }.start()
        }
    }

    companion object {
        const val ACTION_DONE = "de.sprachliste.widget.DONE"
        const val EXTRA_ID = "id"
        private const val MAX_ROWS = 6
        private val rowIds = intArrayOf(R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5, R.id.row6)
        private val checkIds = intArrayOf(R.id.check1, R.id.check2, R.id.check3, R.id.check4, R.id.check5, R.id.check6)
        private val textIds = intArrayOf(R.id.text1, R.id.text2, R.id.text3, R.id.text4, R.id.text5, R.id.text6)
        private val timeIds = intArrayOf(R.id.time1, R.id.time2, R.id.time3, R.id.time4, R.id.time5, R.id.time6)

        /** Alle Widgets neu zeichnen (nach jeder Änderung an den Aufgaben). */
        fun refresh(context: Context) {
            runCatching {
                val manager = AppWidgetManager.getInstance(context)
                manager.getAppWidgetIds(ComponentName(context, TaskWidgetProvider::class.java))
                    .forEach { render(context, manager, it) }
            }
        }

        private fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val today = LocalDate.now()
            val open = TaskRepository.get(context).tasks.value
                .filter { !it.done && it.date != null && !it.date.isAfter(today) }
                .sortedWith(compareBy({ it.date }, { it.time ?: LocalTime.MAX }, { it.createdAt }))

            // So viele Zeilen, wie in die aktuelle Widget-Höhe passen
            val heightDp = manager.getAppWidgetOptions(widgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
            val fit = ((heightDp - 62) / 34).coerceIn(1, MAX_ROWS)
            val rows = if (open.size > fit) (fit - 1).coerceAtLeast(1) else fit
            val shown = open.take(rows)

            val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            val accent = Accents.getOrElse(Settings(context).current.accent) { Accents[0] }
                .let { if (night) it.dark else it.light }.toArgb()
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

            fun activity(action: String?, code: Int): PendingIntent = PendingIntent.getActivity(
                context, code,
                Intent(context, MainActivity::class.java).setAction(action)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                flags,
            )

            val views = RemoteViews(context.packageName, R.layout.widget_tasks)
            views.setTextViewText(R.id.widget_sub, buildString {
                append(today.format(DateTimeFormatter.ofPattern("EEEE, d. MMMM", Locale.GERMAN)))
                if (open.isNotEmpty()) append(" · ${open.size} offen")
            })
            views.setOnClickPendingIntent(R.id.widget_header, activity(Intent.ACTION_MAIN, 0))
            views.setOnClickPendingIntent(R.id.widget_add, activity(MainActivity.ACTION_ADD, 1))
            views.setOnClickPendingIntent(R.id.widget_mic, activity(MainActivity.ACTION_VOICE, 2))
            views.setInt(R.id.widget_add, "setColorFilter", accent)
            views.setInt(R.id.widget_mic, "setColorFilter", accent)
            views.setViewVisibility(R.id.widget_empty, if (open.isEmpty()) View.VISIBLE else View.GONE)

            for (i in 0 until MAX_ROWS) {
                val task = shown.getOrNull(i)
                views.setViewVisibility(rowIds[i], if (task == null) View.GONE else View.VISIBLE)
                if (task == null) continue
                views.setTextViewText(textIds[i], task.title)
                val overdue = task.date != null && task.date.isBefore(today)
                views.setTextViewText(timeIds[i],
                    if (overdue) formatWhen(task.date, null, today).orEmpty()
                    else task.time?.let { "%02d:%02d".format(it.hour, it.minute) }.orEmpty())
                views.setInt(checkIds[i], "setColorFilter", accent)
                views.setOnClickPendingIntent(checkIds[i], PendingIntent.getBroadcast(
                    context, 100 + i,
                    Intent(context, TaskWidgetProvider::class.java).setAction(ACTION_DONE)
                        .setData(Uri.parse("sprachliste://task/${task.id}")).putExtra(EXTRA_ID, task.id),
                    flags,
                ))
                views.setOnClickPendingIntent(textIds[i], activity(Intent.ACTION_MAIN, 0))
            }

            val more = open.size - shown.size
            views.setViewVisibility(R.id.widget_more, if (more > 0) View.VISIBLE else View.GONE)
            if (more > 0) views.setTextViewText(R.id.widget_more, if (more == 1) "1 weitere Aufgabe" else "$more weitere Aufgaben")
            views.setOnClickPendingIntent(R.id.widget_more, activity(Intent.ACTION_MAIN, 0))

            manager.updateAppWidget(widgetId, views)
        }
    }
}

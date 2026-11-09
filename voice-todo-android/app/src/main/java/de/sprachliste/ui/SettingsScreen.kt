package de.sprachliste.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import de.sprachliste.BuildConfig
import de.sprachliste.data.CalendarInfo
import de.sprachliste.data.Prefs

private enum class Page(val title: String) {
    OVERVIEW("Einstellungen"), LOOK("Darstellung"), CALENDAR("Kalender & Konten"),
    ASSISTANT("Sprachassistent"), RECOGNITION("Texterkennung"),
}

@Composable
fun SettingsScreen(
    prefs: Prefs,
    calendars: List<CalendarInfo>,
    hasCalendarPermission: Boolean,
    onUpdate: (Prefs.() -> Prefs) -> Unit,
    onRequestPermission: () -> Unit,
    onAddAccount: () -> Unit,
    onClose: () -> Unit,
) {
    var pageName by rememberSaveable { mutableStateOf(Page.OVERVIEW.name) }
    val page = Page.valueOf(pageName)
    fun goBack() {
        if (page == Page.OVERVIEW) onClose() else pageName = Page.OVERVIEW.name
    }
    BackHandler { goBack() }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { goBack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Zurück") }
            Text(page.title, style = MaterialTheme.typography.titleLarge)
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            when (page) {
                Page.OVERVIEW -> Overview(prefs, calendars, hasCalendarPermission) { pageName = it.name }
                Page.LOOK -> LookPage(prefs, onUpdate)
                Page.CALENDAR -> CalendarPage(prefs, calendars, hasCalendarPermission, onUpdate, onRequestPermission, onAddAccount)
                Page.ASSISTANT -> AssistantPage(prefs, calendars, hasCalendarPermission) { pageName = Page.CALENDAR.name }
                Page.RECOGNITION -> RecognitionPage(prefs, onUpdate)
            }
        }
    }
}

// ---------- Übersicht ----------

@Composable
private fun Overview(prefs: Prefs, calendars: List<CalendarInfo>, hasPermission: Boolean, open: (Page) -> Unit) {
    val themeName = listOf("Wie System", "Hell", "Dunkel").getOrElse(prefs.themeMode) { "Wie System" }
    val accentName = if (prefs.dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "Farben vom Hintergrundbild"
    else Accents.getOrElse(prefs.accent) { Accents[0] }.name
    val selected = calendars.firstOrNull { it.id == prefs.calendarId } ?: calendars.firstOrNull()
    Group {
        NavRow(Icons.Rounded.Palette, "Darstellung", "$themeName · $accentName") { open(Page.LOOK) }
        RowDivider()
        NavRow(Icons.Rounded.Event, "Kalender & Konten",
            when {
                !prefs.addToCalendar -> "Aus"
                !hasPermission -> "Zugriff fehlt"
                selected != null -> selected.account.ifBlank { selected.name }
                else -> "Kein Kalender gefunden"
            }) { open(Page.CALENDAR) }
        RowDivider()
        NavRow(Icons.Rounded.RecordVoiceOver, "Sprachassistent", "Google Assistant und Gemini") { open(Page.ASSISTANT) }
        RowDivider()
        NavRow(Icons.Rounded.TextFields, "Texterkennung",
            if (prefs.apiKey.isBlank()) "Einfache Erkennung (offline)" else "Erweiterte Erkennung aktiv") { open(Page.RECOGNITION) }
    }
    Text("Sprachliste ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 12.dp))
}

// ---------- Darstellung ----------

@Composable
private fun LookPage(prefs: Prefs, onUpdate: (Prefs.() -> Prefs) -> Unit) {
    val canDynamic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val dynamicOn = canDynamic && prefs.dynamicColor

    GroupTitle("Vorschau")
    Group {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = if (prefs.compact) 10.dp else 16.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Check, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(15.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Beispielaufgabe", style = MaterialTheme.typography.bodyLarge)
                Text("Heute · 18:00 Uhr", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            Button(onClick = {}, shape = RoundedCornerShape(12.dp)) { Text("Button") }
        }
    }

    GroupTitle("Design")
    Group {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Wie System", "Hell", "Dunkel").forEachIndexed { i, label ->
                FilterChip(prefs.themeMode == i, { onUpdate { copy(themeMode = i) } }, { Text(label) })
            }
        }
    }

    GroupTitle("Akzentfarbe")
    Group {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val darkNow = MaterialTheme.colorScheme.background.red < 0.5f
            Accents.forEachIndexed { i, a ->
                val chosen = !dynamicOn && prefs.accent == i
                val c = if (darkNow) a.dark else a.light
                Box(
                    Modifier.size(40.dp).clip(CircleShape)
                        .border(2.dp, if (chosen) c else Color.Transparent, CircleShape)
                        .clickable { onUpdate { copy(accent = i, dynamicColor = false) } },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(30.dp).clip(CircleShape).background(c.copy(alpha = if (dynamicOn) 0.35f else 1f)),
                        contentAlignment = Alignment.Center) {
                        if (chosen) Icon(Icons.Rounded.Check, a.name, tint = if (darkNow) Color(0xFF101114) else Color.White,
                            modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
        if (canDynamic) {
            RowDivider(inset = 14)
            SwitchRow("Farben vom Hintergrundbild", "Übernimmt die Farbpalette deines Geräts", prefs.dynamicColor) {
                onUpdate { copy(dynamicColor = it) }
            }
        }
    }

    GroupTitle("Liste")
    Group {
        SwitchRow("Kompakte Darstellung", "Mehr Aufgaben auf einen Blick", prefs.compact) { onUpdate { copy(compact = it) } }
        RowDivider(inset = 14)
        SwitchRow("Tagesfortschritt anzeigen", null, prefs.showProgress) { onUpdate { copy(showProgress = it) } }
        RowDivider(inset = 14)
        SwitchRow("Termine aus dem Kalender anzeigen", null, prefs.showEvents) { onUpdate { copy(showEvents = it) } }
    }
}

// ---------- Kalender & Konten ----------

@Composable
private fun CalendarPage(
    prefs: Prefs, calendars: List<CalendarInfo>, hasPermission: Boolean,
    onUpdate: (Prefs.() -> Prefs) -> Unit, onRequestPermission: () -> Unit, onAddAccount: () -> Unit,
) {
    Group {
        SwitchRow("Mit Kalender synchronisieren",
            "Aufgaben mit Datum erscheinen als Termin. Änderungen werden in beide Richtungen übernommen.",
            prefs.addToCalendar) { on -> onUpdate { copy(addToCalendar = on) }; if (on && !hasPermission) onRequestPermission() }
    }
    if (!prefs.addToCalendar) return

    if (!hasPermission) {
        Group {
            Column(Modifier.padding(14.dp)) {
                Text("Kalenderzugriff fehlt", style = MaterialTheme.typography.bodyLarge)
                Text("Erlaube den Zugriff, damit Aufgaben in deinen Kalender eingetragen werden können.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(10.dp))
                Button(onClick = onRequestPermission, shape = RoundedCornerShape(12.dp)) { Text("Zugriff erlauben") }
            }
        }
        return
    }

    val selectedId = calendars.firstOrNull { it.id == prefs.calendarId }?.id ?: calendars.firstOrNull()?.id
    calendars.groupBy { it.account to it.isGoogle }.forEach { (key, list) ->
        val (account, isGoogle) = key
        GroupTitle(if (isGoogle) "Google-Konto · $account" else account.ifBlank { "Auf diesem Gerät" })
        Group {
            list.forEachIndexed { i, c ->
                Row(Modifier.fillMaxWidth().clickable { onUpdate { copy(calendarId = c.id) } }.padding(end = 14.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selectedId == c.id, { onUpdate { copy(calendarId = c.id) } })
                    Box(Modifier.size(10.dp).clip(CircleShape).background(Color(c.color or 0xFF000000.toInt())))
                    Spacer(Modifier.width(10.dp))
                    Text(c.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                }
                if (i < list.lastIndex) RowDivider(inset = 48)
            }
        }
    }
    if (calendars.none { it.isGoogle }) {
        Text("Kein Google-Konto mit Kalender gefunden. Füge dein Konto hinzu und aktiviere dort die Kalender-Synchronisierung.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp))
    }
    TextButton(onClick = onAddAccount) {
        Icon(Icons.Rounded.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Google-Konto hinzufügen")
    }

    GroupTitle("Erinnerung bei Aufgaben mit Uhrzeit")
    Group {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(0 to "Keine", 5 to "5 Min.", 15 to "15 Min.", 30 to "30 Min.", 60 to "1 Std.").forEach { (min, label) ->
                FilterChip(prefs.reminderMin == min, { onUpdate { copy(reminderMin = min) } }, { Text(label) })
            }
        }
    }

    GroupTitle("Übernahme")
    Group {
        SwitchRow("Neue Termine als Aufgaben übernehmen",
            "Termine, die du im gewählten Kalender anlegst – auch per Sprachassistent –, erscheinen automatisch in der Liste. " +
                "Serientermine werden ausgelassen.",
            prefs.autoImport) { onUpdate { copy(autoImport = it) } }
    }
}

// ---------- Sprachassistent ----------

@Composable
private fun AssistantPage(prefs: Prefs, calendars: List<CalendarInfo>, hasPermission: Boolean, openCalendar: () -> Unit) {
    val selected = calendars.firstOrNull { it.id == prefs.calendarId } ?: calendars.firstOrNull()
    val ready = prefs.addToCalendar && hasPermission && prefs.autoImport && selected?.isGoogle == true

    GroupTitle("Aufgaben per Google Assistant oder Gemini")
    Group {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Sag zum Beispiel:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("„Hey Google, trag in meinen Kalender ein: morgen um 10 Uhr Zahnarzt.“", style = MaterialTheme.typography.bodyLarge)
            Text("Der Assistent legt den Termin in deinem Google Kalender an. Sprachliste übernimmt ihn beim nächsten Öffnen " +
                "automatisch als Aufgabe.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    Group {
        StatusRow(prefs.addToCalendar && hasPermission, "Kalender-Synchronisierung aktiv")
        RowDivider(inset = 48)
        StatusRow(selected?.isGoogle == true, "Google-Kalender ausgewählt" + (selected?.takeIf { it.isGoogle }?.let { " (${it.account})" } ?: ""))
        RowDivider(inset = 48)
        StatusRow(prefs.autoImport, "Neue Termine werden übernommen")
    }
    if (!ready) {
        Button(onClick = openCalendar, shape = RoundedCornerShape(12.dp)) { Text("Kalender einrichten") }
    }

    GroupTitle("App per Sprache öffnen")
    Group {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("„Hey Google, öffne Sprachliste.“", style = MaterialTheme.typography.bodyLarge)
            Text("Für die Aufnahme ohne Umweg: App-Symbol gedrückt halten und „Sprechen“ wählen. " +
                "Den Eintrag kannst du auch als eigenes Symbol auf den Startbildschirm ziehen.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    Text("Hinweis: Direktes Diktieren in die App per „Hey Google“ erlaubt Google nur Apps aus dem Play Store. " +
        "Der Weg über den Kalender funktioniert ohne diese Einschränkung.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp))
}

// ---------- Texterkennung ----------

@Composable
private fun RecognitionPage(prefs: Prefs, onUpdate: (Prefs.() -> Prefs) -> Unit) {
    var key by remember { mutableStateOf(prefs.apiKey) }
    Group {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Erweiterte Erkennung", style = MaterialTheme.typography.bodyLarge)
            Text("Mit einem Anthropic-API-Schlüssel versteht die App auch lange, freie Sprachaufnahmen und fasst sie zu " +
                "einzelnen Aufgaben zusammen. Ohne Schlüssel arbeitet die einfache Erkennung direkt auf dem Gerät.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(key, { key = it; onUpdate { copy(apiKey = it) } }, label = { Text("API-Schlüssel") },
                singleLine = true, visualTransformation = PasswordVisualTransformation(),
                shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            Text("Der Schlüssel wird nur auf diesem Gerät gespeichert.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ---------- Bausteine ----------

@Composable
private fun Group(content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(content = content)
    }
}

@Composable
private fun GroupTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 14.dp))
}

@Composable
private fun RowDivider(inset: Int = 52) {
    HorizontalDivider(Modifier.padding(start = inset.dp), color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun NavRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, onChange)
    }
}

@Composable
private fun StatusRow(ok: Boolean, text: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (ok) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline, null,
            tint = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

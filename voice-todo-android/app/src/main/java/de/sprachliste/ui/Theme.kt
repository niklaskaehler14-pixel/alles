package de.sprachliste.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

val Violet = Color(0xFF6C4CF1)
val Pink = Color(0xFFE85AAD)
val Teal = Color(0xFF1FB6A6)
val Amber = Color(0xFFF2A93B)

private val Light = lightColorScheme(
    primary = Violet, onPrimary = Color.White,
    primaryContainer = Color(0xFFE8E2FF), onPrimaryContainer = Color(0xFF22106B),
    secondary = Pink, tertiary = Teal,
    background = Color(0xFFF7F6FB), surface = Color(0xFFF7F6FB),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF0EEF7),
)
private val Dark = darkColorScheme(
    primary = Color(0xFFB7A6FF), onPrimary = Color(0xFF2B1579),
    primaryContainer = Color(0xFF3E2BA0), onPrimaryContainer = Color(0xFFE8E2FF),
    secondary = Color(0xFFFF9CCF), tertiary = Color(0xFF6FE0D2),
    background = Color(0xFF121118), surface = Color(0xFF121118),
    surfaceContainer = Color(0xFF1D1B25), surfaceContainerHigh = Color(0xFF27242F),
)

@Composable
fun SprachlisteTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

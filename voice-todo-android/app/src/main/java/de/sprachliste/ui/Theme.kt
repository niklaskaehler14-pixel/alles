package de.sprachliste.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/*
 * Ruhiges, neutrales Farbsystem: warme Grautöne, eine einzige Akzentfarbe.
 * Keine Verläufe, keine wechselnden Systemfarben – die App sieht überall gleich aus.
 */
private val Light = lightColorScheme(
    primary = Color(0xFF1F5FE0), onPrimary = Color.White,
    primaryContainer = Color(0xFFE4ECFD), onPrimaryContainer = Color(0xFF0E2F7A),
    secondary = Color(0xFF4A4F57), onSecondary = Color.White,
    secondaryContainer = Color(0xFFE4ECFD), onSecondaryContainer = Color(0xFF0E2F7A),
    tertiary = Color(0xFF1F5FE0), onTertiary = Color.White,
    background = Color(0xFFF6F6F4), onBackground = Color(0xFF17181A),
    surface = Color(0xFFF6F6F4), onSurface = Color(0xFF17181A),
    surfaceVariant = Color(0xFFECECE9), onSurfaceVariant = Color(0xFF6A6D73),
    surfaceTint = Color(0xFFF6F6F4),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFFBFBFA),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFEFEFEC),
    surfaceContainerHighest = Color(0xFFE8E8E5),
    outline = Color(0xFFB4B6BB), outlineVariant = Color(0xFFE3E3E0),
    error = Color(0xFFC8372D), onError = Color.White,
    errorContainer = Color(0xFFFBE6E3), onErrorContainer = Color(0xFF7A1A13),
    inverseSurface = Color(0xFF26272A), inverseOnSurface = Color(0xFFF3F3F1), inversePrimary = Color(0xFF9DB9FF),
    scrim = Color.Black,
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8FB0FF), onPrimary = Color(0xFF0A2666),
    primaryContainer = Color(0xFF1B3266), onPrimaryContainer = Color(0xFFDCE6FF),
    secondary = Color(0xFFC3C6CC), onSecondary = Color(0xFF1C1D20),
    secondaryContainer = Color(0xFF1B3266), onSecondaryContainer = Color(0xFFDCE6FF),
    tertiary = Color(0xFF8FB0FF), onTertiary = Color(0xFF0A2666),
    background = Color(0xFF111214), onBackground = Color(0xFFECEDEF),
    surface = Color(0xFF111214), onSurface = Color(0xFFECEDEF),
    surfaceVariant = Color(0xFF26282C), onSurfaceVariant = Color(0xFF9A9DA4),
    surfaceTint = Color(0xFF111214),
    surfaceContainerLowest = Color(0xFF0C0D0E), surfaceContainerLow = Color(0xFF191A1D),
    surfaceContainer = Color(0xFF1B1C1F), surfaceContainerHigh = Color(0xFF242629),
    surfaceContainerHighest = Color(0xFF2D2F33),
    outline = Color(0xFF5C5F66), outlineVariant = Color(0xFF2C2E32),
    error = Color(0xFFFF8A80), onError = Color(0xFF5A0F0A),
    errorContainer = Color(0xFF4A1A16), onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFECEDEF), inverseOnSurface = Color(0xFF1B1C1F), inversePrimary = Color(0xFF1F5FE0),
    scrim = Color.Black,
)

private val base = Typography()
private val AppTypography = Typography(
    displaySmall = base.displaySmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    headlineLarge = TextStyle(fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
    titleSmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.2.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
)

@Composable
fun SprachlisteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = AppTypography,
        content = content,
    )
}

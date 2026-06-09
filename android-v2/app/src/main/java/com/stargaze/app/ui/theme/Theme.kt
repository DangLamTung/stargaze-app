package com.stargaze.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = AccentBlue,
    secondary = AccentCyan,
    tertiary = StarYellow,
    background = SkyBlack,
    surface = SkyDarkBlue,
    surfaceVariant = SkyCard,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = SkyBlack,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onSurfaceVariant = TextSecondary,
    outline = SkyCardBorder,
    error = ScoreBad
)

@Composable
fun StarGazeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = Typography(),
        content = content
    )
}

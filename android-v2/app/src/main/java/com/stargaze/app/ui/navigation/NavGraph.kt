package com.stargaze.app.ui.navigation

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object Camera : Screen("camera")
    data object SkyMap : Screen("skymap")
    data object Favorites : Screen("favorites")
    data object Settings : Screen("settings")
}

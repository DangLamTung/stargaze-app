package com.stargaze.app.ui.navigation

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object Camera : Screen("camera")
    data object SkyMap : Screen("skymap?lat={lat}&lon={lon}") {
        fun createRoute(lat: Double, lon: Double) = "skymap?lat=$lat&lon=$lon"
    }
    data object Favorites : Screen("favorites")
    data object Settings : Screen("settings")
}

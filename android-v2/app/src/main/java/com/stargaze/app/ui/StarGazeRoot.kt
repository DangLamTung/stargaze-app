package com.stargaze.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.stargaze.app.ui.navigation.Screen
import com.stargaze.app.ui.screen.HomeScreen
import com.stargaze.app.ui.theme.SkyBlack
import com.stargaze.app.ui.theme.StarGazeTheme
import com.stargaze.app.ui.screen.CameraScreen
import com.stargaze.app.ui.screen.FavoritesScreen
import com.stargaze.app.ui.screen.SettingsScreen
import com.stargaze.app.ui.screen.SkyMapScreen

@Composable
fun StarGazeRoot() {
    StarGazeTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = SkyBlack
        ) {
            val navController = rememberNavController()

            NavHost(
                navController = navController,
                startDestination = Screen.Home.route
            ) {
                composable(Screen.Home.route) {
                    HomeScreen(
                        onNavigateToCamera = { navController.navigate(Screen.Camera.route) },
                        onNavigateToSkyMap = { navController.navigate(Screen.SkyMap.route) },
                        onNavigateToFavorites = { navController.navigate(Screen.Favorites.route) },
                        onNavigateToSettings = { navController.navigate(Screen.Settings.route) }
                    )
                }
                composable(Screen.Camera.route) { CameraScreen(onBack = { navController.popBackStack() }) }
                composable(Screen.SkyMap.route) { SkyMapScreen(onBack = { navController.popBackStack() }) }
                composable(Screen.Favorites.route) { FavoritesScreen(onBack = { navController.popBackStack() }) }
                composable(Screen.Settings.route) { SettingsScreen(onBack = { navController.popBackStack() }) }
            }
        }
    }
}

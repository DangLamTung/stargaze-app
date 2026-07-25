package com.stargaze.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
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
                        onNavigateToSkyMap = { lat, lon ->
                            navController.navigate(Screen.SkyMap.createRoute(lat, lon))
                        },
                        onNavigateToFavorites = { navController.navigate(Screen.Favorites.route) },
                        onNavigateToSettings = { navController.navigate(Screen.Settings.route) }
                    )
                }
                composable(Screen.Camera.route) {
                    CameraScreen(onBack = { navController.popBackStack() })
                }
                composable(
                    route = Screen.SkyMap.route,
                    arguments = listOf(
                        navArgument("lat") { type = NavType.FloatType; defaultValue = 10.762622f },
                        navArgument("lon") { type = NavType.FloatType; defaultValue = 106.660172f }
                    )
                ) { backStackEntry ->
                    val lat = backStackEntry.arguments?.getFloat("lat")?.toDouble() ?: 10.762622
                    val lon = backStackEntry.arguments?.getFloat("lon")?.toDouble() ?: 106.660172
                    SkyMapScreen(
                        onBack = { navController.popBackStack() },
                        latitude = lat,
                        longitude = lon
                    )
                }
                composable(Screen.Favorites.route) {
                    FavoritesScreen(onBack = { navController.popBackStack() })
                }
                composable(Screen.Settings.route) {
                    SettingsScreen(onBack = { navController.popBackStack() })
                }
            }
        }
    }
}

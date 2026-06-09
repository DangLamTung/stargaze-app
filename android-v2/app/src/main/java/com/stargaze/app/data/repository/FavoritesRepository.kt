package com.stargaze.app.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.stargaze.app.data.model.FavoriteLocation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "favorites")

class FavoritesRepository(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private val FAVORITES_KEY = stringPreferencesKey("favorites_json")
    }

    val favoritesFlow: Flow<List<FavoriteLocation>> = context.dataStore.data.map { prefs ->
        val raw = prefs[FAVORITES_KEY] ?: return@map emptyList()
        runCatching { json.decodeFromString<List<FavoriteLocation>>(raw) }.getOrDefault(emptyList())
    }

    suspend fun getFavorites(): List<FavoriteLocation> {
        var result = emptyList<FavoriteLocation>()
        favoritesFlow.collect { result = it; return@collect }
        return result
    }

    suspend fun toggle(location: FavoriteLocation): Boolean {
        val current = getFavorites().toMutableList()
        val existing = current.find {
            kotlin.math.abs(it.latitude - location.latitude) < 0.001 &&
            kotlin.math.abs(it.longitude - location.longitude) < 0.001
        }
        return if (existing != null) {
            current.remove(existing)
            save(current)
            false // removed
        } else {
            current.add(location)
            save(current)
            true // added
        }
    }

    suspend fun isFavorite(lat: Double, lon: Double): Boolean {
        return getFavorites().any {
            kotlin.math.abs(it.latitude - lat) < 0.001 &&
            kotlin.math.abs(it.longitude - lon) < 0.001
        }
    }

    private suspend fun save(list: List<FavoriteLocation>) {
        context.dataStore.edit { prefs ->
            prefs[FAVORITES_KEY] = json.encodeToString(list)
        }
    }
}

package com.stargaze.app.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val context: Context) {

    companion object {
        private val REFRESH_INTERVAL_KEY = intPreferencesKey("refresh_interval_seconds")
        private val MODE_AI_KEY = booleanPreferencesKey("mode_ai_enabled")
        private val DEFAULT_INTERVAL = 3600 // 60 minutes

        val PERMISSION_NOTIFICATIONS = "notifications"
    }

    val refreshIntervalFlow: Flow<Int> = context.settingsDataStore.data.map { prefs ->
        prefs[REFRESH_INTERVAL_KEY] ?: DEFAULT_INTERVAL
    }

    val modeAIFlow: Flow<Boolean> = context.settingsDataStore.data.map { prefs ->
        prefs[MODE_AI_KEY] ?: false
    }

    suspend fun getRefreshInterval(): Int =
        context.settingsDataStore.data.first()[REFRESH_INTERVAL_KEY] ?: DEFAULT_INTERVAL

    suspend fun setRefreshInterval(seconds: Int) {
        context.settingsDataStore.edit { prefs ->
            prefs[REFRESH_INTERVAL_KEY] = seconds
        }
    }

    suspend fun isModeAIEnabled(): Boolean =
        context.settingsDataStore.data.first()[MODE_AI_KEY] ?: false

    suspend fun setModeAIEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { prefs ->
            prefs[MODE_AI_KEY] = enabled
        }
    }
}

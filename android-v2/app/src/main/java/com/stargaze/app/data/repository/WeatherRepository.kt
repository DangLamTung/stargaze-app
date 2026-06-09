package com.stargaze.app.data.repository

import com.stargaze.app.data.api.ApiClient
import com.stargaze.app.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class WeatherRepository {

    private val api = ApiClient.api

    suspend fun getWeather(lat: Double, lon: Double, timezone: String = "auto"): WeatherResponse =
        withContext(Dispatchers.IO) {
            api.getWeather(lat, lon, timezone)
        }

    suspend fun getBortleClass(lat: Double, lon: Double): Int = withContext(Dispatchers.IO) {
        runCatching { api.getBortle(lat, lon).bortleClass }.getOrDefault(5)
    }

    suspend fun searchLocations(query: String, count: Int = 8): List<LocationResult> =
        withContext(Dispatchers.IO) {
            runCatching { api.searchLocations(query, count) }.getOrDefault(emptyList())
        }

    suspend fun reverseGeocode(lat: Double, lon: Double): LocationResult =
        withContext(Dispatchers.IO) {
            api.reverseGeocode(lat, lon)
        }
}

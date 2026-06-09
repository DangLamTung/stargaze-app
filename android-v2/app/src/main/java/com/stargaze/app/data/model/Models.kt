package com.stargaze.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ─── Location ───

@Serializable
data class LocationResult(
    val name: String,
    val country: String = "",
    @SerialName("admin1") val admin1: String = "",
    val latitude: Double,
    val longitude: Double,
    val timezone: String = "auto"
)

// ─── Weather ───

@Serializable
data class WeatherResponse(
    val current: CurrentWeather? = null,
    val hourly: List<HourlyWeather> = emptyList(),
    val daily: List<DailyWeather> = emptyList()
)

@Serializable
data class CurrentWeather(
    val temperature: Double? = null,
    val cloudCover: Double? = null,
    val humidity: Double? = null,
    val visibility: Double? = null,
    val windSpeed: Double? = null,
    val precipitation: Double? = null,
    val weatherCode: Int? = null,
    val isDay: Int? = null,
    val apparentTemperature: Double? = null,
    val windDirection: Double? = null
)

@Serializable
data class HourlyWeather(
    val time: String,
    val temperature: Double? = null,
    val humidity: Double? = null,
    val cloudCover: Double? = null,
    val cloudCoverLow: Double? = null,
    val cloudCoverMid: Double? = null,
    val cloudCoverHigh: Double? = null,
    val visibility: Double? = null,
    val windSpeed: Double? = null,
    val windDirection: Double? = null,
    val precipitationProbability: Double? = null,
    val precipitation: Double? = null,
    val weatherCode: Int? = null,
    val isDay: Int? = null
)

@Serializable
data class DailyWeather(
    val date: String,
    val tempMax: Double? = null,
    val tempMin: Double? = null,
    val sunset: String? = null,
    val sunrise: String? = null,
    val moonPhase: Double = 0.0,
    val moonPhaseName: String = "",
    val moonPhaseIcon: String = "",
    val weatherCode: Int? = null,
    val uvIndexMax: Double? = null,
    val precipitationSum: Double? = null,
    val precipitationProbabilityMax: Double? = null,
    val windSpeedMax: Double? = null
)

// ─── Bortle ───

@Serializable
data class BortleResponse(
    val bortleClass: Int = 5,
    val bortleName: String = ""
)

// ─── Settings ───

@Serializable
data class SettingsResponse(
    val interval: Int = 14400 // seconds
)

@Serializable
data class SettingsBody(
    val interval: Int
)

// ─── Curated Spots ───

@Serializable
data class CuratedSpot(
    val name: String,
    val country: String = "",
    val admin1: String = "",
    val latitude: Double,
    val longitude: Double,
    val bortle: Int? = null
)

// ─── Favorite Location (local storage) ───

data class FavoriteLocation(
    val name: String,
    val country: String = "",
    val latitude: Double,
    val longitude: Double,
    val addedAt: Long = System.currentTimeMillis()
)

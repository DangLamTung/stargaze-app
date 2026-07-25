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
data class OpenMeteoResponse(
    @SerialName("current_units") val currentUnits: CurrentUnits? = null,
    @SerialName("hourly_units") val hourlyUnits: HourlyUnits? = null,
    @SerialName("daily_units") val dailyUnits: DailyUnits? = null,
    val current: OpenMeteoCurrent? = null,
    val hourly: OpenMeteoHourly? = null,
    val daily: OpenMeteoDaily? = null
)

@Serializable
data class CurrentUnits(val time: String)

@Serializable
data class HourlyUnits(val time: String)

@Serializable
data class DailyUnits(val time: String)

@Serializable
data class OpenMeteoCurrent(
    val time: String,
    @SerialName("temperature_2m") val temperature: Double? = null,
    @SerialName("relative_humidity_2m") val humidity: Double? = null,
    @SerialName("apparent_temperature") val apparentTemperature: Double? = null,
    @SerialName("cloud_cover") val cloudCover: Double? = null,
    val visibility: Double? = null,
    @SerialName("wind_speed_10m") val windSpeed: Double? = null,
    @SerialName("wind_direction_10m") val windDirection: Double? = null,
    val precipitation: Double? = null,
    @SerialName("weather_code") val weatherCode: Int? = null,
    @SerialName("is_day") val isDay: Int? = null
)

@Serializable
data class OpenMeteoHourly(
    val time: List<String>,
    @SerialName("temperature_2m") val temperature: List<Double?> = emptyList(),
    @SerialName("relative_humidity_2m") val humidity: List<Double?> = emptyList(),
    @SerialName("cloud_cover") val cloudCover: List<Double?> = emptyList(),
    @SerialName("cloud_cover_low") val cloudCoverLow: List<Double?> = emptyList(),
    @SerialName("cloud_cover_mid") val cloudCoverMid: List<Double?> = emptyList(),
    @SerialName("cloud_cover_high") val cloudCoverHigh: List<Double?> = emptyList(),
    val visibility: List<Double?> = emptyList(),
    @SerialName("wind_speed_10m") val windSpeed: List<Double?> = emptyList(),
    @SerialName("wind_direction_10m") val windDirection: List<Double?> = emptyList(),
    @SerialName("precipitation_probability") val precipitationProbability: List<Double?> = emptyList(),
    val precipitation: List<Double?> = emptyList(),
    @SerialName("weather_code") val weatherCode: List<Int?> = emptyList(),
    @SerialName("is_day") val isDay: List<Int?> = emptyList()
)

@Serializable
data class OpenMeteoDaily(
    val time: List<String>,
    @SerialName("weather_code") val weatherCode: List<Int?> = emptyList(),
    @SerialName("temperature_2m_max") val tempMax: List<Double?> = emptyList(),
    @SerialName("temperature_2m_min") val tempMin: List<Double?> = emptyList(),
    val sunrise: List<String?> = emptyList(),
    val sunset: List<String?> = emptyList(),
    @SerialName("uv_index_max") val uvIndexMax: List<Double?> = emptyList(),
    @SerialName("precipitation_sum") val precipitationSum: List<Double?> = emptyList(),
    @SerialName("precipitation_probability_max") val precipitationProbabilityMax: List<Double?> = emptyList(),
    @SerialName("wind_speed_10m_max") val windSpeedMax: List<Double?> = emptyList()
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

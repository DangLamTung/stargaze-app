package com.stargaze.app.data.repository

import com.stargaze.app.data.api.ApiClient
import com.stargaze.app.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class WeatherRepository {

    private val api = ApiClient.api
    private val openMeteo = ApiClient.openMeteoApi

    suspend fun getWeather(lat: Double, lon: Double, timezone: String = "auto"): WeatherResponse =
        withContext(Dispatchers.IO) {
            val hourlyParams = listOf(
                "temperature_2m", "relative_humidity_2m", "dew_point_2m", "cloud_cover",
                "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
                "wind_speed_10m", "wind_direction_10m", "precipitation_probability",
                "precipitation", "weather_code", "apparent_temperature", "is_day"
            ).joinToString(",")

            val dailyParams = listOf(
                "weather_code", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset",
                "uv_index_max", "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max"
            ).joinToString(",")

            val currentParams = listOf(
                "temperature_2m", "relative_humidity_2m", "apparent_temperature", "cloud_cover",
                "visibility", "wind_speed_10m", "wind_direction_10m", "precipitation",
                "weather_code", "is_day"
            ).joinToString(",")

            val response = openMeteo.getForecast(
                lat = lat,
                lon = lon,
                hourly = hourlyParams,
                daily = dailyParams,
                current = currentParams,
                timezone = timezone
            )

            // Map OpenMeteoResponse to WeatherResponse
            WeatherResponse(
                current = response.current?.let { c ->
                    CurrentWeather(
                        temperature = c.temperature,
                        cloudCover = c.cloudCover,
                        humidity = c.humidity,
                        visibility = c.visibility,
                        windSpeed = c.windSpeed,
                        precipitation = c.precipitation,
                        weatherCode = c.weatherCode,
                        isDay = c.isDay,
                        apparentTemperature = c.apparentTemperature,
                        windDirection = c.windDirection
                    )
                },
                hourly = (response.hourly?.time ?: emptyList()).mapIndexed { i, t ->
                    HourlyWeather(
                        time = t + ":00Z", // Append Z to match Instant.parse
                        temperature = response.hourly?.temperature?.getOrNull(i),
                        humidity = response.hourly?.humidity?.getOrNull(i),
                        cloudCover = response.hourly?.cloudCover?.getOrNull(i),
                        cloudCoverLow = response.hourly?.cloudCoverLow?.getOrNull(i),
                        cloudCoverMid = response.hourly?.cloudCoverMid?.getOrNull(i),
                        cloudCoverHigh = response.hourly?.cloudCoverHigh?.getOrNull(i),
                        visibility = response.hourly?.visibility?.getOrNull(i),
                        windSpeed = response.hourly?.windSpeed?.getOrNull(i),
                        windDirection = response.hourly?.windDirection?.getOrNull(i),
                        precipitationProbability = response.hourly?.precipitationProbability?.getOrNull(i),
                        precipitation = response.hourly?.precipitation?.getOrNull(i),
                        weatherCode = response.hourly?.weatherCode?.getOrNull(i),
                        isDay = response.hourly?.isDay?.getOrNull(i)
                    )
                },
                daily = (response.daily?.time ?: emptyList()).mapIndexed { i, t ->
                    DailyWeather(
                        date = t,
                        tempMax = response.daily?.tempMax?.getOrNull(i),
                        tempMin = response.daily?.tempMin?.getOrNull(i),
                        sunset = response.daily?.sunset?.getOrNull(i)?.let { it + ":00Z" },
                        sunrise = response.daily?.sunrise?.getOrNull(i)?.let { it + ":00Z" },
                        weatherCode = response.daily?.weatherCode?.getOrNull(i),
                        uvIndexMax = response.daily?.uvIndexMax?.getOrNull(i),
                        precipitationSum = response.daily?.precipitationSum?.getOrNull(i),
                        precipitationProbabilityMax = response.daily?.precipitationProbabilityMax?.getOrNull(i),
                        windSpeedMax = response.daily?.windSpeedMax?.getOrNull(i)
                    )
                }
            )
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

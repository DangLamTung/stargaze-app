package com.stargaze.app.data.api

import com.stargaze.app.data.model.*
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * StarGaze backend API.
 * Backend is Python on Fly.io — unchanged from v1.
 */
interface StarGazeApi {

    @GET("api/search")
    suspend fun searchLocations(
        @Query("q") query: String,
        @Query("count") count: Int = 8
    ): List<LocationResult>

    @GET("api/reverse")
    suspend fun reverseGeocode(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double
    ): LocationResult

    @GET("api/weather")
    suspend fun getWeather(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("tz") tz: String = "auto"
    ): WeatherResponse

    @GET("api/bortle")
    suspend fun getBortle(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double
    ): BortleResponse

    @GET("api/curated_spots")
    suspend fun getCuratedSpots(): List<CuratedSpot>

    @GET("api/settings")
    suspend fun getSettings(): SettingsResponse

    @POST("api/settings")
    suspend fun saveSettings(
        @retrofit2.http.Body body: SettingsBody
    ): SettingsResponse
}

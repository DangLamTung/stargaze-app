package com.stargaze.app.data.model

/**
 * A single night's stargazing score with all computed fields.
 * Mirrors the JS calculateAllScores output.
 */
data class NightScore(
    val date: String,
    val dayOfWeek: String,
    val dayOfMonth: Int,
    val month: String,
    val score: Int,
    val rating: String,
    val ratingColor: Long, // ARGB color

    // Component scores
    val cloudCoverScore: Int,
    val moonPhaseScore: Int,
    val humidityScore: Int,
    val visibilityScore: Int,
    val precipScore: Int,

    // Averages for display
    val avgCloudCover: Int?,      // percentage
    val avgHumidity: Int?,        // percentage
    val avgVisibility: Int?,      // meters
    val avgPrecipProb: Int?,      // percentage
    val avgWindSpeed: Int?,       // km/h

    // Moon
    val moonPhase: Double,
    val moonPhaseName: String,
    val moonPhaseIcon: String,

    // Temperature
    val tempMax: Double?,
    val tempMin: Double?,

    // Timing
    val sunset: String?,
    val sunrise: String?,

    // Best viewing window
    val bestViewingTime: String?,
    val bestViewingScore: Int,

    // Hourly breakdown
    val hourlyScores: List<HourlyScore> = emptyList()
)

data class HourlyScore(
    val time: String,
    val score: Int,
    val cloudCover: Double?,
    val cloudCoverLow: Double?,
    val cloudCoverMid: Double?,
    val cloudCoverHigh: Double?,
    val humidity: Double?,
    val visibility: Double?
)

fun getScoreRating(score: Int): String = when {
    score >= 80 -> "Excellent"
    score >= 60 -> "Good"
    score >= 40 -> "Fair"
    score >= 20 -> "Poor"
    else -> "Bad"
}

fun getScoreColor(score: Int): Long = when {
    score >= 80 -> 0xFF00E676L
    score >= 60 -> 0xFF76FF03L
    score >= 40 -> 0xFFFFEB3BL
    score >= 20 -> 0xFFFF9800L
    else -> 0xFFF44336L
}

fun scoreIcon(score: Int): String = when {
    score >= 90 -> "🌟"
    score >= 80 -> "⭐"
    score >= 70 -> "✨"
    score >= 60 -> "🌙"
    score >= 50 -> "🌤️"
    else -> "☁️"
}

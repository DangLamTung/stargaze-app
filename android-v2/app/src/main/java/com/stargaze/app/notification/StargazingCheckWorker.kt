package com.stargaze.app.notification

import android.content.Context
import androidx.work.*
import com.stargaze.app.data.repository.FavoritesRepository
import com.stargaze.app.data.repository.WeatherRepository
import com.stargaze.app.domain.scorer.StargazingScorer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Periodic worker that checks weather + stargazing scores
 * for all favorite locations and sends notifications.
 *
 * Replaces the JS setInterval + Service Worker approach from v1.
 * Runs every {settings.interval} minutes (default 60).
 */
class StargazingCheckWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    private val weatherRepo = WeatherRepository()
    private val favoritesRepo = FavoritesRepository(context)
    private val notificationHelper = NotificationHelper(context)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!notificationHelper.hasPermission()) return@withContext Result.success()

        try {
            val favorites = favoritesRepo.getFavorites()
            if (favorites.isEmpty()) return@withContext Result.success()

            favorites.forEach { fav ->
                runCatching {
                    val weather = weatherRepo.getWeather(fav.latitude, fav.longitude)
                    val bortle = weatherRepo.getBortleClass(fav.latitude, fav.longitude)
                    val observedCloud = weather.current?.cloudCover
                    val scores = StargazingScorer.calculateAllScores(weather, bortle, observedCloud)
                    val body = formatForecastBody(scores)

                    notificationHelper.showForecast(
                        "📍 ${fav.name}",
                        body,
                        "loc-${fav.name.replace(" ", "-")}"
                    )
                }
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "stargazing_periodic_check"

        fun schedule(context: Context, intervalMinutes: Long = 60) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<StargazingCheckWorker>(
                intervalMinutes, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}

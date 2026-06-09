package com.stargaze.app.notification

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.stargaze.app.MainActivity
import com.stargaze.app.StarGazeApp
import com.stargaze.app.data.model.NightScore
import com.stargaze.app.data.model.scoreIcon

class NotificationHelper(private val context: Context) {

    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun hasPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else true

    fun showForecast(title: String, body: String, tag: String = "stargaze_forecast") {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, StarGazeApp.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // TODO: replace with app icon
            .setContentTitle(title)
            .setContentText(body.lines().firstOrNull() ?: body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        manager.notify(tag.hashCode(), notification)
    }
}

/**
 * Format a list of NightScores into notification body text.
 * Mirrors the JS buildForecastBody function.
 */
fun formatForecastBody(scores: List<NightScore>): String {
    val lines = mutableListOf<String>()
    val best = scores.maxByOrNull { it.score }

    best?.let {
        lines.add("${scoreIcon(it.score)} Best: ${it.dayOfWeek} ${it.score}")
    }

    for (s in scores.take(7)) {
        val cloud = s.avgCloudCover?.toString() ?: "?"
        val rain = s.avgPrecipProb?.toString() ?: "?"
        lines.add("${s.dayOfWeek} ☁$cloud% 🌧$rain% ${scoreIcon(s.score)} ${s.score}")
    }

    return lines.joinToString("\n")
}

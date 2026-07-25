package com.stargaze.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class StarGazeApp : Application() {

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "stargaze_forecasts"
        const val NOTIFICATION_CHANNEL_NAME = "Stargazing Forecasts"

        lateinit var instance: StarGazeApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize osmdroid
        org.osmdroid.config.Configuration.getInstance().load(
            this,
            getSharedPreferences("osmdroid", MODE_PRIVATE)
        )
        org.osmdroid.config.Configuration.getInstance().userAgentValue = packageName

        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                NOTIFICATION_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "7-day stargazing forecast alerts for your favorite locations"
                setShowBadge(true)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}

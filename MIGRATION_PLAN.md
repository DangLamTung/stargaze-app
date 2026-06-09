# StarGaze v2 — Kotlin Native Migration Plan

## Current State
- Capacitor hybrid app (WebView wrapping PWA at `stargaze-app.fly.dev`)
- `MainActivity extends BridgeActivity` — zero native code, everything in JS
- Backend: Python on Fly.io (Singapore), REST API at `stargaze-app.fly.dev/api/`
- No camera access, no native sensors beyond what browser gives

## Target: Full Kotlin Android App
- Compose UI, MVVM architecture
- Camera2 API pro mode (manual ISO, shutter, focus, RAW)
- Native sensor fusion (orientation, GPS)
- Same backend API — no backend changes needed

---

## Phase 1: Project Scaffold (Week 1)

### 1.1 New Module Structure
```
android/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml          (add CAMERA, FINE_LOCATION, etc.)
│       ├── java/com/stargaze/app/
│       │   ├── StarGazeApp.kt           (Application class)
│       │   ├── MainActivity.kt          (ComponentActivity, setContent{...})
│       │   ├── di/                       (Manual DI or Hilt module)
│       │   │   └── AppModule.kt
│       │   ├── data/
│       │   │   ├── api/                  (Retrofit interfaces)
│       │   │   │   ├── WeatherApi.kt
│       │   │   │   ├── LocationApi.kt
│       │   │   │   └── SettingsApi.kt
│       │   │   ├── model/                (Data classes)
│       │   │   │   ├── WeatherData.kt
│       │   │   │   ├── StargazingScore.kt
│       │   │   │   ├── Location.kt
│       │   │   │   └── Settings.kt
│       │   │   └── repository/
│       │   │       ├── WeatherRepository.kt
│       │   │       ├── LocationRepository.kt
│       │   │       └── FavoritesRepository.kt
│       │   ├── domain/
│       │   │   ├── scorer/               (Port JS stargazing-score.js)
│       │   │   │   └── StargazingScorer.kt
│       │   │   └── usecase/
│       │   │       ├── GetWeatherUseCase.kt
│       │   │       ├── GetScoresUseCase.kt
│       │   │       └── CheckNotificationsUseCase.kt
│       │   ├── ui/
│       │   │   ├── theme/
│       │   │   │   ├── Theme.kt
│       │   │   │   ├── Color.kt
│       │   │   │   └── Type.kt
│       │   │   ├── navigation/
│       │   │   │   └── NavGraph.kt
│       │   │   ├── screen/
│       │   │   │   ├── HomeScreen.kt      (main dashboard)
│       │   │   │   ├── MapScreen.kt       (Leaflet → osmdroid/Mapbox)
│       │   │   │   ├── SkyMapScreen.kt    (Stellarium → SkyView lib or Kustom)
│       │   │   │   ├── CameraScreen.kt    (pro mode camera)
│       │   │   │   ├── FavoritesScreen.kt
│       │   │   │   └── SettingsScreen.kt
│       │   │   └── component/
│       │   │       ├── WeatherCard.kt
│       │   │       ├── ScoreGauge.kt
│       │   │       ├── ForecastList.kt
│       │   │       └── CompassView.kt
│       │   ├── sensor/
│       │   │   ├── OrientationProvider.kt  (sensor fusion)
│       │   │   └── LocationProvider.kt
│       │   ├── camera/
│       │   │   ├── CameraManager.kt        (Camera2 setup)
│       │   │   ├── ManualControlState.kt   (ISO, shutter, focus state)
│       │   │   └── RawCaptureUseCase.kt    (DNG save pipeline)
│       │   ├── notification/
│       │   │   ├── NotificationHelper.kt
│       │   │   └── AlarmScheduler.kt       (WorkManager for periodic checks)
│       │   └── util/
│       │       ├── MoonPhaseCalculator.kt
│       │       ├── BearingCalculator.kt
│       │       └── Extensions.kt
│       └── res/
│           ├── values/strings.xml
│           └── drawable/ (icons, splash)
├── build.gradle.kts              (root — Kotlin DSL)
├── settings.gradle.kts
├── gradle.properties
└── gradle/libs.versions.toml     (version catalog)
```

### 1.2 Key Dependencies (libs.versions.toml)
```toml
[versions]
kotlin = "2.1.0"
compose = "1.7.6"
compose-compiler = "1.5.15"
retrofit = "2.11.0"
okhttp = "4.12.0"
kotlinx-serialization = "1.7.3"
work = "2.10.0"
datastore = "1.1.1"
osmdroid = "6.1.20"
coil = "2.7.0"
coroutines = "1.9.0"
lifecycle = "2.8.7"
camera2 = "1.4.1"          # AndroidX Camera2 extensions

[libraries]
retrofit-core = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }
retrofit-kotlinx = { module = "com.squareup.retrofit2:converter-kotlinx-serialization", version.ref = "retrofit" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
osmdroid = { module = "org.osmdroid:osmdroid-android", version.ref = "osmdroid" }
coil = { module = "io.coil-kt:coil-compose", version.ref = "coil" }
work = { module = "androidx.work:work-runtime-ktx", version.ref = "work" }
datastore = { module = "androidx.datastore:datastore-preferences", version.ref = "datastore" }
camera2 = { module = "androidx.camera:camera-camera2", version.ref = "camera2" }
camera-lifecycle = { module = "androidx.camera:camera-lifecycle", version.ref = "camera2" }
camera-view = { module = "androidx.camera:camera-view", version.ref = "camera2" }
lifecycle-runtime = { module = "androidx.lifecycle:lifecycle-runtime-compose", version.ref = "lifecycle" }
lifecycle-viewmodel = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
```

---

## Phase 2: Data Layer (Week 1-2)

### 2.1 API Layer — Retrofit Interfaces

The backend API stays the same. We port the JS fetch calls to Retrofit + kotlinx.serialization.

```kotlin
// WeatherApi.kt
interface WeatherApi {
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
}

// LocationApi.kt
interface LocationApi {
    @GET("api/search")
    suspend fun search(@Query("q") query: String): List<LocationResult>

    @GET("api/reverse")
    suspend fun reverseGeocode(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double
    ): LocationResult
}

// SettingsApi.kt
interface SettingsApi {
    @GET("api/settings")
    suspend fun getSettings(): SettingsResponse

    @POST("api/settings")
    suspend fun saveSettings(@Body body: SettingsBody): SettingsResponse
}
```

### 2.2 Data Models (kotlinx.serialization)
```kotlin
@Serializable
data class WeatherResponse(
    val current: CurrentWeather,
    val hourly: List<HourlyWeather>,
    val daily: List<DailyWeather>
)

@Serializable
data class CurrentWeather(
    val temperature: Double?,
    val cloudCover: Double?,
    val humidity: Double?,
    val visibility: Double?,
    val windSpeed: Double?,
    val precipitation: Double?,
    val weatherCode: Int?
)

@Serializable
data class DailyWeather(
    val date: String,
    val tempMax: Double?,
    val tempMin: Double?,
    val sunset: String?,
    val sunrise: String?,
    val moonPhase: Double,
    val moonPhaseName: String,
    val moonPhaseIcon: String,
    val weatherCode: Int?
)
```

### 2.3 Scorer Port (JS → Kotlin)
Port `stargazing-score.js` logic directly:

```kotlin
object StargazingScorer {
    fun calculateAllScores(
        weatherData: WeatherResponse,
        bortleClass: Int,
        observedCloudPct: Double? = null
    ): List<NightScore> {
        // Same logic as calculateAllScores in JS
        // - filter night hours (sunset → sunrise)
        // - calculateHourlyScore for each
        // - aggregate per night
        // - apply cloud bias correction
    }

    fun calculateHourlyScore(
        hour: HourlyWeather,
        moonPhase: Double,
        bortleClass: Int
    ): Int {
        // Port of calculateHourlyScore with WEIGHTS map
        // cloud(0.45) + moon(0.20) + bortle(0.15) + humidity(0.08) + vis(0.07) + precip(0.05)
        // Penalties for heavy cloud/rain
    }
}
```

### 2.4 Favorites Storage (DataStore)
```kotlin
class FavoritesRepository(private val dataStore: DataStore<Preferences>) {
    val favorites: Flow<List<FavoriteLocation>>

    suspend fun toggle(location: FavoriteLocation): Boolean
    suspend fun isFavorite(lat: Double, lon: Double): Boolean
    suspend fun remove(location: FavoriteLocation)
}
```

---

## Phase 3: Camera Pro Mode (Week 2-3)

### 3.1 Architecture
```
CameraScreen (Compose)
  ├── CameraPreview (AndroidView wrapping TextureView)
  ├── ManualControls (sliders for ISO, shutter, focus, WB)
  ├── CaptureButton (with long-press for burst)
  └── ModeSelector (Pro / Astro / HDR / Normal)

CameraManager (lifecycle-aware)
  ├── Opens Camera2 device
  ├── Creates CaptureSession
  ├── Manages CaptureRequest.Builder
  └── Exposes ManualControlState

ManualControlState (data class)
  ├── iso: Int (100–3200)
  ├── exposureTime: Long (nanoseconds, e.g. 1/8000 to 30s)
  ├── focusDistance: Float (0.0–1.0)
  ├── aeMode: Int (CONTROL_AE_MODE_ON/OFF)
  ├── afMode: Int (CONTROL_AF_MODE_AUTO/OFF)
  └── rawEnabled: Boolean
```

### 3.2 Camera Capability Query
```kotlin
class CameraManager(private val context: Context) {
    suspend fun getCapabilities(): CameraCapabilities {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = manager.cameraIdList.first { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == LENS_FACING_BACK
        }
        val chars = manager.getCameraCharacteristics(cameraId)

        return CameraCapabilities(
            isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE),
            exposureRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE),
            maxAnalogSensitivity = chars.get(CameraCharacteristics.SENSOR_MAX_ANALOG_SENSITIVITY),
            aperture = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES),
            rawSupported = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                ?.contains(REQUEST_AVAILABLE_CAPABILITIES_RAW) ?: false,
            manualExposureSupported = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                ?.contains(REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR) ?: false,
            manualFocusSupported = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                ?.contains(REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING) ?: false,
        )
    }
}
```

### 3.3 RAW/DNG Capture
```kotlin
suspend fun captureRaw(session: CameraCaptureSession, cameraDevice: CameraDevice) {
    val dngCreator = DngCreator(
        cameraDevice.cameraCharacteristics, 
        captureResult
    )
    // Set DNG metadata
    dngCreator.setOrientation(ORIENTATION)
    dngCreator.setDescription("StarGaze Astro Photo")

    val outputDir = context.getExternalFilesDir(Environment.DIRECTORY_DCIM)
    val dngFile = File(outputDir, "stargaze_${System.currentTimeMillis()}.dng")

    dngCreator.writeImage(
        FileOutputStream(dngFile),
        rawImage  // from ImageReader with RAW_SENSOR format
    )
    dngCreator.close()
}
```

### 3.4 Astro Mode (Stacking)
For astrophotography, capture N frames and stack:
```kotlin
class AstroStacker {
    suspend fun captureAndStack(
        cameraManager: CameraManager,
        frameCount: Int = 16,
        exposureMs: Long = 2000L,
        iso: Int = 3200
    ): Bitmap {
        val frames = (1..frameCount).map {
            cameraManager.captureRawFrame(exposureMs, iso)
        }
        return alignAndStack(frames) // Mean/median stacking in OpenCV or custom
    }
}
```

---

## Phase 4: UI Layer — Compose Screens (Week 3-4)

### 4.1 Home Screen Layout
```
┌─────────────────────────────┐
│  🔍 Search bar     ⚙️ ★    │  ← TopBar
├─────────────────────────────┤
│  🗺️ Map View (80% height)  │
│  [Leaflet → osmdroid]       │
│  - Light pollution overlay  │
│  - Cloud satellite overlay  │
│  - Nearby POI markers       │
├─────────────────────────────┤
│  📊 Bottom Sheet            │
│  ┌─────────────────────────┐│
│  │ Now: 78/100 ⭐  Clear   ││  ← Now Score
│  │ ☁️12% 🌡️25° 👁️10km    ││
│  └─────────────────────────┘│
│  ┌──┬──┬──┬──┬──┬──┬──┐    │
│  │Mo│Tu│We│Th│Fr│Sa│Su│    │  ← Forecast quick cards
│  │72│85│60│45│80│90│55│    │
│  └──┴──┴──┴──┴──┴──┴──┘    │
└─────────────────────────────┘
```

### 4.2 Camera Screen
```
┌─────────────────────────────┐
│  [Astro] [Pro] [Normal]    │  ← Mode selector
│  Viewfinder Area            │
│  ┌─────────────────────────┐│
│  │                         ││
│  │    Camera Preview        ││  ← TextureView
│  │    + Overlay grid        ││
│  │    + Star chart overlay  ││  ← Optional AR-like overlay
│  │                         ││
│  └─────────────────────────┘│
│  Manual Controls:           │
│  ISO: ──●────── 3200       │
│  Shutter: ────●─── 15s     │
│  Focus: ──●──────── ∞      │
│  WB: ─────●───── 4500K     │
│  [RAW: ON] [Timer: 3s]     │
│         [ ● ]               │  ← Capture button
└─────────────────────────────┘
```

### 4.3 Map (osmdroid instead of Leaflet)
- Offline-capable tile caching
- Light pollution overlay (VIIRS tiles from same source)
- Cloud satellite animation (Himawari tiles)
- Click to select location, right-click for bearing
- Bearing line from selected location

### 4.4 Sky Map (WebView option or native)
Options:
1. **Embed Stellarium Web Engine in WebView** (simplest — reuse existing JS/WASM)
2. **Use Android's built-in SkyMap library** (not great)
3. **Use skymap.gl via a WebView** (like current approach but lighter)

**Recommendation**: Option 1 — embed the existing Stellarium as a WebView component. It works, it's battle-tested, and it's the best star map engine available.

---

## Phase 5: Notifications & Background (Week 4)

### 5.1 WorkManager Periodic Checks
```kotlin
class StargazingCheckWorker(
    context: Context,
    params: WorkerParameters,
    private val weatherRepo: WeatherRepository,
    private val favoritesRepo: FavoritesRepository,
    private val notificationHelper: NotificationHelper
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        // 1. Get all favorite locations
        val locations = favoritesRepo.getAll() + currentLocation

        // 2. For each, fetch weather + calculate scores
        locations.forEach { loc ->
            val weather = weatherRepo.getWeather(loc.lat, loc.lon)
            val scores = StargazingScorer.calculateAllScores(weather, ...)
            val body = formatNotification(scores)

            // 3. Show notification with 7-day forecast
            notificationHelper.show(loc.name, body)
        }
        return Result.success()
    }
}

// Schedule: every {settings.interval} minutes
val workRequest = PeriodicWorkRequestBuilder<StargazingCheckWorker>(
    intervalMinutes, TimeUnit.MINUTES
).build()
WorkManager.getInstance(context).enqueue(workRequest)
```

### 5.2 Notification Channel
```kotlin
class NotificationHelper(private val context: Context) {
    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Stargazing Forecasts",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "7-day stargazing forecast alerts"
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
```

---

## Phase 6: Sensor Fusion (Concurrent with UI)

### 6.1 Orientation Sensor
```kotlin
class OrientationProvider(context: Context) {
    private val sensorManager = context.getSystemService(SENSOR_SERVICE) as SensorManager
    private val rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    data class Orientation(val azimuth: Float, val pitch: Float, val roll: Float)

    fun observe(): Flow<Orientation> = callbackFlow {
        val listener = SensorEventListener { event ->
            val rotationMatrix = FloatArray(9)
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
            val orientation = FloatArray(3)
            SensorManager.getOrientation(rotationMatrix, orientation)
            trySend(Orientation(
                azimuth = Math.toDegrees(orientation[0].toDouble()).toFloat(),
                pitch = Math.toDegrees(orientation[1].toDouble()).toFloat(),
                roll = Math.toDegrees(orientation[2].toDouble()).toFloat()
            ))
        }
        sensorManager.registerListener(listener, rotationVector, SensorManager.SENSOR_DELAY_GAME)
        awaitClose { sensorManager.unregisterListener(listener) }
    }
}
```

### 6.2 Location Provider
```kotlin
class LocationProvider(private val context: Context) {
    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)

    suspend fun getCurrentLocation(): android.location.Location {
        return fusedClient.getCurrentLocation(PRIORITY_HIGH_ACCURACY, null).await()
    }
}
```

---

## Phase 7: Polish & Launch (Week 5)

### 7.1 Remaining Features
| Feature | Implementation |
|---|---|
| Favorites sync | Sync with backend API for cross-device |
| Dark theme | Compose Material3 dark color scheme (default) |
| Offline mode | Room DB cache for weather, DataStore for scores |
| Widget | Home screen widget with tonight's score |
| AR mode | Reuse Stellarium + sensor fusion in WebView |
| Reminder scheduling | AlarmManager for sunset reminders |

### 7.2 Performance Targets
- Cold start < 2s
- Compose recomposition < 16ms
- Camera preview latency < 100ms
- API calls cached aggressively (weather cached 5 min)

---

## Migration Strategy: Incremental, NOT Rewrite

### Approach: Strangler Fig Pattern
Instead of rewriting everything, we migrate screen-by-screen:

1. **Step 1**: Create the Kotlin project alongside Capacitor project
2. **Step 2**: Build HomeScreen (map + weather cards) → first working screen
3. **Step 3**: Add navigation → Settings, Favorites
4. **Step 4**: Add CameraScreen (pro mode) — the main new feature
5. **Step 5**: Add SkyMap (WebView with Stellarium)
6. **Step 6**: Add Notifications via WorkManager
7. **Step 7**: Remove Capacitor, ship pure Kotlin APK

### What Moves, What Stays
| Component | v1 (Current) | v2 (Target) |
|---|---|---|
| Backend | Python/Fly.io | **Same** — no changes |
| API calls | fetch() in JS | Retrofit in Kotlin |
| Weather scoring | JS module | Kotlin object (ported) |
| UI | HTML/CSS | Jetpack Compose |
| Map | Leaflet.js | osmdroid |
| Sky map | Stellarium Web Engine (WASM) | Same, in WebView |
| AR mode | Canvas + sensors | Compose + camera overlay |
| Camera | None | Camera2 API |
| Notifications | Service Worker | WorkManager + NotificationCompat |
| Storage | localStorage | DataStore / Room |
| Location | Geolocation API | FusedLocationProvider |
| Sensors | AbsoluteOrientationSensor | SensorManager (fused) |

---

## File Count Estimate
| Layer | Files |
|---|---|
| Data (API + models + repos) | ~15 |
| Domain (scorer + use cases) | ~8 |
| UI (screens + components) | ~20 |
| Camera (manager + controls + RAW) | ~6 |
| Sensor (orientation + location) | ~3 |
| Notification | ~3 |
| Navigation + DI + theme | ~5 |
| **Total** | **~60 Kotlin files** |

---

## First Step: Scaffold
Run:
```bash
# Create new Kotlin Android project alongside existing
cd /Users/tungdl/Documents/Test
mkdir android-v2
# Use Android Studio project template or manual Gradle files
```

Want me to scaffold the project structure and start with the first files?

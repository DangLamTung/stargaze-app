# StarGaze v2 — Kotlin Migration

## Structure
```
android-v2/
├── build.gradle.kts              # Root build
├── settings.gradle.kts           # Project settings
├── gradle.properties             # Gradle config
├── gradle/
│   └── libs.versions.toml        # Version catalog
└── app/
    ├── build.gradle.kts          # App module
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/
        │   ├── values/themes.xml
        │   ├── values/strings.xml
        │   ├── xml/file_paths.xml
        │   └── mipmap-*/          (launcher icons — TODO)
        └── java/com/stargaze/app/
            ├── StarGazeApp.kt           # Application
            ├── MainActivity.kt          # Entry point
            ├── camera/
            │   └── CameraManager.kt     # Camera2 pro mode
            ├── data/
            │   ├── api/
            │   │   ├── StarGazeApi.kt   # Retrofit API
            │   │   └── ApiClient.kt     # HTTP client
            │   ├── model/
            │   │   ├── Models.kt        # Weather/Location DTOs
            │   │   └── ScoreModels.kt   # Stargazing score types
            │   └── repository/
            │       ├── WeatherRepository.kt
            │       └── FavoritesRepository.kt
            ├── domain/
            │   └── scorer/
            │       └── StargazingScorer.kt  # Ported from JS
            ├── notification/
            │   ├── NotificationHelper.kt
            │   └── StargazingCheckWorker.kt # WorkManager
            └── ui/
                ├── StarGazeRoot.kt       # Root composable
                ├── theme/
                │   ├── Color.kt
                │   └── Theme.kt
                ├── navigation/
                │   └── NavGraph.kt
                └── screen/
                    ├── HomeScreen.kt     # Dashboard
                    └── OtherScreens.kt   # Placeholders
```

## 26 Files (~2800 lines of Kotlin)

### ✅ Implemented Features

1. **HomeScreen** — Full dashboard with:
   - City search (debounced, with dropdown results)
   - Geolocation button (My Location)
   - Now-score card with color-coded rating
   - Quick stats row (temp, cloud, humidity, visibility)
   - 7-day forecast cards with emoji score icons
   - osmdroid map view (interactive, zoom/pinch)
   - Loading/error states
   
2. **CameraScreen** — Pro mode camera with:
   - TextureView live preview (Camera2 API)
   - Auto/Pro mode toggle
   - Manual ISO slider
   - Manual shutter speed slider (with preset labels)
   - Manual focus slider
   - Capture button
   - Runtime permission handling
   
3. **SkyMapScreen** — Stellarium Web Engine:
   - WebView embedding `stargaze-app.fly.dev/test-engine.html`
   - JavaScript + WASM star map with pinch/zoom
   
4. **SettingsScreen** — Full settings:
   - Refresh interval slider (5–240 min)
   - Notification permission request
   - Test notification button
   - Version info

5. **Background notifications** — WorkManager + NotificationHelper

### What still needs production polish:
- [ ] Add real GPS (FusedLocationProvider) in locateMe()
- [ ] Implement photo capture (JPEG + RAW) in CameraScreen
- [ ] Add favorites management screen
- [ ] Add light pollution overlay on osmdroid map
- [ ] Add cloud satellite overlay on osmdroid map
- [ ] Wire refresh interval from Settings to WorkManager
- [ ] Add app icon resources (mipmap-*)

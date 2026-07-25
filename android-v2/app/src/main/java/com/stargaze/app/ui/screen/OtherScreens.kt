package com.stargaze.app.ui.screen

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Environment
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.stargaze.app.data.model.*
import com.stargaze.app.data.repository.FavoritesRepository
import com.stargaze.app.data.repository.SettingsRepository
import com.stargaze.app.data.repository.WeatherRepository
import com.stargaze.app.domain.scorer.StargazingScorer
import com.stargaze.app.notification.NotificationHelper
import com.stargaze.app.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraScreen(onBack: () -> Unit) {
    val context = LocalContext.current

    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasPermission = granted }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pro Camera") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SkyDarkBlue)
            )
        },
        containerColor = SkyBlack
    ) { padding ->
        if (!hasPermission) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Camera permission required", color = TextPrimary, fontSize = 18.sp)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                        Text("Grant Permission")
                    }
                }
            }
        } else {
            CameraXContent(modifier = Modifier.padding(padding))
        }
    }
}

@Composable
private fun CameraXContent(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var captureToast by remember { mutableStateOf<String?>(null) }
    var isCapturing by remember { mutableStateOf(false) }
    var imageCapture by remember { mutableStateOf<androidx.camera.core.ImageCapture?>(null) }
    var camera by remember { mutableStateOf<androidx.camera.core.Camera?>(null) }
    var flashMode by remember { mutableIntStateOf(androidx.camera.core.ImageCapture.FLASH_MODE_OFF) }

    // Camera provider future
    val cameraProviderFuture = remember { androidx.camera.lifecycle.ProcessCameraProvider.getInstance(context) }

    Box(modifier = modifier.fillMaxSize()) {
        // Viewfinder
        AndroidView(
            factory = { ctx ->
                val previewView = androidx.camera.view.PreviewView(ctx).apply {
                    implementationMode = androidx.camera.view.PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = androidx.camera.view.PreviewView.ScaleType.FILL_CENTER
                }

                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()

                    // Preview
                    val preview = androidx.camera.core.Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    // Image capture
                    val capture = androidx.camera.core.ImageCapture.Builder()
                        .setCaptureMode(androidx.camera.core.ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .setTargetRotation(previewView.display?.rotation ?: android.view.Surface.ROTATION_0)
                        .build()
                    imageCapture = capture

                    // Camera selector: back camera
                    val cameraSelector = androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA

                    try {
                        cameraProvider.unbindAll()
                        val cam = cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            cameraSelector,
                            preview,
                            capture
                        )
                        camera = cam
                    } catch (e: Exception) {
                        android.util.Log.e("CameraX", "Failed to bind camera: ${e.message}")
                    }
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Bottom controls overlay
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Flash toggle
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                FilterChip(
                    selected = flashMode == androidx.camera.core.ImageCapture.FLASH_MODE_OFF,
                    onClick = { flashMode = androidx.camera.core.ImageCapture.FLASH_MODE_OFF },
                    label = { Text("⚡ Off", fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AccentCyan.copy(alpha = 0.3f)
                    )
                )
                FilterChip(
                    selected = flashMode == androidx.camera.core.ImageCapture.FLASH_MODE_ON,
                    onClick = { flashMode = androidx.camera.core.ImageCapture.FLASH_MODE_ON },
                    label = { Text("⚡ On", fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = StarYellow.copy(alpha = 0.3f)
                    )
                )
                FilterChip(
                    selected = flashMode == androidx.camera.core.ImageCapture.FLASH_MODE_AUTO,
                    onClick = { flashMode = androidx.camera.core.ImageCapture.FLASH_MODE_AUTO },
                    label = { Text("⚡ Auto", fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = ScoreGood.copy(alpha = 0.3f)
                    )
                )
            }

            // Capture button
            Button(
                onClick = {
                    val capture = imageCapture ?: return@Button
                    if (isCapturing) return@Button
                    isCapturing = true
                    capture.flashMode = flashMode

                    val dir = java.io.File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                        "StarGaze"
                    )
                    dir.mkdirs()
                    val file = java.io.File(dir, "stargaze_${System.currentTimeMillis()}.jpg")
                    val outputOptions = androidx.camera.core.ImageCapture.OutputFileOptions.Builder(file).build()

                    capture.takePicture(
                        outputOptions,
                        ContextCompat.getMainExecutor(context),
                        object : androidx.camera.core.ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(output: androidx.camera.core.ImageCapture.OutputFileResults) {
                                isCapturing = false
                                captureToast = "Saved: ${file.name}"
                            }
                            override fun onError(exception: androidx.camera.core.ImageCaptureException) {
                                isCapturing = false
                                captureToast = "Capture failed: ${exception.message}"
                            }
                        }
                    )
                },
                modifier = Modifier.size(72.dp).clip(CircleShape),
                colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                shape = CircleShape
            ) {
                if (isCapturing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        color = SkyBlack,
                        strokeWidth = 3.dp
                    )
                } else {
                    Box(
                        modifier = Modifier.size(60.dp).clip(CircleShape).background(SkyBlack)
                    )
                }
            }
        }

        // Toast
        captureToast?.let { msg ->
            Snackbar(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 100.dp),
                containerColor = SkyCard
            ) {
                Text(msg, color = TextPrimary)
            }
            LaunchedEffect(msg) {
                kotlinx.coroutines.delay(2500)
                captureToast = null
            }
        }
    }
}

// ─── Sky Map Screen ───
// Uses Stellarium Web (https://stellarium-web.org) which is the same engine
// the web app uses. 100% reliable, no WASM/WebGL compatibility issues.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkyMapScreen(
    onBack: () -> Unit,
    latitude: Double = 10.762622,
    longitude: Double = 106.660172
) {
    var isLoading by remember { mutableStateOf(true) }
    var hasError by remember { mutableStateOf(false) }
    var currentAzimuth by remember { mutableFloatStateOf(0f) }

    val stellariumUrl = remember(latitude, longitude, currentAzimuth) {
        "https://stellarium-web.org/?lat=${"%.4f".format(latitude)}&lng=${"%.4f".format(longitude)}&az=${currentAzimuth.toInt()}&alt=35&fov=60"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Sky Map", fontWeight = FontWeight.Bold)
                        Text(
                            "Lat ${"%.4f".format(latitude)}  Lon ${"%.4f".format(longitude)}",
                            fontSize = 11.sp, color = TextMuted
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                actions = {
                    // Quick azimuth buttons
                    TextButton(onClick = { currentAzimuth = 0f }) {
                        Text("N", color = if (currentAzimuth == 0f) AccentCyan else TextMuted, fontSize = 14.sp)
                    }
                    TextButton(onClick = { currentAzimuth = 90f }) {
                        Text("E", color = if (currentAzimuth == 90f) AccentCyan else TextMuted, fontSize = 14.sp)
                    }
                    TextButton(onClick = { currentAzimuth = 180f }) {
                        Text("S", color = if (currentAzimuth == 180f) AccentCyan else TextMuted, fontSize = 14.sp)
                    }
                    TextButton(onClick = { currentAzimuth = 270f }) {
                        Text("W", color = if (currentAzimuth == 270f) AccentCyan else TextMuted, fontSize = 14.sp)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SkyDarkBlue)
            )
        },
        containerColor = SkyBlack
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            // Stellarium Web in WebView
            AndroidView(
                factory = { ctx ->
                    android.webkit.WebView(ctx).apply {
                        setBackgroundColor(android.graphics.Color.BLACK)
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            mediaPlaybackRequiresUserGesture = false
                            setSupportZoom(true)
                            builtInZoomControls = true
                            displayZoomControls = false
                            loadWithOverviewMode = true
                            useWideViewPort = true
                            setRenderPriority(android.webkit.WebSettings.RenderPriority.HIGH)
                        }

                        webChromeClient = object : android.webkit.WebChromeClient() {
                            override fun onConsoleMessage(msg: android.webkit.ConsoleMessage): Boolean {
                                android.util.Log.d("Stellarium", msg.message())
                                return true
                            }
                        }

                        webViewClient = object : android.webkit.WebViewClient() {
                            override fun onPageFinished(view: android.webkit.WebView, url: String) {
                                isLoading = false
                                hasError = false
                            }

                            override fun onReceivedError(
                                view: android.webkit.WebView,
                                request: android.webkit.WebResourceRequest,
                                error: android.webkit.WebResourceError
                            ) {
                                if (request.isForMainFrame) {
                                    isLoading = false
                                    hasError = true
                                }
                            }

                            @Suppress("DEPRECATION")
                            override fun onReceivedError(
                                view: android.webkit.WebView,
                                errorCode: Int,
                                description: String,
                                failingUrl: String
                            ) {
                                isLoading = false
                                hasError = true
                            }
                        }

                        loadUrl(stellariumUrl)
                    }
                },
                update = { webView ->
                    // Reload when URL changes (azimuth, location)
                    webView.loadUrl(stellariumUrl)
                },
                modifier = Modifier.fillMaxSize()
            )

            // Loading overlay
            if (isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.9f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = AccentCyan, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(16.dp))
                        Text("Loading sky map…", color = TextSecondary, fontSize = 14.sp)
                        Text("via Stellarium Web", color = TextMuted, fontSize = 11.sp)
                    }
                }
            }

            // Error state
            if (hasError) {
                Box(
                    modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.95f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 32.dp)
                    ) {
                        Text("⚠️", fontSize = 48.sp)
                        Spacer(Modifier.height(12.dp))
                        Text("Could not load sky map", color = TextPrimary, fontSize = 16.sp)
                        Text("Check your internet connection", color = TextMuted, fontSize = 13.sp)
                        Spacer(Modifier.height(20.dp))
                        OutlinedButton(
                            onClick = { isLoading = true; hasError = false },
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentCyan)
                        ) { Text("Retry") }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FavoritesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val favoritesRepo = remember { FavoritesRepository(context) }
    val weatherRepo = remember { WeatherRepository() }
    val coroutineScope = rememberCoroutineScope()

    var favorites by remember { mutableStateOf<List<FavoriteLocation>>(emptyList()) }
    var scores by remember { mutableStateOf<Map<String, NightScore?>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(true) }

    // Load favorites
    LaunchedEffect(Unit) {
        favoritesRepo.favoritesFlow.collect { favs ->
            favorites = favs
            if (favs.isEmpty()) isLoading = false
        }
    }

    // Load scores for each favorite
    LaunchedEffect(favorites) {
        if (favorites.isEmpty()) { isLoading = false; return@LaunchedEffect }
        val scoreMap = mutableMapOf<String, com.stargaze.app.data.model.NightScore?>()
        favorites.forEach { fav ->
            try {
                val weather = weatherRepo.getWeather(fav.latitude, fav.longitude)
                val bortle = weatherRepo.getBortleClass(fav.latitude, fav.longitude)
                val observedCloud = weather.current?.cloudCover
                val allScores = StargazingScorer.calculateAllScores(weather, bortle, observedCloud)
                scoreMap[fav.name] = StargazingScorer.findBestNight(allScores)
            } catch (_: Exception) {
                scoreMap[fav.name] = null
            }
        }
        scores = scoreMap
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Favorites") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SkyDarkBlue)
            )
        },
        containerColor = SkyBlack
    ) { padding ->
        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = AccentCyan)
                }
            }
            favorites.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("⭐", fontSize = 48.sp)
                        Spacer(Modifier.height(12.dp))
                        Text("No favorites yet", color = TextSecondary, fontSize = 16.sp)
                        Text("Tap ★ on the home screen to add", color = TextMuted, fontSize = 13.sp)
                    }
                }
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(favorites.size) { idx ->
                        val fav = favorites[idx]
                        val score = scores[fav.name]

                        Card(
                            colors = CardDefaults.cardColors(containerColor = SkyCard),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        fav.name,
                                        color = TextPrimary,
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                    if (fav.country.isNotEmpty()) {
                                        Text(
                                            fav.country,
                                            color = TextMuted,
                                            fontSize = 12.sp
                                        )
                                    }
                                }

                                // Score badge
                                score?.let { s ->
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(scoreIcon(s.score), fontSize = 22.sp)
                                        Text(
                                            "${s.score}",
                                            color = Color(getScoreColor(s.score)),
                                            fontSize = 18.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                        Text(
                                            s.dayOfWeek,
                                            color = TextSecondary,
                                            fontSize = 11.sp
                                        )
                                    }
                                } ?: run {
                                    Text("—", color = TextMuted, fontSize = 14.sp)
                                }

                                // Delete button
                                IconButton(onClick = {
                                    coroutineScope.launch {
                                        favoritesRepo.toggle(fav)
                                    }
                                }) {
                                    Icon(
                                        Icons.Default.Delete,
                                        "Remove",
                                        tint = ScoreBad.copy(alpha = 0.6f)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val settingsRepo = remember { SettingsRepository(context) }
    val notificationHelper = remember { NotificationHelper(context) }

    var intervalMinutes by remember { mutableIntStateOf(60) }
    var hasNotifPermission by remember { mutableStateOf(notificationHelper.hasPermission()) }
    var isModeAIEnabled by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasNotifPermission = granted }

    LaunchedEffect(Unit) {
        intervalMinutes = settingsRepo.getRefreshInterval() / 60
        isModeAIEnabled = settingsRepo.isModeAIEnabled()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SkyDarkBlue)
            )
        },
        containerColor = SkyBlack
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // ─── Refresh Interval ───
            Card(
                colors = CardDefaults.cardColors(containerColor = SkyCard),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Weather Refresh Interval",
                        style = MaterialTheme.typography.titleSmall,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "How often to check weather and send notifications",
                        fontSize = 12.sp,
                        color = TextMuted
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("${intervalMinutes} min", color = AccentCyan, fontSize = 18.sp)
                        Slider(
                            value = intervalMinutes.toFloat(),
                            onValueChange = { intervalMinutes = it.toInt() },
                            valueRange = 5f..240f,
                            steps = 46,
                            modifier = Modifier.weight(1f),
                            colors = SliderDefaults.colors(
                                thumbColor = AccentCyan,
                                activeTrackColor = AccentCyan
                            )
                        )
                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    settingsRepo.setRefreshInterval(intervalMinutes * 60)
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = AccentCyan)
                        ) {
                            Text("Save")
                        }
                    }
                }
            }

            // ─── AI Mode ───
            Card(
                colors = CardDefaults.cardColors(containerColor = SkyCard),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "AI Mode",
                                style = MaterialTheme.typography.titleSmall,
                                color = TextPrimary
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Enable AI-enhanced stargazing insights and predictions",
                                fontSize = 12.sp,
                                color = TextMuted
                            )
                        }
                        Switch(
                            checked = isModeAIEnabled,
                            onCheckedChange = { enabled ->
                                isModeAIEnabled = enabled
                                coroutineScope.launch {
                                    settingsRepo.setModeAIEnabled(enabled)
                                }
                            },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = StarYellow,
                                checkedTrackColor = StarYellow.copy(alpha = 0.5f)
                            )
                        )
                    }
                }
            }

            // ─── Notifications ───
            Card(
                colors = CardDefaults.cardColors(containerColor = SkyCard),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Notifications",
                        style = MaterialTheme.typography.titleSmall,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            if (hasNotifPermission) "✅ Enabled" else "❌ Not granted",
                            color = if (hasNotifPermission) ScoreExcellent else ScoreBad
                        )
                        Button(
                            onClick = {
                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                                    notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                }
                            },
                            enabled = !hasNotifPermission,
                            colors = ButtonDefaults.buttonColors(containerColor = StarYellow)
                        ) {
                            Text("Request Permission", color = SkyBlack)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = {
                            notificationHelper.showForecast(
                                "🔭 StarGaze Test",
                                "⭐ Best: Wed 92\nMon ☁12% 🌧5% ✨ 75\nTue ☁8% 🌧2% 🌟 92",
                                "test"
                            )
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = SkyCardBorder),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Send Test Notification")
                    }
                }
            }

            // ─── About ───
            Card(
                colors = CardDefaults.cardColors(containerColor = SkyCard),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("StarGaze v2.0.0", color = TextPrimary, fontWeight = FontWeight.Bold)
                    Text("Kotlin Native · Camera2 Pro Mode", color = TextMuted, fontSize = 12.sp)
                    Text("Backend: stargaze-app.fly.dev", color = TextMuted, fontSize = 12.sp)
                }
            }
        }
    }
}

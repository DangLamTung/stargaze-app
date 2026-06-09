package com.stargaze.app.ui.screen

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.view.TextureView
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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.stargaze.app.camera.CameraManager
import com.stargaze.app.data.model.*
import com.stargaze.app.data.repository.FavoritesRepository
import com.stargaze.app.data.repository.SettingsRepository
import com.stargaze.app.data.repository.WeatherRepository
import com.stargaze.app.domain.scorer.StargazingScorer
import com.stargaze.app.notification.NotificationHelper
import com.stargaze.app.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var hasPermission by remember { mutableStateOf(
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    )}

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
            CameraContent(modifier = Modifier.padding(padding))
        }
    }
}

@Composable
private fun CameraContent(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var iso by remember { mutableIntStateOf(800) }
    var exposureLabel by remember { mutableStateOf("1/60") }
    var exposureNanos by remember { mutableLongStateOf(16_666_667L) }
    var focusDist by remember { mutableFloatStateOf(0f) }
    var manualMode by remember { mutableStateOf(false) }
    var capabilities by remember { mutableStateOf<CameraManager.CameraCapabilities?>(null) }
    var captureToast by remember { mutableStateOf<String?>(null) }
    var isCapturing by remember { mutableStateOf(false) }

    // Camera thread
    val cameraThread = remember { HandlerThread("CameraThread").apply { start() } }
    val cameraHandler = remember { Handler(cameraThread.looper) }
    var cameraDevice by remember { mutableStateOf<CameraDevice?>(null) }
    var captureSession by remember { mutableStateOf<CameraCaptureSession?>(null) }
    var textureView by remember { mutableStateOf<TextureView?>(null) }

    var previewSurface by remember { mutableStateOf<Surface?>(null) }

    // Camera lifecycle observer with coroutine scope for suspend functions
    val scope = rememberCoroutineScope()
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> scope.launch {
                    openCamera(context, cameraHandler) { dev, caps ->
                        cameraDevice = dev
                        capabilities = caps
                    }
                }
                Lifecycle.Event.ON_PAUSE -> {
                    captureSession?.close()
                    captureSession = null
                    cameraDevice?.close()
                    cameraDevice = null
                    previewSurface = null
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            captureSession?.close()
            cameraDevice?.close()
            previewSurface = null
            cameraThread.quitSafely()
        }
    }

    // Update preview when TextureView is ready
    LaunchedEffect(textureView, cameraDevice) {
        val view = textureView ?: return@LaunchedEffect
        val device = cameraDevice ?: return@LaunchedEffect
        val caps = capabilities ?: return@LaunchedEffect

        // Create JPEG ImageReader
        val jpegReader = ImageReader.newInstance(
            view.width.coerceAtLeast(480), view.height.coerceAtLeast(360),
            ImageFormat.JPEG, 2
        )

        view.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                val surf = Surface(surface)
                previewSurface = surf
                startPreview(device, caps, surf, jpegReader.surface, width, height, cameraHandler) { session ->
                    captureSession = session
                    updateManualSettings(session, device, surf, iso, exposureNanos, focusDist, manualMode, caps, cameraHandler)
                }
            }
            override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {}
            override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                captureSession?.close()
                captureSession = null
                jpegReader.close()
                return true
            }
            override fun onSurfaceTextureUpdated(s: SurfaceTexture) {}
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        // Viewfinder
        AndroidView(
            factory = { ctx ->
                TextureView(ctx).also {
                    textureView = it
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Manual controls overlay at bottom
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.6f))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Device capability badge
            capabilities?.let { caps ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        when {
                            caps.rawSupported -> "📸 RAW Supported"
                            caps.manualExposureSupported -> "📷 Pro Controls"
                            else -> "📱 Basic Camera"
                        },
                        color = if (caps.manualExposureSupported) StarYellow else TextMuted,
                        fontSize = 11.sp
                    )
                }
            }

            // Mode toggle — only show Pro if supported
            if (capabilities?.manualExposureSupported == true) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FilterChip(
                        selected = !manualMode,
                        onClick = { manualMode = false },
                        label = { Text("Auto") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AccentCyan.copy(alpha = 0.3f)
                        )
                    )
                    Spacer(Modifier.width(8.dp))
                    FilterChip(
                        selected = manualMode,
                        onClick = { manualMode = true },
                        label = { Text("Pro") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = StarYellow.copy(alpha = 0.3f)
                        )
                    )
                }
            }

            if (manualMode && capabilities != null) {
                val caps = capabilities!!

                // ISO Slider
                caps.isoRange?.let { range ->
                    ControlSlider(
                        label = "ISO",
                        value = iso,
                        valueRange = range.lower.toFloat()..range.upper.toFloat(),
                        displayValue = iso.toString(),
                        onValueChange = { v ->
                            iso = v.toInt()
                            val session = captureSession
                            val dev = cameraDevice
                            if (session != null && dev != null && previewSurface != null) {
                                updateManualSettings(session, dev, previewSurface!!, iso, exposureNanos, focusDist, true, caps, cameraHandler)
                            }
                        }
                    )
                }

                // Exposure Slider
                caps.exposureRange?.let { range ->
                    val expLabels = listOf("1/8000", "1/2000", "1/500", "1/125", "1/30", "1/8", "2s", "15s", "30s")
                    val expValues = listOf(125_000L, 500_000L, 2_000_000L, 8_000_000L, 33_333_333L, 125_000_000L, 2_000_000_000L, 15_000_000_000L, 30_000_000_000L)
                    ControlSlider(
                        label = "Shutter",
                        value = exposureNanos.toFloat(),
                        valueRange = range.lower.toFloat()..range.upper.toFloat(),
                        displayValue = exposureLabel,
                        onValueChange = { v ->
                            exposureNanos = v.toLong()
                            // Snap to nearest preset label
                            val nearest = expValues.minByOrNull { kotlin.math.abs(it - exposureNanos) }
                            val idx = expValues.indexOf(nearest)
                            if (idx >= 0 && idx < expLabels.size) exposureLabel = expLabels[idx]
                            val session = captureSession
                            val dev = cameraDevice
                            if (session != null && dev != null && previewSurface != null) {
                                updateManualSettings(session, dev, previewSurface!!, iso, exposureNanos, focusDist, true, caps, cameraHandler)
                            }
                        }
                    )
                }

                // Focus Slider
                if (caps.manualFocusSupported) {
                    ControlSlider(
                        label = "Focus",
                        value = focusDist,
                        valueRange = 0f..1f,
                        displayValue = if (focusDist == 0f) "∞" else "${(focusDist * 100).toInt()}cm",
                        onValueChange = { v ->
                            focusDist = v
                            val session = captureSession
                            val dev = cameraDevice
                            if (session != null && dev != null && previewSurface != null) {
                                updateManualSettings(session, dev, previewSurface!!, iso, exposureNanos, focusDist, true, caps, cameraHandler)
                            }
                        }
                    )
                }
            }

            // Capture button
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Button(
                    onClick = {
                        if (isCapturing) return@Button
                        isCapturing = true
                        capturePhoto(
                            device = cameraDevice,
                            session = captureSession,
                            iso = iso,
                            exposureNanos = exposureNanos,
                            focusDist = focusDist,
                            manualMode = manualMode,
                            caps = capabilities,
                            handler = cameraHandler,
                            context = context,
                            onResult = { msg ->
                                isCapturing = false
                                captureToast = msg
                            }
                        )
                    },
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape),
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
                            modifier = Modifier
                                .size(60.dp)
                                .clip(CircleShape)
                                .background(SkyBlack)
                        )
                    }
                }
            }

            // Toast message
            captureToast?.let { msg ->
                Snackbar(
                    modifier = Modifier.padding(bottom = 8.dp),
                    containerColor = SkyCard
                ) {
                    Text(msg, color = TextPrimary)
                }
                LaunchedEffect(msg) {
                    kotlinx.coroutines.delay(2000)
                    captureToast = null
                }
            }
        }
    }
}

@Composable
private fun ControlSlider(
    label: String,
    value: Float,
    valueRange: ClosedFloatingPointRange<Float>,
    displayValue: String,
    onValueChange: (Float) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(label, color = TextSecondary, fontSize = 11.sp, modifier = Modifier.width(50.dp))
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = valueRange,
            modifier = Modifier.weight(1f),
            colors = SliderDefaults.colors(
                thumbColor = StarYellow,
                activeTrackColor = StarYellow
            )
        )
        Text(displayValue, color = TextPrimary, fontSize = 12.sp, modifier = Modifier.width(60.dp))
    }
}

// ─── Camera2 helpers ───

private suspend fun openCamera(
    context: Context,
    handler: Handler,
    onOpened: (CameraDevice, CameraManager.CameraCapabilities) -> Unit
) = withContext(Dispatchers.Main) {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
    val cameraId = manager.cameraIdList.firstOrNull { id ->
        val chars = manager.getCameraCharacteristics(id)
        chars.get(CameraCharacteristics.LENS_FACING) == CameraMetadata.LENS_FACING_BACK
    } ?: return@withContext

    val chars = manager.getCameraCharacteristics(cameraId)
    val capSet = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toSet() ?: emptySet()

    val caps = CameraManager.CameraCapabilities(
        isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE),
        exposureRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE),
        maxAnalogSensitivity = chars.get(CameraCharacteristics.SENSOR_MAX_ANALOG_SENSITIVITY),
        aperture = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES),
        rawSupported = capSet.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW),
        manualExposureSupported = capSet.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR),
        manualFocusSupported = capSet.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING)
    )

    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
        return@withContext

    manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) { onOpened(camera, caps) }
        override fun onDisconnected(camera: CameraDevice) { camera.close() }
        override fun onError(camera: CameraDevice, error: Int) { camera.close() }
    }, handler)
}

private fun startPreview(
    device: CameraDevice,
    caps: CameraManager.CameraCapabilities,
    previewSurface: Surface,
    jpegSurface: Surface,
    width: Int,
    height: Int,
    handler: Handler,
    onConfigured: (CameraCaptureSession) -> Unit
) {
    val surfaces = listOf(previewSurface, jpegSurface)
    val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
        addTarget(previewSurface)
        set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
    }

    device.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(session: CameraCaptureSession) {
            session.setRepeatingRequest(builder.build(), null, handler)
            onConfigured(session)
        }
        override fun onConfigureFailed(session: CameraCaptureSession) {}
    }, handler)
}

private fun updateManualSettings(
    session: CameraCaptureSession,
    device: CameraDevice,
    previewSurface: Surface,
    iso: Int,
    exposureNanos: Long,
    focusDist: Float,
    manualMode: Boolean,
    caps: CameraManager.CameraCapabilities,
    handler: Handler
) {
    val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
        addTarget(previewSurface)
        if (manualMode && caps.manualExposureSupported) {
            set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF)
            set(CaptureRequest.SENSOR_SENSITIVITY, iso)
            set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNanos)
        } else {
            set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON)
        }

        if (caps.manualFocusSupported) {
            set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
            set(CaptureRequest.LENS_FOCUS_DISTANCE, focusDist)
        }
    }
    session.setRepeatingRequest(builder.build(), null, handler)
}

private fun capturePhoto(
    device: CameraDevice?,
    session: CameraCaptureSession?,
    iso: Int,
    exposureNanos: Long,
    focusDist: Float,
    manualMode: Boolean,
    caps: CameraManager.CameraCapabilities?,
    handler: Handler,
    context: Context,
    onResult: (String) -> Unit
) {
    val dev = device ?: run { onResult("Camera not ready"); return }
    val sess = session ?: run { onResult("Session not ready"); return }

    try {
        val builder = dev.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)

        // Apply manual settings if in pro mode
        if (manualMode && caps != null && caps.manualExposureSupported) {
            builder.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF)
            builder.set(CaptureRequest.SENSOR_SENSITIVITY, iso)
            builder.set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNanos)
        }

        if (caps != null && caps.manualFocusSupported) {
            builder.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
            builder.set(CaptureRequest.LENS_FOCUS_DISTANCE, focusDist)
        }

        // Create JPEG ImageReader for this capture
        val jpegReader = ImageReader.newInstance(1920, 1080, ImageFormat.JPEG, 1)

        jpegReader.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage()
            try {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                image.close()

                // Save to Pictures/StarGaze
                val dir = java.io.File(
                    Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES
                    ), "StarGaze"
                )
                dir.mkdirs()
                val file = java.io.File(dir, "stargaze_${System.currentTimeMillis()}.jpg")
                file.writeBytes(bytes)

                onResult("Saved: ${file.name}")
            } catch (e: Exception) {
                image.close()
                onResult("Save failed: ${e.message}")
            }
        }, handler)

        builder.addTarget(jpegReader.surface)

        sess.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {
            override fun onCaptureCompleted(
                session: CameraCaptureSession,
                request: CaptureRequest,
                result: TotalCaptureResult
            ) {
                // Capture complete — ImageReader callback handles saving
            }
            override fun onCaptureFailed(
                session: CameraCaptureSession,
                request: CaptureRequest,
                failure: CaptureFailure
            ) {
                onResult("Capture failed")
            }
        }, handler)

    } catch (e: Exception) {
        onResult("Error: ${e.message}")
    }
}

// ─── Placeholder screens ───

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkyMapScreen(onBack: () -> Unit) {
    var isLoading by remember { mutableStateOf(true) }
    var hasError by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sky Map") },
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
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            // Stellarium WebView (hidden until loaded)
            AndroidView(
                factory = { ctx ->
                    android.webkit.WebView(ctx).apply {
                        setBackgroundColor(android.graphics.Color.BLACK)
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            allowFileAccess = true
                            allowContentAccess = true
                            mediaPlaybackRequiresUserGesture = false
                            setSupportZoom(true)
                            builtInZoomControls = true
                            displayZoomControls = false
                            // Enable WebGL for WASM
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
                                isLoading = false
                                hasError = true
                            }
                        }
                        // Try bundled assets first, fall back to online
                        loadUrl("file:///android_asset/stellarium/stellarium.html")
                        // If local fails after 5s, try online
                        postDelayed({
                            if (isLoading) {
                                loadUrl("https://stargaze-app.fly.dev/test-engine.html?v=kotlin")
                            }
                        }, 5000)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )

            // Loading indicator
            if (isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.8f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = AccentCyan, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(16.dp))
                        Text("Loading star map...", color = TextSecondary, fontSize = 14.sp)
                        Text("Stellarium Web Engine", color = TextMuted, fontSize = 12.sp)
                    }
                }
            }

            // Error state
            if (hasError) {
                Box(
                    modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.9f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("⚠️", fontSize = 48.sp)
                        Spacer(Modifier.height(12.dp))
                        Text("Could not load sky map", color = TextPrimary, fontSize = 16.sp)
                        Text("Check your internet connection", color = TextMuted, fontSize = 13.sp)
                        Spacer(Modifier.height(16.dp))
                        Button(
                            onClick = { isLoading = true; hasError = false },
                            colors = ButtonDefaults.buttonColors(containerColor = AccentCyan)
                        ) {
                            Text("Retry")
                        }
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
    val coroutineScope = rememberCoroutineScope()

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasNotifPermission = granted }

    LaunchedEffect(Unit) {
        intervalMinutes = settingsRepo.getRefreshInterval() / 60
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

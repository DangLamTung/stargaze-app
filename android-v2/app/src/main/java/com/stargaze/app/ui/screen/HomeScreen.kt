package com.stargaze.app.ui.screen

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.stargaze.app.data.model.*
import com.stargaze.app.data.repository.WeatherRepository
import com.stargaze.app.domain.scorer.StargazingScorer
import com.stargaze.app.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToCamera: () -> Unit,
    onNavigateToSkyMap: () -> Unit,
    onNavigateToFavorites: () -> Unit,
    onNavigateToSettings: () -> Unit,
    viewModel: HomeViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()

    // Location permission launcher
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) viewModel.locateMe()
    }

    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        state.locationName ?: "StarGaze",
                        fontWeight = FontWeight.Bold
                    )
                },
                actions = {
                    IconButton(onClick = onNavigateToSkyMap) {
                        Icon(Icons.Default.Map, "Sky Map", tint = AccentCyan)
                    }
                    IconButton(onClick = onNavigateToCamera) {
                        Icon(Icons.Default.CameraAlt, "Camera", tint = StarYellow)
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, "Settings", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SkyDarkBlue
                )
            )
        },
        containerColor = SkyBlack
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                state.isLoading && state.currentScore == null -> {
                    // Initial loading
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center),
                        color = AccentCyan
                    )
                }
                state.error != null && state.currentScore == null -> {
                    // Error state
                    Column(
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text("⚠️", fontSize = 48.sp)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            state.error ?: "Something went wrong",
                            color = ScoreBad,
                            fontSize = 16.sp
                        )
                        Spacer(Modifier.height(16.dp))
                        Button(onClick = { viewModel.retry() }) {
                            Text("Retry")
                        }
                    }
                }
                else -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // ─── Search Bar ───
                        SearchBar(
                            query = state.searchQuery,
                            onQueryChange = { viewModel.onSearchQuery(it) },
                            results = state.searchResults,
                            onSelectLocation = { viewModel.selectLocation(it) },
                            onLocate = {
                                val hasLocPerm = ContextCompat.checkSelfPermission(
                                    context, Manifest.permission.ACCESS_FINE_LOCATION
                                ) == PackageManager.PERMISSION_GRANTED
                                if (hasLocPerm) viewModel.locateMe()
                                else locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                            },
                            isLocating = state.isLocating
                        )

                        // ─── Map View ───
                        MapView(
                            latitude = state.currentLocation?.latitude,
                            longitude = state.currentLocation?.longitude,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                                .clip(RoundedCornerShape(12.dp))
                        )

                        // ─── Now Score ───
                        if (state.currentScore != null) {
                            NowScoreCard(state.currentScore!!)
                        }

                        // ─── Quick Stats ───
                        state.currentWeather?.let { w ->
                            QuickStatsRow(w)
                        }

                        // ─── Forecast Cards ───
                        if (state.scores.isNotEmpty()) {
                            Text(
                                "7-Day Forecast",
                                style = MaterialTheme.typography.titleMedium,
                                color = TextSecondary
                            )
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp)
                            ) {
                                items(state.scores) { score ->
                                    ForecastCard(score)
                                }
                            }
                        }

                        // ─── Action Buttons ───
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            ActionButton(
                                text = "Sky Map",
                                icon = { Icon(Icons.Default.Map, null, tint = AccentCyan) },
                                onClick = onNavigateToSkyMap,
                                modifier = Modifier.weight(1f)
                            )
                            ActionButton(
                                text = "Pro Camera",
                                icon = { Icon(Icons.Default.CameraAlt, null, tint = StarYellow) },
                                onClick = onNavigateToCamera,
                                modifier = Modifier.weight(1f)
                            )
                        }

                        if (state.isLoading) {
                            LinearProgressIndicator(
                                modifier = Modifier.fillMaxWidth(),
                                color = AccentCyan
                            )
                        }

                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

// ─── Search Bar ───

@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    results: List<LocationResult>,
    onSelectLocation: (LocationResult) -> Unit,
    onLocate: () -> Unit,
    isLocating: Boolean
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text("Search city...", color = TextMuted) },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                focusedBorderColor = AccentCyan,
                unfocusedBorderColor = SkyCardBorder,
                cursorColor = AccentCyan
            ),
            shape = RoundedCornerShape(12.dp)
        )
        IconButton(onClick = onLocate) {
            if (isLocating) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = AccentCyan,
                    strokeWidth = 2.dp
                )
            } else {
                Icon(Icons.Default.MyLocation, "Locate", tint = AccentCyan)
            }
        }
    }

    // Dropdown results
    if (results.isNotEmpty()) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = SkyCard),
            shape = RoundedCornerShape(8.dp)
        ) {
            Column {
                results.take(5).forEach { loc ->
                    TextButton(
                        onClick = { onSelectLocation(loc) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(horizontalAlignment = Alignment.Start) {
                            Text(loc.name, color = TextPrimary, fontSize = 14.sp)
                            Text(
                                listOfNotNull(loc.admin1, loc.country).joinToString(", "),
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

// ─── Cards ───

@Composable
private fun NowScoreCard(status: CurrentScoreStatus) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SkyCard),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                status.score.toString(),
                fontSize = 48.sp,
                fontWeight = FontWeight.Bold,
                color = Color(getScoreColor(status.score))
            )
            Text(
                status.rating,
                fontSize = 18.sp,
                color = Color(getScoreColor(status.score))
            )
            Text(
                status.description,
                fontSize = 14.sp,
                color = TextSecondary
            )
        }
    }
}

@Composable
private fun QuickStatsRow(w: CurrentWeather) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        StatBadge("🌡️", "${w.temperature?.roundToInt() ?: "?"}°C")
        StatBadge("☁️", "${w.cloudCover?.roundToInt() ?: "?"}%")
        StatBadge("💧", "${w.humidity?.roundToInt() ?: "?"}%")
        StatBadge("👁️", "${w.visibility?.div(1000.0)?.let { String.format("%.1f", it) } ?: "?"}km")
    }
}

@Composable
private fun StatBadge(icon: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(icon, fontSize = 16.sp)
        Text(value, fontSize = 12.sp, color = TextSecondary)
    }
}

@Composable
private fun ForecastCard(score: NightScore) {
    Card(
        modifier = Modifier.width(72.dp),
        colors = CardDefaults.cardColors(containerColor = SkyCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(score.dayOfWeek, fontSize = 12.sp, color = TextSecondary)
            Text(scoreIcon(score.score), fontSize = 20.sp)
            Text(
                score.score.toString(),
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = Color(getScoreColor(score.score))
            )
        }
    }
}

@Composable
private fun ActionButton(
    text: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Button(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = SkyCard),
        shape = RoundedCornerShape(12.dp)
    ) {
        icon()
        Spacer(Modifier.width(8.dp))
        Text(text)
    }
}

// ─── Map Composable ───

@Composable
private fun MapView(
    latitude: Double?,
    longitude: Double?,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lat = latitude ?: 10.76
    val lon = longitude ?: 106.66

    AndroidView(
        factory = { ctx ->
            org.osmdroid.views.MapView(ctx).apply {
                setTileSource(org.osmdroid.tileprovider.tilesource.TileSourceFactory.MAPNIK)
                setMultiTouchControls(true)
                controller.setZoom(9.0)
                controller.setCenter(org.osmdroid.util.GeoPoint(lat, lon))
                setBuiltInZoomControls(false)
                // Dark theme tiles
                overlayManager.tilesOverlay?.setColorFilter(
                    org.osmdroid.tileprovider.tilesource.TileSourceFactory.MAPNIK
                        .let { null } // Use default renderer
                )
                // TODO: Add light pollution overlay, cloud satellite overlay
            }
        },
        update = { mapView ->
            mapView.controller.setCenter(org.osmdroid.util.GeoPoint(lat, lon))
        },
        modifier = modifier
    )
}

// ─── State ───

data class HomeUiState(
    val locationName: String? = null,
    val currentLocation: LocationResult? = null,
    val currentWeather: CurrentWeather? = null,
    val currentScore: CurrentScoreStatus? = null,
    val scores: List<NightScore> = emptyList(),
    val searchQuery: String = "",
    val searchResults: List<LocationResult> = emptyList(),
    val isLoading: Boolean = false,
    val isLocating: Boolean = false,
    val error: String? = null
)

data class CurrentScoreStatus(
    val score: Int,
    val rating: String,
    val description: String
)

// ─── ViewModel ───

class HomeViewModel(application: android.app.Application) : AndroidViewModel(application) {

    private val weatherRepo = WeatherRepository()
    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(application)

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private var lastQuery = ""

    init {
        // Default: Ho Chi Minh City
        selectLocation(
            LocationResult(
                name = "Ho Chi Minh City",
                country = "Vietnam",
                admin1 = "Ho Chi Minh City",
                latitude = 10.762622,
                longitude = 106.660172,
                timezone = "Asia/Ho_Chi_Minh"
            )
        )
    }

    fun onSearchQuery(query: String) {
        lastQuery = query
        _uiState.update { it.copy(searchQuery = query) }
        if (query.length < 2) {
            _uiState.update { it.copy(searchResults = emptyList()) }
            return
        }
        viewModelScope.launch {
            val results = weatherRepo.searchLocations(query)
            _uiState.update { it.copy(searchResults = results) }
        }
    }

    fun selectLocation(location: LocationResult) {
        _uiState.update {
            it.copy(
                searchQuery = location.name,
                searchResults = emptyList(),
                isLoading = true,
                error = null
            )
        }
        viewModelScope.launch {
            try {
                val weather = weatherRepo.getWeather(
                    location.latitude, location.longitude, location.timezone
                )
                val bortle = weatherRepo.getBortleClass(location.latitude, location.longitude)
                val observedCloud = weather.current?.cloudCover
                val scores = StargazingScorer.calculateAllScores(weather, bortle, observedCloud)
                val bestNight = StargazingScorer.findBestNight(scores)
                val nowScore = scores.firstOrNull()?.score ?: 0

                val currentWeather = weather.current
                val rating = getScoreRating(nowScore)

                _uiState.update {
                    it.copy(
                        locationName = "${location.name}, ${location.country}",
                        currentLocation = location,
                        currentWeather = currentWeather,
                        currentScore = CurrentScoreStatus(
                            score = nowScore,
                            rating = rating,
                            description = if (bestNight != null)
                                "Best: ${bestNight.dayOfWeek} — ${bestNight.score}/100"
                            else "No forecast data"
                        ),
                        scores = scores,
                        isLoading = false,
                        error = null
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Failed to load weather: ${e.message}"
                    )
                }
            }
        }
    }

    fun locateMe() {
        _uiState.update { it.copy(isLocating = true, error = null) }
        viewModelScope.launch {
            try {
                val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                    getApplication(), Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED

                if (!hasPermission) {
                    // Fall back to HCMC — permission must be requested from UI
                    selectLocation(
                        LocationResult(
                            name = "Ho Chi Minh City",
                            country = "Vietnam",
                            latitude = 10.762622,
                            longitude = 106.660172,
                            timezone = "Asia/Ho_Chi_Minh"
                        )
                    )
                    _uiState.update { it.copy(isLocating = false) }
                    return@launch
                }

                val location = fusedLocationClient.getCurrentLocation(
                    Priority.PRIORITY_HIGH_ACCURACY,
                    CancellationTokenSource().token
                ).await()

                if (location != null) {
                    val locName = weatherRepo.reverseGeocode(location.latitude, location.longitude)
                    selectLocation(
                        LocationResult(
                            name = locName.name.ifEmpty { "Current Location" },
                            country = locName.country,
                            admin1 = locName.admin1,
                            latitude = location.latitude,
                            longitude = location.longitude,
                            timezone = "auto"
                        )
                    )
                } else {
                    _uiState.update { it.copy(isLocating = false, error = "Could not get location") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLocating = false, error = "GPS error: ${e.message}") }
            }
        }
    }

    fun retry() {
        _uiState.value.currentLocation?.let { selectLocation(it) }
    }
}


package com.stargaze.app.camera

import android.content.Context
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Camera2 API manager for manual (pro) mode controls.
 *
 * Provides:
 * - Manual ISO (100–max supported)
 * - Manual exposure time (1/8000s to 30s depending on hardware)
 * - Manual focus distance
 * - RAW/DNG capture support detection
 */
class CameraManager(private val context: Context) {

    data class CameraCapabilities(
        val isoRange: Range<Int>?,
        val exposureRange: Range<Long>?,         // nanoseconds
        val maxAnalogSensitivity: Int?,
        val aperture: FloatArray?,
        val rawSupported: Boolean,
        val manualExposureSupported: Boolean,
        val manualFocusSupported: Boolean
    )

    data class ManualControlState(
        val iso: Int = 800,
        val exposureNanos: Long = 16_666_667L,   // ~1/60s
        val focusDistance: Float = 0f,             // 0=infinity
        val aeMode: Int = CameraMetadata.CONTROL_AE_MODE_ON,
        val afMode: Int = CameraMetadata.CONTROL_AF_MODE_AUTO,
        val rawEnabled: Boolean = false
    )

    private val cameraManager =
        context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var cameraThread = HandlerThread("CameraThread").apply { start() }
    private val cameraHandler = Handler(cameraThread.looper)

    private val _capabilities = MutableStateFlow<CameraCapabilities?>(null)
    val capabilities: StateFlow<CameraCapabilities?> = _capabilities.asStateFlow()

    private val _manualState = MutableStateFlow(ManualControlState())
    val manualState: StateFlow<ManualControlState> = _manualState.asStateFlow()

    private var backCameraId: String? = null

    suspend fun getBackCameraId(): String? = withContext(Dispatchers.IO) {
        if (backCameraId != null) return@withContext backCameraId
        cameraManager.cameraIdList.forEach { id ->
            val chars = cameraManager.getCameraCharacteristics(id)
            if (chars.get(CameraCharacteristics.LENS_FACING) == CameraMetadata.LENS_FACING_BACK) {
                backCameraId = id
                return@withContext id
            }
        }
        null
    }

    suspend fun queryCapabilities(): CameraCapabilities = withContext(Dispatchers.IO) {
        val id = getBackCameraId() ?: throw IllegalStateException("No back camera found")
        val chars = cameraManager.getCameraCharacteristics(id)

        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toSet()
            ?: emptySet()

        CameraCapabilities(
            isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE),
            exposureRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE),
            maxAnalogSensitivity = chars.get(CameraCharacteristics.SENSOR_MAX_ANALOG_SENSITIVITY),
            aperture = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES),
            rawSupported = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW),
            manualExposureSupported = caps.contains(
                CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR
            ),
            manualFocusSupported = caps.contains(
                CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING
            )
        ).also { _capabilities.value = it }
    }

    fun setManualState(state: ManualControlState) {
        _manualState.value = state
        updateCaptureRequest()
    }

    fun updateIso(iso: Int) {
        _manualState.value = _manualState.value.copy(iso = iso)
        updateCaptureRequest()
    }

    fun updateExposureTime(nanos: Long) {
        _manualState.value = _manualState.value.copy(exposureNanos = nanos)
        updateCaptureRequest()
    }

    fun updateFocusDistance(distance: Float) {
        _manualState.value = _manualState.value.copy(focusDistance = distance)
        updateCaptureRequest()
    }

    fun toggleManualExposure() {
        val current = _manualState.value
        val newAeMode = if (current.aeMode == CameraMetadata.CONTROL_AE_MODE_ON)
            CameraMetadata.CONTROL_AE_MODE_OFF
        else
            CameraMetadata.CONTROL_AE_MODE_ON
        _manualState.value = current.copy(aeMode = newAeMode)
        updateCaptureRequest()
    }

    fun toggleRaw(enabled: Boolean) {
        _manualState.value = _manualState.value.copy(rawEnabled = enabled)
    }

    private fun updateCaptureRequest() {
        // Rebuild capture request with new settings
        // Called when any manual control changes
        captureSession?.let { session ->
            val request = buildCaptureRequest()
            if (request != null) {
                session.setRepeatingRequest(request, null, cameraHandler)
            }
        }
    }

    private fun buildCaptureRequest(): CaptureRequest? {
        val device = cameraDevice ?: return null
        val state = _manualState.value
        val caps = _capabilities.value ?: return null

        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)

        // Manual exposure
        builder.set(CaptureRequest.CONTROL_AE_MODE, state.aeMode)
        if (state.aeMode == CameraMetadata.CONTROL_AE_MODE_OFF) {
            if (caps.manualExposureSupported) {
                builder.set(CaptureRequest.SENSOR_SENSITIVITY, state.iso)
                builder.set(CaptureRequest.SENSOR_EXPOSURE_TIME, state.exposureNanos)
            }
        }

        // Manual focus
        if (caps.manualFocusSupported) {
            builder.set(CaptureRequest.CONTROL_AF_MODE, state.afMode)
            if (state.afMode == CameraMetadata.CONTROL_AF_MODE_OFF) {
                builder.set(CaptureRequest.LENS_FOCUS_DISTANCE, state.focusDistance)
            }
        }

        return builder.build()
    }

    fun release() {
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        cameraThread.quitSafely()
    }
}

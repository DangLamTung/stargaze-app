# AR Mode Upgrade — Implementation Plan

## Overview

Add 5 new capabilities to the AR Stellarium mode:
1. **Camera light sensor** — Read ambient brightness from camera feed
2. **Bortle estimation from camera** — Combine light + phone angle → estimate Bortle class
3. **Per-Bortle recommended settings** — Preset Stellarium configs for each Bortle level (1–9)
4. **Auto-apply best settings** — Button to auto-tune engine to match real sky
5. **Phone holding guide** — Visual overlay showing correct orientation

---

## Phase 1: Camera Light Sensor + Bortle Estimator

### New file: `src/core/sky-sense.js`

```
Purpose: Read camera pixel brightness + phone altitude angle → estimate Bortle

Core functions:
  analyzeFrame(videoEl) → { avgBrightness, darkPixelPct, estimatedBortle, confidence }
    - Grab a low-res snapshot from videoEl via offscreen <canvas>
    - Compute average luminance (Y = 0.299R + 0.587G + 0.114B)
    - Count % of "dark pixels" (Y < 30)
    - Map brightness + altitude to Bortle class using lookup table

  estimateBortleFromCamera(videoEl, altitudeDeg) → { bortle, label, desc }
    - Calls analyzeFrame() 3× over 1s and averages
    - Adjusts for phone altitude (pointing up = darker = lower Bortle)
    - Returns Bortle 1–9 with label

Bortle mapping table (brightness + altitude → Bortle):
  - avgBrightness < 20 → Bortle 1–2 (pristine dark)
  - avgBrightness 20-40 → Bortle 3–4
  - avgBrightness 40-80 → Bortle 5–6
  - avgBrightness 80-150 → Bortle 7–8
  - avgBrightness > 150 → Bortle 9 (inner city)
  - Each range shifted -1 level if altitude > 60° (pointing at zenith)
  - Each range shifted +1 level if altitude < 15° (pointing at horizon/ground)
```

### Integration: `src/ui/ar-mode.js`

- Add `let cameraBortle = null;` state variable
- In `renderLoop()`, every 30 frames (~0.5s), call `analyzeFrame(videoEl)`
- Display estimated Bortle in `#ar-debug` and a new `#ar-bortle-display` element
- Add `export function getCameraBortle()` for external access

---

## Phase 2: Bortle Presets Engine

### New file: `src/core/bortle-presets.js`

```
Purpose: Define optimal Stellarium settings for each Bortle level

Bortle preset structure:
{
  bortle: 4,
  label: "Rural/Suburban Transition",
  settings: {
    starMagnitudeLimit: 6.5,    // fainter stars visible
    milkywayVisible: true,
    milkywayBrightness: 0.8,
    constellationLines: true,
    constellationLabels: true,
    dsoVisible: true,
    atmosphereVisible: false,
    landscapeVisible: true,
    skyOpacity: 0.85,
    planetHints: true,
    starHints: true,
    nebulaHints: true,
    zodiacalLight: false,
  }
}

Presets for Bortle 1–9:
  Bortle 1 — Everything visible, max magnitude 7.5, milkyway full, zodiacal light on
  Bortle 2 — Magnitude 7.0, milkyway full
  Bortle 3 — Magnitude 6.5, milkyway bright
  Bortle 4 — Magnitude 6.0, milkyway visible (default)
  Bortle 5 — Magnitude 5.5, milkyway faint
  Bortle 6 — Magnitude 5.0, milkyway off
  Bortle 7 — Magnitude 4.5, only bright stars
  Bortle 8 — Magnitude 4.0, planets + brightest stars
  Bortle 9 — Magnitude 3.5, only planets + moon

Export:
  getBortlePreset(bortleClass) → preset object
  getAllPresets() → array of all 9 presets
  getRecommendedBortle(lat, lon) → calls backend API + falls back to camera
```

---

## Phase 3: Auto-Apply Engine Settings

### Modify: `src/ui/ar-mode.js`

```
New function: applyBortlePreset(preset)
  - Takes a preset from bortle-presets.js
  - Sets stel.core.stars.magnitude_limit (if available)
  - Toggles constellation lines/labels
  - Sets milkyway visibility + alpha
  - Adjusts skyOpacity
  - Toggles atmosphere, landscape
  - Updates toggle button UI states to match

New function: autoMatchSky()
  - Gets best Bortle estimate (camera OR API)
  - Gets preset for that Bortle
  - Calls applyBortlePreset()
  - Shows toast: "Sky matched to Bortle X — Y"

New UI button: "🎯 Auto-Match" in AR controls
  - Calls autoMatchSky() on tap
  - Disabled if engine not ready
```

---

## Phase 4: Phone Holding Guide

### Modify: `index.html` AR overlay

Add a guide overlay inside `#ar-overlay`:

```html
<div id="ar-guide" class="ar-guide-overlay">
  <div class="ar-guide-content">
    <div class="ar-guide-icon">📱</div>
    <h3>Hold Your Phone</h3>
    <div class="ar-guide-steps">
      <div class="ar-guide-step">
        <span>1️⃣</span> Point camera at the sky
      </div>
      <div class="ar-guide-step">
        <span>2️⃣</span> Hold phone at ~45° angle
      </div>
      <div class="ar-guide-step">
        <span>3️⃣</span> Keep steady for best tracking
      </div>
    </div>
    <div class="ar-guide-angle">
      <div class="ar-guide-angle-bar">
        <div class="ar-guide-angle-fill" id="ar-guide-fill"></div>
      </div>
      <span id="ar-guide-angle-text">45°</span>
    </div>
    <button id="ar-guide-dismiss">Got it ✨</button>
  </div>
</div>
```

### Modify: `src/ui/ar-mode.js`

```
New function: showPhoneGuide()
  - Shows #ar-guide overlay
  - Updates angle bar live from smoothAltitude
  - Auto-dismisses after 5s or on "Got it" tap
  - Stores dismissed state in localStorage so it only shows once

New function: updateGuideAngle()
  - Called from renderLoop
  - Updates #ar-guide-fill width based on smoothAltitude (0-90°)
  - Shows "Too low 🔽" if altitude < 10°
  - Shows "Too high 🔼" if altitude > 80°  
  - Shows "Perfect ✨" if altitude 30-60°
```

---

## Phase 5: UI Layout Changes

### Modify: `index.html` AR controls section

Current layout:
```
[opacity slider]
[time slider]
[⏪ ◀ ⏹ ▶ ⏩]
[realtime clock]
[🌅 ⛰️ 📐]
```

New layout:
```
[opacity slider]
[time slider]
[⏪ ◀ ⏹ ▶ ⏩]
[realtime clock]
[Bortle: 4 🌃 | Auto-Match 🎯]   ← NEW ROW
[🌅 ⛰️ 📐]
[📱 Guide]                        ← NEW BUTTON
```

Add CSS in `src/styles/main.css`:
```css
.ar-bortle-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
.ar-bortle-badge { background:rgba(0,255,136,0.15); color:#0f0; border-radius:4px; padding:2px 8px; font-size:11px; }
.ar-auto-btn { background:rgba(0,200,255,0.2); border:1px solid rgba(0,200,255,0.4); color:#0cf; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; }
.ar-guide-btn { background:rgba(255,200,0,0.15); border:1px solid rgba(255,200,0,0.3); color:#fc0; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; }
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/core/sky-sense.js` | **CREATE** | Camera brightness analyzer + Bortle estimator |
| `src/core/bortle-presets.js` | **CREATE** | 9 Bortle presets with Stellarium settings |
| `src/ui/ar-mode.js` | **MODIFY** | Integrate camera analysis, auto-match, guide |
| `index.html` | **MODIFY** | Add guide overlay, bortle badge, auto-match button, guide button |
| `src/styles/main.css` | **MODIFY** | Add CSS for new UI elements |

---

## Execution Order

1. Create `src/core/bortle-presets.js` (pure data, no dependencies)
2. Create `src/core/sky-sense.js` (depends on camera access, testable standalone)
3. Modify `src/ui/ar-mode.js` (wire everything together)
4. Modify `index.html` (add UI elements)
5. Modify `src/styles/main.css` (style new elements)
6. Test → Deploy

---

## Testing Checklist

- [ ] Camera Bortle displays correctly in dark room (should read 1–3)
- [ ] Camera Bortle displays correctly in bright room (should read 7–9)
- [ ] Phone angle adjusts Bortle estimate (point up → lower Bortle)
- [ ] Auto-Match button applies correct preset
- [ ] Toggle buttons sync with applied preset
- [ ] Guide overlay shows on first AR open
- [ ] Guide angle bar updates with phone tilt
- [ ] Guide dismisses and doesn't reappear
- [ ] Time controls still work alongside new features
- [ ] No performance regression (Bortle analysis at 2fps max)

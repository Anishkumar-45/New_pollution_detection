/* ============================
   MOBILE MAPPING — Walk & Record Module
   ============================ */

// ==================== MOBILE MAPPING GLOBALS ====================
let mobileMap = null;
let mobileMapInitialized = false;
let isMobileMapping = false;
let mobileAudioContext = null;
let mobileAnalyser = null;
let mobileMicrophone = null;
let mobileCurrentDb = 0;
let mobileAnimFrameId = null;

// Trail data
let trailPoints = [];
let trailMarkers = null;
let trailPolyline = null;
let userMarker = null;
let accuracyCircle = null;

// GPS tracking
let gpsWatchId = null;
let lastGpsPosition = null;
let totalDistance = 0;

// Timing
let mappingStartTime = null;
let mappingIntervalId = null;
let durationIntervalId = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initMobileMapping();
});

function initMobileMapping() {
  document
    .getElementById('btn-start-mapping')
    .addEventListener('click', startMobileMapping);
  document
    .getElementById('btn-stop-mapping')
    .addEventListener('click', stopMobileMapping);
  document
    .getElementById('btn-center-map')
    .addEventListener('click', centerOnUser);
  document
    .getElementById('btn-save-route')
    .addEventListener('click', saveRouteToServer);
  document
    .getElementById('btn-new-route')
    .addEventListener('click', resetMobileMapping);
}

// ==================== MOBILE MAP INITIALIZATION ====================
function initMobileMap() {
  if (mobileMapInitialized) return;

  mobileMap = L.map('mobile-map', {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: false,
  }).setView([28.6139, 77.209], 15);

  // Add zoom control to right side
  L.control.zoom({ position: 'topright' }).addTo(mobileMap);

  // Dark tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(mobileMap);

  trailMarkers = L.layerGroup().addTo(mobileMap);

  mobileMapInitialized = true;

  // Try to center on user's location immediately
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mobileMap.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }
}

// ==================== START MOBILE MAPPING ====================
async function startMobileMapping() {
  if (isMobileMapping) return;

  // Check GPS support
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  // Request microphone
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mobileAudioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    mobileAnalyser = mobileAudioContext.createAnalyser();
    mobileAnalyser.fftSize = 2048;
    mobileAnalyser.smoothingTimeConstant = 0.8;
    mobileMicrophone = mobileAudioContext.createMediaStreamSource(stream);
    mobileMicrophone.connect(mobileAnalyser);
  } catch (err) {
    showToast(
      'Microphone access denied. Please allow microphone permission.',
      'error',
    );
    return;
  }

  isMobileMapping = true;
  trailPoints = [];
  totalDistance = 0;
  lastGpsPosition = null;
  mappingStartTime = Date.now();

  // Clear previous trail
  if (trailMarkers) trailMarkers.clearLayers();
  if (trailPolyline) {
    mobileMap.removeLayer(trailPolyline);
    trailPolyline = null;
  }

  // Hide summary if shown
  document.getElementById('route-summary').style.display = 'none';

  // Update UI
  document.getElementById('btn-start-mapping').style.display = 'none';
  document.getElementById('btn-stop-mapping').style.display = '';
  document.getElementById('btn-stop-mapping').classList.add('recording');
  document.getElementById('mobile-hud').classList.add('active');

  // Start dB meter animation
  updateMobileDb();

  // Start GPS watch (continuous tracking)
  gpsWatchId = navigator.geolocation.watchPosition(onGpsUpdate, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 10000,
  });

  // Start recording interval
  const interval =
    parseInt(document.getElementById('mapping-interval').value) * 1000;
  mappingIntervalId = setInterval(recordMobilePoint, interval);

  // Start duration timer
  durationIntervalId = setInterval(updateDurationDisplay, 1000);

  showToast(
    'Mobile mapping started! Walk around to map noise levels.',
    'success',
  );
}

// ==================== STOP MOBILE MAPPING ====================
function stopMobileMapping() {
  if (!isMobileMapping) return;
  isMobileMapping = false;

  // Stop GPS
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  // Stop intervals
  if (mappingIntervalId) {
    clearInterval(mappingIntervalId);
    mappingIntervalId = null;
  }
  if (durationIntervalId) {
    clearInterval(durationIntervalId);
    durationIntervalId = null;
  }

  // Stop audio
  if (mobileAnimFrameId) {
    cancelAnimationFrame(mobileAnimFrameId);
    mobileAnimFrameId = null;
  }
  if (mobileAudioContext) {
    mobileAudioContext.close();
    mobileAudioContext = null;
  }

  // Update UI
  document.getElementById('btn-start-mapping').style.display = '';
  document.getElementById('btn-stop-mapping').style.display = 'none';
  document.getElementById('btn-stop-mapping').classList.remove('recording');

  // Show route summary
  showRouteSummary();

  showToast(
    `Mapping complete! ${trailPoints.length} points recorded.`,
    'success',
  );
}

// ==================== GPS CALLBACKS ====================
function onGpsUpdate(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy;

  lastGpsPosition = { lat, lng, accuracy };

  // Update accuracy badge
  const badge = document.getElementById('gps-accuracy-badge');
  const text = document.getElementById('gps-accuracy-text');
  badge.classList.add('active');

  if (accuracy < 10) {
    text.textContent = `GPS: ±${accuracy.toFixed(0)}m (Excellent)`;
    badge.className = 'gps-accuracy-badge active excellent';
  } else if (accuracy < 30) {
    text.textContent = `GPS: ±${accuracy.toFixed(0)}m (Good)`;
    badge.className = 'gps-accuracy-badge active good';
  } else {
    text.textContent = `GPS: ±${accuracy.toFixed(0)}m (Poor)`;
    badge.className = 'gps-accuracy-badge active poor';
  }

  // Update user marker
  if (mobileMap) {
    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
    } else {
      userMarker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: '#00d4aa',
        color: '#ffffff',
        fillOpacity: 1,
        weight: 3,
        className: 'user-position-marker',
      }).addTo(mobileMap);
    }

    // Accuracy circle
    if (accuracyCircle) {
      accuracyCircle.setLatLng([lat, lng]);
      accuracyCircle.setRadius(accuracy);
    } else {
      accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        fillColor: '#00d4aa',
        fillOpacity: 0.08,
        color: '#00d4aa',
        opacity: 0.2,
        weight: 1,
      }).addTo(mobileMap);
    }

    // Pan map to follow user
    mobileMap.panTo([lat, lng], { animate: true, duration: 0.5 });
  }
}

function onGpsError(error) {
  const text = document.getElementById('gps-accuracy-text');
  text.textContent = 'GPS: ' + error.message;
  document.getElementById('gps-accuracy-badge').className =
    'gps-accuracy-badge active poor';
}

// ==================== RECORD A POINT ====================
function recordMobilePoint() {
  if (!isMobileMapping || !lastGpsPosition) return;

  const lat = lastGpsPosition.lat;
  const lng = lastGpsPosition.lng;
  const db = Math.round(mobileCurrentDb * 10) / 10;
  const routeName =
    document.getElementById('mapping-route-name').value || 'Mobile Mapping';
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Calculate distance from last point
  if (trailPoints.length > 0) {
    const lastPt = trailPoints[trailPoints.length - 1];
    const dist = haversineMeters(lastPt.lat, lastPt.lng, lat, lng);
    totalDistance += dist;

    // Skip if we haven't moved much (less than 1 meter)
    if (dist < 1) return;
  }

  const point = { lat, lng, db, timestamp, location: routeName };
  trailPoints.push(point);

  // Add color-coded marker
  const color = getMobileDbColor(db);
  const marker = L.circleMarker([lat, lng], {
    radius: 7,
    fillColor: color,
    color: color,
    fillOpacity: 0.85,
    weight: 2,
    opacity: 0.9,
  });

  marker.bindPopup(`
        <div class="popup-title">${routeName}</div>
        <div class="popup-db" style="color: ${color}">${db} dB</div>
        <div class="popup-meta">📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div class="popup-meta">🕐 ${timestamp}</div>
    `);

  trailMarkers.addLayer(marker);

  // Update trail polyline
  const latlngs = trailPoints.map((p) => [p.lat, p.lng]);
  if (trailPolyline) {
    trailPolyline.setLatLngs(latlngs);
  } else {
    trailPolyline = L.polyline(latlngs, {
      color: '#00d4aa',
      weight: 3,
      opacity: 0.5,
      dashArray: '8, 6',
      lineJoin: 'round',
    }).addTo(mobileMap);
  }

  // Update HUD stats
  updateHudStats();
}

// ==================== MOBILE DB METER ====================
function updateMobileDb() {
  if (!isMobileMapping || !mobileAnalyser) return;

  const bufferLength = mobileAnalyser.fftSize;
  const dataArray = new Float32Array(bufferLength);
  mobileAnalyser.getFloatTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);
  let db = 20 * Math.log10(rms + 1e-10);
  db = Math.max(0, Math.min(120, db + 100));

  mobileCurrentDb = db;

  // Update HUD display
  const dbEl = document.getElementById('hud-db-value');
  const labelEl = document.getElementById('hud-noise-label');
  const displayEl = document.getElementById('hud-db-display');

  dbEl.textContent = db.toFixed(1);

  if (db < 40) {
    labelEl.textContent = '🟢 Quiet';
    displayEl.className = 'hud-db-display level-quiet';
  } else if (db < 70) {
    labelEl.textContent = '🟡 Moderate';
    displayEl.className = 'hud-db-display level-moderate';
  } else if (db < 90) {
    labelEl.textContent = '🟠 Loud';
    displayEl.className = 'hud-db-display level-loud';
  } else {
    labelEl.textContent = '🔴 Dangerous!';
    displayEl.className = 'hud-db-display level-danger';
  }

  mobileAnimFrameId = requestAnimationFrame(updateMobileDb);
}

// ==================== HUD STATS ====================
function updateHudStats() {
  document.getElementById('hud-points').textContent = trailPoints.length;

  // Distance
  if (totalDistance < 1000) {
    document.getElementById('hud-distance').textContent =
      Math.round(totalDistance) + 'm';
  } else {
    document.getElementById('hud-distance').textContent =
      (totalDistance / 1000).toFixed(2) + 'km';
  }

  // Average dB
  if (trailPoints.length > 0) {
    const avgDb =
      trailPoints.reduce((s, p) => s + p.db, 0) / trailPoints.length;
    document.getElementById('hud-avg-db').textContent = avgDb.toFixed(1);
  }
}

function updateDurationDisplay() {
  if (!mappingStartTime) return;
  const elapsed = Math.floor((Date.now() - mappingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  document.getElementById('hud-duration').textContent =
    `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==================== ROUTE SUMMARY ====================
function showRouteSummary() {
  if (trailPoints.length === 0) return;

  const dbs = trailPoints.map((p) => p.db);
  const avg = (dbs.reduce((a, b) => a + b, 0) / dbs.length).toFixed(1);
  const max = Math.max(...dbs).toFixed(1);
  const min = Math.min(...dbs).toFixed(1);

  const elapsed = Math.floor((Date.now() - mappingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  document.getElementById('summary-points').textContent = trailPoints.length;
  document.getElementById('summary-avg').textContent = `${avg} dB`;
  document.getElementById('summary-max').textContent = `${max} dB`;
  document.getElementById('summary-min').textContent = `${min} dB`;
  document.getElementById('summary-duration').textContent =
    `${mins}:${secs.toString().padStart(2, '0')}`;

  if (totalDistance < 1000) {
    document.getElementById('summary-distance').textContent =
      Math.round(totalDistance) + 'm';
  } else {
    document.getElementById('summary-distance').textContent =
      (totalDistance / 1000).toFixed(2) + 'km';
  }

  document.getElementById('route-summary').style.display = 'block';
}

// ==================== SAVE ROUTE TO SERVER ====================
async function saveRouteToServer() {
  if (trailPoints.length === 0) {
    showToast('No data points to save', 'error');
    return;
  }

  let saved = 0;
  let failed = 0;

  for (const point of trailPoints) {
    try {
      const response = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: point.lat,
          longitude: point.lng,
          decibel: point.db,
          location: point.location,
          timestamp: point.timestamp,
        }),
      });
      if (response.ok) saved++;
      else failed++;
    } catch {
      failed++;
    }
  }

  if (saved > 0) {
    showToast(`Saved ${saved} data points to server!`, 'success');
  }
  if (failed > 0) {
    showToast(`${failed} points failed to save`, 'error');
  }
}

// ==================== RESET ====================
function resetMobileMapping() {
  trailPoints = [];
  totalDistance = 0;
  lastGpsPosition = null;

  if (trailMarkers) trailMarkers.clearLayers();
  if (trailPolyline) {
    mobileMap.removeLayer(trailPolyline);
    trailPolyline = null;
  }
  if (userMarker) {
    mobileMap.removeLayer(userMarker);
    userMarker = null;
  }
  if (accuracyCircle) {
    mobileMap.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }

  document.getElementById('route-summary').style.display = 'none';
  document.getElementById('hud-points').textContent = '0';
  document.getElementById('hud-distance').textContent = '0m';
  document.getElementById('hud-avg-db').textContent = '—';
  document.getElementById('hud-duration').textContent = '0:00';
  document.getElementById('hud-db-value').textContent = '0.0';
  document.getElementById('hud-noise-label').textContent = '—';
  document.getElementById('mobile-hud').classList.remove('active');

  showToast('Ready for a new route!', 'info');
}

// ==================== CENTER ON USER ====================
function centerOnUser() {
  if (lastGpsPosition && mobileMap) {
    mobileMap.setView([lastGpsPosition.lat, lastGpsPosition.lng], 17, {
      animate: true,
    });
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (mobileMap) {
          mobileMap.setView([pos.coords.latitude, pos.coords.longitude], 17, {
            animate: true,
          });
        }
      },
      () => showToast('Could not get your location', 'error'),
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }
}

// ==================== UTILITY ====================
function getMobileDbColor(db) {
  if (db < 40) return '#10b981';
  if (db < 70) return '#f59e0b';
  if (db < 90) return '#f97316';
  return '#ef4444';
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


// ==================== GLOBALS ====================
let map = null;
let heatLayer = null;
let markersLayer = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let isRecording = false;
let currentDb = 0;
let animationFrameId = null;
let mapInitialized = false;

// Charts
let chartTopLocations = null;
let chartCategories = null;
let chartTimeline = null;
let analyticsLoaded = false;

// Waveform
let waveformCanvas = null;
let waveformCtx = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initRecorder();
  initWaveform();
  initUpload();
  initMapToolbar();
  initDataTable();
  initAnalytics();
  initRippleButtons();
});

// ==================== RIPPLE EFFECT ====================
function initRippleButtons() {
  document.querySelectorAll('.ripple-btn').forEach((btn) => {
    btn.addEventListener('click', function (e) {
      const rect = this.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                border-radius: 50%;
                background: rgba(255,255,255,0.15);
                transform: translate(-50%, -50%) scale(0);
                left: ${e.clientX - rect.left}px;
                top: ${e.clientY - rect.top}px;
                animation: rippleAnim 0.6s ease-out forwards;
                pointer-events: none;
            `;
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  });

  // Add ripple keyframes
  if (!document.getElementById('ripple-styles')) {
    const style = document.createElement('style');
    style.id = 'ripple-styles';
    style.textContent = `
            @keyframes rippleAnim {
                to { transform: translate(-50%, -50%) scale(4); opacity: 0; }
            }
        `;
    document.head.appendChild(style);
  }
}

// ==================== TAB NAVIGATION ====================
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Deactivate all
      navBtns.forEach((b) => b.classList.remove('active'));
      document
        .querySelectorAll('.tab-content')
        .forEach((t) => t.classList.remove('active'));
      // Activate selected
      btn.classList.add('active');
      const tabEl = document.getElementById(`tab-${tab}`);
      tabEl.classList.add('active');

      // Initialize map on first visit, then invalidate + refresh
      if (tab === 'heatmap') {
        if (!mapInitialized) {
          setTimeout(() => {
            initMap();
            mapInitialized = true;
            refreshMap();
          }, 50);
        } else if (map) {
          setTimeout(() => map.invalidateSize(), 100);
          refreshMap();
        }
      }
      if (tab === 'mobile') {
        setTimeout(() => {
          if (typeof initMobileMap === 'function') {
            initMobileMap();
          }
          if (typeof mobileMap !== 'undefined' && mobileMap) {
            setTimeout(() => mobileMap.invalidateSize(), 100);
          }
        }, 50);
      }
      if (tab === 'data') {
        refreshDataTable();
      }
      if (tab === 'analytics') {
        loadAnalytics();
      }
    });
  });
}

// ==================== WAVEFORM VISUALIZER ====================
function initWaveform() {
  waveformCanvas = document.getElementById('waveform-canvas');
  if (waveformCanvas) {
    waveformCtx = waveformCanvas.getContext('2d');
    // Set canvas resolution
    const rect = waveformCanvas.getBoundingClientRect();
    waveformCanvas.width = rect.width * 2;
    waveformCanvas.height = rect.height * 2;
    waveformCtx.scale(2, 2);
    drawFlatWaveform();
  }
}

function drawFlatWaveform() {
  if (!waveformCtx || !waveformCanvas) return;
  const w = waveformCanvas.width / 2;
  const h = waveformCanvas.height / 2;
  waveformCtx.clearRect(0, 0, w, h);

  // Draw flat line
  waveformCtx.beginPath();
  waveformCtx.moveTo(0, h / 2);
  waveformCtx.lineTo(w, h / 2);
  waveformCtx.strokeStyle = 'rgba(255,255,255,0.1)';
  waveformCtx.lineWidth = 1;
  waveformCtx.stroke();
}

function drawWaveform() {
  if (!isRecording || !analyser || !waveformCtx || !waveformCanvas) return;

  const bufferLength = analyser.fftSize;
  const dataArray = new Float32Array(bufferLength);
  analyser.getFloatTimeDomainData(dataArray);

  const w = waveformCanvas.width / 2;
  const h = waveformCanvas.height / 2;
  waveformCtx.clearRect(0, 0, w, h);

  // Create gradient stroke
  const gradient = waveformCtx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, '#00d4aa');
  gradient.addColorStop(0.5, '#7c3aed');
  gradient.addColorStop(1, '#00d4aa');

  waveformCtx.beginPath();
  waveformCtx.strokeStyle = gradient;
  waveformCtx.lineWidth = 2;
  waveformCtx.lineJoin = 'round';
  waveformCtx.lineCap = 'round';

  const sliceWidth = w / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i];
    const y = h / 2 + v * h * 2;

    if (i === 0) {
      waveformCtx.moveTo(x, y);
    } else {
      waveformCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  waveformCtx.stroke();

  // Add glow effect
  waveformCtx.shadowColor = '#00d4aa';
  waveformCtx.shadowBlur = 6;
  waveformCtx.stroke();
  waveformCtx.shadowBlur = 0;
}

// ==================== LIVE RECORDER ====================
function initRecorder() {
  const btnRecord = document.getElementById('btn-record');
  const btnGetLocation = document.getElementById('btn-get-location');
  const btnSave = document.getElementById('btn-save-measurement');

  btnRecord.addEventListener('click', toggleRecording);
  btnGetLocation.addEventListener('click', autoDetectGPS);
  btnSave.addEventListener('click', saveMeasurement);

  // Add SVG gradient for meter
  const svg = document.querySelector('.meter-ring');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const gradient = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'linearGradient',
  );
  gradient.setAttribute('id', 'meter-gradient');
  gradient.setAttribute('x1', '0%');
  gradient.setAttribute('y1', '0%');
  gradient.setAttribute('x2', '100%');
  gradient.setAttribute('y2', '100%');

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', '#10b981');
  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '50%');
  stop2.setAttribute('stop-color', '#f59e0b');
  const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop3.setAttribute('offset', '100%');
  stop3.setAttribute('stop-color', '#ef4444');

  gradient.appendChild(stop1);
  gradient.appendChild(stop2);
  gradient.appendChild(stop3);
  defs.appendChild(gradient);
  svg.insertBefore(defs, svg.firstChild);
}

async function toggleRecording() {
  const btn = document.getElementById('btn-record');
  const meterLabel = document.getElementById('meter-label');

  if (isRecording) {
    stopRecording();
    btn.innerHTML = '<span class="btn-icon">🎙️</span> Start Recording';
    btn.classList.remove('recording');
    meterLabel.textContent = 'Recording Stopped';
    drawFlatWaveform();
  } else {
    try {
      await startRecording();
      btn.innerHTML = '<span class="btn-icon">⏹️</span> Stop Recording';
      btn.classList.add('recording');
      meterLabel.textContent = 'Listening...';
    } catch (err) {
      showToast(
        'Microphone access denied. Please allow microphone permission.',
        'error',
      );
      console.error('Mic error:', err);
    }
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  microphone = audioContext.createMediaStreamSource(stream);
  microphone.connect(analyser);

  isRecording = true;
  updateMeter();
}

function stopRecording() {
  isRecording = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

function updateMeter() {
  if (!isRecording || !analyser) return;

  const bufferLength = analyser.fftSize;
  const dataArray = new Float32Array(bufferLength);
  analyser.getFloatTimeDomainData(dataArray);

  // Compute RMS
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);

  // Convert RMS to dB
  let db = 20 * Math.log10(rms + 1e-10);
  db = Math.max(0, Math.min(120, db + 100));

  currentDb = db;

  // Update UI
  const dbValueEl = document.getElementById('db-value');
  const meterFill = document.getElementById('meter-fill');
  const meterLabel = document.getElementById('meter-label');

  dbValueEl.textContent = db.toFixed(1);

  // Update circular progress
  const circumference = 2 * Math.PI * 85;
  const progress = Math.min(db / 120, 1);
  const offset = circumference - progress * circumference;
  meterFill.style.strokeDashoffset = offset;

  // Update label based on level
  if (db < 40) {
    meterLabel.textContent = '🟢 Quiet';
  } else if (db < 70) {
    meterLabel.textContent = '🟡 Moderate';
  } else if (db < 90) {
    meterLabel.textContent = '🟠 Loud';
  } else {
    meterLabel.textContent = '🔴 Dangerous!';
  }

  // Also update manual dB field
  document.getElementById('input-db-manual').value = db.toFixed(1);

  // Draw waveform
  drawWaveform();

  animationFrameId = requestAnimationFrame(updateMeter);
}

function autoDetectGPS() {
  const gpsStatus = document.getElementById('gps-status');

  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  gpsStatus.querySelector('span').textContent = 'GPS: Locating...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById('input-lat').value =
        position.coords.latitude.toFixed(6);
      document.getElementById('input-lng').value =
        position.coords.longitude.toFixed(6);
      gpsStatus.classList.add('active');
      gpsStatus.querySelector('span').textContent = 'GPS: Locked ✓';
      showToast('GPS coordinates detected!', 'success');
    },
    (error) => {
      gpsStatus.querySelector('span').textContent = 'GPS: Failed';
      showToast('Could not get GPS location: ' + error.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function saveMeasurement() {
  const lat = parseFloat(document.getElementById('input-lat').value);
  const lng = parseFloat(document.getElementById('input-lng').value);
  const db =
    parseFloat(document.getElementById('input-db-manual').value) || currentDb;
  const location =
    document.getElementById('input-location').value || 'Custom Measurement';

  if (isNaN(lat) || isNaN(lng)) {
    showToast('Please enter valid GPS coordinates or use auto-detect', 'error');
    return;
  }

  if (db <= 0) {
    showToast('Please record or enter a decibel level', 'error');
    return;
  }

  try {
    const response = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: lat,
        longitude: lng,
        decibel: Math.round(db * 10) / 10,
        location: location,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      }),
    });

    const result = await response.json();
    if (response.ok) {
      showToast(
        `Measurement saved: ${db.toFixed(1)} dB at ${location}`,
        'success',
      );
      document.getElementById('input-location').value = '';
      document.getElementById('input-db-manual').value = '';
    } else {
      showToast(result.error || 'Failed to save', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ==================== CSV UPLOAD ====================
function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const btnUploadConfirm = document.getElementById('btn-upload-confirm');

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      previewCSV(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      previewCSV(e.dataTransfer.files[0]);
    }
  });

  btnUploadConfirm.addEventListener('click', uploadCSV);
}

let pendingFile = null;

function previewCSV(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please upload a CSV file', 'error');
    return;
  }

  pendingFile = file;
  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');

    if (lines.length < 2) {
      showToast('CSV file appears to be empty', 'error');
      return;
    }

    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines
      .slice(1)
      .map((line) => line.split(',').map((c) => c.trim()));

    const thead = document.getElementById('preview-thead');
    const tbody = document.getElementById('preview-tbody');

    thead.innerHTML =
      '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    tbody.innerHTML = rows
      .slice(0, 10)
      .map(
        (row) =>
          '<tr>' + row.map((cell) => `<td>${cell}</td>`).join('') + '</tr>',
      )
      .join('');

    document.getElementById('preview-count').textContent =
      `${rows.length} records${rows.length > 10 ? ' (showing first 10)' : ''}`;
    document.getElementById('preview-card').style.display = 'block';
  };

  reader.readAsText(file);
}

async function uploadCSV() {
  if (!pendingFile) {
    showToast('No file selected', 'error');
    return;
  }

  // Show progress bar
  const progressEl = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  progressEl.style.display = 'block';
  progressFill.style.width = '20%';
  progressText.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('file', pendingFile);

  try {
    progressFill.style.width = '60%';
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    progressFill.style.width = '90%';
    const result = await response.json();

    if (response.ok) {
      progressFill.style.width = '100%';
      progressText.textContent = 'Complete!';
      showToast(`${result.count} records uploaded successfully!`, 'success');

      setTimeout(() => {
        document.getElementById('preview-card').style.display = 'none';
        progressEl.style.display = 'none';
        progressFill.style.width = '0%';
        pendingFile = null;
        document.getElementById('file-input').value = '';
      }, 1500);
    } else {
      progressEl.style.display = 'none';
      showToast(result.error || 'Upload failed', 'error');
    }
  } catch (err) {
    progressEl.style.display = 'none';
    showToast('Network error: ' + err.message, 'error');
  }
}

// ==================== HEATMAP ====================
function initMapToolbar() {
  document
    .getElementById('btn-load-sample')
    .addEventListener('click', loadSampleData);
  document
    .getElementById('btn-refresh-map')
    .addEventListener('click', refreshMap);
  document
    .getElementById('btn-clear-data')
    .addEventListener('click', clearAllData);
}

function initMap() {
  map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([28.6139, 77.209], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  heatLayer = L.heatLayer([], {
    radius: 30,
    blur: 20,
    maxZoom: 17,
    max: 100,
    gradient: {
      0.0: '#10b981',
      0.3: '#22d3ee',
      0.5: '#f59e0b',
      0.7: '#f97316',
      1.0: '#ef4444',
    },
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

async function loadSampleData() {
  try {
    await fetch('/api/clear', { method: 'POST' });

    const response = await fetch('/api/sample');
    const blob = await response.blob();
    const file = new File([blob], 'sample_data.csv', { type: 'text/csv' });

    const formData = new FormData();
    formData.append('file', file);

    const uploadResponse = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await uploadResponse.json();
    if (uploadResponse.ok) {
      showToast(`Loaded ${result.count} sample data points`, 'success');
      refreshMap();
    }
  } catch (err) {
    showToast('Failed to load sample data: ' + err.message, 'error');
  }
}

async function refreshMap() {
  if (!map || !heatLayer || !markersLayer) return;

  try {
    const response = await fetch('/api/data');
    const data = await response.json();

    heatLayer.setLatLngs([]);
    markersLayer.clearLayers();

    if (data.length === 0) {
      showToast('No data to display on map', 'info');
      return;
    }

    const heatData = data.map((d) => [d.latitude, d.longitude, d.decibel]);
    heatLayer.setLatLngs(heatData);

    data.forEach((d) => {
      const color = getDbColor(d.decibel);
      const marker = L.circleMarker([d.latitude, d.longitude], {
        radius: 6,
        fillColor: color,
        color: color,
        fillOpacity: 0.8,
        weight: 1.5,
        opacity: 0.9,
      });

      marker.bindPopup(`
                <div class="popup-title">${d.location}</div>
                <div class="popup-db" style="color: ${color}">${d.decibel} dB</div>
                <div class="popup-meta">📍 ${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}</div>
                <div class="popup-meta">🕐 ${d.timestamp}</div>
            `);

      markersLayer.addLayer(marker);
    });

    const lats = data.map((d) => d.latitude);
    const lngs = data.map((d) => d.longitude);
    const bounds = L.latLngBounds(
      [Math.min(...lats) - 0.01, Math.min(...lngs) - 0.01],
      [Math.max(...lats) + 0.01, Math.max(...lngs) + 0.01],
    );
    map.fitBounds(bounds, { padding: [30, 30] });
  } catch (err) {
    showToast('Failed to load map data: ' + err.message, 'error');
  }
}

async function clearAllData() {
  if (!confirm('Are you sure you want to clear all data?')) return;

  try {
    await fetch('/api/clear', { method: 'POST' });
    if (heatLayer) heatLayer.setLatLngs([]);
    if (markersLayer) markersLayer.clearLayers();
    showToast('All data cleared', 'info');
  } catch (err) {
    showToast('Failed to clear data', 'error');
  }
}

function getDbColor(db) {
  if (db < 40) return '#10b981';
  if (db < 70) return '#f59e0b';
  if (db < 90) return '#f97316';
  return '#ef4444';
}

// ==================== ANALYTICS ====================
function initAnalytics() {
  document
    .getElementById('btn-refresh-analytics')
    .addEventListener('click', loadAnalytics);

  // Add SVG gradient for index ring
  const indexRing = document.querySelector('.index-ring');
  if (indexRing) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'linearGradient',
    );
    gradient.setAttribute('id', 'index-gradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '100%');

    const colors = [
      { offset: '0%', color: '#10b981' },
      { offset: '50%', color: '#f59e0b' },
      { offset: '100%', color: '#ef4444' },
    ];

    colors.forEach((c) => {
      const stop = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'stop',
      );
      stop.setAttribute('offset', c.offset);
      stop.setAttribute('stop-color', c.color);
      gradient.appendChild(stop);
    });

    defs.appendChild(gradient);
    indexRing.insertBefore(defs, indexRing.firstChild);
  }
}

async function loadAnalytics() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();

    if (stats.total === 0) {
      showToast(
        'No data available for analytics. Load sample data first!',
        'info',
      );
      return;
    }

    // Animate stat counters
    animateCounter('analytics-total', stats.total, 0);
    animateCounter('analytics-avg', stats.avg, 1);
    animateCounter('analytics-max', stats.max, 1);
    animateCounter('analytics-min', stats.min, 1);

    // Bounce stat cards
    document.querySelectorAll('.analytics-stat-card').forEach((card, i) => {
      card.classList.remove('stat-bounce');
      setTimeout(() => card.classList.add('stat-bounce'), i * 80);
    });

    // Update Noise Index
    updateNoiseIndex(stats.noise_index);

    // Update category badges
    document.getElementById('cat-count-quiet').textContent =
      stats.categories.quiet;
    document.getElementById('cat-count-moderate').textContent =
      stats.categories.moderate;
    document.getElementById('cat-count-loud').textContent =
      stats.categories.loud;
    document.getElementById('cat-count-danger').textContent =
      stats.categories.dangerous;

    // Render charts
    renderTopLocationsChart(stats.top_locations || []);
    renderCategoriesChart(stats.categories);
    renderTimelineChart(stats.time_series || []);

    analyticsLoaded = true;
  } catch (err) {
    showToast('Failed to load analytics: ' + err.message, 'error');
  }
}

function updateNoiseIndex(score) {
  const indexFill = document.getElementById('index-fill');
  const indexValue = document.getElementById('index-value');
  const indexVerdict = document.getElementById('index-verdict');

  // Animate ring
  const circumference = 2 * Math.PI * 80; // r=80
  const progress = Math.min(score / 100, 1);
  const offset = circumference - progress * circumference;

  // Delay for visual effect
  setTimeout(() => {
    indexFill.style.strokeDashoffset = offset;
  }, 200);

  // Animate number
  animateCounter('index-value', score, 1);

  // Verdict
  if (score < 25) {
    indexVerdict.textContent = '🟢 Excellent — Low noise pollution';
    indexVerdict.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    indexVerdict.style.color = '#10b981';
  } else if (score < 50) {
    indexVerdict.textContent = '🟡 Moderate — Some noise concerns';
    indexVerdict.style.borderColor = 'rgba(245, 158, 11, 0.3)';
    indexVerdict.style.color = '#f59e0b';
  } else if (score < 75) {
    indexVerdict.textContent = '🟠 High — Significant noise pollution';
    indexVerdict.style.borderColor = 'rgba(249, 115, 22, 0.3)';
    indexVerdict.style.color = '#f97316';
  } else {
    indexVerdict.textContent = '🔴 Severe — Dangerous noise levels';
    indexVerdict.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    indexVerdict.style.color = '#ef4444';
  }
}

function animateCounter(elementId, target, decimals) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const duration = 1200;
  const start = 0;
  const startTime = performance.now();

  function tick(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;

    el.textContent = current.toFixed(decimals);

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

// ==================== CHART RENDERING ====================
function getChartDefaults() {
  return {
    color: '#94a3b8',
    borderColor: 'rgba(255,255,255,0.06)',
    font: { family: "'Inter', sans-serif" },
  };
}

function renderTopLocationsChart(locations) {
  const ctx = document.getElementById('chart-top-locations');
  if (!ctx) return;

  if (chartTopLocations) chartTopLocations.destroy();

  const labels = locations.map((l) => {
    const name = l.location;
    return name.length > 18 ? name.substring(0, 18) + '…' : name;
  });
  const data = locations.map((l) => l.decibel);
  const colors = data.map((d) => {
    if (d < 40) return 'rgba(16, 185, 129, 0.8)';
    if (d < 70) return 'rgba(245, 158, 11, 0.8)';
    if (d < 90) return 'rgba(249, 115, 22, 0.8)';
    return 'rgba(239, 68, 68, 0.8)';
  });

  chartTopLocations = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Decibel Level',
          data,
          backgroundColor: colors,
          borderColor: colors.map((c) => c.replace('0.8', '1')),
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 26, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: (ctx) => `${ctx.parsed.x} dB`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { size: 11 } },
          title: { display: true, text: 'Decibel (dB)', color: '#64748b' },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 11 } },
        },
      },
      animation: {
        duration: 1200,
        easing: 'easeOutCubic',
      },
    },
  });
}

function renderCategoriesChart(categories) {
  const ctx = document.getElementById('chart-categories');
  if (!ctx) return;

  if (chartCategories) chartCategories.destroy();

  chartCategories = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Quiet', 'Moderate', 'Loud', 'Dangerous'],
      datasets: [
        {
          data: [
            categories.quiet,
            categories.moderate,
            categories.loud,
            categories.dangerous,
          ],
          backgroundColor: [
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(249, 115, 22, 0.8)',
            'rgba(239, 68, 68, 0.8)',
          ],
          borderColor: ['#10b981', '#f59e0b', '#f97316', '#ef4444'],
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 12,
            font: { size: 12 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 26, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed} readings`,
          },
        },
      },
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: 1400,
        easing: 'easeOutCubic',
      },
    },
  });
}

function renderTimelineChart(timeSeries) {
  const ctx = document.getElementById('chart-timeline');
  if (!ctx) return;

  if (chartTimeline) chartTimeline.destroy();

  const labels = timeSeries.map((d) => {
    const parts = d.timestamp.split(' ');
    return parts.length > 1 ? parts[1].substring(0, 5) : d.timestamp;
  });
  const data = timeSeries.map((d) => d.decibel);

  chartTimeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Noise Level (dB)',
          data,
          borderColor: '#00d4aa',
          backgroundColor: (context) => {
            const chart = context.chart;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return 'rgba(0, 212, 170, 0.1)';
            const grad = c.createLinearGradient(
              0,
              chartArea.top,
              0,
              chartArea.bottom,
            );
            grad.addColorStop(0, 'rgba(0, 212, 170, 0.25)');
            grad.addColorStop(1, 'rgba(0, 212, 170, 0.02)');
            return grad;
          },
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#00d4aa',
          pointBorderColor: '#0a0e1a',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#00d4aa',
          pointHoverBorderColor: '#fff',
        },
        {
          label: 'Safe Threshold (70 dB)',
          data: Array(data.length).fill(70),
          borderColor: 'rgba(239, 68, 68, 0.4)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          fill: false,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            usePointStyle: true,
            font: { size: 12 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 26, 0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          displayColors: true,
          callbacks: {
            title: (items) => `Time: ${items[0].label}`,
            label: (ctx) => {
              if (ctx.datasetIndex === 1) return '⚠️ Safe Threshold: 70 dB';
              return `📊 ${ctx.parsed.y.toFixed(1)} dB`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxTicksLimit: 15,
            maxRotation: 45,
          },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { size: 11 } },
          min: 0,
          max: 120,
          title: { display: true, text: 'Decibel (dB)', color: '#64748b' },
        },
      },
      animation: {
        duration: 1500,
        easing: 'easeOutCubic',
      },
    },
  });
}

// ==================== DATA TABLE ====================
function initDataTable() {
  document
    .getElementById('btn-export-csv')
    .addEventListener('click', exportCSV);
  document
    .getElementById('btn-refresh-data')
    .addEventListener('click', refreshDataTable);

  // Column sorting
  document.querySelectorAll('#data-table thead th').forEach((th) => {
    th.addEventListener('click', () => sortTable(th.dataset.sort));
  });

  // Search & Filter
  const searchInput = document.getElementById('data-search');
  const categoryFilter = document.getElementById('data-category-filter');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(applyFilters, 300));
  }
  if (categoryFilter) {
    categoryFilter.addEventListener('change', applyFilters);
  }
}

let currentSort = { field: null, asc: true };
let tableData = [];

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

async function refreshDataTable() {
  try {
    const response = await fetch('/api/data');
    tableData = await response.json();
    applyFilters();
  } catch (err) {
    showToast('Failed to load data', 'error');
  }
}

function applyFilters() {
  const searchTerm = (
    document.getElementById('data-search')?.value || ''
  ).toLowerCase();
  const category =
    document.getElementById('data-category-filter')?.value || 'all';

  let filtered = [...tableData];

  // Search filter
  if (searchTerm) {
    filtered = filtered.filter((d) =>
      d.location.toLowerCase().includes(searchTerm),
    );
  }

  // Category filter
  if (category && category !== 'all') {
    filtered = filtered.filter((d) => {
      const cat = getDbClass(d.decibel);
      if (category === 'dangerous') return cat === 'danger';
      return cat === category;
    });
  }

  renderDataTable(filtered);
}

function renderDataTable(data) {
  const tbody = document.getElementById('data-tbody');
  const emptyState = document.getElementById('empty-state');

  if (data.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.add('show');
    document.querySelector('#tab-data .table-wrapper').style.display = 'none';
  } else {
    emptyState.classList.remove('show');
    document.querySelector('#tab-data .table-wrapper').style.display = 'block';

    tbody.innerHTML = data
      .map((d, i) => {
        const dbClass = getDbClass(d.decibel);
        return `<tr>
                <td>${i + 1}</td>
                <td>${d.location}</td>
                <td><span class="db-pill ${dbClass}">${d.decibel} dB</span></td>
                <td>${d.latitude.toFixed(4)}</td>
                <td>${d.longitude.toFixed(4)}</td>
                <td>${d.timestamp}</td>
            </tr>`;
      })
      .join('');
  }

  // Update stats
  const allData = tableData.length > 0 ? tableData : data;
  if (allData.length > 0) {
    const dbs = allData.map((d) => d.decibel);
    const avg = (dbs.reduce((a, b) => a + b, 0) / dbs.length).toFixed(1);
    const max = Math.max(...dbs).toFixed(1);
    const min = Math.min(...dbs).toFixed(1);

    document.querySelector('#stat-total .stat-value').textContent =
      allData.length;
    document.querySelector('#stat-avg .stat-value').textContent = avg;
    document.querySelector('#stat-max .stat-value').textContent = max;
    document.querySelector('#stat-min .stat-value').textContent = min;

    // Bounce animation
    document.querySelectorAll('.stat-badge').forEach((badge, i) => {
      badge.classList.remove('stat-bounce');
      setTimeout(() => badge.classList.add('stat-bounce'), i * 60);
    });
  } else {
    document.querySelector('#stat-total .stat-value').textContent = '0';
    document.querySelector('#stat-avg .stat-value').textContent = '—';
    document.querySelector('#stat-max .stat-value').textContent = '—';
    document.querySelector('#stat-min .stat-value').textContent = '—';
  }
}

function getDbClass(db) {
  if (db < 40) return 'quiet';
  if (db < 70) return 'moderate';
  if (db < 90) return 'loud';
  return 'danger';
}

function sortTable(field) {
  if (!field || tableData.length === 0) return;

  if (currentSort.field === field) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.field = field;
    currentSort.asc = true;
  }

  const sorted = [...tableData].sort((a, b) => {
    let valA, valB;
    if (field === 'index') {
      return 0;
    } else if (
      field === 'decibel' ||
      field === 'latitude' ||
      field === 'longitude'
    ) {
      valA = a[field];
      valB = b[field];
    } else {
      valA = (a[field] || '').toString().toLowerCase();
      valB = (b[field] || '').toString().toLowerCase();
    }

    if (valA < valB) return currentSort.asc ? -1 : 1;
    if (valA > valB) return currentSort.asc ? 1 : -1;
    return 0;
  });

  renderDataTable(sorted);
}

function exportCSV() {
  window.location.href = '/api/export';
  showToast('Exporting CSV...', 'info');
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 3500);
}

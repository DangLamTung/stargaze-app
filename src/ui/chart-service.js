/**
 * ChartService — Chart.js weather visualizations
 * Dark theme, daily aggregation, "today" divider
 */

let charts = {};

const DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 800, easing: 'easeInOutQuart' },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true,
      labels: {
        color: '#94a3b8',
        font: { family: 'Inter', size: 12 },
        usePointStyle: true,
        pointStyleWidth: 8,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(100,116,139,0.3)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 12,
      titleFont: { family: 'Inter', weight: '600' },
      bodyFont: { family: 'Inter' },
      displayColors: true,
      boxPadding: 4,
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(100,116,139,0.1)', drawBorder: false },
      ticks: { color: '#64748b', font: { family: 'Inter', size: 11 }, maxRotation: 45, maxTicksLimit: 14 },
    },
    y: {
      grid: { color: 'rgba(100,116,139,0.1)', drawBorder: false },
      ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } },
    },
  },
};

const todayLinePlugin = {
  id: 'todayLine',
  afterDraw(chart) {
    const idx = chart.config.options._todayIndex;
    if (idx == null || idx < 0) return;
    const x = chart.scales.x.getPixelForValue(idx);
    const ctx = chart.ctx;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(0,212,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, chart.scales.y.top);
    ctx.lineTo(x, chart.scales.y.bottom);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,212,255,0.8)';
    ctx.font = '11px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Today', x, chart.scales.y.top - 6);
    ctx.restore();
  },
};

Chart.register(todayLinePlugin);

function getHourlyData(hourly) {
  // Only show ±12 hours from now (24-hour window)
  var now = Date.now();
  var windowStart = now - 12 * 3600 * 1000;
  var windowEnd = now + 12 * 3600 * 1000;

  return hourly
    .filter(function (h) {
      var t = new Date(h.time).getTime();
      return t >= windowStart && t <= windowEnd;
    })
    .map(function (h) {
      return {
        date: h.time,
        label: new Date(h.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }),
        temp: h.temperature,
        humidity: h.humidity,
        cloudCover: h.cloudCover,
        cloudCoverLow: h.cloudCoverLow,
        cloudCoverMid: h.cloudCoverMid,
        cloudCoverHigh: h.cloudCoverHigh,
        visibility: h.visibility,
        windSpeed: h.windSpeed,
        precipProb: h.precipProbability,
      };
    });
}

function todayIdx(agg) {
  const t = new Date();
  return agg.findIndex(d => new Date(d.date) >= t);
}

const ZOOM_CONFIG = {
  zoom: {
    pan: { enabled: true, mode: 'x', modifierKey: null },
    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  },
};

function makeChart(id, hourly, config) {
  const data = getHourlyData(hourly);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();

  config.options = config.options || {};
  config.options.plugins = { ...config.options.plugins, ...ZOOM_CONFIG };
  config.options._todayIndex = todayIdx(data);

  config.data.labels = data.map(d => d.label);
  config.data.datasets.forEach(ds => {
    if (ds._dataFn) ds.data = data.map(ds._dataFn);
  });
  charts[id] = new Chart(ctx, config);
}

export function createCloudCoverChart(id, hourly) {
  makeChart(id, hourly, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Total',
          _dataFn: d => d.cloudCover,
          borderColor: '#64748b',
          backgroundColor: 'rgba(100,116,139,0.15)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#64748b',
        },
        {
          label: 'High',
          _dataFn: d => d.cloudCoverHigh,
          borderColor: '#a78bfa',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderDash: [4, 4],
        },
        {
          label: 'Mid',
          _dataFn: d => d.cloudCoverMid,
          borderColor: '#38bdf8',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderDash: [4, 4],
        },
        {
          label: 'Low',
          _dataFn: d => d.cloudCoverLow,
          borderColor: '#fb923c',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      ...DEFAULTS,
      scales: {
        ...DEFAULTS.scales,
        y: { ...DEFAULTS.scales.y, min: 0, max: 100, ticks: { ...DEFAULTS.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  });
}

export function createTemperatureChart(id, hourly) {
  makeChart(id, hourly, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperature',
          _dataFn: d => d.temp,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.12)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#f97316',
        },
      ],
    },
    options: {
      ...DEFAULTS,
      scales: {
        ...DEFAULTS.scales,
        y: { ...DEFAULTS.scales.y, ticks: { ...DEFAULTS.scales.y.ticks, callback: v => v + '°C' } },
      },
    },
  });
}

export function createHumidityChart(id, hourly) {
  makeChart(id, hourly, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Humidity',
          _dataFn: d => d.humidity,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.12)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#38bdf8',
        },
      ],
    },
    options: {
      ...DEFAULTS,
      scales: {
        ...DEFAULTS.scales,
        y: { ...DEFAULTS.scales.y, min: 0, max: 100, ticks: { ...DEFAULTS.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  });
}

export function createVisibilityChart(id, hourly) {
  makeChart(id, hourly, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Visibility',
          _dataFn: d => (d.visibility ? Math.round(d.visibility / 1000) : null),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,0.12)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#34d399',
        },
      ],
    },
    options: {
      ...DEFAULTS,
      scales: {
        ...DEFAULTS.scales,
        y: { ...DEFAULTS.scales.y, min: 0, ticks: { ...DEFAULTS.scales.y.ticks, callback: v => v + ' km' } },
      },
    },
  });
}

export function createAllCharts(hourly) {
  createCloudCoverChart('chart-cloud-cover', hourly);
  createTemperatureChart('chart-temperature', hourly);
  createHumidityChart('chart-humidity', hourly);
  createVisibilityChart('chart-visibility', hourly);
}

export function destroyAllCharts() {
  Object.values(charts).forEach(c => c?.destroy());
  charts = {};
}

export function resizeAllCharts() {
  Object.values(charts).forEach(c => {
    try {
      c.resize();
    } catch (e) {}
  });
}

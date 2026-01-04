(() => {
  const DATA_URL = "https://weather.etfnordic.workers.dev/api/stations";
  const TEMP_MIN = -40;
  const TEMP_MAX = 40;

  const legendMinEl = document.getElementById("legendMin");
  const legendMaxEl = document.getElementById("legendMax");
  const statusEl = document.getElementById("status");
  const highestEl = document.getElementById("highest");
  const lowestEl = document.getElementById("lowest");

  if (legendMinEl) legendMinEl.textContent = `${TEMP_MIN}°C`;
  if (legendMaxEl) legendMaxEl.textContent = `+${TEMP_MAX}°C`;

  const map = L.map("map", { zoomControl: true }).setView([62.5, 16.5], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function lerpColor(stops, t) {
    t = clamp(t, 0, 1);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const local = (t - a.t) / (b.t - a.t || 1);
        const r = Math.round(lerp(a.r, b.r, local));
        const g = Math.round(lerp(a.g, b.g, local));
        const bl = Math.round(lerp(a.b, b.b, local));
        return rgbToHex(r, g, bl);
      }
    }
    const last = stops[stops.length - 1];
    return rgbToHex(last.r, last.g, last.b);
  }

  const COLOR_STOPS = [
    { t: 0.00, r: 0, g: 0, b: 0 },
    { t: 0.25, r: 0, g: 43, b: 127 },
    { t: 0.4375, r: 30, g: 108, b: 255 },
    { t: 0.50, r: 0, g: 176, b: 80 },
    { t: 0.75, r: 255, g: 210, b: 0 },
    { t: 1.00, r: 192, g: 0, b: 0 },
  ];

  function colorForTemp(temp) {
    const t = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    return lerpColor(COLOR_STOPS, t);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtTimeHHMM(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  }

  function fmtNewest(d) {
    return d.toLocaleString("sv-SE", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function markerSizeForZoom(z) {
    if (z <= 4) return 16;
    if (z === 5) return 18;
    if (z === 6) return 20;
    if (z === 7) return 22;
    if (z === 8) return 24;
    if (z === 9) return 26;
    if (z === 10) return 28;
    return 30;
  }

  function fontSizeForMarker(size) {
    if (size <= 16) return 10;
    if (size <= 20) return 11;
    if (size <= 24) return 12;
    if (size <= 28) return 13;
    return 14;
  }

  function makeTempDivIcon(temp, color, size) {
    const text = `${Math.round(temp)}`;
    const fontSize = fontSizeForMarker(size);
    const html = `
      <div style="
        width:${size}px;height:${size}px;
        border-radius:999px;
        background:${color};
        display:flex;
        align-items:center;
        justify-content:center;
        color:#fff;
        font-weight:600;
        font-size:${fontSize}px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 10px 22px rgba(0,0,0,0.28);
        text-shadow:0 1px 2px rgba(0,0,0,0.65);
        user-select:none;
        line-height:1;
      ">${escapeHtml(text)}</div>
    `;
    const icon = L.divIcon({
      className: "",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
    icon._temp = temp;
    return icon;
  }

  const markerLayer = L.layerGroup();

  const clusterLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 9,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function (cluster) {
      const ms = cluster.getAllChildMarkers();
      let sum = 0, n = 0;

      for (const m of ms) {
        const t = Number(m?.options?.icon?._temp);
        if (Number.isFinite(t)) { sum += t; n++; }
      }

      const avg = n ? sum / n : 0;
      const label = Math.round(avg);
      const color = colorForTemp(avg);

      const html = `
        <div style="
          width:44px;height:44px;border-radius:999px;
          background:${color};
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:700;font-size:14px;
          box-shadow:0 10px 22px rgba(0,0,0,0.28);
          text-shadow:0 1px 2px rgba(0,0,0,0.65);
          user-select:none;
        ">${label}°</div>
      `;

      return L.divIcon({ html, className: "", iconSize: [44, 44] });
    },
  });

  let heatLayer = null;
  let lastPoints = [];

  function popupHtml(p) {
    return `
      <div style="font: 14px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
        <div><strong>${escapeHtml(p.name ?? "Station")}</strong></div>
        <div>Temp: <strong>${escapeHtml(String(p.airTemp))}°C</strong></div>
        <div style="opacity:.75;margin-top:4px;">${escapeHtml(fmtTimeHHMM(p.updatedAt))}</div>
      </div>
    `;
  }

  function buildHeat(points) {
    const heatPoints = [];

    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;

      const tNorm = clamp((temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
      heatPoints.push([p.lat, p.lon, tNorm]);
    }

    if (heatLayer) map.removeLayer(heatLayer);

    heatLayer = L.heatLayer(heatPoints, {
      radius: 35,
      blur: 28,
      maxZoom: 8,
      minOpacity: 0.35,
      gradient: {
        0.00: "#000000",
        0.25: "#002b7f",
        0.44: "#1e6cff",
        0.50: "#00b050",
        0.75: "#ffd200",
        1.00: "#c00000",
      },
    });
  }

  function buildClusters(points) {
    clusterLayer.clearLayers();
    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;
      const icon = makeTempDivIcon(temp, colorForTemp(temp), 18);
      const m = L.marker([p.lat, p.lon], { icon });
      m.bindPopup(popupHtml(p));
      clusterLayer.addLayer(m);
    }
  }

  function buildMarkers(points) {
    markerLayer.clearLayers();
    const size = markerSizeForZoom(map.getZoom());
    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;
      const icon = makeTempDivIcon(temp, colorForTemp(temp), size);
      const m = L.marker([p.lat, p.lon], { icon });
      m.bindPopup(popupHtml(p));
      markerLayer.addLayer(m);
    }
  }

  function setLayersForZoom() {
    const z = map.getZoom();
    const showMarkers = z >= 9;

    if (!heatLayer) return;

    if (showMarkers) {
      if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      if (map.hasLayer(clusterLayer)) map.removeLayer(clusterLayer);
      if (!map.hasLayer(markerLayer)) markerLayer.addTo(map);
    } else {
      if (!map.hasLayer(heatLayer)) heatLayer.addTo(map);
      if (!map.hasLayer(clusterLayer)) clusterLayer.addTo(map);
      if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
    }
  }

  function updateStatus(points) {
    let newest = null;
    let minP = null;
    let maxP = null;

    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;

      if (!minP || temp < minP.airTemp) minP = { airTemp: temp, name: p.name ?? "Okänd" };
      if (!maxP || temp > maxP.airTemp) maxP = { airTemp: temp, name: p.name ?? "Okänd" };

      if (p.updatedAt) {
        const d = new Date(p.updatedAt);
        if (!isNaN(d) && (!newest || d > newest)) newest = d;
      }
    }

    if (highestEl && lowestEl) {
      if (minP && maxP) {
        highestEl.textContent = `Högst: ${maxP.airTemp}°C – ${maxP.name}`;
        lowestEl.textContent = `Lägst: ${minP.airTemp}°C – ${minP.name}`;
      } else {
        highestEl.textContent = "Högst: –";
        lowestEl.textContent = "Lägst: –";
      }
    }

    const newestText = newest ? ` • Senaste mätning: ${fmtNewest(newest)}` : "";
    if (statusEl) statusEl.textContent = `Stationer: ${points.length}${newestText}`;
  }

  function render(points) {
    lastPoints = points;
    buildHeat(points);
    buildClusters(points);
    buildMarkers(points);
    setLayersForZoom();
    updateStatus(points);
  }

  async function load() {
    try {
      if (statusEl) statusEl.textContent = "Hämtar data…";
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.textContent = "Kunde inte hämta data (kolla console).";
      if (highestEl) highestEl.textContent = "Högst: –";
      if (lowestEl) lowestEl.textContent = "Lägst: –";
    }
  }

  load();
  setInterval(load, 60_000);

  let zoomTimer = null;
  map.on("zoomend", () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      setLayersForZoom();
      if (map.getZoom() >= 9 && lastPoints.length) buildMarkers(lastPoints);
    }, 60);
  });
})();

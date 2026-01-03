(() => {
  const DATA_URL = "https://weather.etfnordic.workers.dev/api/stations";

  const TEMP_MIN = -35;
  const TEMP_MAX = 35;

  document.getElementById("legendMin").textContent = `${TEMP_MIN}°C`;
  document.getElementById("legendMax").textContent = `+${TEMP_MAX}°C`;

  const map = L.map("map", { zoomControl: true }).setView([62.5, 16.5], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const statusEl = document.getElementById("status");
  const extremesEl = document.getElementById("extremes");
  
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
    { t: 0.00, r: 43,  g: 27,  b: 90  },
    { t: 0.20, r: 42,  g: 75,  b: 215 },
    { t: 0.40, r: 41,  g: 182, b: 246 },
    { t: 0.55, r: 46,  g: 204, b: 113 },
    { t: 0.70, r: 241, g: 196, b: 15  },
    { t: 0.82, r: 255, g: 140, b: 0   },
    { t: 1.00, r: 231, g: 76,  b: 60  },
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

  function fmtTempLabel(temp) {
    const v = Math.round(temp);
    return `${v}`;
  }

  function fmtTempPopup(temp) {
    const v = Math.round(temp * 10) / 10;
    return v.toFixed(1);
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;

    return d.toLocaleString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }


  function markerSizeForZoom(z) {
    if (z <= 4) return 18;
    if (z === 5) return 20;
    if (z === 6) return 22;
    if (z === 7) return 24;
    if (z === 8) return 26;
    if (z === 9) return 28;
    if (z === 10) return 30;
    return 32;
  }

  function fontSizeForMarker(size) {
    if (size <= 18) return 10;
    if (size <= 22) return 11;
    if (size <= 26) return 12;
    if (size <= 30) return 13;
    return 14;
  }

  function makeTempDivIcon(temp, color, size) {
    const text = fmtTempLabel(temp);
    const fontSize = fontSizeForMarker(size);

    const html = `
      <div style="
        width:${size}px;height:${size}px;
        border-radius:999px;
        background:${color};
        border:0;
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

    return L.divIcon({
      className: "",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  let lastPoints = [];

  function render(points) {
    lastPoints = points;
    layer.clearLayers();

    const z = map.getZoom();
    const size = markerSizeForZoom(z);

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

      const color = colorForTemp(temp);
      const icon = makeTempDivIcon(temp, color, size);

      const m = L.marker([p.lat, p.lon], { icon });

      const popup = `
        <div style="font: 14px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
          <div><strong>${escapeHtml(p.name ?? "Station")}</strong></div>
          <div>Temp: <strong>${escapeHtml(fmtTempPopup(temp))}°C</strong></div>
          <div style="opacity:.75;margin-top:4px;">${escapeHtml(fmtTime(p.updatedAt))}</div>
        </div>
      `;
      m.bindPopup(popup);
      m.addTo(layer);
    }

    if (extremesEl) {
      if (minP && maxP) {
        extremesEl.textContent = `Lägst: ${minP.airTemp}°C – ${minP.name}  •  Högst: ${maxP.airTemp}°C – ${maxP.name}`;
      } else {
        extremesEl.textContent = "Lägst: –  •  Högst: –";
      }
    }

    
    const newestText = newest
      ? ` • Senaste mätning: ${newest.toLocaleString("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";


  async function load() {
    try {
      statusEl.textContent = "Hämtar data…";
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Kunde inte hämta data (kolla console).";
    }
  }

  load();
  setInterval(load, 60_000);

  let zoomTimer = null;
  map.on("zoomend", () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      if (lastPoints.length) render(lastPoints);
    }, 80);
  });
})();

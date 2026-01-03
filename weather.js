(() => {
  const DATA_URL = "https://weather.etfnordic.workers.dev/api/stations";

  const TEMP_MIN = -25;
  const TEMP_MAX = 25;

  document.getElementById("legendMin").textContent = `${TEMP_MIN}°C`;
  document.getElementById("legendMax").textContent = `+${TEMP_MAX}°C`;

  const map = L.map("map", { zoomControl: true }).setView([62.5, 16.5], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const statusEl = document.getElementById("status");

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

  function fmtTemp(x) {
    const v = Math.round(x);
    return `${v}`;
  }

  function fmtTempPopup(x) {
    const v = Math.round(x * 10) / 10;
    return v.toFixed(1);
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("sv-SE");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function markerSizeForZoom(z) {
    const base = z <= 5 ? 26 : z <= 7 ? 30 : z <= 9 ? 34 : 38;
    return base;
  }

  function makeTempDivIcon(temp, color, size) {
    const text = fmtTemp(temp);
    const fontSize = size <= 26 ? 11 : size <= 30 ? 12 : size <= 34 ? 13 : 14;
    const border = "rgba(255,255,255,0.85)";

    const html = `
      <div style="
        width:${size}px;height:${size}px;
        border-radius:999px;
        background:${color};
        border:2px solid ${border};
        display:flex;
        align-items:center;
        justify-content:center;
        color:#0b1220;
        font-weight:800;
        font-size:${fontSize}px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 8px 18px rgba(0,0,0,0.25);
        text-shadow:none;
        user-select:none;
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

  function render(points) {
    layer.clearLayers();

    const z = map.getZoom();
    const size = markerSizeForZoom(z);

    let newest = null;

    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;

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

    const newestText = newest ? ` • Senaste mätning: ${newest.toLocaleString("sv-SE")}` : "";
    statusEl.textContent = `Stationer: ${points.length}${newestText}`;
  }

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
    zoomTimer = setTimeout(load, 150);
  });
})();

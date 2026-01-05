(() => {
  const DATA_URL = "https://weather.etfnordic.workers.dev/api/stations";
  const SWEDEN_GEOJSON_URL = "./se.json";

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
    { t: 0.0, r: 0, g: 0, b: 0 },
    { t: 0.25, r: 0, g: 43, b: 127 },
    { t: 0.4375, r: 30, g: 108, b: 255 },
    { t: 0.5, r: 0, g: 176, b: 80 },
    { t: 0.75, r: 255, g: 210, b: 0 },
    { t: 1.0, r: 192, g: 0, b: 0 },
  ];

  function colorForTemp(temp) {
    const t = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    return lerpColor(COLOR_STOPS, t);
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
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
        font-weight:700;
        font-size:${fontSize}px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 10px 22px rgba(0,0,0,0.28);
        text-shadow:0 1px 2px rgba(0,0,0,0.65);
        user-select:none;
        line-height:1;
      ">${escapeHtml(text)}°</div>
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

  function popupHtml(p) {
    return `
      <div style="font: 14px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
        <div><strong>${escapeHtml(p.name ?? "Station")}</strong></div>
        <div>Temp: <strong>${escapeHtml(String(p.airTemp))}°C</strong></div>
        <div style="opacity:.75;margin-top:4px;">${escapeHtml(fmtTimeHHMM(p.updatedAt))}</div>
      </div>
    `;
  }

  let swedenPaths = null;

  function decimateRing(ring, step) {
    if (!ring || ring.length < 4) return ring || [];
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push(first);
    return out;
  }

  function preprocessSweden(geojson) {
    const paths = [];
    const feats = geojson?.features || [];
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;

      const pushPoly = (coords) => {
        const rings = [];
        for (const ring of coords) {
          const step =
            ring.length > 8000 ? 14 :
            ring.length > 3000 ? 10 :
            ring.length > 1200 ? 6 :
            ring.length > 600 ? 4 : 2;
          rings.push(decimateRing(ring, step));
        }
        paths.push({ rings });
      };

      if (g.type === "Polygon") pushPoly(g.coordinates);
      if (g.type === "MultiPolygon") for (const poly of g.coordinates) pushPoly(poly);
    }
    return paths;
  }

  async function loadSwedenGeoJSON() {
    try {
      const res = await fetch(SWEDEN_GEOJSON_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
      const gj = await res.json();
      swedenPaths = preprocessSweden(gj);
    } catch (e) {
      console.warn("Could not load Sweden GeoJSON:", e);
      swedenPaths = null;
    }
  }

  let spatialBins = new Map();
  let lastPoints = [];
  let pointsVersion = 0;

  function binKey(lat, lon) {
    const la = Math.floor(lat * 2);
    const lo = Math.floor(lon * 2);
    return `${la}:${lo}`;
  }

  function rebuildBins(points) {
    spatialBins = new Map();
    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;
      const k = binKey(p.lat, p.lon);
      let arr = spatialBins.get(k);
      if (!arr) { arr = []; spatialBins.set(k, arr); }
      arr.push({ lat: p.lat, lon: p.lon, temp });
    }
  }

  function candidatesAround(lat, lon, need = 28) {
    const la = Math.floor(lat * 2);
    const lo = Math.floor(lon * 2);
    const out = [];
    for (let d = 0; d <= 6; d++) {
      for (let y = la - d; y <= la + d; y++) {
        for (let x = lo - d; x <= lo + d; x++) {
          const arr = spatialBins.get(`${y}:${x}`);
          if (arr) out.push(...arr);
        }
      }
      if (out.length >= need) break;
    }
    return out;
  }

  function idwTemp(lat, lon) {
    const cand = candidatesAround(lat, lon, 34);
    if (!cand.length) return null;

    let num = 0;
    let den = 0;

    for (let i = 0; i < cand.length; i++) {
      const p = cand[i];
      const dLat = lat - p.lat;
      const dLon = lon - p.lon;
      const dist2 = dLat * dLat + dLon * dLon;

      if (dist2 < 1e-10) return p.temp;

      const dist = Math.sqrt(dist2);
      if (dist > 2.8) continue;

      const w = 1 / Math.pow(dist + 0.18, 0.75);
      num += w * p.temp;
      den += w;
    }

    if (den <= 0) return null;
    return num / den;
  }

  class TempFieldCanvasLayer extends L.Layer {
    constructor() {
      super();
      this._canvas = null;
      this._ctx = null;
      this._raf = 0;
      this._pending = false;
      this._lastSig = "";
      this._topLeft = L.point(0, 0);
      this._zoom = null;
      this._center = null;

      this._off = document.createElement("canvas");
      this._off2 = document.createElement("canvas");
      this._offCtx = this._off.getContext("2d", { willReadFrequently: false });
      this._off2Ctx = this._off2.getContext("2d", { willReadFrequently: false });

      this.opacity = 0.72;
      this.blur1 = 10;
      this.blur2 = 20;
      this.gridStep = 6;
      this.alpha = 0.80;
      this.downscale = 1.8;
    }

    onAdd() {
      this._canvas = document.createElement("canvas");
      this._canvas.className = "leaflet-zoom-animated";
      this._canvas.style.position = "absolute";
      this._canvas.style.top = "0";
      this._canvas.style.left = "0";
      this._canvas.style.pointerEvents = "none";
      this._canvas.style.opacity = String(this.opacity);
      this._ctx = this._canvas.getContext("2d", { willReadFrequently: false });

      map.getPanes().overlayPane.appendChild(this._canvas);

      map.on("moveend", this._reset, this);
      map.on("zoomend", this._reset, this);
      map.on("resize", this._reset, this);
      map.on("zoomanim", this._animateZoom, this);
      map.on("movestart", this._invalidateSig, this);

      this._reset();
    }

    onRemove() {
      map.off("moveend", this._reset, this);
      map.off("zoomend", this._reset, this);
      map.off("resize", this._reset, this);
      map.off("zoomanim", this._animateZoom, this);
      map.off("movestart", this._invalidateSig, this);

      if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._ctx = null;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    _invalidateSig() {
      this._lastSig = "";
    }

    setOpacity(op) {
      this.opacity = op;
      if (this._canvas) this._canvas.style.opacity = String(op);
    }

    redraw() {
      this._schedule(true);
    }

    _reset() {
      if (!this._canvas || !this._ctx) return;

      const size = map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      this._canvas.style.opacity = String(this.opacity);

      this._topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, this._topLeft);

      this._zoom = map.getZoom();
      this._center = map.getCenter();
      this._canvas.style.transform = "";

      this._schedule(true);
    }

    _animateZoom(e) {
      if (!this._canvas) return;

      const scale = map.getZoomScale(e.zoom, this._zoom);
      const position = L.DomUtil.getPosition(this._canvas);
      const viewHalf = map.getSize().multiplyBy(0.5);

      const currentCenterPoint = map.project(this._center, e.zoom);
      const destCenterPoint = map.project(e.center, e.zoom);
      const centerOffset = destCenterPoint.subtract(currentCenterPoint);

      const topLeftOffset = viewHalf
        .multiplyBy(-scale)
        .add(position)
        .add(viewHalf)
        .subtract(centerOffset);

      L.DomUtil.setTransform(this._canvas, topLeftOffset, scale);
    }

    _schedule(force = false) {
      if (!this._canvas || !this._ctx) return;
      if (this._raf) {
        this._pending = this._pending || force;
        return;
      }
      this._pending = force;
      this._raf = requestAnimationFrame(() => {
        const f = this._pending;
        this._pending = false;
        this._raf = 0;
        this._render(f);
      });
    }

    _clipSweden(ctx) {
      if (!swedenPaths) return;
      ctx.beginPath();
      for (const poly of swedenPaths) {
        for (const ring of poly.rings) {
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            const lp = map.latLngToLayerPoint([lat, lng]);
            const x = lp.x - this._topLeft.x;
            const y = lp.y - this._topLeft.y;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      }
      ctx.clip("evenodd");
    }

    _maskOffscreen(ctxOff, scaleX, scaleY) {
      if (!swedenPaths) return;
      ctxOff.globalCompositeOperation = "destination-in";
      ctxOff.fillStyle = "#000";
      ctxOff.beginPath();

      for (const poly of swedenPaths) {
        for (const ring of poly.rings) {
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            const lp = map.latLngToLayerPoint([lat, lng]);
            const x = (lp.x - this._topLeft.x) / scaleX;
            const y = (lp.y - this._topLeft.y) / scaleY;
            if (i === 0) ctxOff.moveTo(x, y);
            else ctxOff.lineTo(x, y);
          }
          ctxOff.closePath();
        }
      }

      ctxOff.fill("evenodd");
      ctxOff.globalCompositeOperation = "source-over";
    }

    _render(force) {
      if (!this._canvas || !this._ctx) return;

      const w = this._canvas.width;
      const h = this._canvas.height;

      const b = map.getBounds();
      const z = map.getZoom();
      const sig = `${w}x${h}|z${z}|${b.getSouthWest().lat.toFixed(3)},${b.getSouthWest().lng.toFixed(3)}|v${pointsVersion}|g${this.gridStep}|d${this.downscale}|b${this.blur1},${this.blur2}`;
      if (!force && sig === this._lastSig) return;
      this._lastSig = sig;

      const offW = Math.max(320, Math.floor(w / this.downscale));
      const offH = Math.max(320, Math.floor(h / this.downscale));
      this._off.width = offW;
      this._off.height = offH;
      this._off2.width = offW;
      this._off2.height = offH;

      const ctxOff = this._offCtx;
      const ctxOff2 = this._off2Ctx;
      ctxOff.clearRect(0, 0, offW, offH);
      ctxOff2.clearRect(0, 0, offW, offH);

      const img = ctxOff.createImageData(offW, offH);
      const data = img.data;

      const step = Math.max(4, Math.floor(this.gridStep));
      const scaleX = w / offW;
      const scaleY = h / offH;

      for (let y = 0; y < offH; y += step) {
        for (let x = 0; x < offW; x += step) {
          const cx = x * scaleX;
          const cy = y * scaleY;

          const lp = L.point(this._topLeft.x + cx, this._topLeft.y + cy);
          const ll = map.layerPointToLatLng(lp);

          const t = idwTemp(ll.lat, ll.lng);
          if (t === null) continue;

          const tt = clamp(t, -38, 18);
          const c = hexToRgb(colorForTemp(tt));

          for (let yy = 0; yy < step; yy++) {
            for (let xx = 0; xx < step; xx++) {
              const px = x + xx;
              const py = y + yy;
              if (px >= offW || py >= offH) continue;
              const idx = (py * offW + px) * 4;
              data[idx] = c.r;
              data[idx + 1] = c.g;
              data[idx + 2] = c.b;
              data[idx + 3] = Math.round(255 * this.alpha);
            }
          }
        }
      }

      ctxOff.putImageData(img, 0, 0);
      this._maskOffscreen(ctxOff, scaleX, scaleY);

      ctxOff2.filter = `blur(${this.blur1}px)`;
      ctxOff2.clearRect(0, 0, offW, offH);
      ctxOff2.drawImage(this._off, 0, 0, offW, offH);
      ctxOff2.filter = "none";
      this._maskOffscreen(ctxOff2, scaleX, scaleY);

      const ctx = this._ctx;
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      this._clipSweden(ctx);

      ctx.imageSmoothingEnabled = true;

      ctx.filter = `blur(${this.blur2}px)`;
      ctx.drawImage(this._off2, 0, 0, offW, offH, 0, 0, w, h);

      ctx.filter = "none";
      ctx.globalAlpha = 0.88;
      ctx.drawImage(this._off2, 0, 0, offW, offH, 0, 0, w, h);
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  const tempFieldLayer = new TempFieldCanvasLayer();
  tempFieldLayer.addTo(map);

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
          color:#fff;font-weight:700;font-size:13px;
          box-shadow:0 10px 22px rgba(0,0,0,0.28);
          text-shadow:0 1px 2px rgba(0,0,0,0.65);
          user-select:none;
        ">${label}°</div>
      `;
      return L.divIcon({ html, className: "", iconSize: [44, 44] });
    },
  });

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

    if (showMarkers) {
      if (map.hasLayer(clusterLayer)) map.removeLayer(clusterLayer);
      if (!map.hasLayer(markerLayer)) markerLayer.addTo(map);
      tempFieldLayer.setOpacity(0.75);
      tempFieldLayer.gridStep = 5;
      tempFieldLayer.downscale = 1.55;
      tempFieldLayer.blur1 = 8;
      tempFieldLayer.blur2 = 14;
    } else {
      if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
      if (!map.hasLayer(clusterLayer)) clusterLayer.addTo(map);
      tempFieldLayer.setOpacity(0.72);
      tempFieldLayer.gridStep = 6;
      tempFieldLayer.downscale = 1.8;
      tempFieldLayer.blur1 = 10;
      tempFieldLayer.blur2 = 20;
    }

    tempFieldLayer.redraw();
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
    rebuildBins(points);
    buildClusters(points);
    buildMarkers(points);
    updateStatus(points);
    pointsVersion++;
    setLayersForZoom();
  }

  async function loadStations() {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async function load() {
    try {
      if (statusEl) statusEl.textContent = "Hämtar data…";
      const points = await loadStations();
      render(points);
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.textContent = "Kunde inte hämta data (kolla console).";
      if (highestEl) highestEl.textContent = "Högst: –";
      if (lowestEl) lowestEl.textContent = "Lägst: –";
    }
  }

  (async () => {
    await loadSwedenGeoJSON();
    await load();
    setInterval(load, 60_000);

    map.on("zoomend", () => {
      setLayersForZoom();
      if (map.getZoom() >= 9 && lastPoints.length) buildMarkers(lastPoints);
    });

    map.on("moveend", () => {
      tempFieldLayer.redraw();
    });
  })();
})();

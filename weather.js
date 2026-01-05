(() => {
  // -----------------------------
  // Config
  // -----------------------------
  const DATA_URL = "https://weather.etfnordic.workers.dev/api/stations";
  const SWEDEN_GEOJSON_URL = "./se.json";

  const TEMP_MIN = -40;
  const TEMP_MAX = 40;
  const STALE_MINUTES = 90;

  // Samma stopp används för både legend och färgberäkning.
  const COLOR_STOPS = [
    { t: 0.0, hex: "#000000" },
    { t: 0.25, hex: "#002b7f" },
    { t: 0.4375, hex: "#1e6cff" },
    { t: 0.5, hex: "#00b050" },
    { t: 0.75, hex: "#ffd200" },
    { t: 1.0, hex: "#c00000" },
  ];

  // IDW-parametrar. (Justera om du vill att fältet ska bli "hårdare" eller "mjukare").
  const IDW = {
    radius: 2.8,
    maxCandidates: 34,
    power: 0.75,
    softening: 0.18,
  };

  // -----------------------------
  // DOM
  // -----------------------------
  const el = (id) => document.getElementById(id);
  const statusEl = el("status");
  const highestEl = el("highest");
  const lowestEl = el("lowest");
  const legendMinEl = el("legendMin");
  const legendMaxEl = el("legendMax");
  const sourceEl = el("source");
  const freshnessEl = el("freshness");
  const panelToggle = el("panelToggle");
  const panel = document.querySelector(".panel");

  const toggleField = el("toggleField");
  const toggleStations = el("toggleStations");
  const toggleContours = el("toggleContours");
  const opacity = el("opacity");
  const opacityOut = el("opacityOut");

  if (legendMinEl) legendMinEl.textContent = `${TEMP_MIN}°C`;
  if (legendMaxEl) legendMaxEl.textContent = `${TEMP_MAX > 0 ? "+" : ""}${TEMP_MAX}°C`;
  if (sourceEl) sourceEl.textContent = "Data: Observationsstationer (SMHI/aggregat)";

  // Panel collapse (bra på mobil)
  panelToggle?.addEventListener("click", () => {
    const collapsed = panel?.classList.toggle("panel--collapsed");
    panelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  function setOpacityUI(v) {
    const pct = Math.round(v);
    if (opacityOut) opacityOut.textContent = `${pct}%`;
  }
  setOpacityUI(Number(opacity?.value ?? 72));

  // -----------------------------
  // Helpers
  // -----------------------------
  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function lerpColor(stops, t) {
    t = clamp(t, 0, 1);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const local = (t - a.t) / (b.t - a.t || 1);
        const A = hexToRgb(a.hex);
        const B = hexToRgb(b.hex);
        return rgbToHex(
          Math.round(lerp(A.r, B.r, local)),
          Math.round(lerp(A.g, B.g, local)),
          Math.round(lerp(A.b, B.b, local))
        );
      }
    }
    return stops[stops.length - 1].hex;
  }

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

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function minutesSince(iso) {
    if (!iso) return 0;
    const d = new Date(iso);
    if (isNaN(d)) return 0;
    return Math.floor((Date.now() - d.getTime()) / 60000);
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

  function makeTempDivIcon({ temp, stale, size }) {
    const text = `${Math.round(temp)}`;
    const fontSize = fontSizeForMarker(size);
    const bg = stale ? "rgba(255,255,255,.18)" : colorForTemp(temp);
    const fg = stale ? "rgba(255,255,255,.92)" : "#fff";
    const ring = stale ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.12)";
    const html = `
      <div style="
        width:${size}px;height:${size}px;
        border-radius:999px;
        background:${bg};
        border:1px solid ${ring};
        display:flex;
        align-items:center;
        justify-content:center;
        color:${fg};
        font-weight:800;
        font-size:${fontSize}px;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 10px 22px rgba(0,0,0,0.28);
        text-shadow:0 1px 2px rgba(0,0,0,0.65);
        user-select:none;
        line-height:1;
        opacity:${stale ? 0.78 : 1};
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
    icon._stale = stale;
    return icon;
  }

  function popupHtml(p) {
    const mins = minutesSince(p.updatedAt);
    const stale = mins > STALE_MINUTES;
    const tag = stale ? `<span style="padding:.2em .55em;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);font-size:12px;">Ej aktuell</span>` : "";
    return `
      <div style="font: 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-width:190px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div><strong>${escapeHtml(p.name ?? "Station")}</strong></div>
          ${tag}
        </div>
        <div style="margin-top:6px;">Temp: <strong>${escapeHtml(String(p.airTemp))}°C</strong></div>
        <div style="opacity:.8;margin-top:6px;">Senast: ${escapeHtml(fmtTime(p.updatedAt) || "–")}</div>
        ${p.source ? `<div style="opacity:.65;margin-top:4px;">${escapeHtml(p.source)}</div>` : ""}
      </div>
    `;
  }

  // -----------------------------
  // Map
  // -----------------------------
  const map = L.map("map", { zoomControl: true }).setView([62.5, 16.5], 5);

  // Neutral basemap som funkar bra för tematiska lager
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);

  // -----------------------------
  // Sweden mask (för att klippa fältet)
  // -----------------------------
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
      swedenPaths = preprocessSweden(await res.json());
    } catch (e) {
      console.warn("Could not load Sweden GeoJSON:", e);
      swedenPaths = null;
    }
  }

  // -----------------------------
  // Stations layers
  // -----------------------------
  const markerLayer = L.layerGroup();
  const clusterLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 9,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const ms = cluster.getAllChildMarkers();
      let sum = 0, n = 0;
      let anyStale = false;
      for (const m of ms) {
        const t = Number(m?.options?.icon?._temp);
        const s = Boolean(m?.options?.icon?._stale);
        if (s) anyStale = true;
        if (Number.isFinite(t)) { sum += t; n++; }
      }
      const avg = n ? sum / n : 0;
      const label = Math.round(avg);
      const bg = anyStale ? "rgba(255,255,255,.18)" : colorForTemp(avg);
      const html = `
        <div style="
          width:44px;height:44px;border-radius:999px;
          background:${bg};
          border:1px solid rgba(255,255,255,.18);
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:800;font-size:13px;
          box-shadow:0 10px 22px rgba(0,0,0,0.28);
          text-shadow:0 1px 2px rgba(0,0,0,0.65);
          user-select:none;
        ">${label}°</div>
      `;
      return L.divIcon({ html, className: "", iconSize: [44, 44] });
    },
  });

  function buildStations(points) {
    clusterLayer.clearLayers();
    markerLayer.clearLayers();

    const size = markerSizeForZoom(map.getZoom());
    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;
      const stale = minutesSince(p.updatedAt) > STALE_MINUTES;
      const icon = makeTempDivIcon({ temp, stale, size: 18 });
      const m = L.marker([p.lat, p.lon], { icon });
      m.bindPopup(popupHtml(p));
      clusterLayer.addLayer(m);

      const icon2 = makeTempDivIcon({ temp, stale, size });
      const m2 = L.marker([p.lat, p.lon], { icon: icon2 });
      m2.bindPopup(popupHtml(p));
      markerLayer.addLayer(m2);
    }
  }

  function setStationLayersForZoom() {
    const z = map.getZoom();
    const showMarkers = z >= 9;

    if (!toggleStations?.checked) {
      map.removeLayer(clusterLayer);
      map.removeLayer(markerLayer);
      return;
    }

    if (showMarkers) {
      if (map.hasLayer(clusterLayer)) map.removeLayer(clusterLayer);
      if (!map.hasLayer(markerLayer)) markerLayer.addTo(map);
    } else {
      if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
      if (!map.hasLayer(clusterLayer)) clusterLayer.addTo(map);
    }
  }

  // -----------------------------
  // Temperature field canvas layer
  // -----------------------------
  class TempFieldCanvasLayer extends L.Layer {
    constructor() {
      super();
      this._canvas = null;
      this._ctx = null;
      this._raf = 0;
      this._posRaf = 0;
      this._pending = false;
      this._lastSig = "";
      this._layerTopLeft = L.point(0, 0);

      this.opacity = 0.72;
      this.gridStep = 6;
      this.alpha = 0.80;
      this.downscale = 1.8;
      this.blur = 14;

      this._off = document.createElement("canvas");
      this._offCtx = this._off.getContext("2d", { willReadFrequently: false });

      this._worker = null;
      this._renderId = 0;
      this._inflight = 0;

      this._points = [];
      this._pointsVersion = 0;
      this._bins = new Map();
    }

    onAdd() {
      this._canvas = document.createElement("canvas");
      this._canvas.style.position = "absolute";
      this._canvas.style.top = "0";
      this._canvas.style.left = "0";
      this._canvas.style.pointerEvents = "none";
      this._canvas.style.opacity = String(this.opacity);
      this._ctx = this._canvas.getContext("2d", { willReadFrequently: false });
      map.getPanes().overlayPane.appendChild(this._canvas);

      this._resetSize();
      this._updatePosition();

      map.on("move", this._updatePositionFast, this);
      map.on("moveend", this._schedule, this);
      map.on("zoomend", this._onZoomEnd, this);
      map.on("resize", this._onResize, this);

      this._initWorker();
      this._schedule(true);
    }

    onRemove() {
      map.off("move", this._updatePositionFast, this);
      map.off("moveend", this._schedule, this);
      map.off("zoomend", this._onZoomEnd, this);
      map.off("resize", this._onResize, this);

      if (this._posRaf) cancelAnimationFrame(this._posRaf);
      if (this._raf) cancelAnimationFrame(this._raf);
      this._posRaf = 0;
      this._raf = 0;

      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._ctx = null;

      if (this._worker) this._worker.terminate();
      this._worker = null;
    }

    setOpacity(op) {
      this.opacity = op;
      if (this._canvas) this._canvas.style.opacity = String(op);
    }

    setPoints(points) {
      this._points = points;
      this._pointsVersion++;
      this._rebuildBins(points);
      if (this._worker) {
        const pts = points
          .filter((p) => Number.isFinite(Number(p.airTemp)))
          .filter((p) => minutesSince(p.updatedAt) <= STALE_MINUTES)
          .map((p) => ({ lat: p.lat, lon: p.lon, temp: Number(p.airTemp) }));
        this._worker.postMessage({ type: "setPoints", points: pts });
      }
      this._schedule(true);
    }

    redraw() { this._schedule(true); }

    _onResize() { this._resetSize(); this._updatePosition(); this._schedule(true); }
    _onZoomEnd() { this._resetSize(); this._updatePosition(); this._schedule(true); }

    _resetSize() {
      if (!this._canvas) return;
      const size = map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
    }

    _updatePositionFast() {
      if (this._posRaf) return;
      this._posRaf = requestAnimationFrame(() => {
        this._posRaf = 0;
        this._updatePosition();
      });
    }

    _updatePosition() {
      if (!this._canvas) return;
      this._layerTopLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, this._layerTopLeft);
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
            const pt = map.latLngToContainerPoint([lat, lng]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
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
            const pt = map.latLngToContainerPoint([lat, lng]);
            const x = pt.x / scaleX;
            const y = pt.y / scaleY;
            if (i === 0) ctxOff.moveTo(x, y);
            else ctxOff.lineTo(x, y);
          }
          ctxOff.closePath();
        }
      }

      ctxOff.fill("evenodd");
      ctxOff.globalCompositeOperation = "source-over";
    }

    _initWorker() {
      try {
        this._worker = new Worker("./weatherWorker.js", { type: "classic" });
        this._worker.onmessage = (ev) => {
          const msg = ev.data;
          if (msg?.type !== "renderResult") return;
          if (msg.id !== this._inflight) return; // ignore old renders
          this._drawFromGrid(msg);
        };
      } catch (e) {
        console.warn("Worker unavailable (fallback to main thread)", e);
        this._worker = null;
      }
    }

    _binKey(lat, lon) {
      const la = Math.floor(lat * 2);
      const lo = Math.floor(lon * 2);
      return `${la}:${lo}`;
    }

    _rebuildBins(points) {
      this._bins = new Map();
      for (const p of points) {
        const temp = Number(p.airTemp);
        if (!Number.isFinite(temp)) continue;
        if (minutesSince(p.updatedAt) > STALE_MINUTES) continue;
        const k = this._binKey(p.lat, p.lon);
        let arr = this._bins.get(k);
        if (!arr) { arr = []; this._bins.set(k, arr); }
        arr.push({ lat: p.lat, lon: p.lon, temp });
      }
    }

    _candidatesAround(lat, lon, need = 34) {
      const la = Math.floor(lat * 2);
      const lo = Math.floor(lon * 2);
      const out = [];
      for (let d = 0; d <= 6; d++) {
        for (let y = la - d; y <= la + d; y++) {
          for (let x = lo - d; x <= lo + d; x++) {
            const arr = this._bins.get(`${y}:${x}`);
            if (arr) out.push(...arr);
          }
        }
        if (out.length >= need) break;
      }
      return out;
    }

    _idwTemp(lat, lon) {
      const cand = this._candidatesAround(lat, lon, IDW.maxCandidates);
      if (!cand.length) return NaN;
      let num = 0;
      let den = 0;
      for (let i = 0; i < cand.length; i++) {
        const p = cand[i];
        const dLat = lat - p.lat;
        const dLon = lon - p.lon;
        const dist2 = dLat * dLat + dLon * dLon;
        if (dist2 < 1e-12) return p.temp;
        const dist = Math.sqrt(dist2);
        if (dist > IDW.radius) continue;
        const w = 1 / Math.pow(dist + IDW.softening, IDW.power);
        num += w * p.temp;
        den += w;
      }
      if (den <= 0) return NaN;
      return num / den;
    }

    _render(force) {
      if (!this._canvas || !this._ctx) return;
      if (!toggleField?.checked) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        return;
      }

      const size = map.getSize();
      const w = size.x;
      const h = size.y;
      const b = map.getBounds();
      const z = map.getZoom();

      // render-signature: avbryt onödiga omritningar
      const sig = `${w}x${h}|z${z}|${b.getSouthWest().lat.toFixed(3)},${b.getSouthWest().lng.toFixed(3)}|v${this._pointsVersion}|gs${this.gridStep}|ds${this.downscale}|bl${this.blur}`;
      if (!force && sig === this._lastSig) return;
      this._lastSig = sig;

      this._updatePosition();

      const offW = Math.max(300, Math.floor(w / this.downscale));
      const offH = Math.max(300, Math.floor(h / this.downscale));
      this._off.width = offW;
      this._off.height = offH;

      const params = { ...IDW };
      const renderId = ++this._renderId;
      this._inflight = renderId;

      if (this._worker) {
        this._worker.postMessage({
          type: "render",
          id: renderId,
          bounds: { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() },
          size: { w: offW, h: offH },
          gridStep: this.gridStep,
          params,
        });
        return;
      }

      // Fallback (main thread) om worker ej finns
      const step = Math.max(3, Math.floor(this.gridStep));
      const cols = Math.ceil(offW / step);
      const rows = Math.ceil(offH / step);
      const temps = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * step;
          const y = r * step;
          const ll = map.containerPointToLatLng([x * this.downscale, y * this.downscale]);
          temps[r * cols + c] = this._idwTemp(ll.lat, ll.lng);
        }
      }
      this._drawFromGrid({ id: renderId, w: offW, h: offH, step, cols, rows, temps });
    }

    _drawFromGrid(msg) {
      if (!this._canvas || !this._ctx) return;
      const { w: offW, h: offH, step, cols, rows } = msg;
      const temps = msg.temps;

      const ctxOff = this._offCtx;
      ctxOff.clearRect(0, 0, offW, offH);
      const img = ctxOff.createImageData(offW, offH);
      const data = img.data;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const t = temps[r * cols + c];
          if (!Number.isFinite(t)) continue;
          const tt = clamp(t, TEMP_MIN, TEMP_MAX);
          const { r: R, g: G, b: B } = hexToRgb(colorForTemp(tt));

          const x0 = c * step;
          const y0 = r * step;
          for (let yy = 0; yy < step; yy++) {
            for (let xx = 0; xx < step; xx++) {
              const x = x0 + xx;
              const y = y0 + yy;
              if (x >= offW || y >= offH) continue;
              const idx = (y * offW + x) * 4;
              data[idx] = R;
              data[idx + 1] = G;
              data[idx + 2] = B;
              data[idx + 3] = Math.round(255 * this.alpha);
            }
          }
        }
      }

      ctxOff.putImageData(img, 0, 0);
      const scaleX = map.getSize().x / offW;
      const scaleY = map.getSize().y / offH;
      this._maskOffscreen(ctxOff, scaleX, scaleY);

      const ctx = this._ctx;
      const size = map.getSize();
      const w = size.x;
      const h = size.y;
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      this._clipSweden(ctx);
      ctx.imageSmoothingEnabled = true;
      ctx.filter = `blur(${this.blur}px)`;
      ctx.drawImage(this._off, 0, 0, offW, offH, 0, 0, w, h);
      ctx.filter = "none";
      ctx.globalAlpha = 0.92;
      ctx.drawImage(this._off, 0, 0, offW, offH, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.restore();

      // om isotermer är på: trigga uppdatering (throttlad)
      if (toggleContours?.checked) scheduleContours();
    }
  }

  const tempFieldLayer = new TempFieldCanvasLayer();
  tempFieldLayer.addTo(map);

  opacity?.addEventListener("input", () => {
    const v = Number(opacity.value);
    setOpacityUI(v);
    tempFieldLayer.setOpacity(v / 100);
  });

  toggleField?.addEventListener("change", () => tempFieldLayer.redraw());
  toggleStations?.addEventListener("change", () => setStationLayersForZoom());

  // -----------------------------
  // Isotermer (d3-contour)
  // -----------------------------
  let contourLayer = L.layerGroup();
  let contourTimer = 0;

  function scheduleContours() {
    if (!toggleContours?.checked) return;
    if (contourTimer) return;
    contourTimer = window.setTimeout(() => {
      contourTimer = 0;
      updateContours().catch((e) => console.warn("Contours error", e));
    }, 250);
  }

  toggleContours?.addEventListener("change", () => {
    if (toggleContours.checked) {
      if (!map.hasLayer(contourLayer)) contourLayer.addTo(map);
      scheduleContours();
    } else {
      map.removeLayer(contourLayer);
    }
  });

  async function updateContours() {
    if (!toggleContours?.checked) return;
    if (typeof d3 === "undefined" || !d3.contours) return;

    // Lätt grid för konturer (inte samma som raster), anpassat för zoom.
    const z = map.getZoom();
    const nx = clamp(Math.round(60 + (z - 5) * 8), 60, 140);
    const ny = clamp(Math.round(70 + (z - 5) * 8), 70, 150);
    const b = map.getBounds();

    const values = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      const lat = lerp(b.getNorth(), b.getSouth(), y / (ny - 1));
      for (let x = 0; x < nx; x++) {
        const lon = lerp(b.getWest(), b.getEast(), x / (nx - 1));
        values[y * nx + x] = tempFieldLayer._idwTemp(lat, lon);
      }
    }

    // Konturer var 2°C, plus nollan extra tydlig
    const thresholds = [];
    for (let t = -40; t <= 40; t += 2) thresholds.push(t);
    const contours = d3.contours().size([nx, ny]).thresholds(thresholds)(Array.from(values, (v) => (Number.isFinite(v) ? v : NaN)));

    // Bygg om lagret
    contourLayer.clearLayers();

    const toLatLng = (x, y) => {
      const lon = lerp(b.getWest(), b.getEast(), x / (nx - 1));
      const lat = lerp(b.getNorth(), b.getSouth(), y / (ny - 1));
      return [lat, lon];
    };

    for (const c of contours) {
      if (!Number.isFinite(c.value)) continue;
      const isZero = c.value === 0;
      const weight = isZero ? 2.5 : 1.25;
      const opacity = isZero ? 0.75 : 0.35;

      // d3-contour ger multipolygons i pixelkoordinater
      for (const poly of c.coordinates) {
        for (const ring of poly) {
          const latlngs = ring.map(([x, y]) => toLatLng(x, y));
          L.polyline(latlngs, {
            color: "#ffffff",
            weight,
            opacity,
            interactive: false,
          }).addTo(contourLayer);
        }
      }
    }

    if (toggleContours.checked && !map.hasLayer(contourLayer)) contourLayer.addTo(map);
  }

  // -----------------------------
  // Click-to-estimate temp at point
  // -----------------------------
  const clickPopup = L.popup({ closeButton: true, autoClose: true, maxWidth: 260 });
  map.on("click", (e) => {
    if (!toggleField?.checked) return;
    const t = tempFieldLayer._idwTemp(e.latlng.lat, e.latlng.lng);
    if (!Number.isFinite(t)) return;
    const tt = clamp(t, TEMP_MIN, TEMP_MAX);
    const html = `
      <div style="font: 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
        <div style="font-weight:800;margin-bottom:4px;">Uppskattning på plats</div>
        <div>Temp: <strong>${Math.round(tt)}°C</strong></div>
        <div style="opacity:.7;margin-top:6px;">Interpolerat från stationer.</div>
      </div>
    `;
    clickPopup.setLatLng(e.latlng).setContent(html).openOn(map);
  });

  // -----------------------------
  // Data fetch + UI status
  // -----------------------------
  let lastPoints = [];

  function updateStatus(points) {
    let newest = null;
    let minP = null;
    let maxP = null;
    let fresh = 0;
    let stale = 0;

    for (const p of points) {
      const temp = Number(p.airTemp);
      if (!Number.isFinite(temp)) continue;

      const mins = minutesSince(p.updatedAt);
      const isStale = mins > STALE_MINUTES;
      if (isStale) stale++; else fresh++;

      if (!isStale) {
        if (!minP || temp < minP.airTemp) minP = { airTemp: temp, name: p.name ?? "Okänd" };
        if (!maxP || temp > maxP.airTemp) maxP = { airTemp: temp, name: p.name ?? "Okänd" };
      }

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

    const newestText = newest ? ` • Senast uppdaterad: ${fmtTime(newest.toISOString())}` : "";
    if (statusEl) statusEl.textContent = `Stationer: ${points.length} (aktuella: ${fresh}, ej aktuella: ${stale})${newestText}`;
    if (freshnessEl) freshnessEl.textContent = `Aktuella stationer: ${fresh} • Ej aktuella: ${stale} (>${STALE_MINUTES} min)`;
  }

  function render(points) {
    lastPoints = points;
    buildStations(points);
    tempFieldLayer.setPoints(points);
    updateStatus(points);
    setStationLayersForZoom();
    if (toggleContours?.checked) scheduleContours();
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

  // -----------------------------
  // Hooks
  // -----------------------------
  map.on("zoomend", () => {
    // Bygg om markers på hög zoom för snygg storlek
    if (lastPoints.length) buildStations(lastPoints);
    setStationLayersForZoom();

    // Använd lite skarpare fält på nära håll
    const z = map.getZoom();
    if (z >= 9) {
      tempFieldLayer.gridStep = 5;
      tempFieldLayer.downscale = 1.55;
      tempFieldLayer.blur = 12;
    } else {
      tempFieldLayer.gridStep = 6;
      tempFieldLayer.downscale = 1.85;
      tempFieldLayer.blur = 14;
    }
    tempFieldLayer.redraw();
    if (toggleContours?.checked) scheduleContours();
  });
  map.on("moveend", () => {
    tempFieldLayer.redraw();
    if (toggleContours?.checked) scheduleContours();
  });
  map.on("resize", () => {
    tempFieldLayer.redraw();
    if (toggleContours?.checked) scheduleContours();
  });

  // -----------------------------
  // Boot
  // -----------------------------
  (async () => {
    await loadSwedenGeoJSON();
    await load();
    setInterval(load, 60_000);
  })();
})();

/*
  weatherWorker.js
  Beräknar ett temperaturgrid (IDW) i en web worker så UI-tråden förblir mjuk.

  Inkommande:
    { type: 'setPoints', points: [{lat, lon, temp}] }
    { type: 'render', id, bounds: {s,w,n,e}, size:{w,h}, gridStep, params:{radius,maxCandidates,power,softening} }
  Utgående:
    { type: 'renderResult', id, w, h, step, temps: Float32Array }
*/

// En enkel spatial binning för att slippa O(N) per pixel.
let bins = new Map();
let pointsCount = 0;

function binKey(lat, lon) {
  const la = Math.floor(lat * 2);
  const lo = Math.floor(lon * 2);
  return `${la}:${lo}`;
}

function rebuildBins(points) {
  bins = new Map();
  pointsCount = points.length;
  for (const p of points) {
    const k = binKey(p.lat, p.lon);
    let arr = bins.get(k);
    if (!arr) { arr = []; bins.set(k, arr); }
    arr.push(p);
  }
}

function candidatesAround(lat, lon, need = 34) {
  const la = Math.floor(lat * 2);
  const lo = Math.floor(lon * 2);
  const out = [];
  for (let d = 0; d <= 6; d++) {
    for (let y = la - d; y <= la + d; y++) {
      for (let x = lo - d; x <= lo + d; x++) {
        const arr = bins.get(`${y}:${x}`);
        if (arr) out.push(...arr);
      }
    }
    if (out.length >= need) break;
  }
  return out;
}

function idwTemp(lat, lon, params) {
  const cand = candidatesAround(lat, lon, params.maxCandidates);
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
    if (dist > params.radius) continue;

    const w = 1 / Math.pow(dist + params.softening, params.power);
    num += w * p.temp;
    den += w;
  }

  if (den <= 0) return NaN;
  return num / den;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Rakt linjär interpolation i lat/lon över bbox.
function pxToLatLon(px, py, w, h, b) {
  const x = px / (w - 1);
  const y = py / (h - 1);
  const lon = lerp(b.w, b.e, x);
  const lat = lerp(b.n, b.s, y);
  return { lat, lon };
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'setPoints') {
    rebuildBins(msg.points || []);
    self.postMessage({ type: 'pointsReady', count: pointsCount });
    return;
  }

  if (msg.type === 'render') {
    const { id, bounds, size, gridStep, params } = msg;
    const W = size?.w ?? 0;
    const H = size?.h ?? 0;
    const step = Math.max(3, Math.floor(gridStep || 6));
    if (!W || !H) {
      self.postMessage({ type: 'renderResult', id, w: 0, h: 0, step, temps: new Float32Array(0) }, []);
      return;
    }

    const outW = Math.max(240, W);
    const outH = Math.max(240, H);
    const cols = Math.ceil(outW / step);
    const rows = Math.ceil(outH / step);
    const temps = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = c * step;
        const py = r * step;
        const ll = pxToLatLon(px, py, outW, outH, bounds);
        const t = idwTemp(ll.lat, ll.lon, params);
        temps[r * cols + c] = t;
      }
    }

    self.postMessage(
      { type: 'renderResult', id, w: outW, h: outH, step, cols, rows, temps },
      [temps.buffer]
    );
  }
};

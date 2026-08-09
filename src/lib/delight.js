
import { TX } from "../tx.js";

const defaults = () => ({
  mode: "none", // none | gradient | local
  strength: 1, // how much of the estimated shading to divide out
  order: 2, // polynomial order for 'gradient'
  radius: 0.06,
  perChannel: false, // estimate each channel separately, removing colour gradients
  balance: false, // grey-world white balance, removing an even colour cast
  exposure: 0, // target mean brightness 1..255, or 0 to keep the original
});

const ALPHA_FLOOR = 8;

const LUMA = [0.2126, 0.7152, 0.0722];

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgbByte(v) {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

const SRGB_STEPS = 16384;
const SRGB_BYTE = new Uint8Array(SRGB_STEPS + 1);
for (let i = 0; i <= SRGB_STEPS; i++) SRGB_BYTE[i] = toSrgbByte(i / SRGB_STEPS);

const srgbByte = v => (v > 0 ? (v >= 1 ? 255 : SRGB_BYTE[(v * SRGB_STEPS + 0.5) | 0]) : 0);

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
};

const imageDataOf = source => {
  if (source instanceof ImageData) return source;
  const ctx = canvasOf(source.width, source.height).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height);
};


function analyze(source, options) {
  const image = imageDataOf(source);
  const data = image.data;
  const width = image.width;
  const height = image.height;
  const most = (options && options.maxSamples) || 0;
  const step = most > 0 && width * height > most
    ? Math.max(1, Math.ceil(Math.sqrt((width * height) / most)))
    : 1;
  const hist = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    l: new Uint32Array(256),
  };

  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumLL = 0;
  let clippedLow = 0;
  let clippedHigh = 0;

  for (let y = 0; y < height; y += step) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const i = row + x * 4;
      if (data[i + 3] < ALPHA_FLOOR) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = Math.round(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b);
      hist.r[r]++;
      hist.g[g]++;
      hist.b[b]++;
      hist.l[l]++;
      sumR += r;
      sumG += g;
      sumB += b;
      sumL += l;
      sumLL += l * l;
      if (r === 0 && g === 0 && b === 0) clippedLow++;
      if (r === 255 || g === 255 || b === 255) clippedHigh++;
      count++;
    }
  }

  if (!count) {
    return {
      count: 0, hist, mean: { r: 0, g: 0, b: 0, l: 0 }, median: 0,
      contrast: 0, range: [0, 0], clipped: { low: 0, high: 0 }, cast: 0,
    };
  }

  const mean = { r: sumR / count, g: sumG / count, b: sumB / count, l: sumL / count };

  let seen = 0;
  let median = 0;
  let low = 0;
  let high = 255;
  for (let v = 0; v < 256; v++) {
    const before = seen;
    seen += hist.l[v];
    if (before < count * 0.01 && seen >= count * 0.01) low = v;
    if (before < count * 0.5 && seen >= count * 0.5) median = v;
    if (before < count * 0.99 && seen >= count * 0.99) { high = v; break; }
  }

  const cast = mean.l > 0
    ? Math.max(Math.abs(mean.r - mean.l), Math.abs(mean.g - mean.l), Math.abs(mean.b - mean.l)) / mean.l
    : 0;

  return {
    count,
    hist,
    mean,
    median,
    contrast: Math.sqrt(Math.max(0, sumLL / count - mean.l * mean.l)),
    range: [low, high],
    clipped: { low: clippedLow / count, high: clippedHigh / count },
    cast,
  };
}


function logFields(image, wantChannels, step) {
  const data = image.data;
  const width = image.width;
  const height = image.height;
  const n = width * height;
  const lattice = Math.max(1, Math.round(step || 1));
  const logs = wantChannels
    ? [new Float32Array(n), new Float32Array(n), new Float32Array(n)] : null;
  const logLuma = new Float32Array(n);
  const valid = new Uint8Array(n);
  const EPS = 1e-4;

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (data[i + 3] >= ALPHA_FLOOR) valid[p] = 1;
  }

  for (let y = 0; y < height; y += lattice) {
    for (let x = 0; x < width; x += lattice) {
      const p = y * width + x;
      if (!valid[p]) continue;
      const i = p * 4;
      const r = TO_LINEAR[data[i]];
      const g = TO_LINEAR[data[i + 1]];
      const b = TO_LINEAR[data[i + 2]];
      if (logs) {
        logs[0][p] = Math.log(r + EPS);
        logs[1][p] = Math.log(g + EPS);
        logs[2][p] = Math.log(b + EPS);
      }
      logLuma[p] = Math.log(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b + EPS);
    }
  }

  return { logs, logLuma, valid, n, step: lattice };
}

const TERMS = { 1: 3, 2: 6, 3: 10 };

function basis(order, x, y, out) {
  out[0] = 1; out[1] = x; out[2] = y;
  if (order >= 2) { out[3] = x * x; out[4] = x * y; out[5] = y * y; }
  if (order >= 3) {
    out[6] = x * x * x; out[7] = x * x * y; out[8] = x * y * y; out[9] = y * y * y;
  }
  return out;
}

function solve(a, b, n) {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const t = a[pivot]; a[pivot] = a[col]; a[col] = t;
      const tb = b[pivot]; b[pivot] = b[col]; b[col] = tb;
    }
    for (let row = col + 1; row < n; row++) {
      const f = a[row][col] / a[col][col];
      if (!f) continue;
      for (let k = col; k < n; k++) a[row][k] -= f * a[col][k];
      b[row] -= f * b[col];
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

const FIT_SAMPLES = 30000;

const fitStep = (width, height) =>
  Math.max(1, Math.ceil(Math.sqrt((width * height) / FIT_SAMPLES)));

function fitSurface(field, valid, width, height, order) {
  const n = TERMS[order] || TERMS[2];
  const terms = new Float64Array(n);
  const sx = Math.max(1, width - 1);
  const sy = Math.max(1, height - 1);

  const step = fitStep(width, height);
  const samples = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (valid[y * width + x]) samples.push(y * width + x);
    }
  }
  if (samples.length < n * 2) return null;

  const residual = new Float32Array(samples.length);
  let keep = null; // null means every sample still counts

  for (let pass = 0; pass < 3; pass++) {
    const ata = Array.from({ length: n }, () => new Float64Array(n));
    const atb = new Float64Array(n);

    for (let s = 0; s < samples.length; s++) {
      if (keep && !keep[s]) continue;
      const p = samples[s];
      basis(order, ((p % width) / sx) * 2 - 1, (((p / width) | 0) / sy) * 2 - 1, terms);
      const value = field[p];
      for (let i = 0; i < n; i++) {
        atb[i] += terms[i] * value;
        for (let j = i; j < n; j++) ata[i][j] += terms[i] * terms[j];
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) ata[i][j] = ata[j][i];

    const coeffs = solve(ata, atb, n);
    if (!coeffs) return null;
    if (pass === 2) return { coeffs, order, n };

    let sum = 0;
    for (let s = 0; s < samples.length; s++) {
      const p = samples[s];
      basis(order, ((p % width) / sx) * 2 - 1, (((p / width) | 0) / sy) * 2 - 1, terms);
      let fitted = 0;
      for (let i = 0; i < n; i++) fitted += coeffs[i] * terms[i];
      residual[s] = field[p] - fitted;
      sum += residual[s] * residual[s];
    }
    const cutoff = 2.5 * (Math.sqrt(sum / samples.length) || 1);
    keep = new Uint8Array(samples.length);
    for (let s = 0; s < samples.length; s++) keep[s] = Math.abs(residual[s]) <= cutoff ? 1 : 0;
  }

  return null;
}

function evaluateSurface(fit, width, height) {
  const out = new Float32Array(width * height);
  const terms = new Float64Array(fit.n);
  for (let y = 0; y < height; y++) {
    const ny = (y / Math.max(1, height - 1)) * 2 - 1;
    for (let x = 0; x < width; x++) {
      basis(fit.order, (x / Math.max(1, width - 1)) * 2 - 1, ny, terms);
      let value = 0;
      for (let i = 0; i < fit.n; i++) value += fit.coeffs[i] * terms[i];
      out[y * width + x] = value;
    }
  }
  return out;
}

const GRID_MAX = 48;

function downsample(field, valid, width, height) {
  const scale = Math.min(1, GRID_MAX / Math.max(width, height));
  const gw = Math.max(2, Math.round(width * scale));
  const gh = Math.max(2, Math.round(height * scale));
  const sum = new Float32Array(gw * gh);
  const hits = new Float32Array(gw * gh);

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, ((y * gh) / height) | 0);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!valid[p]) continue;
      const g = gy * gw + Math.min(gw - 1, ((x * gw) / width) | 0);
      sum[g] += field[p];
      hits[g]++;
    }
  }

  let total = 0;
  let covered = 0;
  for (let i = 0; i < sum.length; i++) {
    if (hits[i] > 0) { sum[i] /= hits[i]; total += sum[i]; covered++; }
  }
  const fallback = covered ? total / covered : 0;
  for (let i = 0; i < sum.length; i++) if (!hits[i]) sum[i] = fallback;

  return { grid: sum, gw, gh };
}

function blurAxis(src, dst, gw, gh, radius, horizontal) {
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = horizontal ? Math.max(0, Math.min(gw - 1, x + k)) : x;
        const yy = horizontal ? y : Math.max(0, Math.min(gh - 1, y + k));
        sum += src[yy * gw + xx];
      }
      dst[y * gw + x] = sum / (radius * 2 + 1);
    }
  }
}

function boxBlur(grid, gw, gh, radius) {
  let src = Float32Array.from(grid);
  let dst = new Float32Array(grid.length);
  for (let pass = 0; pass < 3; pass++) {
    blurAxis(src, dst, gw, gh, radius, true);
    [src, dst] = [dst, src];
    blurAxis(src, dst, gw, gh, radius, false);
    [src, dst] = [dst, src];
  }
  return src;
}

function gridSampler(grid, gw, gh, width, height) {
  const sxScale = gw / width;
  const syScale = gh / height;
  return (x, y) => {
    const fx = Math.max(0, Math.min(gw - 1, (x + 0.5) * sxScale - 0.5));
    const fy = Math.max(0, Math.min(gh - 1, (y + 0.5) * syScale - 0.5));
    const x0 = fx | 0;
    const y0 = fy | 0;
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
    const bottom = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

function sampler(estimate, width, height) {
  if (!estimate.fit) {
    return gridSampler(estimate.grid, estimate.gw, estimate.gh, width, height);
  }
  const { fit } = estimate;
  const terms = new Float64Array(fit.n);
  const sx = Math.max(1, width - 1);
  const sy = Math.max(1, height - 1);
  return (x, y) => {
    basis(fit.order, (x / sx) * 2 - 1, (y / sy) * 2 - 1, terms);
    let value = 0;
    for (let i = 0; i < fit.n; i++) value += fit.coeffs[i] * terms[i];
    return value;
  };
}

function upsample(grid, gw, gh, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(gh - 1, ((y + 0.5) * gh) / height - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(gw - 1, ((x + 0.5) * gw) / width - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
      const bottom = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
      out[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

function estimateOf(field, valid, width, height, settings) {
  if (settings.mode === "local") {
    const { grid, gw, gh } = downsample(field, valid, width, height);
    const radius = Math.max(1, Math.round(settings.radius * Math.max(gw, gh)));
    return { grid: boxBlur(grid, gw, gh, radius), gw, gh };
  }
  const fit = fitSurface(field, valid, width, height, settings.order);
  return fit ? { fit } : null;
}

function materialize(estimate, width, height) {
  return estimate.fit
    ? evaluateSurface(estimate.fit, width, height)
    : upsample(estimate.grid, estimate.gw, estimate.gh, width, height);
}

function referenceOf(estimate, valid, width, height) {
  const step = fitStep(width, height);
  const sample = sampler(estimate, width, height);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!valid[y * width + x]) continue;
      sum += sample(x, y);
      n++;
    }
  }
  return n ? sum / n : 0;
}


const settingsOf = patch => {
  const s = { ...defaults(), ...(patch || {}) };
  const num = (value, fallback, min, max) => (typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback);
  return {
    mode: s.mode === "gradient" || s.mode === "local" ? s.mode : "none",
    strength: num(s.strength, 1, 0, 1),
    order: [1, 2, 3].includes(s.order) ? s.order : 2,
    radius: num(s.radius, 0.06, 0.02, 0.5),
    perChannel: !!s.perChannel,
    balance: !!s.balance,
    exposure: num(s.exposure, 0, 0, 255),
  };
};

const isIdentity = settings => settingsOf(settings).mode === "none";

const GAIN_GRID = 64;

function gainGrids(image, settings) {
  const width = image.width;
  const height = image.height;
  const { logs, logLuma, valid } = logFields(image, settings.perChannel,
    settings.mode === "local" ? 1 : fitStep(width, height));

  const scale = Math.min(1, GAIN_GRID / Math.max(width, height));
  const gw = Math.max(2, Math.round(width * scale));
  const gh = Math.max(2, Math.round(height * scale));

  const build = field => {
    const estimate = estimateOf(field, valid, width, height, settings);
    if (!estimate) return null;
    const reference = referenceOf(estimate, valid, width, height);
    const sample = sampler(estimate, width, height);
    const gains = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      const y = ((gy + 0.5) * height) / gh - 0.5;
      for (let gx = 0; gx < gw; gx++) {
        const x = ((gx + 0.5) * width) / gw - 0.5;
        const g = Math.exp((reference - sample(x, y)) * settings.strength);
        gains[gy * gw + gx] = Math.max(0.125, Math.min(8, g));
      }
    }
    return gridSampler(gains, gw, gh, width, height);
  };

  if (!settings.perChannel) {
    const gain = build(logLuma);
    return gain ? { valid, channels: [gain, gain, gain] } : null;
  }

  const channels = [build(logs[0]), build(logs[1]), build(logs[2])];
  if (channels.some(c => !c)) return null;
  return { valid, channels };
}

const MEAN_STEP = 4;

function correctedMeans(image, gains) {
  const data = image.data;
  const width = image.width;
  const height = image.height;
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < height; y += MEAN_STEP) {
    for (let x = 0; x < width; x += MEAN_STEP) {
      const p = y * width + x;
      if (!gains.valid[p]) continue;
      const i = p * 4;
      for (let c = 0; c < 3; c++) sums[c] += TO_LINEAR[data[i + c]] * gains.channels[c](x, y);
      count++;
    }
  }
  const means = count ? sums.map(s => s / count) : [0, 0, 0];
  return { means, luma: LUMA[0] * means[0] + LUMA[1] * means[1] + LUMA[2] * means[2], count };
}

function balanceOf(means, grey) {
  return means.map(m => (m > 1e-6 ? Math.max(0.2, Math.min(5, grey / m)) : 1));
}

function apply(source, patch) {
  const settings = settingsOf(patch);
  if (settings.mode === "none") return source;

  const image = imageDataOf(source);
  const gains = gainGrids(image, settings);
  if (!gains) return source;

  const width = image.width;
  const height = image.height;
  const data = image.data;
  const out = new Uint8ClampedArray(data.length);

  let balance = [1, 1, 1];
  let exposure = 1;
  if (settings.balance || settings.exposure > 0) {
    const { means, luma, count } = correctedMeans(image, gains);
    if (settings.balance) balance = balanceOf(means, luma);
    if (settings.exposure > 0 && count && luma > 1e-6) {
      const balanced = LUMA[0] * means[0] * balance[0] + LUMA[1] * means[1] * balance[1]
        + LUMA[2] * means[2] * balance[2];
      if (balanced > 1e-6) {
        exposure = Math.max(0.1,
          Math.min(10, TO_LINEAR[Math.round(settings.exposure)] / balanced));
      }
    }
  }

  const [gr, gg, gb] = gains.channels;
  const scaleR = balance[0] * exposure;
  const scaleG = balance[1] * exposure;
  const scaleB = balance[2] * exposure;
  const shared = gr === gg && gg === gb;

  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      out[i + 3] = data[i + 3];
      if (!gains.valid[y * width + x]) continue;
      const g0 = gr(x, y);
      out[i] = srgbByte(TO_LINEAR[data[i]] * g0 * scaleR);
      out[i + 1] = srgbByte(TO_LINEAR[data[i + 1]] * (shared ? g0 : gg(x, y)) * scaleG);
      out[i + 2] = srgbByte(TO_LINEAR[data[i + 2]] * (shared ? g0 : gb(x, y)) * scaleB);
    }
  }

  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

function toSrgbFloat(v) {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function shadingField(source, patch) {
  const settings = settingsOf(patch);
  const image = imageDataOf(source);
  const working = settings.mode === "none" ? { ...settings, mode: "gradient" } : settings;
  const { logLuma, valid, n } = logFields(image, false,
    working.mode === "local" ? 1 : fitStep(image.width, image.height));
  const found = estimateOf(logLuma, valid, image.width, image.height, working);
  if (!found) return null;

  const estimate = materialize(found, image.width, image.height);
  const reference = referenceOf(found, valid, image.width, image.height);
  const data = new Float32Array(n);
  const mid = TO_LINEAR[128];
  for (let p = 0; p < n; p++) {
    data[p] = valid[p] ? toSrgbFloat(mid * Math.exp(estimate[p] - reference)) : 0.5;
  }
  return { data, width: image.width, height: image.height, valid };
}

function shadingCanvas(field) {
  if (!field) return null;
  const { data, width, height, valid } = field;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, i = 0; p < data.length; p++, i += 4) {
    if (!valid[p]) continue;
    const value = Math.max(0, Math.min(255, Math.round(data[p] * 255)));
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }

  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

const shadingMap = (source, patch) => shadingCanvas(shadingField(source, patch));


const cache = new Map(); // textureId -> { key, canvas }

const keyOf = (patch, version) => {
  const s = settingsOf(patch);
  if (s.mode === "none") return `none:${version || 0}`;
  const shape = s.mode === "local" ? s.radius.toFixed(3) : s.order;
  const flags = `${s.perChannel ? 1 : 0}${s.balance ? 1 : 0}`;
  return `${s.mode}:${shape}:${s.strength.toFixed(3)}:${flags}:${s.exposure}:${version || 0}`;
};

function resolve(textureId, source, patch, version) {
  if (isIdentity(patch)) {
    cache.delete(textureId);
    return source;
  }

  const key = keyOf(patch, version);
  const hit = cache.get(textureId);
  if (hit && hit.key === key) return hit.canvas;

  const canvas = apply(source, patch);
  cache.set(textureId, { key, canvas });
  return canvas;
}

const invalidate = textureId => {
  if (textureId == null) cache.clear();
  else cache.delete(textureId);
};

TX.delight = {
  defaults,
  settingsOf,
  isIdentity,
  analyze,
  apply,
  shadingField,
  shadingCanvas,
  shadingMap,
  resolve,
  toSrgbByte,
  srgbByte,
  keyOf,
  invalidate,
  solve,
};


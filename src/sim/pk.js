// Power spectrum of the painted 2-D field, estimated on the CPU.
//
// The input is the accumulation buffer itself - weighted particles per 5 Mpc/h
// pixel, projected through the slab - so this is the power of exactly what is on
// screen, light cone and RSD included. A 256^2 FFT in plain JS is ~2-3 ms, which
// is less than it would cost to plumb the GPU FFT through for one small plane.
//
// The simulation and the observation share one random seed, so their spectra
// carry the SAME cosmic variance: the ratio between them is smooth even in the
// first few bins, where each spectrum alone scatters by tens of percent.

/** In-place radix-2 forward FFT of (re, im) along one strided line, length n = 2^m. */
function fft1d(re, im, off, stride, n, rev, cos, sin) {
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = -sin[k * step];   // forward: e^{-i theta}
        const a = off + (s + k) * stride, b = a + half * stride;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/**
 * Build an estimator for an n x n periodic field of side `box` (Mpc/h).
 * Returns (field, stride) -> { k, P } with k in h/Mpc and P in (Mpc/h)^2,
 * log-spaced bins from the fundamental to the Nyquist frequency.
 */
export function pkEstimator(n, box, { nbins = 22 } = {}) {
  const bits = Math.log2(n);
  if (!Number.isInteger(bits)) throw new Error('pkEstimator: n must be a power of 2');
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = Math.sin((2 * Math.PI * k) / n); }

  // Per-mode bookkeeping, done once, over the half plane kx in [0, n/2] (the
  // field is real, so the other half is its mirror image): bin index, |k|, the
  // mode's weight in the full-plane average, and the CIC window. The painting is
  // cloud-in-cell at grid resolution, which multiplies the field by
  // W(k) = [sinc(kx d/2) sinc(ky d/2)]^2; dividing |delta_k|^2 by W^2 removes
  // that smoothing so the high-k end is not artificially suppressed.
  const h = n / 2 + 1;
  const kf = (2 * Math.PI) / box, kNyq = kf * (n / 2), d = box / n;
  const lo = Math.log(kf), dl = (Math.log(kNyq) - lo) / nbins;
  const bin = new Int16Array(h * n), kmag = new Float32Array(h * n), wt = new Float32Array(h * n);
  const sinc = (x) => (x === 0 ? 1 : Math.sin(x) / x);
  for (let ix = 0; ix < h; ix++) {
    const kx = kf * ix;
    for (let iy = 0; iy < n; iy++) {
      const ky = kf * (iy <= n / 2 ? iy : iy - n);
      const kk = Math.hypot(kx, ky), m = ix * n + iy;
      kmag[m] = kk;
      const b = kk > 0 ? Math.floor((Math.log(kk) - lo) / dl + 1e-9) : -1;
      bin[m] = b >= 0 && b < nbins ? b : -1;
      const w = (sinc((kx * d) / 2) * sinc((ky * d) / 2)) ** 2;
      wt[m] = (ix === 0 || ix === n / 2 ? 1 : 2) / (w * w);   // mirrored modes count twice
    }
  }

  // Row pass works on a scratch line; the half-spectrum is stored TRANSPOSED
  // (one contiguous line per kx) so the column pass is cache-friendly too.
  const zr = new Float64Array(n), zi = new Float64Array(n);
  const tr = new Float64Array(h * n), ti = new Float64Array(h * n);
  const sumP = new Float64Array(nbins), sumK = new Float64Array(nbins), sumW = new Float64Array(nbins);
  const norm = (box * box) / (n * n) / (n * n);   // P = (V / N^2) |DFT|^2 in 2-D

  return function estimate(field, stride = 1) {
    let mean = 0;
    for (let i = 0; i < n * n; i++) mean += field[i * stride];
    mean /= n * n;
    const inv = 1 / mean;

    // Rows, two at a time: real rows a and b ride as re + i*im of one complex FFT
    // and are separated afterwards with X = (Z + Z*)/2, Y = (Z - Z*)/2i.
    for (let a = 0; a < n; a += 2) {
      for (let x = 0; x < n; x++) {
        zr[x] = field[(a * n + x) * stride] * inv - 1;
        zi[x] = field[((a + 1) * n + x) * stride] * inv - 1;
      }
      fft1d(zr, zi, 0, 1, n, rev, cos, sin);
      for (let kx = 0; kx < h; kx++) {
        const c = (n - kx) % n;
        const Zr = zr[kx], Zi = zi[kx], Cr = zr[c], Ci = -zi[c];
        const m = kx * n + a;
        tr[m] = 0.5 * (Zr + Cr);     ti[m] = 0.5 * (Zi + Ci);
        tr[m + 1] = 0.5 * (Zi - Ci); ti[m + 1] = -0.5 * (Zr - Cr);
      }
    }
    for (let kx = 0; kx < h; kx++) fft1d(tr, ti, kx * n, 1, n, rev, cos, sin);

    sumP.fill(0); sumK.fill(0); sumW.fill(0);
    for (let m = 0; m < h * n; m++) {
      const b = bin[m];
      if (b < 0) continue;
      const w = wt[m], mult = (m < n || m >= (h - 1) * n) ? 1 : 2;
      sumP[b] += (tr[m] * tr[m] + ti[m] * ti[m]) * w;
      sumK[b] += kmag[m] * mult;
      sumW[b] += mult;
    }
    const k = [], P = [];
    for (let b = 0; b < nbins; b++) {
      if (!sumW[b]) continue;             // the first log bins can fall between modes
      k.push(sumK[b] / sumW[b]);
      P.push((sumP[b] / sumW[b]) * norm);
    }
    return { k, P };
  };
}

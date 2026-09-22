// Flat LCDM background: E(a), growth D(a) and f(a), comoving distance chi(a).
//
// The Omega sliders are constrained to the simplex Omega_b + Omega_c + Omega_L = 1,
// so Omega_k is identically zero and w = -1. That collapses every expression here
// to its simplest form; do not generalise it speculatively.
//
// Conventions mirror montecosmo.nbody (a2g / a2f / a2chi / chi2a) so the validator
// can compare element by element:
//   - growth tabulated on logspace(-3, 0, 128), D normalised so D(a=1) = 1
//   - distances tabulated on logspace(-3, 0, 256), chi in Mpc/h, chi(a=1) = 0

export const R_H = 2997.92458; // Hubble radius, Mpc/h (jax_cosmo.constants.rh)

const GROWTH_LOG10_AMIN = -3.0, GROWTH_STEPS = 128;
const DIST_LOG10_AMIN = -3.0, DIST_STEPS = 256;
const SUBSTEPS = 16; // RK4 substeps per tabulated interval

// Small memo for the two tables. Several consumers ask for the same Omega_m in
// one frame (derive, the P(k) amplitude, sigma_8, the light-cone table) and each
// integration is a few ms of JS. Keyed on Omega_m; the truth and the live side
// alternate, so a handful of entries is plenty.
const MEMO_N = 6;
function memo(fn) {
  const m = new Map();
  return (Om) => {
    if (m.has(Om)) return m.get(Om);
    const v = fn(Om);
    m.set(Om, v);
    if (m.size > MEMO_N) m.delete(m.keys().next().value);
    return v;
  };
}

function logspace(lo, hi, n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.pow(10, lo + ((hi - lo) * i) / (n - 1));
  return a;
}

/** E^2(a) for flat LCDM. */
export function Esqr(a, Omega_m) {
  return Omega_m / (a * a * a) + (1 - Omega_m);
}

/**
 * Integrate the linear growth ODE.
 *   g'' + q g' - r g = 0,  q = [2 - (Om_a + Ode_a)/2]/a,  r = 1.5 Om_a / a^2
 * with w = -1 so (1 + 3w) = -2 and the Ode_a term enters as -Ode_a/2... which is
 * exactly montecosmo's `(Omega_m_a + (1 + 3w) Omega_de_a) / 2` with w = -1.
 * Returns tables of D(a) and f(a) = dlnD/dlna, plus `Dnorm` = the UN-normalised
 * g(a=1). Because the integration starts at a = 1e-3 with g = a, that endpoint is
 * the growth-suppression factor relative to Einstein-de Sitter, which power.js
 * needs for the fixed-A_s amplitude.
 */
function growthTableUncached(Omega_m) {
  const atab = logspace(GROWTH_LOG10_AMIN, 0, GROWTH_STEPS);
  const g = new Float64Array(GROWTH_STEPS);
  const u = new Float64Array(GROWTH_STEPS); // dg/da

  // derivatives in x = ln a, so that a uniform-in-x RK4 step is well conditioned
  const deriv = (x, gy, uy) => {
    const a = Math.exp(x);
    const E2 = Esqr(a, Omega_m);
    const Om_a = Omega_m / (a * a * a) / E2;
    const Ode_a = (1 - Omega_m) / E2;
    const q = (2 - (Om_a - 2 * Ode_a) / 2) / a; // (1 + 3w) = -2
    const r = (1.5 * Om_a) / (a * a);
    return [a * uy, a * (-q * uy + r * gy)];
  };

  g[0] = atab[0];
  u[0] = 1.0;
  for (let i = 0; i < GROWTH_STEPS - 1; i++) {
    let x = Math.log(atab[i]);
    const hTot = Math.log(atab[i + 1]) - x;
    const hs = hTot / SUBSTEPS;
    let gy = g[i], uy = u[i];
    for (let s = 0; s < SUBSTEPS; s++) {
      const k1 = deriv(x, gy, uy);
      const k2 = deriv(x + hs / 2, gy + (hs / 2) * k1[0], uy + (hs / 2) * k1[1]);
      const k3 = deriv(x + hs / 2, gy + (hs / 2) * k2[0], uy + (hs / 2) * k2[1]);
      const k4 = deriv(x + hs, gy + hs * k3[0], uy + hs * k3[1]);
      gy += (hs / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      uy += (hs / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      x += hs;
    }
    g[i + 1] = gy;
    u[i + 1] = uy;
  }

  const norm = g[GROWTH_STEPS - 1];
  const D = new Float64Array(GROWTH_STEPS);
  const f = new Float64Array(GROWTH_STEPS);
  for (let i = 0; i < GROWTH_STEPS; i++) {
    D[i] = g[i] / norm;
    f[i] = (u[i] * atab[i]) / g[i];
  }
  return { a: atab, D, f, Dnorm: norm };
}

/** Comoving distance table, chi in Mpc/h, chi(a=1) = 0. */
function distanceTableUncached(Omega_m) {
  const atab = logspace(DIST_LOG10_AMIN, 0, DIST_STEPS);
  // dchi/dlna = a * dchi/da = a * R_H / (a^2 E) = R_H / (a E)
  const dchidx = (x) => {
    const a = Math.exp(x);
    return R_H / (a * Math.sqrt(Esqr(a, Omega_m)));
  };
  const cum = new Float64Array(DIST_STEPS);
  for (let i = 0; i < DIST_STEPS - 1; i++) {
    let x = Math.log(atab[i]);
    const hs = (Math.log(atab[i + 1]) - x) / SUBSTEPS;
    let y = cum[i];
    for (let s = 0; s < SUBSTEPS; s++) {
      const k1 = dchidx(x), k2 = dchidx(x + hs / 2), k4 = dchidx(x + hs);
      y += (hs / 6) * (k1 + 4 * k2 + k4); // Simpson == RK4 for y' = f(x)
      x += hs;
    }
    cum[i + 1] = y;
  }
  const chi = new Float64Array(DIST_STEPS);
  const last = cum[DIST_STEPS - 1];
  for (let i = 0; i < DIST_STEPS; i++) chi[i] = last - cum[i];
  return { a: atab, chi };
}

export const growthTable = memo(growthTableUncached);
export const distanceTable = memo((Om) => {
  const t = distanceTableUncached(Om);
  // chi is DESCENDING in a; keep an ascending copy so chi -> a inversions do not
  // rebuild it on every call (the light-cone table makes 1024 of them)
  const n = t.a.length;
  t.chiAsc = new Float64Array(n); t.aDesc = new Float64Array(n);
  for (let i = 0; i < n; i++) { t.chiAsc[i] = t.chi[n - 1 - i]; t.aDesc[i] = t.a[n - 1 - i]; }
  return t;
});

/** Linear interpolation on an ascending table, clamped at both ends. */
export function interp(x, xs, ys) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Invert chi(a): chi is DESCENDING in a, so flip before interpolating. */
export function aOfChi(chiVal, distTab) {
  return interp(chiVal, distTab.chiAsc, distTab.aDesc);
}

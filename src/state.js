// Parameter store for the five sliders, plus the flatness constraint.

import { growthTable, distanceTable, interp } from './cosmo/background.js';
import { calibrateAmplitude, sigma8Of, SIGMA8_FID } from './cosmo/power.js';

export const FIXED = { h: 0.6766, n_s: 0.9665 };

// Geometry. L_Z_CELLS is the COMPUTE box depth and is a hard floor: at 5 Mpc/h
// cells anything below 64 over-weights the k_z = 0 plane and inflates the
// displacement rms (32 -> +17%, 16 -> +45%, 8 -> +96%). SLAB_CELLS is the
// rendered thickness and is free to change - it costs draw calls, not FFTs.
export const GEOM = {
  boxXY: 1280.0,   // Mpc/h
  nXY: 256,        // -> 5 Mpc/h cells, k_Nyq = 0.628 h/Mpc
  nZ: 64,          // compute depth -> L_z = 320 Mpc/h
  slabCells: 8,    // rendered slab -> 40 Mpc/h
  draftXY: 128,
  draftZ: 32,      // same 1280 x 1280 x 320 Mpc/h box, half resolution
};

export const FIDUCIAL = { Omega_b: 0.0490, Omega_c: 0.2607, Omega_L: 0.6903 };

// Amplitude convention, chosen with ?norm= in the page URL:
//   'As' (default)  primordial amplitude held fixed; sigma_8 floats, so less
//                   dark matter really means less structure - the physical case
//   'sigma8'        sigma_8 held at Planck 2018's 0.8102; the Omega sliders then
//                   change only the SHAPE of P(k). Fine near the fiducial, but far
//                   from it it needs an unphysical A_s (x116 at Omega_c = 0, i.e.
//                   CMB anisotropies ~11x too large) and piles the power into
//                   box-sized modes.
// Both agree at the fiducial cosmology, so the observation is the same either way.
export const NORM = new URLSearchParams(globalThis.location?.search ?? '').get('norm') === 'sigma8'
  ? 'sigma8' : 'As';

// EH98 divides by the baryon fraction and by Omega_m, so both are kept a hair
// above zero; the bar itself can still sit at exactly 0.
const OMEGA_EPS = 1e-4;

const AMPLITUDE = calibrateAmplitude({
  Omega_b: FIDUCIAL.Omega_b,
  Omega_m: FIDUCIAL.Omega_b + FIDUCIAL.Omega_c,
  ...FIXED,
});

export function createState() {
  const s = {
    Omega_b: FIDUCIAL.Omega_b,
    Omega_c: FIDUCIAL.Omega_c,
    Omega_L: FIDUCIAL.Omega_L,
    f: null,   // filled below from the fiducial growth rate
    b1: 2.0,
    wipe: 0.5,
  };
  s.f = fiducialGrowthRate();
  return s;
}

/** f(z=0) for the fiducial cosmology - the init value of the f slider. */
export function fiducialGrowthRate() {
  const g = growthTable(FIDUCIAL.Omega_b + FIDUCIAL.Omega_c);
  return interp(1.0, g.a, g.f);
}

/**
 * Set the energy content from the divider bar.
 *
 * There is deliberately no simplex projection here any more. Three independent
 * sliders need one, and it has the annoying property that moving Omega_c drags
 * Omega_b off the value you just set. The EnergyBar widget makes
 * Omega_b + Omega_c + Omega_L = 1 structural instead - the segments are the
 * partition of a single bar - so this just stores what the widget hands over,
 * renormalising only to absorb floating-point drift.
 */
export function setEnergy(state, v) {
  const sum = v.Omega_b + v.Omega_c + v.Omega_L;
  state.Omega_b = v.Omega_b / sum;
  state.Omega_c = v.Omega_c / sum;
  state.Omega_L = v.Omega_L / sum;
}

const deriveMemo = new Map();

/**
 * Everything the renderer and the readouts need, derived from the sliders.
 * Depends only on (Omega_b, Omega_c), so it is memoised: b1 and f frames, which
 * are the ones that must stay at 60 fps, get it for free.
 */
export function derive(state) {
  const key = `${state.Omega_b},${state.Omega_c}`;
  const hit = deriveMemo.get(key);
  if (hit) return hit;
  const v = deriveUncached(state);
  deriveMemo.set(key, v);
  if (deriveMemo.size > 6) deriveMemo.delete(deriveMemo.keys().next().value);
  return v;
}

function deriveUncached(state) {
  const Omega_b = Math.max(state.Omega_b, OMEGA_EPS);
  const Omega_m = Math.max(Omega_b + state.Omega_c, 2 * OMEGA_EPS);
  const cosmo = { Omega_b, Omega_m, ...FIXED };
  const growth = growthTable(Omega_m);
  const dist = distanceTable(Omega_m);
  const A = NORM === 'sigma8' ? calibrateAmplitude(cosmo) : AMPLITUDE;
  return {
    cosmo,
    A,
    growth,
    dist,
    Omega_m,
    sigma8: NORM === 'sigma8' ? SIGMA8_FID : sigma8Of(cosmo, A),
    f0: interp(1.0, growth.a, growth.f),
  };
}

export function toHash(state) {
  const r = (x) => Number(x).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `#ob=${r(state.Omega_b)}&oc=${r(state.Omega_c)}&f=${r(state.f)}&b1=${r(state.b1)}`;
}

export function fromHash(state, hash) {
  const p = new URLSearchParams((hash || '').replace(/^#/, ''));
  const num = (k, d) => (p.has(k) ? parseFloat(p.get(k)) : d);
  const ob = num('ob', state.Omega_b), oc = num('oc', state.Omega_c);
  if (Number.isFinite(ob) && Number.isFinite(oc) && ob + oc <= 1) {
    state.Omega_b = ob; state.Omega_c = oc; state.Omega_L = 1 - ob - oc;
  }
  state.f = num('f', state.f);
  state.b1 = num('b1', state.b1);
  return state;
}

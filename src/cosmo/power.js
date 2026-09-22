// Linear matter power spectrum, P(k) = A * k^n_s * T(k)^2, in (Mpc/h)^3.
//
// AMPLITUDE CONVENTION. (state.js can also hold sigma_8 fixed instead, by
// recalibrating A per cosmology; this describes the fixed-A mode.) The app holds
// the primordial amplitude A fixed rather than sigma_8. That is the physically honest response to moving the Omega
// sliders: more dark matter really does mean more structure, instead of being
// silently renormalised away. A is calibrated ONCE from the fiducial cosmology
// so that sigma_8(fiducial) = SIGMA8_FID; sigma_8 then floats and is displayed
// as a derived readout.

import { transferEH98 } from './eh98.js';
import { growthTable } from './background.js';

export const SIGMA8_FID = 0.8102;

/**
 * The Omega_m dependence that a sigma_8-normalised code hides.
 *
 * Poisson relates the primordial potential to the density:
 *   delta(k, a) = [2 R_H^2 k^2 T(k) / (3 Omega_m)] * g(a) * phi_prim(k)
 * where g is the growth normalised so that g -> a in matter domination. So at
 * FIXED primordial amplitude
 *   P_delta(k) ~ A_s k^n_s T(k)^2 * (g(1) / Omega_m)^2
 * and it is this (g(1)/Omega_m)^2 factor, not just T(k), that carries most of
 * the "more dark matter means more structure" signal. jax_cosmo never needs it
 * because linear_matter_power always divides it back out through sigma_8.
 *
 * growthTable() integrates from a = 1e-3 with g(a0) = a0, i.e. already in the
 * g -> a convention, so g(1) is exactly its un-normalised endpoint.
 */
export function amplitudeFactor(Omega_m) {
  const { Dnorm } = growthTable(Omega_m);
  return (Dnorm / Omega_m) ** 2;
}

/**
 * sigma^2(R) = 1/(2 pi^2) Int k^2 P(k) W^2(kR) dk, for UNNORMALISED P = k^n_s T^2.
 *
 * `lnkMin`/`lnkMax` default to a range wide enough to converge. jax_cosmo's own
 * `power.sigmasqr` passes log10 bounds into an integrand that does exp(), so its
 * effective range is ln k in [-4, 3]; pass those explicitly to reproduce it.
 */
export function sigmaSqrUnnorm(R, cosmo, opts = {}) {
  const { lnkMin = -12, lnkMax = 6, n = 2048 } = opts; // n even -> Simpson
  const lnk = new Float64Array(n + 1), k = new Float64Array(n + 1);
  const h = (lnkMax - lnkMin) / n;
  for (let i = 0; i <= n; i++) { lnk[i] = lnkMin + i * h; k[i] = Math.exp(lnk[i]); }
  const T = transferEH98(k, cosmo);
  const amp = amplitudeFactor(cosmo.Omega_m);

  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const ki = k[i], x = ki * R;
    // W(x) = 3 j_1(x)/x; the series avoids 0/0 as x -> 0
    const w = x < 1e-3
      ? 1 - (x * x) / 10
      : (3 * (Math.sin(x) - x * Math.cos(x))) / (x * x * x);
    const pk = amp * T[i] * T[i] * Math.pow(ki, cosmo.n_s);
    const integrand = ki * (ki * w) * (ki * w) * pk; // d ln k measure
    const wt = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sum += wt * integrand;
  }
  return ((h / 3) * sum) / (2 * Math.PI * Math.PI);
}

/** Primordial amplitude A that gives sigma_8 = SIGMA8_FID at `fiducial`. */
export function calibrateAmplitude(fiducial) {
  return (SIGMA8_FID * SIGMA8_FID) / sigmaSqrUnnorm(8.0, fiducial);
}

/** sigma_8 for `cosmo` at fixed amplitude `A` (the derived readout). */
export function sigma8Of(cosmo, A) {
  return Math.sqrt(A * sigmaSqrUnnorm(8.0, cosmo));
}

/**
 * P_lin(k) at a = 1, in (Mpc/h)^3.
 * @param {Float64Array} k  h/Mpc
 * @param {object} cosmo    {Omega_b, Omega_m, h, n_s}
 * @param {number} A        amplitude from calibrateAmplitude()
 */
export function linearPower(k, cosmo, A, out) {
  const T = transferEH98(k, cosmo, out);
  const res = out || T;
  const amp = A * amplitudeFactor(cosmo.Omega_m);
  for (let i = 0; i < k.length; i++) {
    res[i] = k[i] > 0 ? amp * Math.pow(k[i], cosmo.n_s) * T[i] * T[i] : 0;
  }
  return res;
}

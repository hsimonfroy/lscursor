// Two-point correlation function from the linear power spectrum.
//
//   xi(s) = 1/(2 pi^2) Int k^2 P(k) j0(ks) dk,   j0(x) = sin(x)/x
//
// The Kaiser monopole scales exactly like P(k) does, so the (b1, f) prefactor
// multiplies xi as well and only the cosmology needs a fresh transform.
//
// Everything that does not depend on P is precomputed once: the k grid, the
// d ln k measure, the small-scale damping, and j0 on the (s, k) grid. An update
// is then one matrix-vector product - about 0.4 ms for 160 x 1280 - so the
// curve can follow a slider.

/**
 * @param {{sMin?:number, sMax?:number, nS?:number,
 *          kMin?:number, kMax?:number, nK?:number, damp?:number}} [opts]
 *   damp: Gaussian cut exp(-(k*damp)^2) in Mpc/h. It kills the ringing that a
 *   truncated k integral would otherwise leave, on scales far below the ones
 *   plotted (1 Mpc/h against s >= 2).
 * @returns {{s:Float64Array, k:Float64Array, xi:(P:Float64Array)=>Float64Array}}
 */
export function xiTransform({ sMin = 2, sMax = 200, nS = 160,
                              kMin = 3e-5, kMax = 10, nK = 1280, damp = 1.0 } = {}) {
  const s = new Float64Array(nS);
  for (let i = 0; i < nS; i++) s[i] = sMin + ((sMax - sMin) * i) / (nS - 1);

  const k = new Float64Array(nK);
  const dlnk = Math.log(kMax / kMin) / (nK - 1);
  for (let j = 0; j < nK; j++) k[j] = kMin * Math.exp(j * dlnk);

  // measure * k^3 (the d ln k form of k^2 dk) * damping, once
  const meas = new Float64Array(nK);
  for (let j = 0; j < nK; j++) {
    const kd = k[j] * damp;
    meas[j] = (k[j] ** 3 * dlnk * Math.exp(-kd * kd)) / (2 * Math.PI * Math.PI);
  }

  // j0(k s) folded together with the measure: W[i][j] is all that multiplies P
  const W = new Float64Array(nS * nK);
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nK; j++) {
      const x = k[j] * s[i];
      W[i * nK + j] = meas[j] * (x < 1e-8 ? 1 : Math.sin(x) / x);
    }
  }

  const out = new Float64Array(nS);
  return {
    s,
    k,
    /** @param {Float64Array} P  P(k) on this transform's own k grid */
    xi(P) {
      for (let i = 0; i < nS; i++) {
        let sum = 0;
        const off = i * nK;
        for (let j = 0; j < nK; j++) sum += W[off + j] * P[j];
        out[i] = sum;
      }
      return out;
    },
  };
}

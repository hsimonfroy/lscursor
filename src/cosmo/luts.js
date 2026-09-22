// Light-cone lookup: everything that depends on distance from the observer.
//
// The observer sits in the bottom-left corner of the slice, in the slab
// mid-plane, so distance from that corner IS comoving distance and the slice is
// a light cone. Growth and the growth rate therefore vary across the image, and
// both are functions of r alone - one 1-D table, sampled per particle in the
// vertex shader. That is what makes the light cone cost nothing.

import { growthTable, distanceTable, interp, aOfChi } from './background.js';

export const LC_N = 1024;

/**
 * Build the (D, f*D) vs r table.
 * @param {number} Omega_m
 * @param {number} rMax  Mpc/h; the corner-to-corner diagonal of the slice
 * @returns {{data:Float32Array, rMax:number, zMax:number, dMin:number}}
 */
export function lightconeLut(Omega_m, rMax) {
  const g = growthTable(Omega_m);
  const dist = distanceTable(Omega_m);
  const data = new Float32Array(LC_N * 4);
  let zMax = 0, dMin = 1;
  for (let i = 0; i < LC_N; i++) {
    const r = (i / (LC_N - 1)) * rMax;
    const a = aOfChi(r, dist);
    const D = interp(a, g.a, g.D);
    const f = interp(a, g.a, g.f);
    data[i * 4] = D;
    data[i * 4 + 1] = f * D;
    data[i * 4 + 2] = 1 / a - 1; // z, for the overlay/readout
    if (i === LC_N - 1) { zMax = 1 / a - 1; dMin = D; }
  }
  /** Redshift at a comoving distance r (Mpc/h), read off the same table. */
  const zOf = (r) => {
    const t = Math.min(LC_N - 1, Math.max(0, (r / rMax) * (LC_N - 1)));
    const i = t | 0, j = Math.min(i + 1, LC_N - 1), f = t - i;
    return data[i * 4 + 2] + f * (data[j * 4 + 2] - data[i * 4 + 2]);
  };
  return { data, rMax, zMax, dMin, zOf };
}

// Eisenstein & Hu (1998) matter transfer function.
//
// Ported line-for-line from jax_cosmo.transfer.Eisenstein_Hu so that the browser
// and the Python reference agree to machine precision. Keep it that way: the
// validator asserts a 1e-6 relative match against jax_cosmo over a grid of
// cosmologies. k is in h/Mpc throughout.

const TCMB = 2.726; // K, jax_cosmo.constants.tcmb

// jnp.sinc is the NORMALISED sinc, sin(pi x)/(pi x). jax_cosmo calls it as
// sinc(k*s/pi), so what is actually wanted is sin(x)/x. Do not "simplify" this.
function sincUnnormalised(x) {
  return Math.abs(x) < 1e-8 ? 1 - (x * x) / 6 : Math.sin(x) / x;
}

/**
 * @param {Float64Array|number[]} k  wavenumbers in h/Mpc
 * @param {{Omega_b:number, Omega_m:number, h:number}} cosmo
 * @param {Float64Array} [out]
 * @returns {Float64Array} T(k), normalised to 1 as k -> 0
 */
export function transferEH98(k, cosmo, out) {
  const { Omega_b, Omega_m, h } = cosmo;
  const res = out || new Float64Array(k.length);

  const T_2_7_sqr = (TCMB / 2.7) ** 2;
  const h2 = h * h;
  const w_m = Omega_m * h2;
  const w_b = Omega_b * h2;
  const fb = Omega_b / Omega_m;
  const fc = (Omega_m - Omega_b) / Omega_m;

  const k_eq = (7.46e-2 * w_m) / T_2_7_sqr / h; // Eq. (3), h/Mpc
  const z_eq = (2.5e4 * w_m) / T_2_7_sqr ** 2; // Eq. (2)

  // z_drag, Eq. (4)
  const b1d = 0.313 * w_m ** -0.419 * (1 + 0.607 * w_m ** 0.674);
  const b2d = 0.238 * w_m ** 0.223;
  const z_d =
    ((1291 * w_m ** 0.251) / (1 + 0.659 * w_m ** 0.828)) * (1 + b1d * w_b ** b2d);

  // Baryon/photon momentum density ratios, Eq. (5)
  const R_d = ((31.5 * w_b) / T_2_7_sqr ** 2) * (1e3 / z_d);
  const R_eq = ((31.5 * w_b) / T_2_7_sqr ** 2) * (1e3 / z_eq);

  // Sound horizon at drag, Eq. (6), in Mpc/h
  const sh_d =
    (2 / (3 * k_eq)) *
    Math.sqrt(6 / R_eq) *
    Math.log((Math.sqrt(1 + R_d) + Math.sqrt(R_eq + R_d)) / (1 + Math.sqrt(R_eq)));

  // Silk damping scale, Eq. (7), in h/Mpc
  const k_silk =
    (1.6 * w_b ** 0.52 * w_m ** 0.73 * (1 + (10.4 * w_m) ** -0.95)) / h;

  // --- CDM piece, EH98 (11, 12) ---
  const a1 = (46.9 * w_m) ** 0.67 * (1 + (32.1 * w_m) ** -0.532);
  const a2 = (12.0 * w_m) ** 0.424 * (1 + (45.0 * w_m) ** -0.582);
  const alpha_c = a1 ** -fb * a2 ** -(fb ** 3);
  const b1c = 0.944 / (1 + (458.0 * w_m) ** -0.708);
  const b2c = (0.395 * w_m) ** -0.0266;
  const beta_c = 1 / (1 + b1c * (fc ** b2c - 1));

  // EH98 (10, 19)
  const T_tilde = (k1, alpha, beta) => {
    const q = k1 / (13.41 * k_eq);
    const L = Math.log(Math.E + 1.8 * beta * q);
    const C = 14.2 / alpha + 386.0 / (1 + 69.9 * q ** 1.08);
    return L / (L + C * q * q);
  };

  // --- Baryon piece, EH98 (14, 19, 21) ---
  const y = (1 + z_eq) / (1 + z_d);
  const x = Math.sqrt(1 + y);
  const G_EH98 = y * (-6 * x + (2 + 3 * y) * Math.log((x + 1) / (x - 1)));
  const alpha_b = 2.07 * k_eq * sh_d * (1 + R_d) ** -0.75 * G_EH98;
  const beta_node = 8.41 * w_m ** 0.435;
  const beta_b = 0.5 + fb + (3 - 2 * fb) * Math.sqrt((17.2 * w_m) ** 2 + 1);

  for (let i = 0; i < k.length; i++) {
    const ki = k[i];
    if (ki <= 0) { res[i] = 1; continue; }
    const ks = ki * sh_d;

    // EH98 (17, 18)
    const f = 1 / (1 + (ks / 5.4) ** 4);
    const Tc = f * T_tilde(ki, 1.0, beta_c) + (1 - f) * T_tilde(ki, alpha_c, beta_c);

    const tilde_s = sh_d / Math.cbrt(1 + (beta_node / ks) ** 3);
    const Tb =
      (T_tilde(ki, 1.0, 1.0) / (1 + (ks / 5.2) ** 2) +
        (alpha_b / (1 + (beta_b / ks) ** 3)) * Math.exp(-((ki / k_silk) ** 1.4))) *
      sincUnnormalised(ki * tilde_s);

    res[i] = fb * Tb + fc * Tc;
  }
  return res;
}

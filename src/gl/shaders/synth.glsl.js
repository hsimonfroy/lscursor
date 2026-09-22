// Fused pass: generate the white noise directly in Fourier space, apply the
// cosmology, and emit the two complex fields the single inverse FFT needs.
//
// WHY FOURIER-SPACE NOISE. The obvious route is to hash real-space cells into a
// Gaussian field and forward-FFT it once at load. Hashing the WAVEVECTOR instead
// buys two things:
//
//  1. No forward FFT and no stored noise spectrum at all (saves a 22-stage chain
//     at load and ~34 MB of VRAM) - the noise is regenerated from the hash every
//     time, for free, inside a pass that has to run anyway.
//  2. The draft and full grids share a box size, so a given mode has the SAME
//     integer wavevector on both. Hashing on that integer makes the 128x128x32
//     draft exactly the 256x256x64 field truncated at half Nyquist - the same
//     universe, just blurrier. Real-space hashing would make them unrelated
//     fields and the image would jump on every pointerup.
//
// Hermitian symmetry is imposed explicitly so the inverse transform returns real
// fields: modes are hashed by the canonical representative of the {k, -k} pair,
// and the self-conjugate modes (every component 0 or n/2) are forced real.
//
// PACKING. One RGBA32F texel carries two complex numbers. Psi_x and Psi_y are
// both real fields, so their spectra are both Hermitian and can ride together as
// Psi_x_hat + i * Psi_y_hat: after the inverse FFT the real part is Psi_x and the
// imaginary part is Psi_y. That is what collapses the whole chain to ONE inverse
// FFT. The spare imaginary slot of the second field is where a primordial
// potential would go if f_NL is ever added.

import { ATLAS_GLSL } from './common.glsl.js';

// The mode synthesis, shared by both entry points below. Given integer grid
// coordinates g of a Fourier mode on the FULL nx x ny x nz box, returns the two
// packed complex numbers (Psi_x_hat + i Psi_y_hat, delta_L_hat).
const SYNTH_COMMON = `precision highp float;
precision highp int;
precision highp sampler2D;


uniform sampler2D uPk;     // 1 x LUTN RGBA32F: x = sqrt(P(k) * Ncells / Vbox)
uniform int   uLutN;
uniform vec2  uLutLogK;    // (log(kmin), 1/dlog) for the LUT index
uniform vec3  uKf;         // fundamental wavenumbers 2*pi/L per axis, h/Mpc
uniform uint  uSeed;
uniform float uSmoothR;    // Gaussian smoothing of delta_L only, Mpc/h (0 = off)


const float TWO_PI = 6.283185307179586;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

float sqrtP(float k) {
  float t = (log(k) - uLutLogK.x) * uLutLogK.y;
  t = clamp(t, 0.0, float(uLutN - 1));
  int i = int(t);
  int j = min(i + 1, uLutN - 1);
  float fr = t - float(i);
  return mix(texelFetch(uPk, ivec2(i, 0), 0).x, texelFetch(uPk, ivec2(j, 0), 0).x, fr);
}

vec4 synthMode(ivec3 g) {
  ivec3 ki = ivec3(wrapIndex(g.x, uN.x), wrapIndex(g.y, uN.y), wrapIndex(g.z, uN.z));

  if (ki == ivec3(0)) { return vec4(0.0); }   // zero mean

  // Canonical representative of the conjugate pair {k, -k}, worked out on the RAW
  // grid indices rather than the signed ones: the partner of index i is (n - i)
  // mod n, which is well defined at the Nyquist index where the signed convention
  // is ambiguous (n/2 and -n/2 are the same mode).
  ivec3 gp = ivec3((uN.x - g.x) % uN.x, (uN.y - g.y) % uN.y, (uN.z - g.z) % uN.z);
  bool sc = gp == g;                      // self-conjugate -> must be purely real
  bool flip = false;
  ivec3 gc = g;
  if (!sc && (gp.z < g.z || (gp.z == g.z && (gp.y < g.y || (gp.y == g.y && gp.x < g.x))))) {
    gc = gp; flip = true;
  }

  uvec3 h = pcg3d(uvec3(gc) ^ uvec3(uSeed, uSeed * 747796405u + 2891336453u, uSeed ^ 0x9e3779b9u));
  float u1 = (float(h.x) + 0.5) * 2.3283064365386963e-10;
  float u2 = (float(h.y) + 0.5) * 2.3283064365386963e-10;
  float amp = sqrt(-2.0 * log(u1));
  float ph = TWO_PI * u2;

  // <|g|^2> = Ncells: Re, Im ~ N(0, Ncells/2) for a generic mode
  float ncells = float(uN.x) * float(uN.y) * float(uN.z);
  vec2 gk = amp * vec2(cos(ph), sin(ph)) * sqrt(0.5 * ncells);
  if (sc) gk = vec2(amp * cos(ph) * sqrt(ncells), 0.0);
  else if (flip) gk.y = -gk.y;

  vec3 kv = vec3(ki) * uKf;
  float k2 = dot(kv, kv);
  float k = sqrt(k2);

  vec2 dhat = gk * sqrtP(k);                    // delta_L(k)

  // Gradient kernel. The Nyquist coefficient of a spectral derivative has to be
  // zeroed: at k_j = +-k_Nyq the two signs are the same mode, so i k_j delta_hat
  // is not Hermitian there and Psi would come back complex. numpy's irfftn hides
  // this by construction; with a full complex transform it must be explicit.
  vec3 kg = kv;
  if (g.x == (uN.x >> 1)) kg.x = 0.0;
  if (g.y == (uN.y >> 1)) kg.y = 0.0;
  if (g.z == (uN.z >> 1)) kg.z = 0.0;

  // Psi_hat_j = i k_j delta_hat / k^2  (so that div Psi = -delta, matter falls in)
  vec2 idhat = vec2(-dhat.y, dhat.x);           // i * delta_hat
  vec2 psx = idhat * (kg.x / k2);
  vec2 psy = idhat * (kg.y / k2);

  // delta_L feeds the Lagrangian bias weight, where it is defined on the halo
  // Lagrangian radius rather than on a grid cell. Smoothing it here costs
  // nothing and halves the fraction of negative weights at b1 = 2.
  vec2 dsm = dhat * exp(-0.5 * k2 * uSmoothR * uSmoothR);

  // slot 0 = Psi_x_hat + i Psi_y_hat ; slot 1 = delta_L_hat (+ i * spare)
  return vec4(psx.x - psy.y, psx.y + psy.x, dsm.x, dsm.y);
}`;

/** Full 3-D volume in k-space, for the reference (validation) pipeline. */
export const SYNTH_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${ATLAS_GLSL}
${SYNTH_COMMON}
out vec4 outColor;
void main() { outColor = synthMode(atlasToGrid(ivec2(gl_FragCoord.xy))); }`;

// Fused synthesis + z-transform, straight into the slab.
//
// Only slabCells of the nz layers are ever drawn, and the inverse FFT is
// separable, so the z-direction can be done FIRST as a direct sum evaluated at
// just those layers:
//
//   G(kx, ky, z) = (1/nz) sum_kz F(kx, ky, kz) exp(+2 pi i kz z / nz)
//
// after which the x and y FFTs run on slabCells layers instead of nz - an 8x
// smaller volume. This is exact, not an approximation, and the full k-space cube
// is never written to memory at all: each output texel regenerates its column of
// modes from the hash. Hermitian symmetry in (kx, ky) survives the sum, so the
// two-reals-in-one-complex packing still works per layer.
export const SYNTH_Z_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform ivec3 uN;         // FULL box: nx, ny, nz  (what synthMode needs)
uniform ivec3 uSlabN;     // nx, ny, slabCells     (the output layout)
uniform int   uSlabTilesX;
uniform int   uZ0;        // first box layer of the slab

// Same convention as ATLAS_GLSL; defined here because this shader has its own
// output layout and does not include the atlas snippet.
int wrapIndex(int i, int n) { return (i <= (n >> 1)) ? i : i - n; }

${SYNTH_COMMON}

out vec4 outColor;
const float TWO_PI_Z = 6.283185307179586;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int tx = p.x / uSlabN.x, ty = p.y / uSlabN.y;
  int kx = p.x - tx * uSlabN.x, ky = p.y - ty * uSlabN.y;
  int z = uZ0 + ty * uSlabTilesX + tx;          // box layer this texel represents

  vec2 a0 = vec2(0.0), a1 = vec2(0.0);
  for (int kz = 0; kz < 1024; kz++) {
    if (kz >= uN.z) break;
    vec4 F = synthMode(ivec3(kx, ky, kz));
    // reduce kz*z mod nz BEFORE dividing: same fp32 argument-reduction issue as
    // the FFT twiddles, and it is exact because the kernel has period nz
    int m = (kz * z) % uN.z;
    float ang = TWO_PI_Z * float(m) / float(uN.z);
    float c = cos(ang), s = sin(ang);
    a0 += vec2(c * F.x - s * F.y, c * F.y + s * F.x);
    a1 += vec2(c * F.z - s * F.w, c * F.w + s * F.z);
  }
  outColor = vec4(a0, a1) / float(uN.z);
}`;

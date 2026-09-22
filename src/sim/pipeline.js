// Tier B: everything that has to be recomputed when Omega_b or Omega_c moves.
//
// Two modes, same answer:
//
//   'slab' (default)  fused synthesis + z-transform straight into the slab
//                     -> 2-D inverse FFTs on slabCells layers -> payload pass
//   'full3d'          full k-space cube -> 3-D inverse FFT -> cut out the slab
//
// 'slab' works because only slabCells of the nz layers are ever drawn and the
// inverse FFT is separable: the z-sum can be evaluated at just those layers,
// after which the x/y transforms touch an nz/slabCells-times smaller volume.
// 'full3d' is kept as the reference that 'slab' is validated against.
//
// b1, f, the light cone and the wipe never come through here.

import { program, texture, framebuffer, pingPong, pass, FULLSCREEN_VS } from '../gl/glutil.js';
import { planFFT, atlasLayout } from '../gl/fft.js';
import { SYNTH_FS, SYNTH_Z_FS } from '../gl/shaders/synth.glsl.js';
import { PAYLOAD_FS } from '../gl/shaders/payload.glsl.js';
import { linearPower } from '../cosmo/power.js';

export const LUT_N = 1024;

/**
 * Build the sqrt(P(k) * Ncells / Vbox) lookup the synthesis shader samples.
 * Computed by the same JS as the validator, so the GPU cannot silently diverge
 * from the Python reference.
 */
export function buildPkLut(cosmo, A, grid) {
  const { nx, ny, nz, boxXY, boxZ } = grid;
  const kfx = (2 * Math.PI) / boxXY;
  const kMin = 0.5 * Math.min(kfx, (2 * Math.PI) / boxZ);
  const kMax = 2.0 * Math.sqrt(3) * Math.PI * (nx / boxXY);
  const logK0 = Math.log(kMin);
  const dlog = (Math.log(kMax) - logK0) / (LUT_N - 1);

  const k = new Float64Array(LUT_N);
  for (let i = 0; i < LUT_N; i++) k[i] = Math.exp(logK0 + i * dlog);
  const P = linearPower(k, cosmo, A);

  const nCells = nx * ny * nz;
  const vBox = boxXY * boxXY * boxZ;
  const data = new Float32Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) data[i * 4] = Math.sqrt((P[i] * nCells) / vBox);
  return { data, logK0, invDlog: 1 / dlog };
}

export class Pipeline {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {{nx:number, ny:number, nz:number, slabCells:number,
   *          boxXY:number, boxZ:number}} grid
   */
  constructor(gl, grid, { mode = 'slab' } = {}) {
    this.gl = gl;
    this.grid = grid;
    this.mode = mode;
    const { nx, ny, nz, slabCells } = grid;

    this.slab = atlasLayout(nx, ny, slabCells);
    if (mode === 'slab') {
      // the FFT scratch is only the slab: ~17 MB instead of ~134 MB at 256^2 x 64
      this.vol = this.slab;
      this.plan = planFFT(gl, nx, ny, slabCells, { axes: [0, 1] });
      this.synth = program(gl, FULLSCREEN_VS, SYNTH_Z_FS);
    } else {
      this.vol = atlasLayout(nx, ny, nz);
      this.plan = planFFT(gl, nx, ny, nz);
      this.synth = program(gl, FULLSCREEN_VS, SYNTH_FS);
    }
    this.pack = program(gl, FULLSCREEN_VS, PAYLOAD_FS);

    this.pp = pingPong(gl, this.vol.atlasW, this.vol.atlasH, gl.RGBA32F);
    this.lutTex = texture(gl, LUT_N, 1, gl.RGBA32F);
  }

  /** Allocate a payload target. Callers keep one for the live field, one for truth. */
  createPayload() {
    const gl = this.gl;
    // In slab mode the FFT output already IS the slab, in the slab layout, so the
    // payload just aliases it (run() re-points tex at the final ping-pong
    // buffer). The truth is baked to an image before the next run() overwrites
    // it, so nothing needs a private copy - that copy was ~6 ms per change.
    if (this.mode === 'slab') return { tex: null, fb: null, aliased: true, ...this.slab };
    const t = texture(gl, this.slab.atlasW, this.slab.atlasH, gl.RGBA16F);
    return { tex: t, fb: framebuffer(gl, t), ...this.slab };
  }

  /**
   * Recompute the payload for one cosmology.
   * @param {object} cosmo  {Omega_b, Omega_m, h, n_s}
   * @param {number} A      primordial amplitude
   * @param {object} payload from createPayload()
   * @param {{seed?:number, smoothR?:number, stopAfterSynth?:boolean}} [opts]
   */
  run(cosmo, A, payload, opts = {}) {
    const gl = this.gl;
    const { nx, ny, nz, slabCells, boxXY, boxZ } = this.grid;
    const { seed = 1, smoothR = 4.0, stopAfterSynth = false, profile = null } = opts;
    // Optional per-stage timing: sync the GPU after each stage so each number
    // is that stage's own cost. Only for dev pages - it serialises the pipeline.
    let tp = performance.now();
    const lap = (k) => {
      if (!profile) return;
      const px = new Float32Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pp.fbA);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
      const n = performance.now(); profile[k] = +(n - tp).toFixed(2); tp = n;
    };

    // --- 1. fused noise + cosmology synthesis ---
    const lut = buildPkLut(cosmo, A, this.grid);
    lap('P(k) LUT (JS)');
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LUT_N, 1, gl.RGBA, gl.FLOAT, lut.data);

    const z0 = (nz - slabCells) >> 1;
    gl.useProgram(this.synth);
    gl.disable(gl.BLEND);
    const L = this.synth.loc;
    gl.uniform3i(L.uN, nx, ny, nz);
    if (this.mode === 'slab') {
      gl.uniform3i(L.uSlabN, nx, ny, slabCells);
      gl.uniform1i(L.uSlabTilesX, this.slab.tilesX);
      gl.uniform1i(L.uZ0, z0);
    } else {
      gl.uniform1i(L.uTilesX, this.vol.tilesX);
    }
    gl.uniform1i(L.uPk, 0);
    gl.uniform1i(L.uLutN, LUT_N);
    gl.uniform2f(L.uLutLogK, lut.logK0, lut.invDlog);
    gl.uniform3f(L.uKf, (2 * Math.PI) / boxXY, (2 * Math.PI) / boxXY, (2 * Math.PI) / boxZ);
    gl.uniform1ui(L.uSeed, seed >>> 0);
    gl.uniform1f(L.uSmoothR, smoothR);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    pass(gl, this.pp.dstFb, this.vol.atlasW, this.vol.atlasH);
    this.pp.swap();
    lap('synthesis + z-sum (GPU)');
    if (stopAfterSynth) return; // debug hook: leaves the k-space field in volumeFb

    // --- 2. inverse FFT: x and y only in slab mode, all three otherwise ---
    this.plan.inverse(this.pp);
    lap('2-D inverse FFT (GPU)');

    if (payload.aliased) {
      payload.tex = this.pp.src;
      payload.fb = this.pp.src === this.pp.fbA.tex ? this.pp.fbA : this.pp.fbB;
      lap('payload pack (GPU)');
      return;
    }

    // --- 3. compact the slab into the persistent fp16 payload (full3d only) ---
    const slabMode = this.mode === 'slab';
    gl.useProgram(this.pack);
    const K = this.pack.loc;
    gl.uniform1i(K.uSrc, 0);
    gl.uniform3i(K.uSrcN, nx, ny, slabMode ? slabCells : nz);
    gl.uniform1i(K.uSrcTilesX, this.vol.tilesX);
    gl.uniform3i(K.uDstN, nx, ny, slabCells);
    gl.uniform1i(K.uDstTilesX, this.slab.tilesX);
    gl.uniform1i(K.uZ0, slabMode ? 0 : z0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pp.src);
    pass(gl, payload.fb, this.slab.atlasW, this.slab.atlasH);
    lap('payload pack (GPU)');
  }

  /** The fp32 volume scratch; only valid until the next run(). Debug/validation. */
  get volumeTexture() { return this.pp.src; }
  get volumeFb() { return this.pp.src === this.pp.fbA.tex ? this.pp.fbA : this.pp.fbB; }

  dispose() {
    this.pp.dispose();
    this.plan.dispose();
    this.gl.deleteTexture(this.lutTex);
    this.gl.deleteProgram(this.synth);
    this.gl.deleteProgram(this.pack);
  }
}

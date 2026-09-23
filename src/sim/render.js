// Tier A: the part that runs every frame.
//
// One attributeless point draw over the slab plus one full-screen composite.
// Nothing here touches the FFT, so b1, f, the wipe and the colour map are all
// free - the payload from the last cosmology change is reused as-is.

import { program, texture, framebuffer, pass, FULLSCREEN_VS } from '../gl/glutil.js';
import { RENDER_VS, RENDER_FS } from '../gl/shaders/render.glsl.js';
import { POST_FS } from '../gl/shaders/post.glsl.js';
import { colormapTexture } from '../colormaps.js';
import { lightconeLut, LC_N } from '../cosmo/luts.js';

export class Renderer {
  constructor(gl, caps, { width, height, grid }) {
    this.gl = gl;
    this.caps = caps;
    this.grid = grid;
    this.W = width;    // display size
    this.H = height;

    // The accumulation buffer is the SIMULATION grid, not the display size.
    // Painting 65k particles onto a 720x720 canvas leaves 87% of pixels empty
    // and the image collapses to the colour of "no particles here". One cell
    // per texel means every texel receives exactly slabCells particles at mean
    // density, and the composite bilinearly magnifies to the canvas - which is
    // honest, because 5 Mpc/h really is the resolution of the physics.
    this.gw = grid.nx;
    this.gh = grid.ny;

    this.pointProg = program(gl, RENDER_VS, RENDER_FS);
    this.postProg = program(gl, FULLSCREEN_VS, POST_FS);

    // One channel: the unweighted-matter channel went when the field selector
    // did (f = 0, b1 = 1 gives the matter field). Additive float blending is the
    // single most expensive thing in a frame on an integrated GPU, and R32F
    // blends a quarter of the bytes RGBA32F does. EXT_float_blend covers it;
    // R16F is the fallback, with a ~1% noise floor nobody can see.
    const fmt = caps.floatBlend ? gl.R32F : gl.R16F;
    this.accum = texture(gl, this.gw, this.gh, fmt);
    this.accumFb = framebuffer(gl, this.accum);
    // deliberately left at NEAREST: post.glsl does its own bilinear lift so the
    // app never depends on OES_texture_float_linear

    // Display-sized, NOT grid-sized: composite() always renders a full
    // DISPLAY-by-DISPLAY quad, so a grid-sized truth target would be written
    // with the wrong viewport and come back mostly empty.
    this.truth = texture(gl, width, height, gl.RGBA8);
    this.truthFb = framebuffer(gl, this.truth);
    gl.bindTexture(gl.TEXTURE_2D, this.truth);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Bound to the truth sampler while baking the truth itself: sampling a
    // texture that is also the current colour attachment is a feedback loop and
    // renders undefined (in practice, black).
    this.dummy = texture(gl, 1, 1, gl.RGBA8);

    this.lcTex = texture(gl, LC_N, 1, gl.RGBA32F);
    this.cmap = colormapTexture(gl, 'inferno');
    this.vao = gl.createVertexArray(); // empty: positions come from gl_VertexID
    this.lc = null;
  }

  setColormap(name) {
    this.gl.deleteTexture(this.cmap);
    this.cmap = colormapTexture(this.gl, name);
  }

  /** Rebuild the light-cone table. Only needed when Omega_m changes. */
  setCosmology(Omega_m) {
    // A little past the far corner: particles that wrap across the top or right
    // edge are evaluated at their periodic image, up to ~50 Mpc/h further out.
    const rMax = Math.hypot(this.grid.boxXY, this.grid.boxXY) + 0.05 * this.grid.boxXY;
    this.lc = lightconeLut(Omega_m, rMax);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.lcTex);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, LC_N, 1,
      this.gl.RGBA, this.gl.FLOAT, this.lc.data);
    return this.lc;
  }

  /** Accumulate the displaced, weighted particles into `fb`. */
  paint(payload, { f, b1, f0 }, fb = this.accumFb) {
    const gl = this.gl;
    const { nx, ny, slabCells, boxXY } = this.grid;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, this.gw, this.gh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(this.pointProg);
    gl.bindVertexArray(this.vao);
    const L = this.pointProg.loc;
    gl.uniform1i(L.uPayload, 0);
    gl.uniform1i(L.uLc, 1);
    gl.uniform3i(L.uN, nx, ny, slabCells);
    gl.uniform1i(L.uTilesX, payload.tilesX);
    gl.uniform2f(L.uBox, boxXY, boxXY);
    gl.uniform2f(L.uObs, 0, 0);          // bottom-left corner
    gl.uniform1f(L.uInvRMax, 1 / this.lc.rMax);
    gl.uniform1f(L.uGamma, f / f0);
    gl.uniform1f(L.uB1m1, b1 - 1);
    gl.uniform2f(L.uViewport, this.gw, this.gh);
    gl.uniform1f(L.uPointSize, 2.0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, payload.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lcTex);

    gl.drawArrays(gl.POINTS, 0, nx * ny * slabCells);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * Clip levels for the colour ramp: the q and 1-q quantiles of the painted
   * field, with q = 5e-5 by default.
   *
   * A handful of cluster pixels are an order of magnitude above everything else
   * and would otherwise set the top of the scale single-handedly, flattening the
   * whole image. Only a few values need trimming from each tail, so this does a
   * bounded partial selection in one pass rather than sorting 65k floats - a
   * full sort would cost ~15 ms per frame and a histogram is overkill for k < 10.
   */
  quantiles(q = 5e-5) {
    const n = this.gw * this.gh;
    this.readAccum();

    const k = Math.max(1, Math.round(n * q));
    const lows = new Float32Array(k).fill(Infinity);
    const highs = new Float32Array(k).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const v = this._qbuf[i * 4];
      if (v < lows[k - 1]) {
        let j = k - 1;
        while (j > 0 && lows[j - 1] > v) { lows[j] = lows[j - 1]; j--; }
        lows[j] = v;
      }
      if (v > highs[k - 1]) {
        let j = k - 1;
        while (j > 0 && highs[j - 1] < v) { highs[j] = highs[j - 1]; j--; }
        highs[j] = v;
      }
    }
    return { lo: lows[k - 1], hi: highs[k - 1] };
  }

  /**
   * Read the accumulation buffer back to the CPU: one float per grid pixel, at
   * stride 4 (RGBA/FLOAT is the readback format every float target supports).
   * The array is reused across calls - copy it if you need to keep it.
   */
  readAccum() {
    const gl = this.gl;
    const n = this.gw * this.gh;
    if (!this._qbuf || this._qbuf.length !== n * 4) this._qbuf = new Float32Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFb);
    gl.readPixels(0, 0, this.gw, this.gh, gl.RGBA, gl.FLOAT, this._qbuf);
    return this._qbuf;
  }

  /** Composite the accumulation buffer to `target` (null = the canvas). */
  composite(target, { lo, hi, wipe = 2.0, baking = false,
                      knee = 0, gammaT = 1, lift = 0 } = {}) {
    const gl = this.gl;
    gl.useProgram(this.postProg);
    gl.disable(gl.BLEND);
    const L = this.postProg.loc;
    gl.uniform1i(L.uAccum, 0);
    gl.uniform1i(L.uTruth, 1);
    gl.uniform1i(L.uCmap, 2);
    gl.uniform1f(L.uLo, lo);
    gl.uniform1f(L.uHi, hi);
    gl.uniform1f(L.uWipe, wipe);
    gl.uniform1f(L.uKnee, knee);
    gl.uniform1f(L.uGammaT, gammaT);
    gl.uniform1f(L.uLift, lift);
    gl.uniform2f(L.uViewport, this.W, this.H);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.accum);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, baking ? this.dummy : this.truth);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.cmap);
    pass(gl, target, this.W, this.H);
  }

  /**
   * Render the fixed "observation" once and keep only the image.
   * Same code path and the same seed as the live side, so at the truth
   * parameters the seam vanishes exactly rather than merely looking similar.
   */
  bakeTruth(payload, params, tone = {}) {
    this.paint(payload, params);
    const q = this.quantiles(tone.q);
    this.composite(this.truthFb, { ...q, ...tone, wipe: 2.0, baking: true });
    return q;
  }

  dispose() {
    const gl = this.gl;
    [this.accum, this.truth, this.lcTex, this.cmap, this.dummy].forEach((t) => gl.deleteTexture(t));
    [this.accumFb, this.truthFb].forEach((f) => gl.deleteFramebuffer(f));
    gl.deleteProgram(this.pointProg);
    gl.deleteProgram(this.postProg);
    gl.deleteVertexArray(this.vao);
  }
}

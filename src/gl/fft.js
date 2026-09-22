// 3D complex FFT on the GPU via a chain of Stockham passes over a 2D atlas.
//
// Backend-swappable on purpose: plan() returns {forward, inverse} and nothing
// outside this file knows how the transform is done, so a WebGPU compute
// implementation can be dropped in later without touching the pipeline.

import { program, pass, FULLSCREEN_VS } from './glutil.js';
import { FFT_FS } from './shaders/fft.glsl.js';

const log2i = (n) => Math.round(Math.log2(n));
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Atlas dimensions for an nx x ny x nz grid: tiles as square as possible. */
export function atlasLayout(nx, ny, nz) {
  if (![nx, ny, nz].every(isPow2)) throw new Error('FFT requires power-of-two dimensions');
  const tilesX = nz === 1 ? 1 : 1 << Math.ceil(log2i(nz) / 2);
  const tilesY = nz / tilesX;
  return { tilesX, tilesY, atlasW: tilesX * nx, atlasH: tilesY * ny };
}

/**
 * @param {number[]} [axes] which axes to transform; default all three. The slab
 *   pipeline passes [0, 1] to run independent 2-D transforms on every layer of a
 *   stack whose z-direction has already been handled.
 */
export function planFFT(gl, nx, ny, nz, { axes = [0, 1, 2] } = {}) {
  const { tilesX, tilesY, atlasW, atlasH } = atlasLayout(nx, ny, nz);
  const prog = program(gl, FULLSCREEN_VS, FFT_FS);
  const dims = [nx, ny, nz];
  const stages = axes.reduce((a, ax) => a + log2i(dims[ax]), 0);
  // 1/N over the axes actually transformed - not the full stack depth
  const nTransformed = axes.reduce((a, ax) => a * dims[ax], 1);

  function run(pp, inverse) {
    gl.useProgram(prog);
    gl.disable(gl.BLEND);
    gl.uniform3i(prog.loc.uN, nx, ny, nz);
    gl.uniform1i(prog.loc.uTilesX, tilesX);
    gl.uniform1f(prog.loc.uSign, inverse ? 1 : -1);
    gl.uniform1i(prog.loc.uSrc, 0);
    gl.activeTexture(gl.TEXTURE0);

    const total = inverse ? 1 / nTransformed : 1;
    let done = 0;
    for (const axis of axes) {
      const n = dims[axis];
      for (let m = 2; m <= n; m <<= 1) {
        done++;
        const last = done === stages;
        gl.uniform1i(prog.loc.uAxis, axis);
        gl.uniform1i(prog.loc.uSub, m);
        gl.uniform1f(prog.loc.uNorm, last ? total : 1);
        gl.bindTexture(gl.TEXTURE_2D, pp.src);
        pass(gl, pp.dstFb, atlasW, atlasH);
        pp.swap(); // result becomes the source for the next stage
      }
    }
  }

  return {
    nx, ny, nz, tilesX, tilesY, atlasW, atlasH, stages,
    /** In-place over the ping-pong pair; the result ends up in `pp.src`. */
    forward: (pp) => run(pp, false),
    inverse: (pp) => run(pp, true),
    dispose: () => gl.deleteProgram(prog),
  };
}

/** Host-side index helpers, so tests can lay out data the same way as the GPU. */
export function makeIndexer(nx, ny, nz) {
  const { tilesX, atlasW } = atlasLayout(nx, ny, nz);
  return {
    atlasW,
    /** texel offset (in RGBA quads) of grid cell (x,y,z) */
    at(x, y, z) {
      const ax = (z % tilesX) * nx + x;
      const ay = Math.floor(z / tilesX) * ny + y;
      return ay * atlasW + ax;
    },
  };
}

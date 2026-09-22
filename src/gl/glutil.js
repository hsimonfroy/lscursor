// Thin WebGL2 helpers: programs, float textures, framebuffers, full-screen passes.
//
// Every compute pass here is a single full-screen triangle with NO vertex
// attributes; positions come from gl_VertexID. That keeps the whole pipeline
// free of vertex buffers and VAO juggling.

export const FULLSCREEN_VS = `#version 300 es
void main() {
  // one oversized triangle covering the viewport
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
    throw new Error(`shader compile failed:\n${log}\n${numbered}`);
  }
  return sh;
}

export function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  }
  // cache uniform locations by name
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    loc[name] = gl.getUniformLocation(p, name);
  }
  p.loc = loc;
  return p;
}

/** Float texture, NEAREST + CLAMP (we always texelFetch, never filter). */
export function texture(gl, w, h, internalFormat) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  t.width = w; t.height = h; t.internalFormat = internalFormat;
  return t;
}

export function framebuffer(gl, tex) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete framebuffer: 0x' + st.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  fb.tex = tex;
  return fb;
}

/** A pair of identically-sized targets to ping-pong between. */
export function pingPong(gl, w, h, internalFormat) {
  const a = texture(gl, w, h, internalFormat), b = texture(gl, w, h, internalFormat);
  return {
    src: a, dst: b, fbA: framebuffer(gl, a), fbB: framebuffer(gl, b),
    get dstFb() { return this.dst === this.fbA.tex ? this.fbA : this.fbB; },
    swap() { const t = this.src; this.src = this.dst; this.dst = t; },
    dispose() {
      gl.deleteTexture(a); gl.deleteTexture(b);
      gl.deleteFramebuffer(this.fbA); gl.deleteFramebuffer(this.fbB);
    },
  };
}

/** Bind `fb`, set the viewport to its texture, and draw one full-screen triangle. */
export function pass(gl, fb, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Read an RGBA32F target back into a Float32Array (slow; tests and debug only). */
export function readFloat(gl, fb, w, h) {
  const out = new Float32Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
  return out;
}

// The particle pass: displace, weight, and splat.
//
// One attributeless draw over every particle in the slab. There are no vertex
// buffers - the Lagrangian position comes from gl_VertexID and the displacement
// from a texture fetch - so changing b1, f or the wipe is just new uniforms on
// the same draw. That is the whole reason those sliders are free.
//
//   s = q + D(z)*Psi + gamma * f(z)D(z) * (Psi . rhat) rhat
//   w = 1 + (b1 - 1) * D(z) * delta_L(q)
//
// gamma = f_slider / f_LCDM(z=0) makes the f slider a multiplier on the physical
// growth rate, so gamma = 1 reproduces LCDM exactly and the slider still reads
// as "the growth rate today".

export const RENDER_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uPayload;   // RGBA16F: Psi_x, Psi_y, delta_L, -
uniform sampler2D uLc;        // RGBA32F 1-D: D, f*D, z, -
uniform ivec3 uN;             // nx, ny, slabCells
uniform int   uTilesX;
uniform vec2  uBox;           // Mpc/h, the displayed square
uniform vec2  uObs;           // observer position, Mpc/h
uniform float uInvRMax;
uniform float uGamma;         // f_slider / f_LCDM(z=0)
uniform float uB1m1;          // b1 - 1
uniform vec2  uViewport;      // pixels
uniform float uPointSize;

flat out float vW;
flat out vec2  vCenter;

// Light-cone lookup: (D, f*D, z) at comoving distance r from the observer.
vec4 lightcone(float r) {
  int n = textureSize(uLc, 0).x;
  float u = clamp(r * uInvRMax, 0.0, 1.0) * float(n - 1);
  int i0 = int(u);
  int i1 = min(i0 + 1, n - 1);
  return mix(texelFetch(uLc, ivec2(i0, 0), 0), texelFetch(uLc, ivec2(i1, 0), 0), u - float(i0));
}

// Redshift-space position of the particle whose Lagrangian position is q.
// The light cone is evaluated at the LAGRANGIAN position: the displaced
// position differs by at most ~30 Mpc/h out of 1810, i.e. dz < 0.01, and using
// q keeps this a single table lookup with no feedback loop.
vec2 redshiftPos(vec2 q, vec2 psi, out float D) {
  vec2 d = q - uObs;
  float r = length(d);
  vec2 rhat = d / max(r, 1e-6);
  vec4 L = lightcone(r);
  D = L.x;
  return q + L.x * psi + uGamma * L.y * dot(psi, rhat) * rhat;
}

void main() {
  int id = gl_VertexID;
  ivec3 g = ivec3(id % uN.x, (id / uN.x) % uN.y, id / (uN.x * uN.y));
  ivec2 t = ivec2((g.z % uTilesX) * uN.x + g.x, (g.z / uTilesX) * uN.y + g.y);
  vec4 P = texelFetch(uPayload, t, 0);

  vec2 cell = uBox / vec2(uN.xy);
  vec2 q = (vec2(g.xy) + 0.5) * cell;

  float D;
  vec2 s = redshiftPos(q, P.xy, D);

  // The box is periodic, so a particle that leaves through one edge IS its
  // periodic image entering through the opposite one - no padding is needed to
  // fill the edges. But the light cone is not periodic: that image sits a box
  // length away from q, at a different distance from the observer. Re-evaluate
  // growth and RSD there, or a particle from the far edge (z ~ 0.5) wraps in
  // next to the observer still carrying z ~ 0.5 growth.
  vec2 wrap = floor(s / uBox);
  if (wrap != vec2(0.0)) s = redshiftPos(q - wrap * uBox, P.xy, D);
  s = mod(s, uBox);                       // only bites if the re-evaluation moved it again

  vW = 1.0 + uB1m1 * D * P.z;

  vec2 px = s / uBox * uViewport;
  vCenter = px;
  gl_Position = vec4(px / uViewport * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

// Cloud-in-cell splat. A 2 px point sprite covers exactly the four pixels whose
// centres lie within +-1 of the vertex, which is the CIC stencil, so the
// bilinear weight below makes the deposit mass-conserving.
export const RENDER_FS = `#version 300 es
precision highp float;
flat in float vW;
flat in vec2  vCenter;
out vec4 outColor;
void main() {
  vec2 dd = abs(gl_FragCoord.xy - vCenter);
  float wt = max(0.0, 1.0 - dd.x) * max(0.0, 1.0 - dd.y);
  outColor = vec4(vW * wt, 0.0, 0.0, 0.0);   // single-channel target keeps .x
}`;

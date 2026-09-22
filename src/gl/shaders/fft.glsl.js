// One Stockham autosort FFT stage over one axis of the 3D atlas.
//
// Stockham rather than Cooley-Tukey because a fragment shader can only GATHER:
// every output texel reads two inputs at computed positions. In-place
// Cooley-Tukey needs a scatter (and a bit-reversal permutation); Stockham is
// self-sorting, so the output of the final stage is already in natural order.
//
// Per output index i with subtransform size m:
//   evenIndex = (i / m) * (m/2) + (i mod (m/2))
//   out[i]    = src[evenIndex] + W * src[evenIndex + n/2],  W = exp(sign*2*pi*i/m)
// with sign = -1 for the forward transform (numpy's convention).
//
// One RGBA32F texel carries TWO independent complex numbers (xy and zw), so a
// single pass chain transforms two complex fields at once - which is how the
// whole app fits into one inverse FFT per parameter change.

import { ATLAS_GLSL } from './common.glsl.js';

export const FFT_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${ATLAS_GLSL}

uniform sampler2D uSrc;
uniform int   uAxis;  // 0 = x, 1 = y, 2 = z
uniform int   uSub;   // subtransform size m, doubling 2,4,...,n
uniform float uSign;  // -1 forward, +1 inverse
uniform float uNorm;  // folded into the final stage of each chain

out vec4 outColor;

const float TWO_PI = 6.283185307179586;

void main() {
  ivec3 g = atlasToGrid(ivec2(gl_FragCoord.xy));

  int n = (uAxis == 0) ? uN.x : (uAxis == 1) ? uN.y : uN.z;
  int i = (uAxis == 0) ? g.x  : (uAxis == 1) ? g.y  : g.z;

  int half_ = uSub >> 1;
  int evenIndex = (i / uSub) * half_ + (i - (i / half_) * half_);

  ivec3 ge = g, go = g;
  if (uAxis == 0)      { ge.x = evenIndex; go.x = evenIndex + (n >> 1); }
  else if (uAxis == 1) { ge.y = evenIndex; go.y = evenIndex + (n >> 1); }
  else                 { ge.z = evenIndex; go.z = evenIndex + (n >> 1); }

  vec4 even = texelFetch(uSrc, gridToAtlas(ge), 0);
  vec4 odd  = texelFetch(uSrc, gridToAtlas(go), 0);

  // Reduce the phase index modulo uSub FIRST. exp(2*pi*i*n/m) has period m in n,
  // so this is exact - and without it the early stages (uSub = 2, i up to n-1)
  // ask cos/sin for arguments of several hundred radians, where fp32 argument
  // reduction throws away three decimal digits. Costs one int op, worth ~20x.
  float frac = float(i - (i / uSub) * uSub) / float(uSub);
  float ang = uSign * TWO_PI * frac;
  float c = cos(ang), s = sin(ang);

  vec2 o0 = odd.xy, o1 = odd.zw;
  vec2 m0 = vec2(c * o0.x - s * o0.y, c * o0.y + s * o0.x);
  vec2 m1 = vec2(c * o1.x - s * o1.y, c * o1.y + s * o1.x);

  outColor = vec4(even.xy + m0, even.zw + m1) * uNorm;
}`;

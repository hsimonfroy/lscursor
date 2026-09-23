// Turn the accumulation buffer into an image.
//
// The mapping is a plain linear stretch between two quantiles of the field
// (see Renderer.quantiles). An asinh/log curve was tried first and is the wrong
// tool here: it compresses exactly the density contrast the eye is supposed to
// read, and it needs two hand-tuned knobs. Clipping a few parts in 10^4 off each
// tail removes the handful of extreme cluster pixels that would otherwise set
// the scale, and everything between them gets the full ramp.
//
// The live side uses either the observation's clip levels (the default: one
// colour = one weighted count everywhere, on both sides of the wipe) or its own
// per-frame quantiles. Either way it goes through the same code as the baked
// truth, so at the truth parameters the seam disappears.

export const POST_FS = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAccum;   // .x weighted particle count per pixel
uniform sampler2D uTruth;
uniform sampler2D uCmap;
uniform float uLo;          // low  clip, in raw accumulation units
uniform float uHi;          // high clip
uniform float uWipe;        // 0..1 across the viewport; >= 1 disables
uniform vec2  uViewport;
// Tone curve, applied to the clipped value t in [0, 1]. Defaults (0, 1, 0) are
// a plain linear ramp, which is what the app shipped with; the dev page
// dev/looks.html drives them to compare.
uniform float uKnee;        // asinh knee, 0 = off: t -> asinh(a t)/asinh(a)
uniform float uGammaT;      // exponent on t, < 1 lifts the mid-tones
uniform float uLift;        // floor of the colour ramp, keeps voids off pure black

out vec4 outColor;

// Magnify by hand. texture() with LINEAR on an RGBA32F target needs
// OES_texture_float_linear, which WebGL2 does not guarantee - and where it is
// missing every fetch silently returns 0, giving a uniform image and no error.
// Wrapping rather than clamping is physics, not polish: the box is periodic.
float accumSample(vec2 uv) {
  ivec2 sz = textureSize(uAccum, 0);
  vec2 p = uv * vec2(sz) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 fr = p - vec2(i);
  ivec2 i0 = ((i % sz) + sz) % sz;
  ivec2 i1 = (((i + 1) % sz) + sz) % sz;
  float a = texelFetch(uAccum, ivec2(i0.x, i0.y), 0).x;
  float b = texelFetch(uAccum, ivec2(i1.x, i0.y), 0).x;
  float c = texelFetch(uAccum, ivec2(i0.x, i1.y), 0).x;
  float d = texelFetch(uAccum, ivec2(i1.x, i1.y), 0).x;
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float t = clamp((accumSample(uv) - uLo) / max(uHi - uLo, 1e-9), 0.0, 1.0);
  if (uKnee > 0.0) t = asinh(uKnee * t) / asinh(uKnee);
  if (uGammaT != 1.0) t = pow(t, uGammaT);
  t = uLift + (1.0 - uLift) * t;
  vec3 rgb = texture(uCmap, vec2(t, 0.5)).rgb;

  if (uv.x > uWipe) rgb = texture(uTruth, uv).rgb;

  outColor = vec4(rgb, 1.0);
}`;

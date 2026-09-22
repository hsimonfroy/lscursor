// Extract the rendered slab out of the full compute volume.
//
// The FFT runs on the whole nx x ny x nz box because the displacement field
// needs the long-wavelength k_z modes (a box only as deep as the slab inflates
// the displacement rms by ~96%). But only slabCells layers are ever drawn, so
// the result is compacted here into a small persistent RGBA16F payload. That
// payload survives across b1 / f / wipe changes - which is why those sliders
// cost nothing - and lets the big fp32 FFT scratch be reused for the next
// cosmology or for the truth render.
//
// Source and destination are both tiled atlases but with different tile counts,
// so the two index maps are spelled out separately rather than shared.

export const PAYLOAD_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSrc;
uniform ivec3 uSrcN;      // nx, ny, nz of the compute volume
uniform int   uSrcTilesX;
uniform ivec3 uDstN;      // nx, ny, slabCells
uniform int   uDstTilesX;
uniform int   uZ0;        // first compute layer of the slab

out vec4 outColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int tx = p.x / uDstN.x, ty = p.y / uDstN.y;
  ivec3 d = ivec3(p.x - tx * uDstN.x, p.y - ty * uDstN.y, ty * uDstTilesX + tx);

  int z = uZ0 + d.z;
  ivec2 s = ivec2((z % uSrcTilesX) * uSrcN.x + d.x,
                  (z / uSrcTilesX) * uSrcN.y + d.y);
  vec4 v = texelFetch(uSrc, s, 0);

  // v.xy = Psi_x + i Psi_y after the inverse FFT; v.zw = delta_L + i * spare
  outColor = vec4(v.x, v.y, v.z, 0.0);
}`;

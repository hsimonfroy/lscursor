// WebGL2 context creation and capability probing.
//
// The app needs float colour buffers for the FFT ping-pong and, ideally, float
// blending for the particle accumulation. Everything else is core WebGL2.

export const TIER = { FULL: 'full', DRAFT_ONLY: 'draft-only', UNSUPPORTED: 'unsupported' };

export function createContext(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance',
    ...opts,   // dev pages set preserveDrawingBuffer to copy frames out
  });
  if (!gl) return { gl: null, caps: { tier: TIER.UNSUPPORTED, reason: 'no WebGL2' } };

  const colorFloat = gl.getExtension('EXT_color_buffer_float');
  const colorHalf = gl.getExtension('EXT_color_buffer_half_float');
  const floatBlend = gl.getExtension('EXT_float_blend');
  // Probed for diagnostics only - the shaders never rely on it, because a
  // missing float-linear silently yields all-zero samples instead of an error.
  const floatLinear = gl.getExtension('OES_texture_float_linear');
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const dbgRenderer = gl.getExtension('WEBGL_debug_renderer_info');

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const renderer = dbgRenderer
    ? gl.getParameter(dbgRenderer.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);

  // 2048 is the WebGL2 guaranteed minimum and exactly what the 256x256x64 atlas
  // needs, so anything conformant can run the full grid.
  const caps = {
    tier: !colorFloat ? TIER.UNSUPPORTED : maxTex >= 2048 ? TIER.FULL : TIER.DRAFT_ONLY,
    reason: !colorFloat ? 'no EXT_color_buffer_float' : maxTex < 2048 ? `MAX_TEXTURE_SIZE ${maxTex}` : '',
    colorFloat: !!colorFloat, colorHalf: !!colorHalf, floatBlend: !!floatBlend,
    floatLinear: !!floatLinear,
    parallel, timer, maxTex, renderer,
  };
  return { gl, caps };
}

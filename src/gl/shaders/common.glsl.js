// Shared GLSL: the 3D <-> 2D atlas mapping every compute pass uses.
//
// A 3D grid nx x ny x nz is stored as a 2D texture of tilesX x tilesY tiles,
// each nx x ny, with tile index z = tileY * tilesX + tileX. WebGL2 has no
// geometry shader and therefore no gl_Layer, so rendering into a TEXTURE_3D
// would cost one draw call PER LAYER (64 layers x 22 stages = 1408 draws for a
// single transform). The atlas keeps every stage to exactly one draw.

export const ATLAS_GLSL = `
uniform ivec3 uN;      // nx, ny, nz
uniform int   uTilesX; // tiles across the atlas

ivec2 gridToAtlas(ivec3 g) {
  return ivec2((g.z % uTilesX) * uN.x + g.x,
               (g.z / uTilesX) * uN.y + g.y);
}

ivec3 atlasToGrid(ivec2 p) {
  int tx = p.x / uN.x;
  int ty = p.y / uN.y;
  return ivec3(p.x - tx * uN.x, p.y - ty * uN.y, ty * uTilesX + tx);
}

// Signed wavenumber index on a periodic grid: 0,1,...,n/2-1,-n/2,...,-1
int wrapIndex(int i, int n) { return (i <= (n >> 1)) ? i : i - n; }
`;

# lscursor — Large-Scale Cursor

*Tweaking the knobs of the cosmic web.*

**Live: <https://hsimonfroy.github.io/lscursor/>**

An interactive large-scale-structure simulator, in the spirit of Chris North's
[Planck CMB Simulator](https://chrisnorth.github.io/planckapps/Simulator/) — but
for the thing cosmologists actually measure with galaxy surveys.

Change the ingredients of the universe and watch a 2D slice of the cosmic web
respond in real time. A wipe divider down the middle compares your universe
against a fixed "observation" made from the same random seed: get the
parameters right and the seam disappears. Next to it, the power spectrum of
both.

## What it computes

A Zel'dovich (1LPT) galaxy density field in a 1280 Mpc/h box on a 256×256×64
grid (5 Mpc/h cells, k_Nyquist = 0.63 h/Mpc), projected through an 8-cell
(40 Mpc/h) slab. The observer sits in the bottom-left corner, so distance from
that corner is comoving distance: the slice is a light cone running from z = 0
out to z ≈ 0.73 at the far corner, and redshift-space distortions fan out in a
quarter circle.

Five sliders:

| slider | symbol | what it does |
|---|---|---|
| Ordinary matter | Ω_b | baryon acoustic suppression, BAO wiggle amplitude |
| Dark matter | Ω_c | the turnover scale k_eq — how clumpy, and on what scale |
| Dark energy | Ω_Λ | constrained so Ω_b + Ω_c + Ω_Λ = 1 |
| Redshift-space distortions | f | radial squashing of structure |
| Galaxy bias | b₁ | how much galaxies trace matter |

The box is periodic in the plane, so no padding is needed: a particle leaving
one edge re-enters through the opposite one, with its growth and RSD evaluated
at the periodic image that is actually on screen.

The colour scale is fixed to the observation's range, so one colour means one
weighted count per pixel on both sides of the wipe. The ends of that range are
the 10⁻⁴ and 1 − 10⁻⁴ quantiles of the observation, and the ramp between them is
`asinh(2t)/asinh(2)`: a linear ramp left a typical pixel at 0.07 of the colour
map, deep in inferno's near-black end, where a dim screen shows nothing.
`dev/looks.html` compares the alternatives side by side.

`h` is held fixed. The amplitude has two modes, picked with `?norm=` in the URL:

- **default**: the primordial amplitude `A_s` is held fixed and σ₈ floats, so
  less dark matter really means less structure. Remove it entirely and the same
  primordial fluctuations barely grow (σ₈ ≈ 0.08) — the classic argument for
  dark matter.
- `?norm=sigma8`: σ₈ held at Planck 2018's 0.8102, so the Ω sliders change only
  the shape of P(k). Fine near the fiducial; far from it, it needs an
  unphysical `A_s` (×116 at Ω_c = 0, i.e. CMB anisotropies ~11× too large).

Both agree at the fiducial cosmology, so the observation is identical in either.
Ω_b and Ω_m are floored at 10⁻⁴ inside the physics (EH98 divides by both), so
the bar can sit at exactly zero.

## The summary statistics

The panel beside the map plots either the power spectrum or the two-point
correlation function, picked from the tabs. The 2PCF is a Hankel transform of
the same linear P(k) (`src/cosmo/xi.js`, 0.3 ms, checked to 1e-9 against a
200k-point reference), shown as s²ξ(s) so the BAO bump near 105 Mpc/h stands up,
or as plain ξ(s). The panel folds away at any width from the button beside
reset; it starts open on a wide screen and closed on a narrow one, where it sits
between the sliders and the map. `#power` or `#2pcf` in the URL opens it on that
statistic and `#none` closes it at any width, so a link carries the state.

The power-spectrum panel is linear theory, not a measurement: the Kaiser
monopole (b₁² + 2b₁f/3 + f²/5) P_lin(k) at z = 0, from k = 10⁻³ up to the box's
Nyquist frequency π/5 h/Mpc. It opens as log-log P(k); clicking the axis labels
switches x between log and linear k, and y between log P(k) and linear k P(k),
which is the view where the BAO wiggles show. A 1280 Mpc/h
map has too few modes at those scales for the wiggles to survive cosmic
variance. The map's own P(k) can still be measured for checks with
`window.__measurePk()` (CPU FFT of the painted 256² field, `src/sim/pk.js`).

The page sizes the map to the window height so the whole app fits on one
screen, and all text uses fluid `clamp()` sizes that shrink smoothly on phones.

## Why it is fast

Two observations collapse what looks like a 4-dimensional precomputation problem
down to nothing precomputed at all:

1. **b₁ and f are render-time operations.** In 1LPT the velocity is parallel to
   the displacement, so `f` is one multiply on the radial component and `b₁` is a
   per-particle weight. Both are a single GPU draw over half a million points —
   60 fps, always. The light cone is free the same way.
2. **Ω_b and Ω_c enter only through the 1D curve √P(k)**, applied to a noise
   field that never changes. That is exactly the Planck simulator's `sqrt(C_ℓ)`
   filter, one dimension up.

So a cosmology change is one fused synthesis pass (white noise generated
directly in Fourier space, multiplied by √P(k), turned into displacement spectra)
followed by **one** inverse FFT — see [Performance](#performance) for timings.

The repository ships no data files. The Planck simulator carries 75 MB of
precomputed spectra; lscursor carries none, and is continuous in the parameters
rather than snapped to a grid.

## Running it

No build step, no dependencies, no bundler. Serve the directory and open
`index.html` — the app:

```
python3 dev/serve.py            # http://127.0.0.1:8777/
```

It needs WebGL2 with float render targets (`EXT_color_buffer_float`), which
covers current desktop and mobile browsers.

`dev/serve.py` is `python3 -m http.server` plus a `Cache-Control: no-cache`
header. Without it a browser may keep serving stale ES modules after an edit
(VS Code's built-in browser does this reliably).

- `dev/cosmo.html` — P(k), T(k), D(z), f(z) computed live by the app's own code
- `dev/fft.html` — GPU FFT correctness against a reference DFT, plus timings
- `dev/fields.html` — synthesised δ_L and Ψ against analytic mode-grid variances
- `dev/energybar.html` — energy-content bar layout variants

- `dev/slab.html` — the fast slab pipeline against the full 3-D reference

Or drive the gates headlessly (forces the real GPU, refuses SwiftShader numbers).
The scripts need `playwright-core` (`npm i playwright-core`) and Chrome at
`/usr/bin/google-chrome`:

```
node dev/run-checks.mjs fields      # or fft, slab
node dev/bench.mjs                  # frame timings
```

Deployment is `git push`; GitHub Pages serves `main` at the repository root.

## Validation

The physics modules are checked against
[`jax_cosmo`](https://github.com/DifferentiableUniverseInitiative/jax_cosmo) and
`montecosmo`:

| check | reference | result |
|---|---|---|
| `eh98.js` transfer function | `jax_cosmo.transfer.Eisenstein_Hu` | 1.2e-13 |
| `background.js` D(a), f(a) | `montecosmo.nbody.a2g`, `a2f` | 6.3e-7 |
| `background.js` χ(a) | `montecosmo.nbody.a2chi` | 1.2e-9 |
| `power.js` P_lin | `jax_cosmo.power.linear_matter_power` | 1.0e-4 |
| GPU FFT vs naive DFT | in-browser, 8×8×4 | 2.7e-7 |
| GPU FFT round trip | in-browser, 256×256×64 | 7.4e-6 |
| Var[δ_L], Var[Ψ] | analytic sum over the mode grid | within 1σ of realisation scatter |
| painted field mass conservation | mean deposit = slab depth | 4.042 vs 4 |
| RSD isotropy at f = 0 | radial/tangential gradient = 1 | 1.010 |

## Performance

Measured on an Intel RPL-U integrated GPU (the slow end), 256×256×64:

| action | cost |
|---|---|
| `b₁`, `f`, or moving the wipe | **~4 ms** — paint only, no FFT |
| `Ω` change | **25–47 ms** (20–40 fps while dragging; the spread is this GPU's clock state between runs, same code) |

The Ω cost started at 256 ms. Three things brought it down:

1. **The z-transform is done first, and only where it is needed.** Only 8 of the
   64 layers are drawn, and the inverse FFT is separable, so the z-sum is
   evaluated directly at those 8 layers — fused with the noise synthesis, so the
   full k-space cube is never written to memory. The x/y FFTs then run on a
   volume 8× smaller. Exact, not an approximation: it matches the full 3-D FFT
   to 1.2e-5. (3.0×)
2. **Nothing that depends only on Ω is recomputed per frame.** Growth,
   distances, σ₈ and the light-cone table are memoised; the chi→a inversion no
   longer rebuilds its table 1024 times per change.
3. **Less GPU traffic per frame**: a single-channel float accumulator (additive
   float blending is the costliest thing in a frame on an iGPU), no payload
   copy, and the distance arcs redrawn only when their labels can change.

Remaining cost is roughly half synthesis, half 2-D FFT. The next two levers are
multiple render targets (each mode is currently synthesised once per output
layer, i.e. 8× over) and a radix-4 FFT (half the passes).

`dev/bench.mjs` reproduces these numbers.

## Known limitations

- **Large scales are under-clustered.** The 40 Mpc/h slab is selected by
  particles' initial (Lagrangian) positions and their z-displacement is never
  computed, so the flow of matter through the slab's top and bottom faces is
  missing. In linear theory the projected matter power comes out 5–7× too low at
  k ≲ 0.01 h/Mpc and 2× too low at 0.05 h/Mpc; the galaxy weights partly mask
  it. The fix is to carry Ψ_z and select particles by their final position.
- **1LPT only.** Zel'dovich particles pass through each other after shell
  crossing, so the densest knots are too diffuse.
- **Linear physics throughout**: Eisenstein & Hu (1998) transfer function (no
  massive neutrinos), linear Lagrangian bias, Kaiser RSD in the plotted spectrum.

## Licence

MIT, see [LICENSE](LICENSE). The title face, `assets/fonts/Z003-MediumItalic.otf` (URW Z003, from the
urw-base35 set, same file as hollved), is AGPL-3.0 with a font exception.

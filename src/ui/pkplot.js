// Power-spectrum panel: linear-theory galaxy power for the simulation's
// parameters against the observation's.
//
// Two views, switched by clicking the axis labels (as on hollved's density
// chart, and marked the same way with ‹ ›):
//   x   log k  <->  linear k
//   y   P(k) on a log scale  <->  k P(k) on a linear scale
// Log-log shows the whole shape, turnover included. k P(k) on linear axes is
// the view for the BAO wiggles: a ~5% modulation is under 1% of the height of a
// three-decade log axis, but multiplying by k flattens the spectrum there and
// the wiggles read.
//
// The theory is sampled on a log-uniform k grid, so both x scales draw smoothly.
// Identity is never colour-alone: the observation is dashed, the simulation
// solid, and the legend keys both. Series colours come from the --pk-sim /
// --pk-obs tokens in style.css; text sizes from the canvas's computed
// font-size, which is fluid, so the chart scales with the rest of the type.

const MINUS = '−';

function niceStep(span, target) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

/** Write `v` into `el` as text, in m x 10^e form with a real superscript when large. */
function putNumber(el, v, digits = 3) {
  if (!(Math.abs(v) >= 1e4)) { el.textContent = String(+v.toPrecision(digits)); return; }
  const e = Math.floor(Math.log10(Math.abs(v)));
  el.textContent = `${(v / 10 ** e).toFixed(digits - 1)}×10`;
  const sup = document.createElement('sup');
  sup.textContent = String(e);
  el.append(sup);
}

export class PkPlot {
  /**
   * @param {HTMLElement} host  receives the header, canvas, axis buttons and tooltip
   * @param {{title?:string, note?:string}} [opts]  note: hover text on the title
   */
  constructor(host, { title = 'Power spectrum', note = '' } = {}) {
    host.classList.add('pk');
    host.innerHTML = `
      <div class="pk-head">
        <div class="pk-title"></div>
        <div class="pk-legend">
          <span class="pk-key"><i class="pk-line is-sim"></i>Simulation</span>
          <span class="pk-key"><i class="pk-line is-obs"></i>Observation</span>
        </div>
      </div>
      <div class="pk-body">
        <canvas class="pk-canvas" role="img"></canvas>
        <button type="button" class="pk-axis is-x"></button>
        <button type="button" class="pk-axis is-y"></button>
        <div class="pk-tip" hidden></div>
      </div>`;
    const t = host.querySelector('.pk-title');
    t.textContent = title;
    if (note) t.title = note;
    this.canvas = host.querySelector('canvas');
    this.tip = host.querySelector('.pk-tip');
    this.xBtn = host.querySelector('.pk-axis.is-x');
    this.yBtn = host.querySelector('.pk-axis.is-y');
    this.xlog = true;
    this.ylog = true;
    this.obs = null;
    this.sim = null;
    this.hover = null;

    this.xBtn.addEventListener('click', () => { this.xlog = !this.xlog; this.draw(); });
    this.yBtn.addEventListener('click', () => { this.ylog = !this.ylog; this.draw(); });

    const css = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    this.col = {
      sim: tok('--pk-sim', '#ea632a'), obs: tok('--pk-obs', '#b050b8'),
      surface: tok('--surface-2', '#1a1a19'),
      text: 'rgba(255, 255, 255, 0.60)',     // hollved's chart ink
      grid: 'rgba(255, 255, 255, 0.12)',
      axis: 'rgba(255, 255, 255, 0.35)',
    };

    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  /** Curves as {k, P}: k log-uniform in h/Mpc, P in (Mpc/h)^3, one grid for both. */
  setObservation(pk) { this.obs = pk; this.draw(); }
  setSimulation(pk) { this.sim = pk; this.draw(); }

  _labels() {
    this.xBtn.textContent = '‹ k [h/Mpc] ›';
    this.xBtn.title = this.xlog ? 'Switch to a linear k axis' : 'Switch to a logarithmic k axis';
    // one <span>: inside the flex button, bare text runs around <sup> would each
    // become a flex item and lose their edge spaces ("]³›")
    this.yBtn.innerHTML = this.ylog ? '<span>‹ P(k) [Mpc/h]<sup>3</sup> ›</span>'
                                    : '<span>‹ k P(k) [Mpc/h]<sup>2</sup> ›</span>';
    this.yBtn.title = this.ylog ? 'Switch to k P(k) on a linear scale' : 'Switch to P(k) on a log scale';
    this.canvas.setAttribute('aria-label',
      `${this.ylog ? 'P(k), log scale' : 'k P(k), linear scale'} against k on a ${this.xlog ? 'log' : 'linear'} scale,` +
      ' for the simulation and the observation');
  }

  draw() {
    const cv = this.canvas, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    this._labels();
    const { obs, sim, col, xlog, ylog } = this;
    if (!obs || !sim) return;

    const fs = parseFloat(getComputedStyle(cv).fontSize) || 12;
    const font = `${fs}px ui-monospace, 'Roboto Mono', Consolas, monospace`;
    const small = `${(fs * 0.8).toFixed(1)}px ui-monospace, 'Roboto Mono', Consolas, monospace`;
    const k = obs.k, n = k.length;
    const vo = ylog ? obs.P : obs.P.map((p, i) => k[i] * p);
    const vs = ylog ? sim.P : sim.P.map((p, i) => k[i] * p);

    // Ranges follow the data continuously, so nothing jumps a tick mid-drag.
    let lo = Infinity, hi = 0;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, vo[i], vs[i]); hi = Math.max(hi, vo[i], vs[i]); }
    // Log y spans at most 4 decades below the peak: a baryon-only universe has
    // acoustic zeros that would otherwise stretch it over 13 and flatten the
    // curve that matters.
    const y0 = ylog ? Math.max(Math.log10(lo), Math.log10(hi) - 4) - 0.08 : 0;
    const y1 = ylog ? Math.log10(hi) + 0.12 : hi * 1.08;
    const k0 = k[0], kMax = k[n - 1];
    const lx0 = Math.log10(k0), lx1 = Math.log10(kMax);

    // Axis labels are HTML buttons in their own (slightly larger) font; the
    // margins make room for tick labels plus one button height.
    const lf = parseFloat(getComputedStyle(this.xBtn).fontSize) || fs;
    const bh = Math.round(lf * 1.7);
    const M = { l: Math.round(fs * 2.6 + bh + 9), r: Math.round(fs * 0.9), t: Math.round(fs * 0.8),
                b: Math.round(fs * 1.2 + 10 + bh) };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = xlog ? (kv) => M.l + ((Math.log10(kv) - lx0) / (lx1 - lx0)) * pw
                   : (kv) => M.l + (kv / kMax) * pw;
    const Y = ylog ? (v) => M.t + ph - ((Math.log10(v) - y0) / (y1 - y0)) * ph
                   : (v) => M.t + ph - ((v - y0) / (y1 - y0)) * ph;
    const xb = M.t + ph;   // x axis line

    // "10^e" with a smaller, raised exponent - measured so it can be right-
    // aligned (y ticks) or centred (x ticks) as one unit.
    const pow10 = (e, x, base, align) => {
      const es = e < 0 ? MINUS + -e : String(e);
      g.font = font; const wb = g.measureText('10').width;
      g.font = small; const we = g.measureText(es).width;
      const x0 = align === 'right' ? x - wb - we - 1 : x - (wb + we + 1) / 2;
      g.textAlign = 'left';
      g.font = font; g.fillText('10', x0, base);
      g.font = small; g.fillText(es, x0 + wb + 1, base - fs * 0.45);
    };

    g.lineWidth = 1;
    g.fillStyle = col.text;
    g.textBaseline = 'alphabetic';

    // ---- y axis ----
    if (ylog) {
      const perDecade = ph / (y1 - y0);                       // px
      const every = Math.max(1, Math.ceil((fs * 1.8) / perDecade));  // thin crowded labels
      for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) {
        for (let m = 1; m < 10; m++) {
          if (m > 1 && perDecade < 24) break;                 // no room for minor ticks
          const lv = e + Math.log10(m);
          if (lv < y0 || lv > y1) continue;
          const y = Math.round(Y(10 ** lv)) + 0.5;
          if (m === 1) {
            g.strokeStyle = col.grid;
            g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
            if (e % every === 0) pow10(e, M.l - 7, y + fs * 0.35, 'right');
          } else {
            g.strokeStyle = col.axis;   // minor tick on the axis
            g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + 4, y); g.stroke();
          }
        }
      }
    } else {
      const st = niceStep(y1, Math.max(3, Math.round(ph / 55)));
      g.font = font; g.textAlign = 'right';
      for (let v = st; v < y1; v += st) {
        const y = Math.round(Y(v)) + 0.5;
        g.strokeStyle = col.grid;
        g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
        g.fillText(String(+v.toPrecision(6)), M.l - 7, y + fs * 0.35);
      }
      g.fillText('0', M.l - 7, xb + fs * 0.35);
    }

    // ---- axis lines ----
    g.strokeStyle = col.axis;
    g.beginPath(); g.moveTo(M.l - 0.5, M.t); g.lineTo(M.l - 0.5, xb + 0.5); g.lineTo(M.l + pw, xb + 0.5); g.stroke();

    // ---- x axis ----
    const xBase = xb + 6 + fs;
    if (xlog) {
      for (let e = Math.floor(lx0); e <= Math.ceil(lx1); e++) {
        for (let m = 1; m < 10; m++) {
          const lv = e + Math.log10(m);
          if (lv < lx0 - 1e-9 || lv > lx1 + 1e-9) continue;
          const x = Math.round(X(10 ** lv)) + 0.5;
          if (m === 1) {
            g.strokeStyle = col.grid;
            g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, xb); g.stroke();
            pow10(e, x, xBase, 'center');
          } else {
            g.strokeStyle = col.axis;
            g.beginPath(); g.moveTo(x, xb); g.lineTo(x, xb - 4); g.stroke();
          }
        }
      }
    } else {
      const st = niceStep(kMax, Math.max(3, Math.round(pw / 70)));
      g.font = font; g.textAlign = 'center';
      for (let kt = st; kt <= kMax + 1e-9; kt += st) {
        const x = Math.round(X(kt)) + 0.5;
        g.strokeStyle = col.grid;
        g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, xb); g.stroke();
        g.fillText(String(+kt.toFixed(3)), x, xBase);
      }
      g.fillText('0', M.l, xBase);
    }

    // ---- axis-label buttons, laid over the canvas ----
    Object.assign(this.xBtn.style, { left: `${M.l}px`, width: `${pw}px`, height: `${bh}px`,
                                     top: `${H - bh}px` });
    Object.assign(this.yBtn.style, { width: `${ph}px`, height: `${bh}px`,
                                     left: `${bh / 2 - ph / 2}px`, top: `${M.t + ph / 2 - bh / 2}px` });

    // ---- series: 2 px, round joins, clipped to the plot; the dashed
    // observation is drawn last so both stay visible where they coincide ----
    g.save();
    g.beginPath(); g.rect(M.l, M.t - 2, pw, ph + 4); g.clip();
    const line = (v, colour, dash) => {
      g.beginPath();
      for (let i = 0; i < n; i++) { const x = X(k[i]), y = Y(v[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.setLineDash(dash); g.strokeStyle = colour; g.stroke();
      g.setLineDash([]);
    };
    line(vs, col.sim, []);
    line(vo, col.obs, [6, 5]);
    g.restore();

    // ---- hover: crosshair snaps to the nearest sample, one tooltip for both ----
    const hv = this.hover;
    if (!hv || hv.x < M.l || hv.x > M.l + pw || hv.y > xb) { this.tip.hidden = true; return; }
    const t = (hv.x - M.l) / pw;
    const kh = xlog ? 10 ** (lx0 + t * (lx1 - lx0)) : Math.max(k0, t * kMax);
    const best = Math.max(0, Math.min(n - 1, Math.round(Math.log(kh / k0) / Math.log(k[1] / k0))));
    const x = Math.round(X(k[best])) + 0.5;
    g.strokeStyle = col.axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, xb); g.stroke();
    const dot = (v, c) => {
      g.beginPath(); g.arc(x, Y(v), 4, 0, 2 * Math.PI);
      g.fillStyle = c; g.fill();
      g.lineWidth = 2; g.strokeStyle = col.surface; g.stroke();   // surface ring
    };
    dot(vo[best], col.obs);
    dot(vs[best], col.sim);

    const tip = this.tip;
    tip.replaceChildren();
    const row = (v, label, cls) => {
      const r = document.createElement('div'); r.className = 'pk-tip-row';
      if (cls) { const ic = document.createElement('i'); ic.className = `pk-line ${cls}`; r.append(ic); }
      const b = document.createElement('b'); putNumber(b, v);
      const s = document.createElement('span'); s.textContent = label;
      r.append(b, s); tip.append(r);
    };
    row(k[best], 'k [h/Mpc]');
    row(vs[best], 'Simulation', 'is-sim');
    row(vo[best], 'Observation', 'is-obs');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${x + 12 + tw > W ? x - 12 - tw : x + 12}px`;
    tip.style.top = `${M.t + 4}px`;
  }
}

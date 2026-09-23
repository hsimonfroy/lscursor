// Summary-statistic panel: linear theory for the simulation's parameters
// against the observation's, as either the power spectrum or the 2-point
// correlation function.
//
// Views, switched from the tabs and by clicking the y (and for P(k), the x)
// axis label - marked with ‹ › as on hollved's density chart:
//
//   Power spectrum   x: log k <-> linear k      y: log P(k) <-> linear k P(k)
//   2PCF             x: linear s                y: s^2 xi(s) <-> xi(s)
//
// Why those defaults: on a log-log P(k) the ~5% baryon wiggles are under 1% of
// the plot height, so k P(k) on linear axes is the view that shows them; for the
// 2PCF, s^2 xi(s) is the standard way to make the BAO bump near 105 Mpc/h stand
// up out of a curve that otherwise falls like a power law.
//
// Identity is never colour-alone: the observation is dashed, the simulation
// solid, and the legend keys both. Series colours come from the --pk-sim /
// --pk-obs tokens in style.css; text sizes from the canvas's computed
// font-size, which is fluid, so the chart scales with the rest of the type.

const MINUS = '−';

// Per statistic: tab name, x axis, and the two y views.
const STATS = {
  pk: {
    tab: 'Power spectrum',
    xLabel: 'k [h/Mpc]', xToggle: true, xlog: true, xgrid: 'log',
    y: [{ label: 'P(k) [Mpc/h]<sup>3</sup>', log: true, f: (x, y) => y },
        { label: 'k P(k) [Mpc/h]<sup>2</sup>', log: false, f: (x, y) => x * y }],
  },
  xi: {
    tab: '2PCF',
    xLabel: 's [Mpc/h]', xToggle: false, xlog: false, xgrid: 'lin',
    y: [{ label: 's<sup>2</sup> ξ(s) [Mpc/h]<sup>2</sup>', log: false, f: (x, y) => x * x * y },
        { label: 'ξ(s)', log: false, f: (x, y) => y }],
  },
};

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

export class StatsPlot {
  /**
   * @param {HTMLElement} host
   * @param {{note?:string, selector?:'tabs'|'segmented'|'menu', stat?:'pk'|'xi',
   *          onStat?:(stat:string)=>void}} [opts]
   */
  constructor(host, { note = '', selector = 'tabs', stat = 'pk', onStat = null } = {}) {
    host.classList.add('pk', `sel-${selector}`);
    host.innerHTML = `
      <div class="pk-head">
        <div class="pk-pick"></div>
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
    this.host = host;
    this.selector = selector;
    this.canvas = host.querySelector('canvas');
    this.tip = host.querySelector('.pk-tip');
    this.xBtn = host.querySelector('.pk-axis.is-x');
    this.yBtn = host.querySelector('.pk-axis.is-y');
    this.note = note;
    this.onStat = onStat;
    this.stat = stat;
    this.data = { pk: null, xi: null };
    this.view = { pk: { xlog: STATS.pk.xlog, y: 0 }, xi: { xlog: STATS.xi.xlog, y: 0 } };
    this.hover = null;
    this._buildPicker(host.querySelector('.pk-pick'));

    this.xBtn.addEventListener('click', () => {
      if (!STATS[this.stat].xToggle) return;
      this.view[this.stat].xlog = !this.view[this.stat].xlog;
      this.draw();
    });
    this.yBtn.addEventListener('click', () => {
      const v = this.view[this.stat];
      v.y = (v.y + 1) % STATS[this.stat].y.length;
      this.draw();
    });

    const css = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    this.col = {
      sim: tok('--pk-sim', '#ea632a'), obs: tok('--pk-obs', '#b050b8'),
      surface: tok('--surface-2', '#232321'),
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

  /** Statistic picker: tabs, a segmented control, or a plain menu. */
  _buildPicker(host) {
    const keys = Object.keys(STATS);
    if (this.selector === 'menu') {
      const sel = document.createElement('select');
      sel.className = 'pk-menu';
      for (const k of keys) { const o = document.createElement('option'); o.value = k; o.textContent = STATS[k].tab; sel.append(o); }
      sel.value = this.stat;
      sel.addEventListener('input', () => this.setStat(sel.value));
      sel.title = this.note;
      host.append(sel);
      this.picker = sel;
      return;
    }
    const bar = document.createElement('div');
    bar.className = 'pk-tabs';
    bar.setAttribute('role', 'tablist');
    this.tabs = keys.map((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pk-tab';
      b.setAttribute('role', 'tab');
      b.textContent = STATS[k].tab;
      if (this.note) b.title = this.note;
      b.addEventListener('click', () => this.setStat(k));
      bar.append(b);
      return b;
    });
    host.append(bar);
  }

  setStat(stat) {
    if (!STATS[stat] || stat === this.stat) return;
    this.stat = stat;
    this.hover = null;
    this.draw();
    if (this.onStat) this.onStat(stat);
  }

  /**
   * @param {'pk'|'xi'} stat
   * @param {{x:ArrayLike<number>, sim:ArrayLike<number>, obs:ArrayLike<number>}} d
   *   one x grid shared by both curves
   */
  setData(stat, d) { this.data[stat] = d; this.draw(); }

  _labels() {
    const S = STATS[this.stat], v = this.view[this.stat];
    const keys = Object.keys(STATS);
    if (this.selector === 'menu') this.picker.value = this.stat;
    else this.tabs.forEach((b, i) => {
      const on = keys[i] === this.stat;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });

    this.xBtn.disabled = !S.xToggle;
    this.xBtn.innerHTML = S.xToggle ? `<span>‹ ${S.xLabel} ›</span>` : `<span>${S.xLabel}</span>`;
    this.xBtn.title = S.xToggle ? (v.xlog ? 'Switch to a linear axis' : 'Switch to a logarithmic axis') : '';
    // one <span>: inside the flex button, bare text runs around <sup> would each
    // become a flex item and lose their edge spaces ("]³›")
    this.yBtn.innerHTML = `<span>‹ ${S.y[v.y].label} ›</span>`;
    const next = S.y[(v.y + 1) % S.y.length].label.replace(/<[^>]+>/g, '');
    this.yBtn.title = `Switch to ${next}`;
    this.canvas.setAttribute('aria-label',
      `${S.y[v.y].label.replace(/<[^>]+>/g, '')} against ${S.xLabel}, for the simulation and the observation`);
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
    const S = STATS[this.stat], view = this.view[this.stat], d = this.data[this.stat];
    const { col } = this;
    if (!d) return;

    const fs = parseFloat(getComputedStyle(cv).fontSize) || 12;
    const font = `${fs}px ui-monospace, 'Roboto Mono', Consolas, monospace`;
    const small = `${(fs * 0.8).toFixed(1)}px ui-monospace, 'Roboto Mono', Consolas, monospace`;
    const mode = S.y[view.y], xlog = S.xToggle ? view.xlog : S.xlog;
    const x = d.x, n = x.length;
    const vo = Array.from(d.obs, (y, i) => mode.f(x[i], y));
    const vs = Array.from(d.sim, (y, i) => mode.f(x[i], y));

    // Ranges follow the data continuously, so nothing jumps a tick mid-drag.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (mode.log && !(vo[i] > 0 && vs[i] > 0)) continue;
      lo = Math.min(lo, vo[i], vs[i]); hi = Math.max(hi, vo[i], vs[i]);
    }
    // Log y spans at most 4 decades below the peak: a baryon-only universe has
    // acoustic zeros that would otherwise stretch it over 13 and flatten the
    // curve that matters.
    const y0 = mode.log ? Math.max(Math.log10(lo), Math.log10(hi) - 4) - 0.08
                        : Math.min(0, lo * 1.08);
    const y1 = mode.log ? Math.log10(hi) + 0.12 : hi * 1.08;
    const x0 = x[0], xN = x[n - 1];
    const lx0 = Math.log10(x0), lx1 = Math.log10(xN);
    const xMin = xlog ? x0 : 0;

    const lf = parseFloat(getComputedStyle(this.xBtn).fontSize) || fs;
    const bh = Math.round(lf * 1.7);
    const M = { l: Math.round(fs * 2.6 + bh + 9), r: Math.round(fs * 0.9), t: Math.round(fs * 0.8),
                b: Math.round(fs * 1.2 + 10 + bh) };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = xlog ? (v) => M.l + ((Math.log10(v) - lx0) / (lx1 - lx0)) * pw
                   : (v) => M.l + ((v - xMin) / (xN - xMin)) * pw;
    const Y = mode.log ? (v) => M.t + ph - ((Math.log10(v) - y0) / (y1 - y0)) * ph
                       : (v) => M.t + ph - ((v - y0) / (y1 - y0)) * ph;
    const xb = M.t + ph;                       // bottom of the plot
    const zeroY = mode.log ? xb : Y(0);        // where the value 0 sits

    // "10^e" with a smaller, raised exponent - measured so it can be right-
    // aligned (y ticks) or centred (x ticks) as one unit.
    const pow10 = (e, px, base, align) => {
      const es = e < 0 ? MINUS + -e : String(e);
      g.font = font; const wb = g.measureText('10').width;
      g.font = small; const we = g.measureText(es).width;
      const sx = align === 'right' ? px - wb - we - 1 : px - (wb + we + 1) / 2;
      g.textAlign = 'left';
      g.font = font; g.fillText('10', sx, base);
      g.font = small; g.fillText(es, sx + wb + 1, base - fs * 0.45);
    };

    g.lineWidth = 1;
    g.fillStyle = col.text;
    g.textBaseline = 'alphabetic';

    // ---- y axis ----
    if (mode.log) {
      const perDecade = ph / (y1 - y0);
      const every = Math.max(1, Math.ceil((fs * 1.8) / perDecade));   // thin crowded labels
      for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) {
        for (let m = 1; m < 10; m++) {
          if (m > 1 && perDecade < 24) break;
          const lv = e + Math.log10(m);
          if (lv < y0 || lv > y1) continue;
          const y = Math.round(Y(10 ** lv)) + 0.5;
          if (m === 1) {
            g.strokeStyle = col.grid;
            g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
            if (e % every === 0) pow10(e, M.l - 7, y + fs * 0.35, 'right');
          } else {
            g.strokeStyle = col.axis;
            g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + 4, y); g.stroke();
          }
        }
      }
    } else {
      const st = niceStep(y1 - y0, Math.max(3, Math.round(ph / 55)));
      g.font = font; g.textAlign = 'right';
      for (let v = Math.ceil(y0 / st) * st; v < y1; v += st) {
        const y = Math.round(Y(v)) + 0.5;
        g.strokeStyle = Math.abs(v) < st * 1e-6 ? col.axis : col.grid;
        g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
        g.fillText(String(+v.toPrecision(6)), M.l - 7, y + fs * 0.35);
      }
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
          const px = Math.round(X(10 ** lv)) + 0.5;
          if (m === 1) {
            g.strokeStyle = col.grid;
            g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, xb); g.stroke();
            pow10(e, px, xBase, 'center');
          } else {
            g.strokeStyle = col.axis;
            g.beginPath(); g.moveTo(px, xb); g.lineTo(px, xb - 4); g.stroke();
          }
        }
      }
    } else {
      const st = niceStep(xN - xMin, Math.max(3, Math.round(pw / 70)));
      g.font = font; g.textAlign = 'center';
      for (let t = Math.ceil(xMin / st) * st; t <= xN + 1e-9; t += st) {
        const px = Math.round(X(t)) + 0.5;
        g.strokeStyle = col.grid;
        g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, xb); g.stroke();
        g.fillText(String(+t.toPrecision(6)), px, xBase);
      }
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
    if (!mode.log && y0 < 0) {   // zero line, for xi going negative
      g.strokeStyle = col.axis; g.lineWidth = 1;
      const y = Math.round(zeroY) + 0.5;
      g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
    }
    const line = (v, colour, dash) => {
      g.beginPath();
      for (let i = 0; i < n; i++) { const px = X(x[i]), py = Y(v[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
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
    const xh = xlog ? 10 ** (lx0 + t * (lx1 - lx0)) : xMin + t * (xN - xMin);
    const best = Math.max(0, Math.min(n - 1, S.xgrid === 'log'
      ? Math.round(Math.log(Math.max(xh, x0) / x0) / Math.log(x[1] / x0))
      : Math.round((xh - x0) / (x[1] - x0))));
    const px = Math.round(X(x[best])) + 0.5;
    g.strokeStyle = col.axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, xb); g.stroke();
    const dot = (v, c) => {
      g.beginPath(); g.arc(px, Y(v), 4, 0, 2 * Math.PI);
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
      const sp = document.createElement('span'); sp.textContent = label;
      r.append(b, sp); tip.append(r);
    };
    row(x[best], S.xLabel);
    row(vs[best], 'Simulation', 'is-sim');
    row(vo[best], 'Observation', 'is-obs');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${px + 12 + tw > W ? px - 12 - tw : px + 12}px`;
    tip.style.top = `${M.t + 4}px`;
  }
}

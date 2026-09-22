// Minimal canvas2d line plotter for the diagnostic panels.
//
// Deliberately tiny: one live series plus an optional dashed reference curve.
// One series needs no legend box (the title names it) and the reference is drawn
// in muted ink rather than a competing hue, so identity is never colour-alone.

const INK = '#e8e6e3', INK_MUTED = '#8a8886', GRID = '#2a2a28', SURFACE = '#111110';

const fmt = (v) => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-2) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    return `${m.toFixed(1)}e${e}`;
  }
  return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
};

export class Plot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{title:string, xlabel:string, ylabel:string,
   *          xlog?:boolean, ylog?:boolean, color?:string}} opts
   */
  constructor(canvas, opts) {
    this.c = canvas;
    this.o = { xlog: false, ylog: false, color: '#049cdb', ...opts };
    this.series = null;
    this.reference = null;
    this.hover = null;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
  }

  setData(x, y, refY) {
    this.series = { x, y };
    this.reference = refY ? { x, y: refY } : null;
    this.draw();
  }

  _bounds() {
    const { xlog, ylog } = this.o;
    const xs = this.series.x, all = [this.series.y, this.reference && this.reference.y].filter(Boolean);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      const xv = xs[i];
      if (xlog && !(xv > 0)) continue;
      let ok = false;
      for (const ys of all) {
        const yv = ys[i];
        if (!Number.isFinite(yv) || (ylog && !(yv > 0))) continue;
        ok = true;
        if (yv < y0) y0 = yv;
        if (yv > y1) y1 = yv;
      }
      if (!ok) continue;
      if (xv < x0) x0 = xv;
      if (xv > x1) x1 = xv;
    }
    if (ylog) { y0 = Math.max(y0, y1 * 1e-6); } else { const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad; }
    return { x0, x1, y0, y1 };
  }

  draw() {
    const cv = this.c, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = SURFACE; g.fillRect(0, 0, W, H);
    if (!this.series) return;

    const M = { l: 56, r: 12, t: 26, b: 34 };
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const { xlog, ylog } = this.o;
    const b = this._bounds();
    const tx = (v) => M.l + pw * ((xlog ? Math.log10(v / b.x0) : v - b.x0) / (xlog ? Math.log10(b.x1 / b.x0) : b.x1 - b.x0));
    const ty = (v) => M.t + ph * (1 - (ylog ? Math.log10(v / b.y0) : v - b.y0) / (ylog ? Math.log10(b.y1 / b.y0) : b.y1 - b.y0));

    // recessive grid + ticks
    g.font = '10px ui-monospace, monospace';
    g.strokeStyle = GRID; g.lineWidth = 1;
    const ticks = (lo, hi, log) => {
      const out = [];
      if (log) {
        for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
          const v = Math.pow(10, e);
          if (v >= lo && v <= hi) out.push(v);
        }
      } else {
        const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
        const s = [1, 2, 5, 10].map((m) => m * step).find((m) => (hi - lo) / m <= 6) || step;
        for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v);
      }
      return out;
    };
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const v of ticks(b.x0, b.x1, xlog)) {
      const X = tx(v);
      g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke();
      g.fillStyle = INK_MUTED; g.fillText(fmt(v), X, M.t + ph + 6);
    }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of ticks(b.y0, b.y1, ylog)) {
      const Y = ty(v);
      g.beginPath(); g.moveTo(M.l, Y); g.lineTo(M.l + pw, Y); g.stroke();
      g.fillStyle = INK_MUTED; g.fillText(fmt(v), M.l - 6, Y);
    }

    const stroke = (ys, color, dash) => {
      g.save(); g.beginPath();
      g.rect(M.l, M.t, pw, ph); g.clip();
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.setLineDash(dash || []);
      g.beginPath();
      let started = false;
      for (let i = 0; i < ys.length; i++) {
        const xv = this.series.x[i], yv = ys[i];
        if (!Number.isFinite(yv) || (ylog && !(yv > 0)) || (xlog && !(xv > 0))) { started = false; continue; }
        const X = tx(xv), Y = ty(yv);
        if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
      }
      g.stroke(); g.restore();
    };
    if (this.reference) stroke(this.reference.y, INK_MUTED, [4, 4]);
    stroke(this.series.y, this.o.color);

    // title + axis labels in text ink, never the series colour
    g.setLineDash([]);
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '12px system-ui, sans-serif';
    g.fillText(this.o.title, M.l, 16);
    g.fillStyle = INK_MUTED; g.font = '10px system-ui, sans-serif';
    g.textAlign = 'right'; g.fillText(this.o.xlabel, W - M.r, H - 4);
    g.save(); g.translate(11, M.t); g.rotate(-Math.PI / 2);
    g.textAlign = 'right'; g.fillText(this.o.ylabel, 0, 0); g.restore();

    // hover crosshair + readout
    if (this.hover && this.hover.x > M.l && this.hover.x < M.l + pw) {
      const frac = (this.hover.x - M.l) / pw;
      const xv = xlog ? b.x0 * Math.pow(b.x1 / b.x0, frac) : b.x0 + frac * (b.x1 - b.x0);
      let best = 0, bd = Infinity;
      for (let i = 0; i < this.series.x.length; i++) {
        const d = Math.abs((xlog ? Math.log10(this.series.x[i]) : this.series.x[i]) - (xlog ? Math.log10(xv) : xv));
        if (d < bd) { bd = d; best = i; }
      }
      const X = tx(this.series.x[best]), Y = ty(this.series.y[best]);
      if (Number.isFinite(Y)) {
        g.strokeStyle = INK_MUTED; g.lineWidth = 1; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke(); g.setLineDash([]);
        g.fillStyle = this.o.color; g.beginPath(); g.arc(X, Y, 4, 0, 7); g.fill();
        g.strokeStyle = SURFACE; g.lineWidth = 2; g.stroke(); // 2px surface ring
        const txt = `${fmt(this.series.x[best])}, ${fmt(this.series.y[best])}`;
        g.font = '10px ui-monospace, monospace';
        const w = g.measureText(txt).width + 8;
        const bx = Math.min(X + 8, M.l + pw - w);
        g.fillStyle = 'rgba(17,17,16,0.9)'; g.fillRect(bx, M.t + 2, w, 16);
        g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(txt, bx + 4, M.t + 10);
      }
    }
  }
}

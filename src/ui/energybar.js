// The energy content of the universe as ONE bar with two draggable dividers.
//
// Three independent sliders cannot express Omega_b + Omega_c + Omega_L = 1: you
// have to project back onto the simplex after every move, which drags parameters
// the user did not touch (set Omega_b = 0.05, then nudge Omega_c, and Omega_b
// moves). A single full-width bar makes the constraint STRUCTURAL - the segments
// always sum to the bar - and each divider moves exactly the two components it
// sits between, leaving the third alone. Divider 2 changes Omega_c and Omega_L
// and cannot touch Omega_b at all.
//
// Labelling is adaptive because Omega_b is ~5% of the bar at realistic values -
// about 16 px at a 320 px panel width, 34 px even at 700 px. Segments show what
// they have room for, falling back symbol+value -> value -> symbol -> nothing,
// and the legend below always carries every value in full.

const KEYS = ['Omega_b', 'Omega_c', 'Omega_L'];

let measurer = null;
/** Width of `str` in `font`. Subscripts are ~0.72em, so strip the markup and
 *  charge the subscript characters at a discount rather than full width. */
function textWidth(str, font) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  measurer.font = font;
  const base = str.replace(/<[^>]+>/g, '');
  const subs = (str.match(/<sub>(.*?)<\/sub>/g) || []).join('').replace(/<[^>]+>/g, '');
  return measurer.measureText(base).width - 0.28 * measurer.measureText(subs).width;
}

/** Readable ink for a filled segment: WCAG relative luminance, then black or white. */
function pickInk(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return L > 0.35 ? '#1a1a19' : '#ffffff';
}

export class EnergyBar {
  /**
   * @param {HTMLElement} host
   * @param {{title?:string, variant?:'inside'|'values'|'bare',
   *          legend?:'rows'|'inline'|'none', height?:number,
   *          ink?:'auto'|string,
   *          colours:Record<string,string>, names:Record<string,string>,
   *          symbols:Record<string,string>, values:Record<string,number>,
   *          onChange:(v:Record<string,number>)=>void}} opts
   */
  constructor(host, opts) {
    // ink: symbol colour inside the segments. 'auto' picks black or white per
    // segment from its luminance; a CSS colour forces the same ink on all three.
    this.o = { title: 'Energy content', variant: 'inside', legend: 'rows', height: 34, ink: 'auto', ...opts };
    this.v = { ...opts.values };

    const root = document.createElement('div');
    root.className = 'ebar';
    root.innerHTML = `
      <div class="ebar-title"></div>
      <div class="ebar-bar" style="height:${this.o.height}px"></div>
      <div class="ebar-legend"></div>`;
    host.appendChild(root);
    this.root = root;
    root.querySelector('.ebar-title').textContent = this.o.title;
    this.bar = root.querySelector('.ebar-bar');
    this.legend = root.querySelector('.ebar-legend');
    this.legend.classList.add(`is-${this.o.legend}`);

    this.segs = KEYS.map((k) => {
      const el = document.createElement('div');
      el.className = 'ebar-seg';
      el.style.background = this.o.colours[k];
      el.style.color = this.o.ink === 'auto' ? pickInk(this.o.colours[k]) : this.o.ink;
      el.innerHTML = '<span class="ebar-seg-sym"></span><span class="ebar-seg-val"></span>';
      this.bar.appendChild(el);
      return el;
    });

    // Two dividers: 0 sits between Omega_b and Omega_c, 1 between Omega_c and Omega_L
    this.divs = [0, 1].map((i) => {
      const el = document.createElement('div');
      el.className = 'ebar-div';
      el.tabIndex = 0;
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '1');
      el.innerHTML = '<span class="ebar-grip"></span>';
      this.bar.appendChild(el);
      this._wire(el, i);
      return el;
    });

    // Clicking the bar itself moves whichever divider is nearest the click and
    // keeps dragging it, so there is no need to aim at a 6 px grip.
    this.bar.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.ebar-div')) return;   // the grips handle themselves
      const r = this.bar.getBoundingClientRect();
      const t = (ev.clientX - r.left) / r.width;
      const [c0, c1] = this._cuts;
      const i = Math.abs(t - c0) <= Math.abs(t - c1) ? 0 : 1;
      this._startDrag(this.divs[i], i, ev);
    });

    this.render();
    this._ro = new ResizeObserver(() => this.render());
    this._ro.observe(this.bar);
  }

  get _cuts() { return [this.v.Omega_b, this.v.Omega_b + this.v.Omega_c]; }

  _setCut(i, tRaw) {
    const step = this.o.step || 0.01;
    const t = Math.round(tRaw / step) * step;
    const [c0, c1] = this._cuts;
    const cuts = i === 0 ? [Math.min(Math.max(t, 0), c1), c1] : [c0, Math.min(Math.max(t, c0), 1)];
    this.v.Omega_b = cuts[0];
    this.v.Omega_c = cuts[1] - cuts[0];
    this.v.Omega_L = 1 - cuts[1];
    this.render();
    this.o.onChange({ ...this.v });
  }

  _startDrag(el, i, ev) {
    ev.preventDefault();
    const posOf = (e) => {
      const r = this.bar.getBoundingClientRect();
      return (e.clientX - r.left) / r.width;
    };
    const move = (e) => this._setCut(i, posOf(e));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.root.classList.remove('is-dragging');
      this.o.onCommit?.();
    };
    this.root.classList.add('is-dragging');
    this.o.onGrab?.();
    this._setCut(i, posOf(ev));          // jump to the click immediately
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _wire(el, i) {
    el.addEventListener('pointerdown', (ev) => this._startDrag(el, i, ev));
    el.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowLeft' ? -0.005 : ev.key === 'ArrowRight' ? 0.005 : 0;
      if (!d) return;
      ev.preventDefault();
      this.o.onGrab?.();
      this._setCut(i, this._cuts[i] + d);
      this.o.onCommit?.();
    });
  }

  setValues(v) { this.v = { ...v }; this.render(); }

  render() {
    const W = this.bar.clientWidth || 320;
    const GAP = 2; // surface gap between adjacent fills
    const cuts = this._cuts;
    const edges = [0, cuts[0], cuts[1], 1];

    // Measured with the symbol's live computed font: the size is fluid (it
    // follows the viewport through CSS clamp), so a hard-coded one would drift.
    const cs = getComputedStyle(this.segs[0].querySelector('.ebar-seg-sym'));
    const nameFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const valFont = '11px ui-monospace, monospace';

    KEYS.forEach((k, i) => {
      const x0 = edges[i] * W, x1 = edges[i + 1] * W;
      const left = i === 0 ? 0 : x0 + GAP / 2;
      const w = Math.max(0, (i === 2 ? W : x1 - GAP / 2) - left);
      const el = this.segs[i];
      el.style.left = `${left}px`;
      el.style.width = `${w}px`;

      const name = this.o.names[k];
      const sym = this.o.symbols[k];
      const val = this.v[k].toFixed(3);
      const symEl = el.querySelector('.ebar-seg-sym');
      const valEl = el.querySelector('.ebar-seg-val');

      // Graceful degradation as the segment narrows. Omega_b runs out of room
      // first and hits 'nothing' on any realistic panel, which is why the legend
      // is not optional.
      // Symbol only. The number changes constantly while dragging and would
      // flicker in and out as a segment crosses the text width; the legend
      // carries it instead, right-aligned so the three are easy to compare.
      const showSym = w > textWidth(sym, nameFont) + 4;
      symEl.innerHTML = showSym ? sym : '';
      valEl.textContent = '';
      symEl.style.display = showSym ? '' : 'none';
      valEl.style.display = 'none';
      el.title = `${name} ${sym.replace(/<[^>]+>/g, '')} = ${val}`;
    });

    this.divs.forEach((el, i) => {
      el.style.left = `${cuts[i] * W}px`;
      const k = i === 0 ? 'Omega_b' : 'Omega_L';
      el.setAttribute('aria-valuenow', cuts[i].toFixed(3));
      el.setAttribute('aria-label',
        i === 0 ? 'boundary between ordinary matter and dark matter'
                : 'boundary between dark matter and dark energy');
      el.setAttribute('aria-valuetext',
        `${this.o.names.Omega_b} ${this.v.Omega_b.toFixed(3)}, ` +
        `${this.o.names.Omega_c} ${this.v.Omega_c.toFixed(3)}, ` +
        `${this.o.names.Omega_L} ${this.v.Omega_L.toFixed(3)}`);
    });

    if (this.o.legend === 'none') { this.legend.innerHTML = ''; return; }
    // Same grammar as every other control: "Name symbol = value".
    this.legend.innerHTML = KEYS.map((k) => `
      <span class="ebar-key">
        <i style="background:${this.o.colours[k]}"></i>
        <span class="ebar-key-label">${this.o.names[k]} ${this.o.symbols[k]}</span>
        <span class="ebar-key-val">${this.v[k].toFixed(2)}</span>
      </span>`).join('');
  }

  dispose() { this._ro.disconnect(); this.root.remove(); }
}

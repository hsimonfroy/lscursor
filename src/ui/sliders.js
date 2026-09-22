// Slider widgets.
//
// Colours for the three Omegas are sampled from the Planck CMB Simulator slide
// this app is the LSS answer to, so the two sit side by side without a jarring
// repaint. f and b1 are deliberately a separate, cooler pair: they are
// astrophysics, not the cosmic recipe.

export const COLOURS = {
  Omega_b: '#f89406', // ordinary matter
  Omega_c: '#049cdb', // dark matter
  Omega_L: '#46a546', // dark energy
  f: '#9b7ede',
  b1: '#d9709a',
};

export class Slider {
  /**
   * @param {HTMLElement} host
   * @param {{key:string, label:string, min:number, max:number, value:number,
   *          step?:number, fmt?:(v:number)=>string, onInput:(v:number)=>void,
   *          onCommit?:()=>void, onGrab?:()=>void}} opts
   */
  constructor(host, opts) {
    this.o = { fmt: (v) => v.toFixed(2), step: 0.01, ...opts };
    this.value = opts.value;
    this.disabled = false;

    const root = document.createElement('div');
    root.className = 'slider';
    root.innerHTML = `
      <div class="slider-label"><span class="slider-name"></span><span class="slider-value"></span></div>
      <div class="slider-hit">
        <div class="slider-track" tabindex="0" role="slider"
             aria-valuemin="${opts.min}" aria-valuemax="${opts.max}">
          <div class="slider-fill"></div><div class="slider-handle"></div>
        </div>
      </div>`;
    host.appendChild(root);

    this.root = root;
    this.nameEl = root.querySelector('.slider-name');
    this.valEl = root.querySelector('.slider-value');
    this.track = root.querySelector('.slider-track');
    this.fill = root.querySelector('.slider-fill');
    this.handle = root.querySelector('.slider-handle');
    // The pointer target is a padded box around the track, not the track itself.
    // At either end the handle overhangs the track by its radius, and with the
    // listener on the track that overhang was dead: grabbing the visible handle
    // did nothing. Position is still measured against the track.
    this.hit = root.querySelector('.slider-hit');

    this.nameEl.innerHTML = opts.label; // labels carry <sub> markup
    const c = COLOURS[opts.key] || '#888';
    this.fill.style.background = c;
    this.handle.style.borderColor = c;

    const pos = (ev) => {
      const r = this.track.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const raw = this.o.min + t * (this.o.max - this.o.min);
      // snap to the step so the readout and the handle agree exactly
      return Math.round(raw / this.o.step) * this.o.step;
    };
    // The widget owns its own display: update first, then notify. Without this
    // the handle only moves if the host remembers to call set(), which is a
    // silent "the slider does nothing" bug waiting to happen.
    const move = (ev) => {
      if (this.disabled) return;
      const v = pos(ev);
      this.set(v);
      this.o.onInput(v);
    };
    const up = (ev) => {
      this.hit.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.o.onCommit?.();
    };
    this.hit.addEventListener('pointerdown', (ev) => {
      if (this.disabled) return;
      ev.preventDefault();
      this.hit.setPointerCapture?.(ev.pointerId);
      this.o.onGrab?.();
      move(ev);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    this.track.addEventListener('keydown', (ev) => {
      if (this.disabled) return;
      const d = ev.key === 'ArrowLeft' ? -this.o.step : ev.key === 'ArrowRight' ? this.o.step : 0;
      if (!d) return;
      ev.preventDefault();
      const v = Math.min(this.o.max, Math.max(this.o.min, this.value + d));
      this.o.onGrab?.(); this.set(v); this.o.onInput(v); this.o.onCommit?.();
    });

    this.set(opts.value);
  }

  set(v) {
    this.value = v;
    const t = (v - this.o.min) / (this.o.max - this.o.min);
    const pct = `${Math.min(100, Math.max(0, t * 100))}%`;
    this.fill.style.width = pct;
    this.handle.style.left = pct;
    this.valEl.textContent = this.o.fmt(v);
    this.track.setAttribute('aria-valuenow', v.toFixed(4));
    this.track.setAttribute('aria-valuetext', `${this.o.label} ${this.o.fmt(v)}`);
  }

  setDisabled(on) {
    this.disabled = on;
    this.root.classList.toggle('is-disabled', on);
  }
}

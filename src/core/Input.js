// Keyboard and mouse state. Mouse buttons and wheel are only captured when the
// pointer is over the 3D canvas, so HTML menus receive their own clicks.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0, buttons: new Set(), pressed: new Set(), released: new Set(), overCanvas: false, dragDist: 0 };
    this.enabled = true;

    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'Backquote'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.buttons.clear(); });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      this.mouse.buttons.add(e.button);
      this.mouse.pressed.add(e.button);
      this.mouse.dragDist = 0;
      canvas.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointerup', (e) => {
      if (this.mouse.buttons.has(e.button)) this.mouse.released.add(e.button);
      this.mouse.buttons.delete(e.button);
    });
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.nx = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ny = -(this.mouse.y / r.height) * 2 + 1;
      if (this.mouse.buttons.size) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
        this.mouse.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    canvas.addEventListener('pointerenter', () => { this.mouse.overCanvas = true; });
    canvas.addEventListener('pointerleave', () => { this.mouse.overCanvas = false; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5);
    }, { passive: false });
  }

  isDown(code) { return this.enabled && this.down.has(code); }
  wasPressed(code) { return this.enabled && this.pressed.has(code); }
  anyDown(...codes) { return codes.some((c) => this.isDown(c)); }
  mouseDown(b) { return this.mouse.buttons.has(b); }
  mousePressed(b) { return this.mouse.pressed.has(b); }
  mouseReleased(b) { return this.mouse.released.has(b); }

  /** Called once per frame after all systems have read input. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed.clear();
    this.mouse.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}

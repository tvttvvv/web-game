// 입력: 터치(조이스틱 · 화면 드래그 카메라 · 핀치 확대 · 탭 선택 · 버튼) / 키보드 · 마우스
export class Input {
  constructor(canvas, els) {
    this.canvas = canvas; this.els = els;
    this.move = { x: 0, z: 0 };
    this.attackHeld = false;
    this.cam = { yaw: 0, zoom: 0 };
    this.queue = [];
    this.keys = new Set();
    this.enabled = true;
    this.touchMode = false;
    this.sens = 1;
    this.onCommand = () => {};
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.drags = new Map();
    this.bind();
  }

  bind() {
    const c = this.canvas;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.zoom += Math.sign(e.deltaY) * 1.6; }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.moveP(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e, true));
    const B = this.els.buttons;
    const press = (el, on, off) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.touchMode = e.pointerType !== 'mouse' || this.touchMode; el.setPointerCapture?.(e.pointerId); el.classList.add('on'); on(); });
      const end = (e) => { e.preventDefault(); el.classList.remove('on'); if (off) off(); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    press(B.atk, () => { this.attackHeld = true; this.queue.push({ type: 'atk' }); }, () => { this.attackHeld = false; });
    for (let i = 0; i < 4; i++) press(B['s' + i], () => this.queue.push({ type: 'skill', i }));
    press(B.dodge, () => this.queue.push({ type: 'dodge' }));
    press(B.hp, () => this.queue.push({ type: 'hp' }));
    press(B.mp, () => this.queue.push({ type: 'mp' }));
    press(B.act, () => this.queue.push({ type: 'act' }));
  }

  key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.code;
    if (down && !this.keys.has(k)) {
      const cmd = { KeyI: 'inv', KeyC: 'inv', KeyB: 'inv', KeyL: 'quest', KeyJ: 'quest', KeyM: 'map', Escape: 'escape', Enter: 'chat', Slash: 'chat' }[k];
      if (cmd) { e.preventDefault(); this.onCommand(cmd); this.keys.add(k); return; }
      if (!this.enabled) return;
      if (/^Digit[1-4]$/.test(k)) this.queue.push({ type: 'skill', i: +k.slice(5) - 1 });
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.queue.push({ type: 'dodge' });
      if (k === 'KeyR') this.queue.push({ type: 'hp' });
      if (k === 'KeyT') this.queue.push({ type: 'mp' });
      if (k === 'KeyF') this.queue.push({ type: 'act' });
      if (k === 'Tab') { e.preventDefault(); this.queue.push({ type: 'cycle' }); }
      if (k === 'Space') { e.preventDefault(); this.attackHeld = true; this.queue.push({ type: 'atk' }); }
      this.touchMode = false;
    }
    if (down) this.keys.add(k);
    else { this.keys.delete(k); if (k === 'Space') this.attackHeld = false; }
  }

  down(e) {
    e.preventDefault();
    if (e.pointerType !== 'mouse') this.touchMode = true;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.drags.set('mouse', { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, rot: true });
      else if (e.button === 0) this.drags.set('mouseL', { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
      return;
    }
    if (!this.enabled) return;
    if (e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.35 && this.joy.id === null) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.showJoy(e.clientX, e.clientY, 0, 0);
      return;
    }
    this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, rot: true });
  }
  moveP(e) {
    if (e.pointerId === this.joy.id) {
      const R = 60;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R; this.joy.y = dy / R;
      this.showJoy(this.joy.ox, this.joy.oy, dx, dy);
      return;
    }
    const key = e.pointerType === 'mouse' ? (this.drags.has('mouse') ? 'mouse' : 'mouseL') : e.pointerId;
    const D = this.drags.get(key);
    if (!D) return;
    const dx = e.clientX - D.x, dy = e.clientY - D.y;
    D.x = e.clientX; D.y = e.clientY;
    if (!D.moved && Math.hypot(D.x - D.sx, D.y - D.sy) > 8) D.moved = true;
    const touches = [...this.drags.entries()].filter(([k]) => typeof k === 'number');
    if (touches.length >= 2) { // 핀치 확대
      const [a, b] = touches.map(([, v]) => v);
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) this.cam.zoom -= (dd - this.pinch) * 0.05;
      this.pinch = dd;
      return;
    }
    if (D.moved && (D.rot || key === 'mouseL')) this.cam.yaw -= dx * 0.008 * this.sens;
  }
  up(e, cancel) {
    if (e.pointerId === this.joy.id) { this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.hideJoy(); return; }
    const key = e.pointerType === 'mouse' ? (e.button === 2 ? 'mouse' : 'mouseL') : e.pointerId;
    const D = this.drags.get(key);
    if (!D) return;
    this.drags.delete(key);
    if ([...this.drags.keys()].filter((k) => typeof k === 'number').length < 2) this.pinch = 0;
    if (!cancel && !D.moved && performance.now() - D.t < 350 && key !== 'mouse') this.queue.push({ type: 'tap', x: D.x, y: D.y });
  }

  showJoy(x, y, dx, dy) {
    const { joyBase, joyKnob } = this.els;
    joyBase.style.display = 'block';
    joyBase.style.left = x - 62 + 'px'; joyBase.style.top = y - 62 + 'px';
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  hideJoy() { this.els.joyBase.style.display = 'none'; }

  poll() {
    let x = 0, z = 0;
    const K = this.keys;
    if (this.enabled) {
      if (K.has('KeyW') || K.has('ArrowUp')) z += 1;
      if (K.has('KeyS') || K.has('ArrowDown')) z -= 1;
      if (K.has('KeyA') || K.has('ArrowLeft')) x -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) x += 1;
      if (K.has('KeyQ')) this.cam.yaw += 0.04;
      if (K.has('KeyE')) this.cam.yaw -= 0.04;
      if (this.joy.id !== null) { const m = Math.hypot(this.joy.x, this.joy.y); if (m > 0.12) { x = this.joy.x; z = -this.joy.y; } }
    }
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    this.move.x = x; this.move.z = z;
    const cam = { yaw: this.cam.yaw, zoom: this.cam.zoom };
    this.cam.yaw = 0; this.cam.zoom = 0;
    return cam;
  }
  release() {
    this.attackHeld = false; this.queue.length = 0; this.drags.clear();
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.hideJoy();
  }
}

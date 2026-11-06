// 입력: 터치(가상 조이스틱 + 화면 드래그 시점 + 탭/길게 누르기) · 키보드/마우스
export class Input {
  constructor(canvas, els) {
    this.canvas = canvas;
    this.els = els; // { joyBase, joyKnob, buttons: {jump, sneak, mine, use} }
    this.move = { x: 0, z: 0 };
    this.jump = false; this.sneak = false; this.sprint = false;
    this.look = { dx: 0, dy: 0 };
    this.mine = null;         // null | 'center' | {x,y}
    this.useQueue = [];       // 'center' | {x,y}
    this.useHeld = false;
    this.hotbarDelta = 0;
    this.keys = new Set();
    this.locked = false;
    this.enabled = true;      // UI가 열려 있으면 false
    this.touchMode = false;
    this.mouseSens = 1; this.touchSens = 1; this.invertY = false;
    this.onCommand = () => {};
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.looks = new Map();   // pointerId → { x, y, sx, sy, t, moved, mining, timer }
    this.sneakToggle = false;
    this.lastW = 0;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.mine = null; this.useHeld = false; this.jump = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      if (this.touchMode || !this.enabled) return;
      if (!this.locked) { c.requestPointerLock?.(); return; }
      if (e.button === 0) this.mine = 'center';
      if (e.button === 2) { this.useQueue.push('center'); this.useHeld = true; this.useRepeat = performance.now() + 300; }
      if (e.button === 1) this.onCommand('pick');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mine = null;
      if (e.button === 2) this.useHeld = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const k = 0.0022 * this.mouseSens;
      this.look.dx -= e.movementX * k;
      this.look.dy -= e.movementY * k * (this.invertY ? -1 : 1);
    });
    c.addEventListener('wheel', (e) => { if (this.enabled) { this.hotbarDelta += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) { this.mine = null; this.useHeld = false; this.onCommand('unlocked'); }
    });

    // 터치: 캔버스 위 포인터
    c.addEventListener('pointerdown', (e) => this.pdown(e));
    addEventListener('pointermove', (e) => this.pmove(e));
    addEventListener('pointerup', (e) => this.pup(e));
    addEventListener('pointercancel', (e) => this.pup(e, true));

    const hold = (el, on, off) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.touchMode = true; el.setPointerCapture?.(e.pointerId); on(); el.classList.add('on'); });
      const end = (e) => { e.preventDefault(); off(); el.classList.remove('on'); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    };
    const B = this.els.buttons;
    hold(B.jump, () => { this.jump = true; }, () => { this.jump = false; });
    hold(B.mine, () => { this.mine = 'center'; }, () => { this.mine = null; });
    hold(B.use, () => { this.useQueue.push('center'); this.useHeld = true; this.useRepeat = performance.now() + 350; }, () => { this.useHeld = false; });
    if (B.sneak) B.sneak.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.sneakToggle = !this.sneakToggle; B.sneak.classList.toggle('on', this.sneakToggle);
    });
  }

  key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.code;
    if (down) {
      if (k === 'KeyE' || k === 'Tab') { e.preventDefault(); this.onCommand('inventory'); return; }
      if (k === 'KeyT' || k === 'Enter') { e.preventDefault(); this.onCommand('chat'); return; }
      if (k === 'Slash') { e.preventDefault(); this.onCommand('chat/'); return; }
      if (k === 'F5' || k === 'KeyV') { e.preventDefault(); this.onCommand('view'); return; }
      if (k === 'F1') { e.preventDefault(); this.onCommand('hud'); return; }
      if (k === 'F3') { e.preventDefault(); this.onCommand('debug'); return; }
      if (k === 'Escape') { this.onCommand('escape'); return; }
      if (/^Digit[1-9]$/.test(k)) { this.onCommand('slot' + (+k.slice(5) - 1)); return; }
      if (k === 'KeyQ') { this.onCommand('eat'); return; }
      if (k === 'KeyW' && !this.keys.has('KeyW')) {
        const now = performance.now();
        if (now - this.lastW < 280) this.sprintTap = true;
        this.lastW = now;
      }
      if (k === 'Space') e.preventDefault();
      this.touchMode = false;
      this.keys.add(k);
    } else {
      this.keys.delete(k);
      if (k === 'KeyW') this.sprintTap = false;
    }
  }

  pdown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.touchMode = true;
    if (!this.enabled) return;
    const W = innerWidth;
    if (e.clientX < W * 0.38 && this.joy.id === null) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.showJoy(e.clientX, e.clientY, 0, 0);
      return;
    }
    const L = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, mining: false, timer: 0 };
    L.timer = setTimeout(() => { if (!L.moved && this.looks.get(e.pointerId) === L) { L.mining = true; this.mine = { x: L.x, y: L.y }; } }, 330);
    this.looks.set(e.pointerId, L);
  }
  pmove(e) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerId === this.joy.id) {
      const R = 58;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R; this.joy.y = dy / R;
      this.showJoy(this.joy.ox, this.joy.oy, dx, dy);
      return;
    }
    const L = this.looks.get(e.pointerId);
    if (!L) return;
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    L.x = e.clientX; L.y = e.clientY;
    if (!L.moved && Math.hypot(L.x - L.sx, L.y - L.sy) > 10) L.moved = true;
    if (L.mining) { this.mine = { x: L.x, y: L.y }; if (Math.hypot(L.x - L.sx, L.y - L.sy) < 40) return; }
    if (L.moved) {
      const k = 0.0058 * this.touchSens;
      this.look.dx -= dx * k;
      this.look.dy -= dy * k * (this.invertY ? -1 : 1);
    }
  }
  pup(e, cancel) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerId === this.joy.id) {
      this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
      this.hideJoy();
      return;
    }
    const L = this.looks.get(e.pointerId);
    if (!L) return;
    clearTimeout(L.timer);
    this.looks.delete(e.pointerId);
    if (L.mining) { if (![...this.looks.values()].some((o) => o.mining)) this.mine = null; return; }
    if (!cancel && !L.moved && performance.now() - L.t < 330 && this.enabled) this.useQueue.push({ x: L.x, y: L.y });
  }

  showJoy(x, y, dx, dy) {
    const { joyBase, joyKnob } = this.els;
    if (!joyBase) return;
    joyBase.style.display = 'block';
    joyBase.style.left = x - 60 + 'px'; joyBase.style.top = y - 60 + 'px';
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  hideJoy() { if (this.els.joyBase) this.els.joyBase.style.display = 'none'; }

  // 매 프레임 호출
  poll() {
    let x = 0, z = 0;
    const K = this.keys;
    if (this.enabled) {
      if (K.has('KeyW') || K.has('ArrowUp')) z += 1;
      if (K.has('KeyS') || K.has('ArrowDown')) z -= 1;
      if (K.has('KeyA') || K.has('ArrowLeft')) x -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) x += 1;
    }
    let joySprint = false;
    if (this.joy.id !== null && this.enabled) {
      const jx = this.joy.x, jy = this.joy.y, m = Math.hypot(jx, jy);
      if (m > 0.15) { x = jx; z = -jy; joySprint = m > 0.92 && -jy > 0.7; }
    }
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    this.move.x = x; this.move.z = z;
    this.keyJump = this.enabled && K.has('Space');
    this.sneak = this.enabled && (K.has('ShiftLeft') || K.has('ShiftRight') || this.sneakToggle);
    this.sprint = this.enabled && z > 0.5 && (K.has('ControlLeft') || this.sprintTap || joySprint);
    if (this.useHeld && performance.now() > this.useRepeat) { this.useRepeat = performance.now() + 220; this.useQueue.push('center'); }
    const look = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return look;
  }
  get jumping() { return this.jump || this.keyJump; }
  releaseAll() {
    this.mine = null; this.useHeld = false; this.useQueue.length = 0; this.jump = false;
    for (const L of this.looks.values()) clearTimeout(L.timer);
    this.looks.clear();
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.hideJoy();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
}

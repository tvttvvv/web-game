// 키보드 + 가상 조이스틱 입력
export function setupInput(joyEl, knobEl) {
  const keys = new Set();
  const joy = { x: 0, y: 0, id: null };
  const R = 55;

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const setKnob = (x, y) => { knobEl.style.transform = `translate(${x}px, ${y}px)`; };
  const update = (e) => {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = dx / m * R; dy = dy / m * R; }
    setKnob(dx, dy);
    const n = Math.hypot(dx, dy) / R;
    if (n < 0.18) { joy.x = joy.y = 0; } else { joy.x = dx / R; joy.y = dy / R; }
  };
  joyEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); update(e);
  });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) update(e); });
  const end = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.x = joy.y = 0; setKnob(0, 0);
  };
  joyEl.addEventListener('pointerup', end);
  joyEl.addEventListener('pointercancel', end);

  return {
    keys,
    vec() {
      if (joy.x || joy.y) return { dx: joy.x, dy: joy.y };
      let dx = 0, dy = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
      const m = Math.hypot(dx, dy);
      return m ? { dx: dx / m, dy: dy / m } : { dx: 0, dy: 0 };
    },
  };
}

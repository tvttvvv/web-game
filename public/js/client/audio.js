// 효과음 (WebAudio로 즉석 합성 — 파일 없음)
const MAT = {
  stone: { f: 1800, q: 0.9, type: 'bandpass' }, wood: { f: 700, q: 1.2, type: 'bandpass' },
  grass: { f: 3200, q: 0.5, type: 'lowpass' }, gravel: { f: 1400, q: 0.7, type: 'bandpass' },
  sand: { f: 2400, q: 0.4, type: 'lowpass' }, glass: { f: 4200, q: 2, type: 'bandpass' },
  wool: { f: 500, q: 0.5, type: 'lowpass' }, snow: { f: 2000, q: 0.4, type: 'lowpass' },
  metal: { f: 2600, q: 3, type: 'bandpass' }, slime: { f: 400, q: 1, type: 'lowpass' },
};

export class Sound {
  constructor() { this.ctx = null; this.vol = 0.7; this.last = new Map(); }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.vol;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {}
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  ok(kind, gap = 0) {
    if (!this.ctx || this.vol <= 0 || this.ctx.state !== 'running') return false;
    const now = performance.now();
    if (gap && now - (this.last.get(kind) || 0) < gap) return false;
    this.last.set(kind, now);
    return true;
  }
  burst(mat, dur, gain, rate = 1, pan = 0) {
    const c = this.ctx, t = c.currentTime, m = MAT[mat] || MAT.stone;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = m.type; f.frequency.value = m.f * (0.85 + Math.random() * 0.3); f.Q.value = m.q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(f); f.connect(g); node.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    if (mat === 'metal' || mat === 'glass') this.tone(mat === 'glass' ? 2600 : 1400, dur * 1.4, gain * 0.25, 'sine');
  }
  tone(freq, dur, gain, type = 'sine', to = null, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  dig(mat) { if (this.ok('dig', 170)) this.burst(mat, 0.08, 0.35, 0.9); }
  break(mat) { if (this.ok('break', 40)) { this.burst(mat, 0.22, 0.55, 0.8); this.burst(mat, 0.12, 0.3, 1.2); } }
  place(mat) { if (this.ok('place', 50)) { this.burst(mat, 0.1, 0.5, 0.7); this.tone(140, 0.08, 0.15, 'sine', 90); } }
  step(mat) { if (this.ok('step', 120)) this.burst(mat, 0.06, 0.14, 0.9); }
  hurt() { if (this.ok('hurt', 150)) this.tone(260, 0.18, 0.25, 'square', 140); }
  eat() { if (this.ok('eat', 200)) for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.burst('sand', 0.07, 0.3, 1.4), i * 110); }
  click() { if (this.ok('click', 30)) this.tone(900, 0.04, 0.08, 'sine'); }
  pop() { if (this.ok('pop', 60)) this.tone(520, 0.09, 0.12, 'sine', 900); }
  splash() { if (this.ok('splash', 300)) this.burst('sand', 0.45, 0.5, 0.6); }
  door() { if (this.ok('door', 100)) { this.burst('wood', 0.16, 0.5, 0.6); this.tone(110, 0.12, 0.2, 'triangle', 80); } }
  achieve() { if (this.ok('ach', 500)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 0.12, 'triangle', null, i * 0.09)); }
  toolBreak() { if (this.ok('tb', 200)) { this.burst('metal', 0.3, 0.5, 0.7); this.tone(700, 0.25, 0.15, 'square', 200); } }
  mob(type, kind, pan = 0, vol = 1) {
    if (!this.ok('mob' + type + kind, kind === 'idle' ? 1500 : 150)) return;
    const v = 0.18 * vol;
    if (type === 'zombie') this.tone(kind === 'hurt' ? 160 : 95, kind === 'hurt' ? 0.25 : 0.7, v, 'sawtooth', kind === 'hurt' ? 110 : 70);
    else if (type === 'pig') this.tone(kind === 'hurt' ? 520 : 330, 0.18, v, 'sawtooth', kind === 'hurt' ? 360 : 260);
    else if (type === 'sheep') { this.tone(380, 0.35, v * 0.8, 'sawtooth', 300); this.tone(392, 0.35, v * 0.5, 'square', 310); }
    else if (type === 'chicken') { this.tone(1300, 0.06, v * 0.6, 'square', 900); this.tone(1100, 0.06, v * 0.5, 'square', 800, 0.09); }
    else if (type === 'slime') this.tone(kind === 'hurt' ? 260 : 180, 0.15, v * 1.3, 'sine', 90);
  }
}

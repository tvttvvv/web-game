// 효과음 (WebAudio로 즉석 합성 — 파일 없음)
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
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
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
  // 잡음 (휘두르기 · 폭발 · 발걸음)
  hiss(freq, dur, gain, type = 'bandpass', q = 1, to = null, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  tone(freq, dur, gain, type = 'sine', to = null, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  chord(notes, step, dur, gain, type = 'triangle') { notes.forEach((f, i) => this.tone(f, dur, gain, type, null, i * step)); }

  click() { if (this.ok('click', 30)) this.tone(900, 0.04, 0.07, 'sine'); }
  swing() { if (this.ok('swing', 90)) this.hiss(1800, 0.16, 0.22, 'bandpass', 0.8, 600); }
  bow() { if (this.ok('bow', 90)) { this.tone(220, 0.08, 0.12, 'triangle', 120); this.hiss(3000, 0.12, 0.12, 'highpass', 0.5); } }
  magic(kind = 0) { if (this.ok('magic' + kind, 90)) { const f = [660, 520, 880][kind] || 660; this.tone(f, 0.22, 0.08, 'sine', f * 1.8); this.tone(f * 1.5, 0.18, 0.05, 'triangle', f * 2.4, 0.03); } }
  hit(crit) { if (this.ok('hit', 45)) { this.hiss(900, 0.09, crit ? 0.4 : 0.26, 'lowpass', 0.7); this.tone(crit ? 180 : 140, 0.08, 0.16, 'square', 70); if (crit) this.tone(1400, 0.1, 0.06, 'triangle', 900); } }
  hurt() { if (this.ok('hurt', 140)) { this.tone(240, 0.16, 0.18, 'sawtooth', 110); this.hiss(500, 0.1, 0.2, 'lowpass'); } }
  boom(big) { if (this.ok('boom', 80)) { this.hiss(big ? 400 : 700, big ? 0.7 : 0.4, big ? 0.6 : 0.4, 'lowpass', 0.6, 80); this.tone(big ? 70 : 110, big ? 0.6 : 0.3, 0.3, 'sine', 35); } }
  heal() { if (this.ok('heal', 200)) this.chord([660, 880, 1100, 1320], 0.06, 0.3, 0.06, 'sine'); }
  buff() { if (this.ok('buff', 200)) this.chord([392, 523, 659], 0.07, 0.3, 0.08, 'triangle'); }
  dodge() { if (this.ok('dodge', 100)) this.hiss(1200, 0.2, 0.16, 'bandpass', 0.6, 3000); }
  blink() { if (this.ok('blink', 100)) { this.tone(400, 0.2, 0.08, 'sine', 1600); this.hiss(2500, 0.15, 0.1, 'highpass'); } }
  levelup() { if (this.ok('lvl', 800)) { this.chord([523, 659, 784, 1046], 0.1, 0.4, 0.12); this.chord([1046, 1318, 1568], 0.08, 0.6, 0.06, 'sine'); } }
  quest() { if (this.ok('quest', 400)) this.chord([587, 740, 880, 1175], 0.08, 0.32, 0.1); }
  coin() { if (this.ok('coin', 70)) { this.tone(1320, 0.07, 0.06, 'square'); this.tone(1760, 0.12, 0.05, 'square', null, 0.06); } }
  pickup() { if (this.ok('pick', 60)) this.tone(520, 0.1, 0.1, 'sine', 1040); }
  rare() { if (this.ok('rare', 300)) this.chord([784, 988, 1175, 1568], 0.05, 0.45, 0.08, 'sine'); }
  potion() { if (this.ok('pot', 200)) { for (let i = 0; i < 3; i++) this.tone(300 + i * 90, 0.08, 0.08, 'sine', 500 + i * 120, i * 0.07); } }
  down() { if (this.ok('down', 500)) this.chord([392, 330, 262, 196], 0.14, 0.5, 0.1, 'sawtooth'); }
  revive() { if (this.ok('rev', 500)) this.chord([262, 392, 523, 784], 0.1, 0.5, 0.09); }
  warn() { if (this.ok('warn', 250)) { this.tone(440, 0.14, 0.07, 'square'); this.tone(440, 0.14, 0.07, 'square', null, 0.2); } }
  enhance(ok) { if (!this.ok('enh', 200)) return; this.tone(1200, 0.08, 0.12, 'square', 600); if (ok) this.chord([784, 1046, 1318, 1568], 0.07, 0.5, 0.1); else this.tone(300, 0.4, 0.12, 'sawtooth', 120, 0.12); }
  step() { if (this.ok('step', 300)) this.hiss(2200, 0.05, 0.03, 'lowpass', 0.5); }
  mob(model, kind) {
    if (!this.ok('mob' + model + kind, kind === 'die' ? 80 : 160)) return;
    const v = kind === 'die' ? 0.16 : 0.1;
    const base = { slime: 200, boar: 150, wolf: 330, crab: 500, mushroom: 260, goblin: 420, skeleton: 900, bat: 1500, golem: 70, orc: 120, imp: 600, treant: 60, giant: 50 }[model] || 220;
    if (model === 'skeleton') this.hiss(2400, 0.15, v * 1.5, 'bandpass', 4);
    else this.tone(base, kind === 'die' ? 0.4 : 0.16, v, model === 'slime' ? 'sine' : 'sawtooth', base * (kind === 'die' ? 0.4 : 0.7));
  }
}

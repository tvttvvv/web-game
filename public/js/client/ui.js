// HUD · 핫바 · 가방/조합/상자 · 채팅 · 메뉴 · 사망 · 표지판 · 로딩
import { ITEMS, RECIPES, RECIPE_CATS, TAG_NAMES, itemName, countOf, canCraft, toolOf, INV_SIZE } from '../shared/items.js';
import { SKIN_TONES, HAIR, SHIRT, PANTS, skinColors } from './entities.js';
import { MAX_HP, MAX_FOOD, MAX_AIR } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);

function pixelIcon(rows, pal) {
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
}
const HEART = ['.XX...XX.', 'XRRX.XRRX', 'XRWRXRRRX', 'XRRRRRRRX', '.XRRRRRX.', '..XRRRX..', '...XRX...', '....X....'];
const FOOD = ['....XXX..', '...XBBBX.', '..XBbBBBX', '..XBBBBBX', '...XBBBX.', '..XWXXX..', '.XWX.....', 'XWWX.....', '.XX......'];
const BUBBLE = ['..XXXX..', '.XBBBBX.', 'XBWBBBBX', 'XBBBBBBX', 'XBBBBBBX', 'XBBBBBBX', '.XBBBBX.', '..XXXX..'];
const half = (rows) => rows.map((r) => [...r].map((ch, x) => (x >= Math.ceil(r.length / 2) && ch !== 'X' && ch !== '.' ? 'E' : ch)).join(''));
const empty = (rows) => rows.map((r) => r.replace(/[^X.]/g, 'E'));
const ICONS = {
  heart: pixelIcon(HEART, { X: '#1a0000', R: '#e0262b', W: '#ffb0b0' }),
  heartHalf: pixelIcon(half(HEART), { X: '#1a0000', R: '#e0262b', W: '#ffb0b0', E: '#3a1010' }),
  heartEmpty: pixelIcon(empty(HEART), { X: '#1a0000', E: '#3a1010' }),
  food: pixelIcon(FOOD, { X: '#2a1500', B: '#b0703a', b: '#e0a060', W: '#f0e8d8' }),
  foodHalf: pixelIcon(half(FOOD), { X: '#2a1500', B: '#b0703a', b: '#e0a060', W: '#f0e8d8', E: '#3a2a20' }),
  foodEmpty: pixelIcon(empty(FOOD), { X: '#2a1500', E: '#3a2a20' }),
  bubble: pixelIcon(BUBBLE, { X: '#0a2a60', B: '#4a8ae8', W: '#e0f0ff' }),
};

export class UI {
  constructor(icons, sound) {
    this.icons = icons; this.sound = sound;
    this.inv = new Array(INV_SIZE).fill(null);
    this.sel = 0;
    this.pick = null;
    this.split = false;
    this.chest = null;
    this.station = { table: false, furnace: false };
    this.cat = 'basic';
    this.cb = {};
    this.chatOpen = false;
    this.goals = [];
    this.buildHotbar();
    this.buildGrids();
    this.buildCats();
    this.bindButtons();
    this.setStats(MAX_HP, MAX_FOOD, MAX_AIR);
  }
  on(name, fn) { this.cb[name] = fn; }
  emit(name, ...a) { if (this.cb[name]) this.cb[name](...a); }

  get anyOpen() { return !$('inv').hidden || !$('menu').hidden || !$('death').hidden || !$('sign').hidden || this.chatOpen; }

  // ---------- 슬롯 ----------
  slotEl(i) {
    const d = document.createElement('div');
    d.className = 'slot'; d.dataset.i = i;
    d.innerHTML = '<img alt=""><span class="n"></span><span class="dur" hidden><i></i></span>';
    return d;
  }
  fillSlot(el, s) {
    const img = el.firstChild, n = el.children[1], dur = el.children[2];
    if (!s) { img.removeAttribute('src'); img.style.visibility = 'hidden'; n.textContent = ''; dur.hidden = true; el.title = ''; return; }
    const url = this.icons.url(s.id);
    if (img.getAttribute('src') !== url) img.src = url;
    img.style.visibility = 'visible';
    n.textContent = s.n > 1 ? s.n : '';
    const t = toolOf(s.id);
    if (t && s.d !== undefined && s.d < t.dur) {
      dur.hidden = false;
      const f = Math.max(0, s.d / t.dur);
      dur.firstChild.style.width = f * 100 + '%';
      dur.firstChild.style.background = `hsl(${f * 120}, 80%, 50%)`;
    } else dur.hidden = true;
    el.title = itemName(s.id);
  }
  buildHotbar() {
    const hb = $('hotbar');
    this.hot = [];
    for (let i = 0; i < 9; i++) {
      const el = this.slotEl(i);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.emit('select', i); });
      hb.appendChild(el); this.hot.push(el);
    }
  }
  buildGrids() {
    this.bagEls = []; this.hotEls = []; this.chestEls = [];
    const click = (el) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onSlot(+el.dataset.i); });
    for (let i = 9; i < 36; i++) { const el = this.slotEl(i); click(el); $('bag').appendChild(el); this.bagEls.push(el); }
    for (let i = 0; i < 9; i++) { const el = this.slotEl(i); click(el); $('hotbar-grid').appendChild(el); this.hotEls.push(el); }
    for (let i = 0; i < 27; i++) { const el = this.slotEl(100 + i); click(el); $('chest').appendChild(el); this.chestEls.push(el); }
  }
  getSlot(i) { return i >= 100 ? (this.chest && this.chest.slots[i - 100]) || null : this.inv[i]; }
  onSlot(i) {
    this.sound.click();
    if (this.pick === null) {
      if (this.getSlot(i)) this.pick = i;
    } else if (this.pick === i) this.pick = null;
    else {
      const half = this.split && !this.getSlot(i);
      this.emit('swap', this.pick, i, half);
      this.pick = null;
    }
    this.renderInv();
  }

  setInventory(inv) { this.inv = inv; this.renderHotbar(); if (!$('inv').hidden) { this.renderInv(); this.renderRecipes(); } }
  setSelected(i) {
    if (i !== this.sel) {
      this.sel = i;
      const s = this.inv[i];
      const hn = $('held-name');
      hn.textContent = s ? itemName(s.id) : '';
      hn.classList.add('on');
      clearTimeout(this._hn); this._hn = setTimeout(() => hn.classList.remove('on'), 1500);
    }
    this.renderHotbar();
  }
  renderHotbar() {
    for (let i = 0; i < 9; i++) { this.fillSlot(this.hot[i], this.inv[i]); this.hot[i].classList.toggle('sel', i === this.sel); }
  }
  renderInv() {
    for (let i = 9; i < 36; i++) { const el = this.bagEls[i - 9]; this.fillSlot(el, this.inv[i]); el.classList.toggle('pick', this.pick === i); }
    for (let i = 0; i < 9; i++) { const el = this.hotEls[i]; this.fillSlot(el, this.inv[i]); el.classList.toggle('pick', this.pick === i); el.classList.toggle('sel', i === this.sel); }
    if (this.chest) for (let i = 0; i < 27; i++) { const el = this.chestEls[i]; this.fillSlot(el, this.chest.slots[i]); el.classList.toggle('pick', this.pick === 100 + i); }
    const s = this.pick !== null ? this.getSlot(this.pick) : null;
    const t = s && toolOf(s.id);
    $('sel-info').textContent = s ? `${itemName(s.id)}${s.n > 1 ? ' ×' + s.n : ''}${t ? ` (내구도 ${s.d}/${t.dur})` : ''}` : '칸을 눌러 선택';
    $('b-eat').hidden = !(s && ITEMS[s.id] && ITEMS[s.id].food && this.pick < 100);
    $('b-trash').disabled = !s || this.pick >= 100;
  }

  // ---------- 조합 ----------
  buildCats() {
    const box = $('cats');
    for (const [k, name] of RECIPE_CATS) {
      const b = document.createElement('button');
      b.textContent = name; b.dataset.cat = k;
      b.addEventListener('click', () => { this.cat = k; this.sound.click(); this.renderRecipes(); });
      box.appendChild(b);
    }
  }
  setStation(st) {
    const ch = st.table !== this.station.table || st.furnace !== this.station.furnace;
    this.station = st;
    if (ch && !$('inv').hidden) this.renderRecipes();
  }
  renderRecipes() {
    for (const b of $('cats').children) b.classList.toggle('on', b.dataset.cat === this.cat);
    const st = this.station;
    $('station').innerHTML = `<span class="${st.table ? 'ok' : ''}">작업대 ${st.table ? '✓' : '✗'}</span> · <span class="${st.furnace ? 'ok' : ''}">화로 ${st.furnace ? '✓' : '✗'}</span>`;
    const list = RECIPES.filter((r) => r.cat === this.cat).map((r) => {
      const stOk = !r.st || st[r.st === 'table' ? 'table' : 'furnace'];
      return { r, ok: stOk && canCraft(this.inv, r), stOk };
    });
    list.sort((a, b) => b.ok - a.ok || a.r.i - b.r.i);
    const box = $('recipes');
    box.textContent = '';
    for (const { r, ok, stOk } of list) {
      const row = document.createElement('div');
      row.className = 'rec ' + (ok ? 'can' : 'no');
      const ing = r.ins.map(([spec, n]) => {
        const have = countOf(this.inv, spec);
        const name = typeof spec === 'string' ? TAG_NAMES[spec.slice(1)] : itemName(spec);
        const icon = typeof spec === 'string' ? this.tagIcon(spec) : this.icons.url(spec);
        return `<span class="${have >= n ? '' : 'miss'}" title="${name}"><img src="${icon}">${name} ${Math.min(have, 999)}/${n}</span>`;
      }).join('');
      const stLabel = r.st ? `<span class="st">${r.st === 'table' ? '작업대' : '화로'}${stOk ? '' : ' 필요'}</span>` : '';
      row.innerHTML = `<img src="${this.icons.url(r.out)}"><div><div class="nm">${itemName(r.out)}<small>×${r.n}</small> ${stLabel}</div><div class="ing">${ing}</div></div><div class="btns"><button data-n="1">만들기</button><button data-n="64">최대</button></div>`;
      for (const b of row.querySelectorAll('button')) {
        b.disabled = !ok;
        b.addEventListener('click', () => { this.sound.click(); this.emit('craft', r.i, +b.dataset.n); });
      }
      box.appendChild(row);
    }
  }
  tagIcon(spec) {
    const rep = { '#planks': 5, '#logs': 9, '#leaves': 10, '#wool': 115, '#fuel': 257 }[spec];
    return this.icons.url(rep);
  }

  openInventory(chest) {
    if (chest) this.chest = chest;
    $('chest-wrap').hidden = !this.chest;
    $('inv').hidden = false;
    this.pick = null; this.split = false; $('b-split').classList.remove('on');
    this.renderInv(); this.renderRecipes();
  }
  setChest(k, slots) {
    if (!this.chest || this.chest.k !== k) return;
    this.chest.slots = slots;
    this.renderInv();
  }
  closeInventory() {
    const had = this.chest;
    $('inv').hidden = true; this.pick = null; this.chest = null;
    if (had) this.emit('closeChest');
  }

  // ---------- HUD ----------
  setStats(hp, food, air) {
    const icons = (n, max, full, halfI, emptyI) => {
      let h = '';
      for (let i = 0; i < max / 2; i++) { const v = n - i * 2; h += `<img src="${v >= 2 ? full : v === 1 ? halfI : emptyI}">`; }
      return h;
    };
    const sig = `${hp}|${food}|${air}`;
    if (sig === this._stats) return;
    this._stats = sig;
    $('hearts').innerHTML = icons(hp, MAX_HP, ICONS.heart, ICONS.heartHalf, ICONS.heartEmpty);
    $('food').innerHTML = icons(food, MAX_FOOD, ICONS.food, ICONS.foodHalf, ICONS.foodEmpty);
    $('air').innerHTML = air < MAX_AIR ? Array.from({ length: Math.max(0, air) }, () => `<img src="${ICONS.bubble}">`).join('') : '';
  }
  setInfo(o) {
    $('i-time').textContent = o.time || '';
    $('i-online').textContent = o.online || '';
    $('i-role').textContent = o.role || '';
    $('i-zone').textContent = o.zone || '';
  }
  setDebug(text) { const d = $('debug'); d.hidden = !text; if (text) d.textContent = text; }
  toast(m, ms = 2200) {
    const t = $('toast'); t.textContent = m; t.classList.add('on');
    clearTimeout(this._t); this._t = setTimeout(() => t.classList.remove('on'), ms);
  }
  banner(title, sub = '', ms = 3500) {
    $('banner-t').textContent = title; $('banner-s').textContent = sub;
    const b = $('banner'); b.classList.add('on');
    clearTimeout(this._b); this._b = setTimeout(() => b.classList.remove('on'), ms);
  }
  chatLine(name, m, sys) {
    const log = $('chatlog'), d = document.createElement('div');
    if (sys) { d.className = 'sys'; d.textContent = m; }
    else { const b = document.createElement('b'); b.textContent = name; d.append(b, m); }
    log.appendChild(d);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => { if (!this.chatOpen) d.style.opacity = '0'; d.dataset.old = '1'; }, 12000);
  }
  hit() { const v = $('vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); setTimeout(() => v.classList.remove('hit'), 120); }
  setUnderwater(on) { $('water-tint').classList.toggle('on', on); }
  setHud(on) { $('hud').classList.toggle('hide', !on); $('crosshair').hidden = !on; }
  setCrosshair(on) { $('crosshair').hidden = !on; }

  // ---------- 채팅 ----------
  openChat(prefix = '') {
    this.chatOpen = true;
    $('chat-form').hidden = false;
    const inp = $('chat-in'); inp.value = prefix; inp.focus();
    for (const d of $('chatlog').children) d.style.opacity = '1';
  }
  closeChat() {
    this.chatOpen = false;
    $('chat-form').hidden = true; $('chat-in').blur();
    for (const d of $('chatlog').children) if (d.dataset.old) d.style.opacity = '0';
  }

  // ---------- 메뉴 ----------
  openMenu() { $('menu').hidden = false; this.renderGoals(); }
  closeMenu() { $('menu').hidden = true; }
  bindSettings(settings, apply) {
    const bindRange = (id, key, fmt) => {
      const el = $('s-' + id), lab = $('v-' + id);
      el.value = settings[key];
      lab.textContent = fmt(settings[key]);
      el.addEventListener('input', () => { settings[key] = +el.value; lab.textContent = fmt(settings[key]); apply(key); });
    };
    bindRange('dist', 'dist', (v) => `${v}청크`);
    bindRange('bright', 'bright', (v) => `${Math.round(v * 100)}%`);
    bindRange('sens', 'sens', (v) => `${v.toFixed(1)}`);
    bindRange('fov', 'fov', (v) => `${v}°`);
    bindRange('res', 'res', (v) => `${Math.round(v * 100)}%`);
    bindRange('vol', 'vol', (v) => `${Math.round(v * 100)}%`);
    for (const [id, key] of [['autojump', 'autoJump'], ['clouds', 'clouds'], ['bob', 'bob'], ['names', 'names'], ['invert', 'invert']]) {
      const el = $('s-' + id);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; apply(key); });
    }
    for (const b of $('menu-tabs').children) b.addEventListener('click', () => {
      for (const x of $('menu-tabs').children) x.classList.toggle('on', x === b);
      for (const t of document.querySelectorAll('#menu .tab')) t.hidden = t.dataset.tab !== b.dataset.tab;
      if (b.dataset.tab === 'goal') this.renderGoals();
    });
  }
  setProfile(name, skin) {
    $('s-name').value = name;
    this.skin = skin.slice();
    const box = $('skin-pick');
    box.textContent = '';
    const rows = [['피부', SKIN_TONES], ['머리', HAIR], ['옷', SHIRT], ['바지', PANTS]];
    rows.forEach(([label, cols], ri) => {
      const d = document.createElement('div');
      d.textContent = label + ' ';
      cols.forEach((c, ci) => {
        const s = document.createElement('span');
        s.className = 'sw' + (this.skin[ri] === ci ? ' on' : '');
        s.style.background = c;
        s.addEventListener('click', () => { this.skin[ri] = ci; this.emit('skin', this.skin.slice()); this.setProfile($('s-name').value, this.skin); });
        d.appendChild(s);
      });
      box.appendChild(d);
    });
    this.drawPreview();
  }
  drawPreview() {
    const c = $('skin-preview'), g = c.getContext('2d'), k = skinColors(this.skin);
    g.clearRect(0, 0, 96, 96);
    const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * 3, y * 3, w * 3, h * 3); };
    r(12, 0, 8, 8, k.skin); r(12, 0, 8, 2, k.hair); r(13, 4, 1, 1, '#fff'); r(14, 4, 1, 1, '#3b5bdb'); r(17, 4, 1, 1, '#3b5bdb'); r(18, 4, 1, 1, '#fff');
    r(12, 8, 8, 12, k.shirt); r(8, 8, 4, 4, k.shirt); r(20, 8, 4, 4, k.shirt); r(8, 12, 4, 8, k.skin); r(20, 12, 4, 8, k.skin);
    r(12, 20, 4, 10, k.pants); r(16, 20, 4, 10, k.pants); r(12, 30, 4, 2, '#3a3a3a'); r(16, 30, 4, 2, '#3a3a3a');
  }
  setGoals(list) { this.goals = list; this.renderGoals(); }
  renderGoals() {
    const box = $('goals');
    if (!box) return;
    const done = this.goals.filter((g) => g.done).length;
    box.innerHTML = `<p>${done} / ${this.goals.length} 달성</p>` + this.goals.map((g) => `<div class="g ${g.done ? 'done' : ''}"><i>${g.done ? '✅' : g.icon}</i><div>${g.name}<small>${g.desc}</small></div></div>`).join('');
  }

  // ---------- 사망 / 표지판 / 로딩 ----------
  showDeath(reason) { $('death-reason').textContent = reason || ''; $('death').hidden = false; }
  hideDeath() { $('death').hidden = true; }
  openSign(text, done) {
    const ins = [...document.querySelectorAll('#sign .sl')];
    const lines = (text || '').split('\n');
    ins.forEach((el, i) => { el.value = lines[i] || ''; });
    $('sign').hidden = false;
    setTimeout(() => ins[0].focus(), 50);
    this._signDone = (ok) => {
      $('sign').hidden = true;
      if (ok) done(ins.map((el) => el.value).join('\n').replace(/\n+$/, ''));
    };
  }
  loading(msg, frac, retry) {
    $('loading').classList.remove('hide');
    if (msg !== undefined) $('load-msg').textContent = msg;
    if (frac !== undefined) $('load-bar').style.width = Math.round(frac * 100) + '%';
    $('b-retry').hidden = !retry;
  }
  hideLoading() { $('loading').classList.add('hide'); }

  bindButtons() {
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.sound.click(); fn(); });
    click('b-close', () => this.closeInventory());
    click('b-trash', () => { if (this.pick !== null && this.pick < 100) { this.emit('trash', this.pick); this.pick = null; this.renderInv(); } });
    click('b-eat', () => { if (this.pick !== null) { this.emit('eat', this.pick); } });
    click('b-split', () => { this.split = !this.split; $('b-split').classList.toggle('on', this.split); this.toast(this.split ? '빈 칸을 누르면 절반만 옮겨요' : '전부 옮겨요', 1200); });
    click('b-resume', () => this.closeMenu());
    click('b-respawn', () => this.emit('respawn'));
    click('b-sign-ok', () => this._signDone && this._signDone(true));
    click('b-sign-cancel', () => this._signDone && this._signDone(false));
    click('b-name', () => this.emit('name', $('s-name').value.trim()));
    click('b-spawn', () => { this.emit('chat', '/spawn'); this.closeMenu(); });
    click('b-full', () => {
      const d = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen?.();
      else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d);
    });
    click('b-retry', () => this.emit('retry'));
    $('inv').addEventListener('pointerdown', (e) => { if (e.target === $('inv')) this.closeInventory(); });
    $('menu').addEventListener('pointerdown', (e) => { if (e.target === $('menu')) this.closeMenu(); });
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $('chat-in').value.trim();
      if (t) this.emit('chat', t);
      this.closeChat();
    });
    $('chat-in').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); } e.stopPropagation(); });
    for (const el of document.querySelectorAll('#sign .sl')) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this._signDone && this._signDone(true); });
    $('s-name').addEventListener('keydown', (e) => e.stopPropagation());
  }
}

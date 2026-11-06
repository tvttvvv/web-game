// 화면 UI (DOM)
import { CLASSES, SKILLS, MONSTERS, RARITY, GEAR, STACK, STAT_NAMES, PCT_STATS, NPCS, SHOPS, QUESTS, QUEST_BY_ID } from '../shared/data.js';
import { EQUIP_SLOTS, EQUIP_NAMES, INV_SIZE } from '../shared/constants.js';
import { itemStats, itemName, itemValue, buyPrice, enhanceInfo, canEquip, countStack, xpToNext } from '../shared/rules.js';
import { ZONE_INFO, WAYPOINTS, ARENAS, CAMPS, NPC_POS, ROADS, LAKE, LAVA, heightAt, zoneAt } from '../shared/world.js';
import { WORLD_R } from '../shared/constants.js';
import { SKIN, HAIR, OUTFIT } from './models.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WEAPON_ICON = { warrior: '🗡️', archer: '🏹', mage: '🪄', cleric: '🔨' };
const SLOT_ICON = { helm: '⛑️', armor: '🛡️', boots: '👢', ring: '💍' };
export function itemIcon(it) {
  if (!it) return '';
  if (STACK[it.k]) return STACK[it.k].icon;
  const g = GEAR[it.k];
  return g ? (g.slot === 'weapon' ? WEAPON_ICON[g.cls] : SLOT_ICON[g.slot]) : '❔';
}
export const itemColor = (it) => (it && GEAR[it.k] ? RARITY[it.r || 0].color : '#e6e6e6');
const fmtStat = (s, v) => (PCT_STATS.has(s) ? `${v}%` : v);

export class UI {
  constructor(sound) {
    this.sound = sound;
    this.cb = {};
    this.ch = null; this.st = null;
    this.sel = null;
    this.npc = null;
    this.near = {};
    this.labels = new Map();
    this.mapImg = null;
    this.openPanel = null;
    this.bind();
  }
  on(n, f) { this.cb[n] = f; }
  emit(n, ...a) { if (this.cb[n]) this.cb[n](...a); }
  get anyOpen() { return !!this.openPanel || !$('chat-form').hidden; }

  // ---------- 공통 ----------
  show(id) { this.closeAll(); $(id).hidden = false; this.openPanel = id; this.sound.click(); }
  closeAll() {
    for (const id of ['inv', 'quest', 'dialog', 'shop', 'enh', 'map', 'menu']) $(id).hidden = true;
    this.openPanel = null;
  }
  toast(m, ms = 2400) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(this._t); this._t = setTimeout(() => t.classList.remove('on'), ms); }
  banner(a, b = '', ms = 3200) { $('banner-a').textContent = a; $('banner-b').textContent = b; const el = $('banner'); el.classList.add('on'); clearTimeout(this._b); this._b = setTimeout(() => el.classList.remove('on'), ms); }
  loading(msg, frac, retry) { $('loading').classList.remove('hide'); if (msg !== undefined) $('load-msg').textContent = msg; if (frac !== undefined) $('load-bar').style.width = Math.round(frac * 100) + '%'; $('b-retry').hidden = !retry; }
  hideLoading() { $('loading').classList.add('hide'); }
  chatLine(name, m, cls = '') {
    const log = $('chatlog'), d = document.createElement('div');
    d.className = cls;
    if (name) { const b = document.createElement('b'); b.textContent = name; d.append(b, ' ', m); } else d.textContent = m;
    log.appendChild(d);
    while (log.children.length > 7) log.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 14000);
  }

  // ---------- 캐릭터 만들기 ----------
  showCreate(defName, done) {
    $('create').hidden = false;
    const look = [0, 0, 0, 0];
    let cls = 'warrior';
    const cards = $('cls-cards');
    cards.innerHTML = Object.entries(CLASSES).map(([k, c]) => {
      const bar = (v, max) => `<i style="width:${Math.min(100, (v / max) * 100)}%"></i>`;
      return `<div class="card" data-k="${k}" style="--c:${c.color}"><div class="ci">${c.icon}</div><b>${c.name}</b><p>${c.desc}</p>
        <div class="bars"><span>체력</span><em>${bar(c.base.hp, 130)}</em><span>공격</span><em>${bar(c.base.atk, 15)}</em><span>사거리</span><em>${bar(c.range, 15)}</em></div>
        <div class="sk">${c.skills.map((s) => SKILLS[s].icon).join(' ')}</div></div>`;
    }).join('');
    const pick = (k) => { cls = k; for (const el of cards.children) el.classList.toggle('on', el.dataset.k === k); this.sound.click(); };
    for (const el of cards.children) el.addEventListener('click', () => pick(el.dataset.k));
    pick('warrior');
    const sw = $('look-pick');
    const rows = [['피부', SKIN], ['머리', HAIR], ['옷', OUTFIT]];
    const draw = () => {
      sw.innerHTML = rows.map(([n, cols], r) => `<div><span>${n}</span>${cols.map((c, i) => `<i data-r="${r}" data-i="${i}" class="${look[r] === i ? 'on' : ''}" style="background:${c}"></i>`).join('')}</div>`).join('');
      for (const el of sw.querySelectorAll('i')) el.addEventListener('click', () => { look[+el.dataset.r] = +el.dataset.i; draw(); this.sound.click(); });
    };
    look[0] = Math.floor(Math.random() * 3); look[1] = Math.floor(Math.random() * 8); look[2] = Math.floor(Math.random() * 8);
    draw();
    $('c-name').value = defName;
    $('c-name').onkeydown = (e) => { if (e.key === 'Enter') $('b-start').click(); };
    $('b-start').onclick = () => {
      const n = $('c-name').value.trim();
      if (!n) { $('c-name').focus(); return; }
      $('create').hidden = true;
      done(cls, n, look);
    };
  }

  // ---------- HUD ----------
  setCharacter(ch, st) {
    this.ch = ch; this.st = st || this.st;
    const C = CLASSES[ch.cls];
    $('p-icon').textContent = C.icon; $('p-icon').style.background = C.color;
    $('p-name').textContent = ch.name; $('p-lv').textContent = `Lv ${ch.lv}`;
    $('p-title').textContent = ch.title || C.name;
    $('gold').textContent = ch.gold.toLocaleString();
    const need = xpToNext(ch.lv);
    $('xp-fill').style.width = (ch.lv >= 30 ? 100 : Math.min(100, (ch.xp / need) * 100)) + '%';
    $('xp-text').textContent = ch.lv >= 30 ? '최고 레벨' : `${ch.xp.toLocaleString()} / ${need.toLocaleString()}`;
    const C2 = CLASSES[ch.cls];
    C2.skills.forEach((k, i) => {
      const S = SKILLS[k], el = $('s' + i);
      el.querySelector('.ic').textContent = S.icon;
      el.classList.toggle('lock', ch.lv < S.lv);
      el.querySelector('.lv').textContent = ch.lv < S.lv ? `Lv${S.lv}` : '';
      el.title = `${S.name} (마나 ${S.mp}) — ${S.desc}`;
    });
    $('b-atk').querySelector('.ic').textContent = C.icon;
    const hp = countStack(ch.inv, 'hp1') + countStack(ch.inv, 'hp2') + countStack(ch.inv, 'hp3');
    const mp = countStack(ch.inv, 'mp1') + countStack(ch.inv, 'mp2') + countStack(ch.inv, 'mp3');
    $('hp-n').textContent = hp; $('mp-n').textContent = mp;
    if (this.openPanel === 'inv') this.renderInv();
    if (this.openPanel === 'quest') this.renderQuests();
    if (this.openPanel === 'shop') this.renderShop();
    if (this.openPanel === 'enh') this.renderEnh();
    if (this.openPanel === 'dialog' && this.npc) this.renderDialog();
    this.renderTracker();
  }
  setVitals(hp, mp, maxHp, maxMp) {
    $('hp-fill').style.width = Math.max(0, Math.min(100, (hp / maxHp) * 100)) + '%';
    $('mp-fill').style.width = Math.max(0, Math.min(100, (mp / maxMp) * 100)) + '%';
    $('hp-text').textContent = `${Math.max(0, Math.round(hp))} / ${maxHp}`;
    $('mp-text').textContent = `${Math.round(mp)} / ${maxMp}`;
    $('hp-low').classList.toggle('on', hp > 0 && hp / maxHp < 0.25);
  }
  setCooldowns(cds, mp) {
    if (!this.ch) return;
    const now = Date.now();
    CLASSES[this.ch.cls].skills.forEach((k, i) => {
      const el = $('s' + i), rem = Math.max(0, (cds[k] || 0) - now), S = SKILLS[k];
      const cdEl = el.querySelector('.cd');
      cdEl.style.height = rem > 0 ? (rem / (S.cd * 1000)) * 100 + '%' : '0';
      cdEl.textContent = rem > 0 ? Math.ceil(rem / 1000) : '';
      el.classList.toggle('nomp', mp < S.mp);
    });
    const d = $('b-dodge').querySelector('.cd'), dr = Math.max(0, (cds.dodge || 0) - now);
    d.style.height = dr > 0 ? (dr / 2500) * 100 + '%' : '0';
  }
  setTarget(t) {
    const el = $('tframe');
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    $('t-name').textContent = t.name; $('t-lv').textContent = `Lv ${t.lv}`;
    $('t-fill').style.width = t.hp + '%';
    el.classList.toggle('boss', !!t.boss);
  }
  setParty(list, myId) {
    const box = $('party');
    const others = (list || []).filter((m) => m[0] !== myId);
    const key = others.map((m) => [m[0], m[1], m[2], m[3], m[7]].join(':')).join('|');
    if (key !== this.partyKey) {
      this.partyKey = key;
      box.innerHTML = others.length ? others.map((m) => `<div class="pm ${m[7] ? 'down' : ''}"><span style="background:${CLASSES[m[2]].color}">${CLASSES[m[2]].icon}</span><b>${esc(m[1])}</b><em>Lv${m[3]}</em><i><u></u></i></div>`).join('') + '<button id="b-pleave">파티 나가기</button>' : '';
      if (others.length) $('b-pleave').onclick = () => { this.sound.click(); this.emit('pleave'); };
    }
    const bars = box.querySelectorAll('.pm u');
    others.forEach((m, i) => { if (bars[i]) bars[i].style.width = m[4] + '%'; });
  }
  feed(html) {
    const box = $('feed'), d = document.createElement('div');
    d.innerHTML = html;
    box.appendChild(d);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 3800);
    setTimeout(() => d.remove(), 4600);
  }
  setBuffs(bf) {
    $('buffs').innerHTML = (bf || []).map(([k, s]) => `<span title="${SKILLS[k] ? SKILLS[k].name : ''}">${SKILLS[k] ? SKILLS[k].icon : '✨'}<small>${Math.ceil(s)}</small></span>`).join('');
  }
  setAct(label) { const b = $('b-act'); b.hidden = !label; if (label) b.querySelector('small').textContent = label; }
  setZone(x, z) {
    const zn = zoneAt(x, z), info = ZONE_INFO[zn];
    if (zn !== this.zone) { this.zone = zn; $('zone').textContent = `${info.name}`; $('zone-lv').textContent = info.lv; if (this.ch) this.banner(info.name, info.lv, 2200); }
  }
  setOnline(n) { $('online').textContent = `👥 ${n}`; }

  renderTracker() {
    if (!this.ch) return;
    const act = this.ch.quests.active;
    const rows = [];
    for (const qid in act) {
      const Q = QUEST_BY_ID[qid]; if (!Q) continue;
      rows.push(`<div><b>${esc(Q.name)}</b><span>${this.progressText(Q)}</span></div>`);
    }
    const b = this.ch.bounty;
    if (b) rows.push(`<div><b>현상금: ${MONSTERS[b.mob].name}</b><span>${b.n}/${b.need}${b.n >= b.need ? ' ✔ 게시판으로' : ''}</span></div>`);
    if (!rows.length) { const next = this.nextQuest(); if (next) rows.push(`<div><b>! ${esc(next.name)}</b><span>${NPCS[next.npc].name}에게 받기</span></div>`); }
    $('tracker').innerHTML = rows.slice(0, 4).join('');
  }
  progressText(Q) {
    const a = this.ch.quests.active[Q.id];
    const o = Q.obj;
    if (o.type === 'talk') return `${NPCS[o.npc].name}에게 말 걸기`;
    if (o.type === 'collect') { const n = countStack(this.ch.inv, o.item); return `${STACK[o.item].name} ${Math.min(n, o.n)}/${o.n}${n >= o.n ? ' ✔' : ''}`; }
    if (o.type === 'boss') return `${MONSTERS[o.mob].name} 처치${a.n >= 1 ? ' ✔' : ''}`;
    return `${MONSTERS[o.mob].name} ${Math.min(a.n, o.n)}/${o.n}${a.n >= o.n ? ' ✔' : ''}`;
  }
  questState(Q) {
    const qs = this.ch.quests;
    if (qs.done.includes(Q.id)) return 'done';
    if (qs.active[Q.id]) {
      const a = qs.active[Q.id], o = Q.obj;
      const ready = o.type === 'collect' ? countStack(this.ch.inv, o.item) >= o.n : o.type === 'talk' ? false : a.n >= (o.n || 1);
      return ready ? 'ready' : 'active';
    }
    if (Q.pre && !qs.done.includes(Q.pre)) return 'locked';
    return this.ch.lv >= Q.lv ? 'avail' : 'lowlv';
  }
  nextQuest() { return QUESTS.find((Q) => ['avail', 'lowlv'].includes(this.questState(Q))); }
  // NPC 머리 위 표시: '!' 받을 퀘스트, '?' 완료 가능
  npcMark(key) {
    if (!this.ch) return '';
    let m = '';
    for (const Q of QUESTS) {
      const s = this.questState(Q);
      if ((s === 'ready' && Q.npc === key) || (s === 'active' && Q.obj.type === 'talk' && Q.obj.npc === key)) return '?';
      if (s === 'avail' && Q.npc === key) m = '!';
    }
    if (key === 'board' && this.ch.bounty && this.ch.bounty.n >= this.ch.bounty.need) return '?';
    return m;
  }

  // ---------- 이름표/체력바 ----------
  label(id, sx, sy, html, cls) {
    let el = this.labels.get(id);
    if (!el) { el = document.createElement('div'); el.className = 'lbl'; $('labels').appendChild(el); this.labels.set(id, el); el._h = ''; }
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    if (el._c !== cls) { el.className = 'lbl ' + cls; el._c = cls; }
    el.style.transform = `translate(${sx | 0}px, ${sy | 0}px) translate(-50%, -100%)`;
    el._seen = true;
  }
  labelsEnd() { for (const [id, el] of this.labels) { if (!el._seen) { el.remove(); this.labels.delete(id); } else el._seen = false; } }

  // ---------- 가방 / 장비 ----------
  slotHtml(it, extra = '') {
    if (!it) return `<div class="slot ${extra}"></div>`;
    return `<div class="slot ${extra}" style="--rc:${itemColor(it)}"><span>${itemIcon(it)}</span>${it.n > 1 ? `<em>${it.n}</em>` : ''}${it.en ? `<i>+${it.en}</i>` : ''}</div>`;
  }
  renderInv() {
    const ch = this.ch, st = this.st;
    if (!ch) return;
    $('eq').innerHTML = EQUIP_SLOTS.map((s) => `<div class="eqs" data-eq="${s}"><small>${EQUIP_NAMES[s]}</small>${this.slotHtml(ch.equip[s], this.sel && this.sel.eq === s ? 'sel' : '')}</div>`).join('');
    $('stats').innerHTML = st ? [
      ['레벨', `${ch.lv} (${CLASSES[ch.cls].name})`], ['체력', st.maxHp], ['마나', st.maxMp], ['공격력', st.atk], ['방어력', st.def],
      ['치명타', `${st.crit}%`], ['치명타 피해', `${Math.round(st.critdmg * 100)}%`], ['공격 간격', `${st.aspd.toFixed(2)}초`], ['이동 속도', st.spd.toFixed(1)],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('') + `<div><span>골드</span><b>💰 ${ch.gold.toLocaleString()}</b></div>` : '';
    $('bag').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, this.sel && this.sel.i === i ? 'sel' : '').replace('class="slot', `data-i="${i}" class="slot`)).join('');
    for (const el of $('bag').children) el.onclick = () => { this.sel = { i: +el.dataset.i }; this.sound.click(); this.renderInv(); };
    for (const el of $('eq').children) el.onclick = () => { this.sel = { eq: el.dataset.eq }; this.sound.click(); this.renderInv(); };
    this.renderDetail();
  }
  itemDetail(it, cmp) {
    if (!it) return '';
    const g = GEAR[it.k];
    let h = `<b style="color:${itemColor(it)}">${itemIcon(it)} ${esc(itemName(it))}</b>`;
    if (g) {
      h += `<small>${RARITY[it.r || 0].name} · ${EQUIP_NAMES[g.slot]}${g.cls ? ` (${CLASSES[g.cls].name})` : ''} · 아이템 레벨 ${it.lv}</small>`;
      const s = itemStats(it), c = cmp ? itemStats(cmp) : null;
      h += '<ul>' + Object.entries(s).map(([k, v]) => {
        const d = c ? Math.round((v - (c[k] || 0)) * 10) / 10 : 0;
        return `<li>${STAT_NAMES[k]} <b>+${fmtStat(k, v)}</b>${c && d ? ` <em class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${fmtStat(k, Math.abs(d))}</em>` : ''}</li>`;
      }).join('') + '</ul>';
    } else if (STACK[it.k]) h += `<small>${STACK[it.k].desc}</small>`;
    h += `<small>판매가 ${itemValue(it) * (it.n || 1)} 골드</small>`;
    return h;
  }
  renderDetail() {
    const box = $('detail'), ch = this.ch;
    const it = this.sel ? (this.sel.eq ? ch.equip[this.sel.eq] : ch.inv[this.sel.i]) : null;
    if (!it) { box.innerHTML = '<p class="hint">아이템을 누르면 자세히 볼 수 있어요</p>'; return; }
    const g = GEAR[it.k];
    const cmp = g && !this.sel.eq ? ch.equip[g.slot] : null;
    let btn = '';
    if (this.sel.eq) { if (this.sel.eq !== 'weapon') btn += '<button data-a="unequip">벗기</button>'; }
    else {
      if (g) { const why = canEquip(ch, it); btn += why ? `<p class="hint">${why}</p>` : '<button data-a="equip" class="primary">장착</button>'; }
      if (STACK[it.k] && (STACK[it.k].heal || STACK[it.k].mana || it.k === 'scroll')) btn += '<button data-a="use" class="primary">사용</button>';
      if (this.near.shop) btn += `<button data-a="sell">판매 (+${itemValue(it) * (it.n || 1)})</button>`;
      btn += '<button data-a="trash">버리기</button>';
    }
    if (g && this.near.smith) btn += '<button data-a="enh">강화</button>';
    box.innerHTML = this.itemDetail(it, cmp) + `<div class="btns">${btn}</div>`;
    for (const b of box.querySelectorAll('button')) b.onclick = () => {
      const a = b.dataset.a;
      this.sound.click();
      if (a === 'trash' && !confirm(`${itemName(it)}을(를) 버릴까요?`)) return;
      if (a === 'enh') { this.openEnh(this.sel); return; }
      this.emit('item', a, this.sel);
      if (a !== 'use') this.sel = null;
    };
  }

  // ---------- 퀘스트 ----------
  renderQuests() {
    const ch = this.ch;
    let h = '<h3>진행 중</h3>';
    const act = Object.keys(ch.quests.active);
    h += act.length ? act.map((qid) => { const Q = QUEST_BY_ID[qid]; return Q ? `<div class="q"><b>${esc(Q.name)}</b><p>${esc(Q.text)}</p><span>${this.progressText(Q)} · 보고: ${NPCS[Q.obj.type === 'talk' ? Q.obj.npc : Q.npc].name}</span></div>` : ''; }).join('') : '<p class="hint">진행 중인 퀘스트가 없어요</p>';
    if (ch.bounty) h += `<div class="q"><b>현상금: ${MONSTERS[ch.bounty.mob].name}</b><span>${ch.bounty.n}/${ch.bounty.need} · 보고: 현상금 게시판</span></div>`;
    const next = QUESTS.filter((Q) => ['avail', 'lowlv'].includes(this.questState(Q)));
    h += '<h3>받을 수 있는 퀘스트</h3>' + (next.length ? next.map((Q) => `<div class="q ${this.questState(Q)}"><b>${esc(Q.name)}</b><span>${NPCS[Q.npc].name} · Lv ${Q.lv}${this.questState(Q) === 'lowlv' ? ' (레벨 부족)' : ''}</span></div>`).join('') : '<p class="hint">새 퀘스트가 없어요. 레벨을 올려 보세요!</p>');
    h += `<p class="hint">완료한 퀘스트 ${ch.quests.done.length} / ${QUESTS.length}</p>`;
    $('quest-body').innerHTML = h;
  }

  // ---------- NPC 대화 ----------
  openDialog(key) { this.npc = key; this.show('dialog'); this.emit('talk', key); this.renderDialog(); }
  renderDialog() {
    const key = this.npc, N = NPCS[key], ch = this.ch;
    $('d-face').textContent = N.name[0]; $('d-face').style.background = N.color;
    $('d-name').textContent = N.name; $('d-title').textContent = N.title;
    $('d-text').textContent = N.hi[Math.floor(Date.now() / 60000) % N.hi.length];
    let h = '';
    for (const Q of QUESTS) {
      const s = this.questState(Q);
      const turnIn = Q.obj.type === 'talk' ? Q.obj.npc : Q.npc;
      if (Q.npc === key && s === 'avail') h += `<div class="dq"><b>! ${esc(Q.name)}</b><p>${esc(Q.text)}</p><small>보상: 경험치 ${Q.reward.xp} · ${Q.reward.gold || 0} 골드${Q.reward.gear ? ' · 장비' : ''}${Q.reward.items ? ' · 아이템' : ''}</small><button data-q="${Q.id}" data-a="qaccept" class="primary">수락</button></div>`;
      else if (turnIn === key && (s === 'ready' || (s === 'active' && Q.obj.type === 'talk'))) h += `<div class="dq"><b>? ${esc(Q.name)}</b><p>잘 해냈군! 보상을 받게.</p><button data-q="${Q.id}" data-a="qdone" class="primary">완료</button></div>`;
      else if (Q.npc === key && s === 'active') h += `<div class="dq dim"><b>${esc(Q.name)}</b><small>${this.progressText(Q)}</small></div>`;
      else if (Q.npc === key && s === 'lowlv') h += `<div class="dq dim"><b>${esc(Q.name)}</b><small>레벨 ${Q.lv}이 되면 받을 수 있어요</small></div>`;
    }
    if (N.board) {
      const b = ch.bounty;
      if (!b) h += '<div class="dq"><b>현상금 의뢰</b><p>레벨에 맞는 몬스터 10마리를 처치하면 골드와 경험치를 드립니다.</p><button data-a="btake" class="primary">의뢰 받기</button></div>';
      else h += `<div class="dq"><b>현상금: ${MONSTERS[b.mob].name}</b><small>${b.n}/${b.need}</small>${b.n >= b.need ? '<button data-a="bdone" class="primary">보상 받기</button>' : '<button data-a="bdrop">포기</button>'}</div>`;
    }
    const btns = [];
    if (N.shop) btns.push('<button data-a="shop">🛒 상점</button>');
    if (N.enhance) btns.push('<button data-a="enhance">🔨 강화</button>');
    if (N.heal) btns.push('<button data-a="rest">🛏️ 휴식 (무료)</button>');
    $('d-body').innerHTML = h + (btns.length ? `<div class="btns">${btns.join('')}</div>` : '');
    for (const b of $('d-body').querySelectorAll('button')) b.onclick = () => {
      const a = b.dataset.a;
      this.sound.click();
      if (a === 'shop') return this.openShop(key);
      if (a === 'enhance') return this.openEnh(null);
      if (a === 'qaccept' || a === 'qdone') return this.emit('quest', a, b.dataset.q);
      if (a === 'btake') return this.emit('bounty', 'take');
      if (a === 'bdone') return this.emit('bounty', 'done');
      if (a === 'bdrop') return this.emit('bounty', 'drop');
      if (a === 'rest') return this.emit('rest');
    };
  }

  // ---------- 상점 ----------
  openShop(key) { this.shopNpc = key; this.show('shop'); this.renderShop(); }
  renderShop() {
    const N = NPCS[this.shopNpc], list = SHOPS[N.shop], ch = this.ch;
    $('shop-title').textContent = `${N.name}의 상점`;
    $('shop-gold').textContent = `💰 ${ch.gold.toLocaleString()}`;
    $('shop-list').innerHTML = list.map((e) => {
      const k = e.replace('@', ''), price = buyPrice(k), g = GEAR[k];
      const it = g ? { k, r: 0, lv: 0, en: 0, b: [] } : { k, n: 1 };
      const desc = g ? Object.entries(itemStats({ ...it, lv: 0 })).map(([s, v]) => `${STAT_NAMES[s]} +${fmtStat(s, v)}`).join(' · ') + (g.cls ? ` · ${CLASSES[g.cls].name}` : '') : STACK[k].desc;
      return `<div class="si ${g && g.cls && g.cls !== ch.cls ? 'dim' : ''}"><span class="ic">${itemIcon(it)}</span><div><b>${itemName(it)}</b><small>${desc}</small></div><em>${price}G</em><button data-k="${k}" data-n="1" ${ch.gold < price ? 'disabled' : ''}>구매</button>${g ? '' : `<button data-k="${k}" data-n="5" ${ch.gold < price * 5 ? 'disabled' : ''}>×5</button>`}</div>`;
    }).join('');
    for (const b of $('shop-list').querySelectorAll('button')) b.onclick = () => { this.sound.click(); this.emit('buy', this.shopNpc, b.dataset.k, +b.dataset.n); };
  }

  // ---------- 강화 ----------
  openEnh(sel) { this.enhSel = sel; this.show('enh'); this.renderEnh(); }
  renderEnh() {
    const ch = this.ch;
    const list = [...EQUIP_SLOTS.filter((s) => ch.equip[s]).map((s) => ({ eq: s })), ...ch.inv.map((it, i) => (it && GEAR[it.k] ? { i } : null)).filter(Boolean)];
    const get = (s) => (s.eq ? ch.equip[s.eq] : ch.inv[s.i]);
    if (!this.enhSel || !get(this.enhSel)) this.enhSel = list[0] || null;
    $('enh-list').innerHTML = list.map((s) => this.slotHtml(get(s), this.enhSel && this.enhSel.eq === s.eq && this.enhSel.i === s.i ? 'sel' : '').replace('class="slot', `data-s='${JSON.stringify(s)}' class="slot`)).join('');
    for (const el of $('enh-list').children) el.onclick = () => { this.enhSel = JSON.parse(el.dataset.s); this.sound.click(); this.renderEnh(); };
    const it = this.enhSel && get(this.enhSel);
    const info = enhanceInfo(it);
    const stones = countStack(ch.inv, 'stone');
    if (!it) { $('enh-info').innerHTML = '<p class="hint">강화할 장비가 없어요</p>'; return; }
    const next = info ? itemStats({ ...it, en: (it.en || 0) + 1 }) : null;
    $('enh-info').innerHTML = this.itemDetail(it) + (info ? `<div class="enh-next">+${(it.en || 0) + 1} 성공 시: ${Object.entries(next).map(([s, v]) => `${STAT_NAMES[s]} ${fmtStat(s, v)}`).join(' · ')}</div>
      <div class="enh-cost">성공 확률 <b>${Math.round(info.chance * 100)}%</b> · 비용 <b>${info.gold.toLocaleString()} 골드</b> · 강화석 <b>${info.stones}</b>개 (보유 ${stones})</div>
      <p class="hint">실패해도 장비는 부서지지 않아요. 강화석은 몬스터에게서 얻거나 대장장이에게 살 수 있어요.</p>
      <button id="b-enh" class="primary" ${ch.gold < info.gold || stones < info.stones ? 'disabled' : ''}>강화하기</button>` : '<p class="hint">최대 강화(+10)예요</p>');
    const b = $('b-enh');
    if (b) b.onclick = () => { this.sound.click(); this.emit('enhance', this.enhSel); };
  }

  // ---------- 지도 ----------
  buildMapImage() {
    const S = 300, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const col = { town: [150, 170, 120], field: [110, 175, 85], lake: [110, 170, 100], forest: [55, 120, 60], canyon: [180, 115, 75], waste: [80, 62, 60], sea: [60, 120, 200] };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i / S) * 2 * WORLD_R - WORLD_R, z = (j / S) * 2 * WORLD_R - WORLD_R;
      const h = heightAt(x, z);
      let c3 = h < 0 ? [60, 120, 200] : col[zoneAt(x, z)];
      if (h > 0) c3 = c3.map((v) => Math.min(255, v * (0.85 + Math.min(h, 12) * 0.025)));
      const k = (j * S + i) * 4;
      img.data[k] = c3[0]; img.data[k + 1] = c3[1]; img.data[k + 2] = c3[2]; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(230,200,140,0.85)'; g.lineWidth = 2;
    const P = (x) => ((x + WORLD_R) / (2 * WORLD_R)) * S;
    for (const r of ROADS) { g.beginPath(); r.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke(); }
    for (const l of LAVA) { g.fillStyle = '#ff5a1f'; g.beginPath(); g.arc(P(l.x), P(l.z), (l.r / (2 * WORLD_R)) * S, 0, 7); g.fill(); }
    this.mapImg = c;
  }
  drawMap(canvas, cx, cz, span, markers) {
    if (!this.mapImg) this.buildMapImage();
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const S = this.mapImg.width, k = S / (2 * WORLD_R);
    g.fillStyle = '#3c78c8'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapImg, (cx - span / 2 + WORLD_R) * k, (cz - span / 2 + WORLD_R) * k, span * k, span * k, 0, 0, W, H);
    const P = (x, z) => [((x - cx) / span + 0.5) * W, ((z - cz) / span + 0.5) * H];
    for (const m of markers) {
      const [x, y] = P(m.x, m.z);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      if (m.icon) {
        g.font = `bold ${m.size || 14}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(m.icon, x, y);
        g.fillStyle = m.c || '#ffffff'; g.fillText(m.icon, x, y); continue;
      }
      g.fillStyle = m.c; g.beginPath(); g.arc(x, y, m.r || 3, 0, 7); g.fill();
      if (m.me) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(m.ry) * 10, y - Math.cos(m.ry) * 10); g.stroke(); }
    }
  }
  openMap(nearStone) { this.show('map'); this.nearStone = nearStone; this.renderMapList(); }
  renderMapList() {
    const ch = this.ch;
    $('map-tp').innerHTML = this.nearStone ? '<b>순간이동</b>' + Object.entries(WAYPOINTS).map(([k, w]) => `<button data-wp="${k}" ${ch.wps.includes(k) ? '' : 'disabled'}>${ch.wps.includes(k) ? '' : '🔒 '}${w.name}</button>`).join('') : '<p class="hint">이동의 돌 근처에서 순간이동할 수 있어요. 새 야영지의 돌에 가까이 가면 등록돼요.</p>';
    for (const b of $('map-tp').querySelectorAll('button')) b.onclick = () => { this.emit('tp', b.dataset.wp); this.closeAll(); };
  }

  // ---------- 그 밖의 창 ----------
  showDeath(by) { $('death').hidden = false; $('death-by').textContent = by ? `${by}에게 당했어요` : ''; }
  hideDeath() { $('death').hidden = true; }
  setDeathTimer(s) { $('death-t').textContent = `${Math.max(0, Math.ceil(s))}초 뒤 마을에서 깨어나요`; }
  invite(from, name) {
    const el = $('invite');
    $('inv-name').textContent = name; el.hidden = false;
    $('b-inv-ok').onclick = () => { el.hidden = true; this.emit('paccept', from); };
    $('b-inv-no').onclick = () => { el.hidden = true; };
    setTimeout(() => { el.hidden = true; }, 20000);
  }
  playerMenu(id, name, info) {
    const el = $('ctx');
    $('ctx-name').textContent = `${name} · ${info}`;
    el.hidden = false;
    $('b-ctx-party').onclick = () => { el.hidden = true; this.emit('pinvite', id); };
    $('b-ctx-close').onclick = () => { el.hidden = true; };
  }
  openChat() { $('chat-form').hidden = false; $('chat-in').focus(); for (const d of $('chatlog').children) d.classList.remove('old'); }
  closeChat() { $('chat-form').hidden = true; $('chat-in').value = ''; $('chat-in').blur(); }

  bindSettings(s, apply) {
    const range = (id, key, fmt) => {
      const el = $('s-' + id), lab = $('v-' + id);
      const sync = () => { el.value = s[key]; lab.textContent = fmt(s[key]); };
      sync();
      el.oninput = () => { s[key] = +el.value; lab.textContent = fmt(s[key]); apply(key); };
    };
    range('dist', 'dist', (v) => `${v}m`); range('res', 'res', (v) => `${Math.round(v * 100)}%`); range('vol', 'vol', (v) => `${Math.round(v * 100)}%`); range('sens', 'sens', (v) => v.toFixed(1));
    for (const [id, key] of [['shadow', 'shadows'], ['nums', 'nums'], ['names', 'names']]) { const el = $('s-' + id); el.checked = !!s[key]; el.onchange = () => { s[key] = el.checked; apply(key); }; }
  }

  bind() {
    const click = (id, f) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.sound.click(); f(); });
    for (const el of document.querySelectorAll('.overlay .x')) el.addEventListener('click', () => this.closeAll());
    for (const id of ['inv', 'quest', 'dialog', 'shop', 'enh', 'map', 'menu']) $(id).addEventListener('pointerdown', (e) => { if (e.target === $(id)) this.closeAll(); });
    click('b-bag', () => this.toggle('inv'));
    click('b-quest', () => this.toggle('quest'));
    click('b-map', () => this.emit('map'));
    click('b-menu', () => this.toggle('menu'));
    click('b-chat', () => this.openChat());
    click('b-respawn', () => this.emit('respawn'));
    click('b-retry', () => this.emit('retry'));
    click('b-newchar', () => { if (confirm('지금 캐릭터를 지우고 새로 만들까요? (되돌릴 수 없어요)')) this.emit('newchar'); });
    click('b-full', () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d); });
    click('b-sellmat', () => this.emit('sellmat'));
    $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('chat-in').value.trim(); if (t) this.emit('chat', t); this.closeChat(); });
    $('chat-in').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.closeChat(); });
    $('c-name').addEventListener('keydown', (e) => e.stopPropagation());
  }
  toggle(id) {
    if (this.openPanel === id) return this.closeAll();
    this.show(id);
    if (id === 'inv') { this.sel = null; this.renderInv(); }
    if (id === 'quest') this.renderQuests();
  }
}

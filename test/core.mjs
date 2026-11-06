// RPG 호스트 로직 테스트 (네트워크 없이)
import { Game, bindSocket } from '../public/js/core/game.js';
import { PROTO } from '../public/js/shared/constants.js';
import { NPC_POS, ARENAS, SPAWNS } from '../public/js/shared/world.js';
import { xpToNext, newChar, sanitizeChar, deriveStats, itemStats, makeGear } from '../public/js/shared/rules.js';
import { mulberry32 } from '../public/js/shared/noise.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail++; };
const game = new Game({ hash: (t) => t.slice(0, 16), log: () => {} });
const tick = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) game.tick(dt); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name, token, extra = {}) {
  const c = { msgs: [], ws: null };
  c.ws = { readyState: 1, bufferedAmount: 0, send: (s) => c.msgs.push(JSON.parse(s)), close: (code) => c.msgs.push({ t: '_closed', code }) };
  c.sock = bindSocket(game, c.ws);
  c.send = (o) => c.sock.receive(JSON.stringify(o));
  c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
  c.send({ t: 'join', ver: PROTO, name, token, ...extra });
  c.p = c.ws.player;
  return c;
}
const moveTo = (c, x, z) => { c.p.x = x; c.p.z = z; c.p.allowJump = Date.now() + 1000; };

// 접속 + 캐릭터 생성
const a = client('전사', 'tokenAAAAAAAAAAAAAAAA', { cls: 'warrior', look: [1, 2, 3, 4] });
const w = a.last('welcome');
ok(w && w.ch.cls === 'warrior' && w.ch.lv === 1 && w.ch.equip.weapon, '새 캐릭터 생성 (전사, 기본 무기)');
const b = client('궁수', 'tokenBBBBBBBBBBBBBBBB', { cls: 'archer' });
ok(b.p && b.p.ch.cls === 'archer', '두 번째 플레이어 (궁수)');
// 저장된 캐릭터로 접속 (클라이언트 저장본 검증)
const rnd = mulberry32(1);
const saved = newChar('mage', '마법사', [0, 0, 0, 0], rnd);
saved.lv = 99; saved.gold = 1e12; saved.inv[0] = { k: 'nope', n: 3 }; saved.inv[1] = { k: 'hp1', n: 5 };
const sc = sanitizeChar(saved);
ok(sc.lv === 30 && sc.gold <= 99999999 && sc.inv[0] === null && sc.inv[1].n === 5, '저장본 검증 (레벨/골드 범위, 잘못된 아이템 제거)');
const c = client('마법사', 'tokenCCCCCCCCCCCCCCCC', { char: newChar('mage', '마법사', [0, 0, 0, 0], rnd) });
ok(c.p.ch.cls === 'mage', '저장된 캐릭터로 접속');

// 퀘스트 1: 촌장에게 말 걸기
moveTo(a, NPC_POS.chief.x, NPC_POS.chief.z + 2);
a.send({ t: 'qaccept', q: 'q1' });
ok(a.p.ch.quests.done.includes('q1') && a.p.ch.inv.some((s) => s && s.k === 'hp1' && s.n >= 5), '퀘스트 q1 즉시 완료 + 물약 보상');
a.send({ t: 'qaccept', q: 'q2' });
ok(a.p.ch.quests.active.q2, '퀘스트 q2 수락 (슬라임 8마리)');

// 슬라임 무리 깨우기
const slimeCamp = game.camps.find((cp) => cp.type === 'slime');
moveTo(a, slimeCamp.x + 3, slimeCamp.z + 3);
tick(20);
const slimes = [...game.mobs.values()].filter((m) => m.type === 'slime');
ok(slimes.length > 0, `플레이어 근처 무리 활성화 (슬라임 ${slimes.length})`);
// 기본 공격으로 처치
const s0 = slimes[0];
const xp0 = a.p.ch.xp, gold0 = a.p.ch.gold;
for (let i = 0; i < 40 && game.mobs.has(s0.id); i++) {
  moveTo(a, s0.x + 1.2, s0.z);
  a.p.atkT = 0; a.send({ t: 'atk', tid: s0.id });
  await wait(200); tick(1);
}
ok(!game.mobs.has(s0.id), '슬라임 처치');
ok(a.p.ch.xp > xp0 || a.p.ch.lv > 1, `경험치 획득 (${a.p.ch.xp})`);
ok(a.p.ch.gold > gold0, '골드 획득');
ok(a.p.ch.quests.active.q2.n === 1, '퀘스트 진행도 1/8');
// 스킬 (회전베기)
tick(30);
const near = [...game.mobs.values()].filter((m) => m.type === 'slime');
if (near.length) {
  moveTo(a, near[0].x, near[0].z + 1);
  const hp0 = near[0].hp;
  a.send({ t: 'skill', s: 0, ry: 0 });
  await wait(250); tick(1);
  ok(!game.mobs.has(near[0].id) || near[0].hp < hp0, '스킬 회전베기 피해');
  ok(a.p.mp < a.p.st.maxMp, '마나 소모');
}
// 레벨업
const lv0 = a.p.ch.lv;
game.addXp(a.p, xpToNext(a.p.ch.lv) * 3);
ok(a.p.ch.lv > lv0 && a.p.hp === a.p.st.maxHp, `레벨 업 (Lv ${a.p.ch.lv}) + 체력 회복`);
// 전리품
const mob = game.spawnMob(slimeCamp, 'slime', 3);
game.rollLoot(a.p, mob);
const lootMsg = a.last('loot');
ok(lootMsg === undefined || lootMsg.l.length >= 0, '전리품 굴림');
const fakeLoot = { id: 999, x: a.p.x, z: a.p.z, it: makeGear('helm_0', 2, 2, rnd), until: Date.now() + 9999 };
a.p.loot.set(999, fakeLoot);
a.send({ t: 'pick', id: 999 });
const helmSlot = a.p.ch.inv.findIndex((s) => s && s.k === 'helm_0');
ok(helmSlot >= 0, '전리품 줍기 (희귀 투구)');
const def0 = a.p.st.def;
a.send({ t: 'equip', slot: helmSlot });
ok(a.p.ch.equip.helm && a.p.st.def > def0, `장비 착용 → 방어력 ${def0} → ${a.p.st.def}`);
// 상점
moveTo(a, NPC_POS.merchant.x - 2, NPC_POS.merchant.z);
a.p.ch.gold = 500;
a.send({ t: 'buy', npc: 'merchant', k: 'hp2', n: 2 });
ok(a.p.ch.gold === 500 - 180 && a.p.ch.inv.some((s) => s && s.k === 'hp2' && s.n === 2), '상점 구매 (중급 물약 ×2)');
const sellSlot = a.p.ch.inv.findIndex((s) => s && s.k === 'hp2');
a.send({ t: 'sell', slot: sellSlot });
ok(a.p.ch.gold > 320 && !a.p.ch.inv[sellSlot], '판매');
// 강화
moveTo(a, NPC_POS.smith.x + 2, NPC_POS.smith.z);
a.p.ch.gold = 100000;
a.p.ch.inv[20] = { k: 'stone', n: 20 };
for (let i = 0; i < 5; i++) a.send({ t: 'enhance', eq: 'weapon' });
ok((a.p.ch.equip.weapon.en || 0) >= 3, `무기 강화 +${a.p.ch.equip.weapon.en}`);
const st0 = itemStats({ ...a.p.ch.equip.weapon, en: 0 }).atk, st1 = itemStats(a.p.ch.equip.weapon).atk;
ok(st1 > st0, `강화로 공격력 증가 ${st0} → ${st1}`);
// 물약
a.p.hp = 10;
const hpSlot = a.p.ch.inv.findIndex((s) => s && s.k === 'hp1');
a.send({ t: 'use', slot: hpSlot });
ok(a.p.hp > 10, '물약 사용');
// 몬스터가 플레이어 공격 → 쓰러짐 → 동료가 부활
moveTo(b, slimeCamp.x, slimeCamp.z);
b.p.hp = 3;
game.hurtPlayer(b.p, 9999, mob);
ok(b.p.downed && b.last('down'), '쓰러짐');
moveTo(a, b.p.x + 1, b.p.z);
a.send({ t: 'revive', id: b.p.id });
await wait(2600); tick(1);
ok(!b.p.downed && b.p.hp > 0, '동료 부활');
// 파티
a.send({ t: 'pinvite', id: b.p.id });
b.send({ t: 'paccept', from: a.p.id });
ok(a.p.party && a.p.party === b.p.party, '파티 결성');
tick(2);
ok(a.last('s') && a.last('s').pt && a.last('s').pt.length === 2, '파티 정보 전송');
// 보스 경고 패턴
const kingCamp = game.camps.find((cp) => cp.type === 'slime_king');
moveTo(a, ARENAS.slime_king.x + 3, ARENAS.slime_king.z); moveTo(b, ARENAS.slime_king.x - 3, ARENAS.slime_king.z);
tick(12);
const king = [...game.mobs.values()].find((m) => m.type === 'slime_king');
ok(!!king, '보스 등장 (슬라임 킹)');
if (king) {
  king.skillT = 0; king.target = a.p.id; king.state = 'chase';
  a.msgs.length = 0;
  tick(2);
  ok(a.msgs.some((m) => m.t === 'fx' && m.f.some((f) => f[0] === 'warn')), '보스 바닥 경고 표시');
}
// 이동의 돌
moveTo(a, 0, 0); a.p.ch.wps = ['town'];
const wp = Object.entries((await import('../public/js/shared/world.js')).WAYPOINTS).find(([k]) => k === 'forest')[1];
moveTo(a, wp.x, wp.z);
tick(10);
ok(a.p.ch.wps.includes('forest'), '이동의 돌 발견');
a.send({ t: 'tp', wp: 'town' });
ok(Math.hypot(a.p.x, a.p.z) < 15, '순간이동');
// 현상금
moveTo(a, NPC_POS.board.x, NPC_POS.board.z + 1.5);
a.send({ t: 'bounty', a: 'take' });
ok(a.p.ch.bounty && a.p.ch.bounty.need === 10, `현상금 의뢰 (${a.p.ch.bounty && a.p.ch.bounty.mob})`);
// 캐릭터 동기화
await wait(300); tick(4);
ok(a.msgs.some((m) => m.t === 'char'), '캐릭터 데이터 동기화(char)');
// 스탯 계산
const st = deriveStats({ cls: 'cleric', lv: 10, equip: {} });
ok(st.maxHp > 200 && st.atk > 20, `성직자 Lv10 능력치 HP ${st.maxHp} ATK ${st.atk}`);
// 버전 불일치
const old = { msgs: [] };
old.ws = { readyState: 1, send: (s) => old.msgs.push(JSON.parse(s)), close: (code) => old.msgs.push({ t: '_closed', code }) };
bindSocket(game, old.ws).receive(JSON.stringify({ t: 'join', ver: 3, token: 'tokenOLDOLDOLDOLDOLD', cls: 'warrior' }));
ok(old.msgs.some((m) => m.t === '_closed' && m.code === 4004), '이전 버전 거절');
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);

// 아이템 · 레시피 · 인벤토리 도우미 (호스트와 클라이언트가 같은 규칙을 씀)
import { BLOCKS, B, NUM_BLOCKS } from './blocks.js';

export const ITEMS = [];
export const I = {}; // key → id
export const INV_SIZE = 36; // 0~8 핫바, 9~35 가방

function item(id, key, o) {
  const it = Object.assign({ id, key, name: key, stack: 64, icon: null }, o);
  ITEMS[id] = it; I[key] = id;
  return it;
}

// 블록 아이템
const FLAT = new Set(['torch', 'ladder_0', 'flag', 'tall_grass', 'dead_bush', 'flower_red', 'flower_yellow', 'flower_blue', 'flower_white', 'sapling_oak', 'sapling_birch', 'sapling_spruce']);
for (let id = 0; id < NUM_BLOCKS; id++) {
  const b = BLOCKS[id];
  if (!b || b.noItem || b.render === 'air') continue;
  let icon = { type: 'cube', block: id };
  if (FLAT.has(b.key)) icon = { type: 'tile', tile: b.key === 'ladder_0' ? 'ladder' : b.tex.side };
  else if (b.key.startsWith('slab_') || b.key === 'bed') icon = { type: 'slab', block: id };
  else if (b.stairs) icon = { type: 'stairs', block: id };
  else if (b.door) icon = { type: 'sprite', sprite: 'door' };
  else if (b.sign) icon = { type: 'sprite', sprite: 'sign' };
  item(id, b.key, { name: b.name, block: id, icon });
}
I.ladder = 65; I.door = 77; I.sign = 131; I.furnace = 57; I.chest = 61;
ITEMS[65].name = '사다리'; ITEMS[57].name = '화로'; ITEMS[61].name = '상자';

const sprite = (s) => ({ type: 'sprite', sprite: s });
item(256, 'stick', { name: '막대기', icon: sprite('stick'), fuel: true });
item(257, 'coal', { name: '석탄', icon: sprite('coal'), fuel: true });
item(258, 'iron_ingot', { name: '철 주괴', icon: sprite('iron_ingot') });
item(259, 'gold_ingot', { name: '금 주괴', icon: sprite('gold_ingot') });
item(260, 'diamond', { name: '다이아몬드', icon: sprite('diamond') });
item(261, 'apple', { name: '사과', icon: sprite('apple'), food: 4 });
item(262, 'golden_apple', { name: '황금 사과', icon: sprite('golden_apple'), food: 10, heal: 8 });
item(263, 'bread', { name: '빵', icon: sprite('bread'), food: 5 });
item(264, 'wheat', { name: '밀', icon: sprite('wheat') });
item(265, 'seeds', { name: '씨앗', icon: sprite('seeds'), place: 'seeds' });
item(266, 'raw_pork', { name: '생 돼지고기', icon: sprite('raw_pork'), food: 3 });
item(267, 'cooked_pork', { name: '구운 돼지고기', icon: sprite('cooked_pork'), food: 8 });
item(268, 'raw_mutton', { name: '생 양고기', icon: sprite('raw_mutton'), food: 2 });
item(269, 'cooked_mutton', { name: '구운 양고기', icon: sprite('cooked_mutton'), food: 6 });
item(270, 'raw_chicken', { name: '생 닭고기', icon: sprite('raw_chicken'), food: 2 });
item(271, 'cooked_chicken', { name: '구운 닭고기', icon: sprite('cooked_chicken'), food: 6 });
item(272, 'feather', { name: '깃털', icon: sprite('feather') });
item(273, 'slimeball', { name: '슬라임볼', icon: sprite('slimeball') });
item(274, 'rotten_flesh', { name: '썩은 살점', icon: sprite('rotten_flesh'), food: 2 });

// 도구: 280 + 재질*5 + 종류
export const TOOL_MATS = [
  ['wood', '나무', 2, 60, '#a07a45'], ['stone', '돌', 4, 132, '#8b8b8b'],
  ['iron', '철', 6, 251, '#e6e6e6'], ['diamond', '다이아몬드', 8, 1562, '#4ee0d2'],
];
export const TOOL_TYPES = [['pickaxe', '곡괭이', 'pick'], ['axe', '도끼', 'axe'], ['shovel', '삽', 'shovel'], ['sword', '검', 'sword'], ['hoe', '괭이', 'hoe']];
const DMG = { pickaxe: [2, 3, 4, 5], axe: [3, 4, 5, 6], shovel: [2, 2, 3, 4], sword: [4, 5, 6, 7], hoe: [1, 1, 1, 1] };
TOOL_MATS.forEach(([mk, mn, speed, dur, color], ti) => {
  TOOL_TYPES.forEach(([tk, tn, cls], k) => {
    item(280 + ti * 5 + k, `${mk}_${tk}`, {
      name: `${mn} ${tn}`, stack: 1, icon: { type: 'tool', tool: tk, color, mat: mk },
      tool: { cls, tier: ti + 1, speed, dur, dmg: DMG[tk][ti] },
    });
  });
});

export const itemName = (id) => (ITEMS[id] ? ITEMS[id].name : '?');
export const maxStack = (id) => (ITEMS[id] ? ITEMS[id].stack : 64);
export const toolOf = (id) => (ITEMS[id] && ITEMS[id].tool) || null;

// 태그 (어떤 판자든, 어떤 원목이든 …)
export const TAGS = {
  planks: [B.planks_oak, B.planks_birch, B.planks_spruce],
  logs: [B.log_oak, B.log_birch, B.log_spruce],
  leaves: [B.leaves_oak, B.leaves_birch, B.leaves_spruce],
  wool: Array.from({ length: 16 }, (_, i) => 115 + i),
  fuel: [I.coal, B.planks_oak, B.planks_birch, B.planks_spruce, B.log_oak, B.log_birch, B.log_spruce, I.stick],
};
export const TAG_NAMES = { planks: '판자', logs: '원목', leaves: '나뭇잎', wool: '양털', fuel: '땔감' };

// ---------- 레시피 ----------
// st: null(맨손) | 'table'(작업대 근처) | 'furnace'(화로 근처)
const R = [];
const rec = (cat, out, n, ins, st = null) => R.push({ cat, out, n, ins, st });
rec('basic', 'planks_oak', 4, [['log_oak', 1]]);
rec('basic', 'planks_birch', 4, [['log_birch', 1]]);
rec('basic', 'planks_spruce', 4, [['log_spruce', 1]]);
rec('basic', 'stick', 4, [['#planks', 2]]);
rec('basic', 'crafting_table', 1, [['#planks', 4]]);
rec('basic', 'torch', 4, [['stick', 1], ['coal', 1]]);
rec('basic', 'sandstone', 1, [['sand', 4]]);
rec('basic', 'hay_bale', 1, [['wheat', 9]]);
rec('basic', 'slime_block', 1, [['slimeball', 9]]);
rec('basic', 'flag', 1, [['stick', 2], ['#wool', 1]]);
rec('basic', 'mossy_cobblestone', 1, [['cobblestone', 1], ['#leaves', 1]]);

const MAT_ING = ['#planks', 'cobblestone', 'iron_ingot', 'diamond'];
TOOL_MATS.forEach(([mk], ti) => {
  const m = MAT_ING[ti];
  rec('tools', `${mk}_pickaxe`, 1, [[m, 3], ['stick', 2]], 'table');
  rec('tools', `${mk}_axe`, 1, [[m, 3], ['stick', 2]], 'table');
  rec('tools', `${mk}_shovel`, 1, [[m, 1], ['stick', 2]], 'table');
  rec('tools', `${mk}_sword`, 1, [[m, 2], ['stick', 1]], 'table');
  rec('tools', `${mk}_hoe`, 1, [[m, 2], ['stick', 2]], 'table');
});

rec('build', 'furnace_0', 1, [['cobblestone', 8]], 'table');
rec('build', 'chest_0', 1, [['#planks', 8]], 'table');
rec('build', 'door_0_0_0', 2, [['#planks', 6]], 'table');
rec('build', 'ladder_0', 3, [['stick', 7]], 'table');
rec('build', 'sign_wall_0', 3, [['#planks', 6], ['stick', 1]], 'table');
rec('build', 'bed', 1, [['#wool', 3], ['#planks', 3]], 'table');
rec('build', 'lamp', 1, [['glass', 4], ['torch', 1]], 'table');
rec('build', 'bookshelf', 1, [['#planks', 6]], 'table');
rec('build', 'stone_bricks', 4, [['stone', 4]], 'table');
[['slab_smooth_stone', 'smooth_stone'], ['slab_cobblestone', 'cobblestone'], ['slab_planks_oak', 'planks_oak'], ['slab_stone_bricks', 'stone_bricks'], ['slab_sandstone', 'sandstone'], ['slab_bricks', 'bricks']]
  .forEach(([o, m]) => rec('build', o, 6, [[m, 3]], 'table'));
[['stairs_planks_oak_0', 'planks_oak'], ['stairs_cobblestone_0', 'cobblestone'], ['stairs_stone_bricks_0', 'stone_bricks'], ['stairs_bricks_0', 'bricks']]
  .forEach(([o, m]) => rec('build', o, 4, [[m, 6]], 'table'));
rec('build', 'iron_block', 1, [['iron_ingot', 9]], 'table');
rec('build', 'gold_block', 1, [['gold_ingot', 9]], 'table');
rec('build', 'diamond_block', 1, [['diamond', 9]], 'table');

// 양털 염색
const W = (i) => 'wool_' + i;
rec('deco', W(14), 1, [[W(0), 1], ['flower_red', 1]]);
rec('deco', W(4), 1, [[W(0), 1], ['flower_yellow', 1]]);
rec('deco', W(11), 1, [[W(0), 1], ['flower_blue', 1]]);
rec('deco', W(13), 1, [[W(0), 1], ['cactus', 1]]);
rec('deco', W(15), 1, [[W(0), 1], ['coal', 1]]);
rec('deco', W(12), 1, [[W(0), 1], ['dirt', 1]]);
rec('deco', W(1), 2, [[W(0), 2], ['flower_red', 1], ['flower_yellow', 1]]);
rec('deco', W(6), 2, [[W(0), 2], ['flower_red', 1], ['flower_white', 1]]);
rec('deco', W(10), 2, [[W(0), 2], ['flower_red', 1], ['flower_blue', 1]]);
rec('deco', W(9), 2, [[W(0), 2], ['flower_blue', 1], ['cactus', 1]]);
rec('deco', W(3), 2, [[W(0), 2], ['flower_blue', 1], ['flower_white', 1]]);
rec('deco', W(5), 2, [[W(0), 2], ['cactus', 1], ['flower_white', 1]]);
rec('deco', W(7), 2, [[W(0), 2], ['coal', 1], ['flower_white', 1]]);
rec('deco', W(8), 3, [[W(0), 3], ['coal', 1], ['flower_white', 2]]);
rec('deco', W(2), 3, [[W(0), 3], ['flower_red', 2], ['flower_blue', 1]]);

rec('food', 'bread', 1, [['wheat', 3]]);
rec('food', 'golden_apple', 1, [['apple', 1], ['gold_ingot', 4]], 'table');

const smelt = (out, n, input, cnt = 1) => rec('smelt', out, n, [[input, cnt], ['#fuel', 1]], 'furnace');
smelt('iron_ingot', 1, 'iron_ore');
smelt('gold_ingot', 1, 'gold_ore');
smelt('glass', 1, 'sand');
smelt('stone', 1, 'cobblestone');
smelt('smooth_stone', 1, 'stone');
smelt('coal', 1, '#logs');
smelt('cooked_pork', 1, 'raw_pork');
smelt('cooked_mutton', 1, 'raw_mutton');
smelt('cooked_chicken', 1, 'raw_chicken');
rec('smelt', 'bricks', 2, [['dirt', 1], ['sand', 1], ['#fuel', 1]], 'furnace');

// 키 → id 로 변환
const toSpec = (k) => (k[0] === '#' ? k : (I[k] ?? B[k]));
export const RECIPES = R.map((r, i) => {
  const out = I[r.out] ?? B[r.out];
  if (out === undefined) throw new Error('bad recipe output ' + r.out);
  const ins = r.ins.map(([k, n]) => {
    const s = toSpec(k);
    if (s === undefined) throw new Error('bad ingredient ' + k);
    return [s, n];
  });
  // 구체적인 재료를 먼저, 태그(특히 땔감)를 나중에 소모
  ins.sort((a, b) => (typeof a[0] === 'string') - (typeof b[0] === 'string') || (a[0] === '#fuel') - (b[0] === '#fuel'));
  return { i, cat: r.cat, out, n: r.n, ins, st: r.st };
});
export const RECIPE_CATS = [['basic', '기본'], ['tools', '도구'], ['build', '건축'], ['deco', '염색'], ['food', '음식'], ['smelt', '화로']];

// ---------- 인벤토리 ----------
// 슬롯: null | { id, n, d }  (d = 남은 내구도, 도구만)
export const newInv = () => new Array(INV_SIZE).fill(null);
const matches = (spec, id) => (typeof spec === 'string' ? (TAGS[spec.slice(1)] || []).includes(id) : spec === id);

export function countOf(inv, spec) {
  let n = 0;
  for (const s of inv) if (s && matches(spec, s.id)) n += s.n;
  return n;
}

// 넣고 남은 개수를 돌려줌
export function addItem(inv, id, n, d) {
  const max = maxStack(id);
  const tool = toolOf(id);
  if (max > 1) {
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.id === id && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
    }
  }
  for (let i = 0; i < inv.length && n > 0; i++) {
    if (!inv[i]) {
      const k = Math.min(n, max);
      inv[i] = { id, n: k };
      if (tool) inv[i].d = d ?? tool.dur;
      n -= k;
    }
  }
  return n;
}
export function canAdd(inv, id, n) {
  const copy = inv.map((s) => (s ? { ...s } : null));
  return addItem(copy, id, n) === 0;
}

// 뒤쪽(가방)부터 꺼내서 핫바는 최대한 유지
export function removeItem(inv, spec, n) {
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (s && matches(spec, s.id)) {
      const k = Math.min(n, s.n);
      s.n -= k; n -= k;
      if (s.n <= 0) inv[i] = null;
    }
  }
  return n === 0;
}

export function canCraft(inv, r) {
  const copy = inv.map((s) => (s ? { ...s } : null));
  for (const [spec, n] of r.ins) if (!removeItem(copy, spec, n)) return false;
  return addItem(copy, r.out, r.n) === 0;
}
export function craft(inv, r) {
  if (!canCraft(inv, r)) return false;
  for (const [spec, n] of r.ins) removeItem(inv, spec, n);
  addItem(inv, r.out, r.n);
  return true;
}

export const invToWire = (inv) => inv.map((s) => (s ? (s.d !== undefined ? [s.id, s.n, s.d] : [s.id, s.n]) : 0));
export function invFromWire(arr) {
  const inv = newInv();
  if (!Array.isArray(arr)) return inv;
  for (let i = 0; i < INV_SIZE; i++) {
    const s = arr[i];
    if (Array.isArray(s) && ITEMS[s[0]] && s[1] > 0) {
      inv[i] = { id: s[0] | 0, n: Math.min(s[1] | 0, maxStack(s[0])) };
      if (toolOf(s[0])) inv[i].d = Math.max(1, (s[2] ?? toolOf(s[0]).dur) | 0);
    }
  }
  return inv;
}

// 캐는 데 걸리는 시간(초)과 드롭 여부
export function breakInfo(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return { time: Infinity, drops: false };
  if (b.hardness === 0) return { time: 0.05, drops: true };
  const t = toolOf(heldId);
  const right = t && b.tool && t.cls === b.tool;
  const drops = !b.tier || (right && t.cls === 'pick' && t.tier >= b.tier);
  let time = b.hardness * (drops ? 1.5 : 5);
  if (right) time /= t.speed;
  if (b.key.startsWith('leaves') && t && t.cls === 'hoe') time /= 4;
  return { time: Math.max(0.05, time), drops };
}

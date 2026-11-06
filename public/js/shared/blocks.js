// 블록 정의 (렌더링 방식, 충돌, 단단함, 드롭, 빛 등)
// 좌표 단위: 박스는 픽셀(0~16). 면 번호: 0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z
export const BLOCKS = [];
export const B = {};

const DEF = {
  name: '', render: 'cube', solid: true, opaque: true, hardness: 1, tool: null, tier: 0,
  light: 0, filter: 0, sound: 'stone', replaceable: false, support: null, drop: undefined,
  item: undefined, group: null, tex: null, boxes: null, collide: undefined, climb: false,
  bounce: false, noItem: false, liquid: false, cutout: false, front: -1,
};

function reg(id, key, o = {}) {
  const d = Object.assign({}, DEF, { id, key }, o);
  if (o.opaque === undefined) d.opaque = d.render === 'cube' && !d.cutout;
  if (o.solid === undefined) d.solid = d.render !== 'cross' && d.render !== 'water' && d.render !== 'air';
  if (typeof d.tex === 'string') d.tex = { top: d.tex, bottom: d.tex, side: d.tex };
  BLOCKS[id] = d;
  B[key] = id;
  return d;
}

// 방향별 박스 헬퍼 (e: 0=북(-Z) 1=동(+X) 2=남(+Z) 3=서(-X))
const edgeBox = (e, t, y0 = 0, y1 = 16) => [
  [0, y0, 0, 16, y1, t], [16 - t, y0, 0, 16, y1, 16], [0, y0, 16 - t, 16, y1, 16], [0, y0, 0, t, y1, 16],
][e];
// 방향 → 그 쪽을 바라보는 면 번호
export const DIR_FACE = [5, 0, 4, 1];
// 플레이어가 바라보는 방향 d → 앞면(플레이어 쪽) 면 번호
export const frontFaceFor = (d) => DIR_FACE[(d + 2) % 4];

reg(0, 'air', { render: 'air', solid: false, opaque: false, hardness: -1, noItem: true });
reg(1, 'stone', { name: '돌', tex: 'stone', hardness: 1.5, tool: 'pick', tier: 1, drop: 'cobblestone' });
reg(2, 'grass', { name: '잔디 블록', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'grass', drop: 'dirt' });
reg(3, 'dirt', { name: '흙', tex: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg(4, 'cobblestone', { name: '조약돌', tex: 'cobblestone', hardness: 2, tool: 'pick', tier: 1 });
reg(5, 'planks_oak', { name: '참나무 판자', tex: 'planks_oak', hardness: 2, tool: 'axe', sound: 'wood', group: 'planks' });
reg(6, 'bedrock', { name: '기반암', tex: 'bedrock', hardness: -1 });
reg(7, 'sand', { name: '모래', tex: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand' });
reg(8, 'gravel', { name: '자갈', tex: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel' });
reg(9, 'log_oak', { name: '참나무 원목', tex: { top: 'log_oak_top', bottom: 'log_oak_top', side: 'log_oak' }, hardness: 2, tool: 'axe', sound: 'wood', group: 'logs' });
reg(10, 'leaves_oak', { name: '참나무 잎', render: 'cube', cutout: true, tex: 'leaves_oak', hardness: 0.2, sound: 'grass', filter: 1, drop: 'special' });
reg(11, 'glass', { name: '유리', render: 'cube', cutout: true, tex: 'glass', hardness: 0.3, sound: 'glass' });
reg(12, 'sandstone', { name: '사암', tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' }, hardness: 0.8, tool: 'pick', tier: 1 });
reg(13, 'snow', { name: '눈 블록', tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow' });
reg(14, 'ice', { name: '얼음', tex: 'ice', hardness: 0.5, tool: 'pick', sound: 'glass', filter: 1 });
reg(15, 'water', { name: '물', render: 'water', solid: false, opaque: false, hardness: -1, filter: 2, liquid: true, noItem: true, replaceable: true, tex: 'water' });
reg(16, 'coal_ore', { name: '석탄 광석', tex: 'coal_ore', hardness: 3, tool: 'pick', tier: 1, drop: 'coal' });
reg(17, 'iron_ore', { name: '철광석', tex: 'iron_ore', hardness: 3, tool: 'pick', tier: 2 });
reg(18, 'gold_ore', { name: '금광석', tex: 'gold_ore', hardness: 3, tool: 'pick', tier: 3 });
reg(19, 'diamond_ore', { name: '다이아몬드 광석', tex: 'diamond_ore', hardness: 3, tool: 'pick', tier: 3, drop: 'diamond' });
reg(20, 'log_birch', { name: '자작나무 원목', tex: { top: 'log_birch_top', bottom: 'log_birch_top', side: 'log_birch' }, hardness: 2, tool: 'axe', sound: 'wood', group: 'logs' });
reg(21, 'leaves_birch', { name: '자작나무 잎', cutout: true, tex: 'leaves_birch', hardness: 0.2, sound: 'grass', filter: 1, drop: 'special' });
reg(22, 'log_spruce', { name: '가문비나무 원목', tex: { top: 'log_spruce_top', bottom: 'log_spruce_top', side: 'log_spruce' }, hardness: 2, tool: 'axe', sound: 'wood', group: 'logs' });
reg(23, 'leaves_spruce', { name: '가문비나무 잎', cutout: true, tex: 'leaves_spruce', hardness: 0.2, sound: 'grass', filter: 1, drop: 'special' });
reg(24, 'planks_birch', { name: '자작나무 판자', tex: 'planks_birch', hardness: 2, tool: 'axe', sound: 'wood', group: 'planks' });
reg(25, 'planks_spruce', { name: '가문비나무 판자', tex: 'planks_spruce', hardness: 2, tool: 'axe', sound: 'wood', group: 'planks' });
reg(26, 'cactus', { name: '선인장', render: 'model', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, boxes: [[1, 0, 1, 15, 16, 15]], hardness: 0.4, sound: 'wool', support: 'sand' });
reg(27, 'tall_grass', { name: '풀', render: 'cross', tex: 'tall_grass', hardness: 0, sound: 'grass', replaceable: true, support: 'ground', drop: 'special', sel: [[2, 0, 2, 14, 13, 14]] });
reg(28, 'flower_red', { name: '양귀비', render: 'cross', tex: 'flower_red', hardness: 0, sound: 'grass', support: 'ground', sel: [[5, 0, 5, 11, 11, 11]] });
reg(29, 'flower_yellow', { name: '민들레', render: 'cross', tex: 'flower_yellow', hardness: 0, sound: 'grass', support: 'ground', sel: [[5, 0, 5, 11, 10, 11]] });
reg(30, 'flower_blue', { name: '수레국화', render: 'cross', tex: 'flower_blue', hardness: 0, sound: 'grass', support: 'ground', sel: [[5, 0, 5, 11, 11, 11]] });
reg(31, 'flower_white', { name: '데이지', render: 'cross', tex: 'flower_white', hardness: 0, sound: 'grass', support: 'ground', sel: [[5, 0, 5, 11, 10, 11]] });
reg(32, 'dead_bush', { name: '마른 덤불', render: 'cross', tex: 'dead_bush', hardness: 0, sound: 'grass', replaceable: true, support: 'ground', drop: 'stick', sel: [[2, 0, 2, 14, 13, 14]] });
reg(33, 'bricks', { name: '벽돌', tex: 'bricks', hardness: 2, tool: 'pick', tier: 1 });
reg(34, 'stone_bricks', { name: '석재 벽돌', tex: 'stone_bricks', hardness: 1.5, tool: 'pick', tier: 1 });
reg(35, 'crafting_table', { name: '작업대', tex: { top: 'table_top', bottom: 'planks_oak', side: 'table_side', px: 'table_front', nx: 'table_front' }, hardness: 2.5, tool: 'axe', sound: 'wood' });
reg(36, 'lamp', { name: '등불', tex: 'lamp', hardness: 0.3, sound: 'glass', light: 15 });
reg(37, 'bookshelf', { name: '책장', tex: { top: 'planks_oak', bottom: 'planks_oak', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood' });
reg(38, 'farmland', { name: '경작지', render: 'model', tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, boxes: [[0, 0, 0, 16, 15, 16]], hardness: 0.6, tool: 'shovel', sound: 'gravel', drop: 'dirt', noItem: true });
reg(39, 'sapling_oak', { name: '참나무 묘목', render: 'cross', tex: 'sapling_oak', hardness: 0, sound: 'grass', support: 'ground', sel: [[3, 0, 3, 13, 12, 13]] });
reg(40, 'sapling_birch', { name: '자작나무 묘목', render: 'cross', tex: 'sapling_birch', hardness: 0, sound: 'grass', support: 'ground', sel: [[3, 0, 3, 13, 12, 13]] });
reg(41, 'sapling_spruce', { name: '가문비나무 묘목', render: 'cross', tex: 'sapling_spruce', hardness: 0, sound: 'grass', support: 'ground', sel: [[3, 0, 3, 13, 12, 13]] });
reg(42, 'snowy_grass', { name: '눈 덮인 잔디', tex: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'snow', drop: 'dirt' });
reg(43, 'mossy_cobblestone', { name: '이끼 낀 조약돌', tex: 'mossy_cobblestone', hardness: 2, tool: 'pick', tier: 1 });
reg(44, 'smooth_stone', { name: '매끄러운 돌', tex: 'smooth_stone', hardness: 2, tool: 'pick', tier: 1 });
reg(45, 'hay_bale', { name: '건초 더미', tex: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' }, hardness: 0.5, sound: 'grass' });
reg(46, 'bed', { name: '침대', render: 'model', tex: { top: 'bed_top', bottom: 'planks_oak', side: 'bed_side' }, boxes: [[0, 0, 0, 16, 9, 16]], hardness: 0.4, sound: 'wool' });
reg(47, 'iron_block', { name: '철 블록', tex: 'iron_block', hardness: 5, tool: 'pick', tier: 2, sound: 'metal' });
reg(48, 'gold_block', { name: '금 블록', tex: 'gold_block', hardness: 3, tool: 'pick', tier: 3, sound: 'metal' });
reg(49, 'diamond_block', { name: '다이아몬드 블록', tex: 'diamond_block', hardness: 5, tool: 'pick', tier: 3, sound: 'metal' });
reg(50, 'slime_block', { name: '슬라임 블록', tex: 'slime', hardness: 0, sound: 'slime', bounce: true });
reg(51, 'flag', { name: '깃발', render: 'model', tex: 'flag', boxes: [[7, 0, 7, 9, 16, 9], [9, 9, 7, 16, 15, 9]], solid: false, hardness: 1, tool: 'axe', sound: 'wood' });

// 횃불: 52=바닥, 53~56=벽(받침 방향)
reg(52, 'torch', { name: '횃불', render: 'model', tex: 'torch', boxes: [[7, 0, 7, 9, 10, 9]], solid: false, hardness: 0, sound: 'wood', light: 14, support: 'torch', cutout: true });
const WALL_TORCH = [[7, 3, 1, 9, 13, 3], [13, 3, 7, 15, 13, 9], [7, 3, 13, 9, 13, 15], [1, 3, 7, 3, 13, 9]];
for (let e = 0; e < 4; e++)
  reg(53 + e, 'torch_wall_' + e, { name: '횃불', render: 'model', tex: 'torch', boxes: [[...WALL_TORCH[e], -3]], solid: false, hardness: 0, sound: 'wood', light: 14, support: 'wall', dir: e, item: 52, noItem: true, cutout: true });

// 화로/상자 (앞면 방향 4가지)
for (let d = 0; d < 4; d++) {
  reg(57 + d, 'furnace_' + d, { name: '화로', tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, front: frontFaceFor(d), hardness: 3.5, tool: 'pick', tier: 1, item: 57, noItem: d > 0, dir: d });
  reg(61 + d, 'chest_' + d, { name: '상자', render: 'model', tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, front: frontFaceFor(d), boxes: [[1, 0, 1, 15, 14, 15]], hardness: 2.5, tool: 'axe', sound: 'wood', item: 61, noItem: d > 0, dir: d, container: true });
}
// 사다리 (받침 방향)
for (let e = 0; e < 4; e++)
  reg(65 + e, 'ladder_' + e, { name: '사다리', render: 'model', tex: 'ladder', boxes: [edgeBox(e, 1)], solid: false, climb: true, hardness: 0.4, tool: 'axe', sound: 'wood', support: 'wall', dir: e, item: 65, noItem: e > 0, cutout: true });
// 밀 (0~7단계)
for (let s = 0; s < 8; s++)
  reg(69 + s, 'wheat_' + s, { name: '밀', render: 'cross', tex: 'wheat_' + s, hardness: 0, sound: 'grass', support: 'farmland', drop: 'special', noItem: true, stage: s, sel: [[0, 0, 0, 16, 2 + s * 2, 16]] });
// 문: 77 + 위아래*8 + 열림*4 + 방향
const doorBox = (open, d) => edgeBox(open ? (d + 3) % 4 : d, 3);
for (let half = 0; half < 2; half++)
  for (let open = 0; open < 2; open++)
    for (let d = 0; d < 4; d++)
      reg(77 + half * 8 + open * 4 + d, `door_${half}_${open}_${d}`, {
        name: '나무 문', render: 'model', tex: half ? 'door_top' : 'door_bottom', boxes: [doorBox(open, d)],
        hardness: 3, tool: 'axe', sound: 'wood', item: 77, noItem: !(half === 0 && open === 0 && d === 0),
        door: { half, open, dir: d }, cutout: true,
      });
// 반 블록
const SLABS = [['smooth_stone', '매끄러운 돌 반 블록', 'pick'], ['cobblestone', '조약돌 반 블록', 'pick'], ['planks_oak', '참나무 반 블록', 'axe'], ['stone_bricks', '석재 벽돌 반 블록', 'pick'], ['sandstone', '사암 반 블록', 'pick'], ['bricks', '벽돌 반 블록', 'pick']];
SLABS.forEach(([mat, name, tool], i) => {
  const t = mat === 'sandstone' ? { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' } : mat;
  reg(93 + i, 'slab_' + mat, { name, render: 'model', tex: t, boxes: [[0, 0, 0, 16, 8, 16]], hardness: 2, tool, tier: tool === 'pick' ? 1 : 0, sound: tool === 'axe' ? 'wood' : 'stone' });
});
// 계단 (재료 4가지 × 방향 4가지): 높은 쪽이 바라보는 방향
const STAIR_TOP = [[0, 8, 0, 16, 16, 8], [8, 8, 0, 16, 16, 16], [0, 8, 8, 16, 16, 16], [0, 8, 0, 8, 16, 16]];
const STAIRS = [['planks_oak', '참나무 계단', 'axe'], ['cobblestone', '조약돌 계단', 'pick'], ['stone_bricks', '석재 벽돌 계단', 'pick'], ['bricks', '벽돌 계단', 'pick']];
STAIRS.forEach(([mat, name, tool], i) => {
  for (let d = 0; d < 4; d++)
    reg(99 + i * 4 + d, `stairs_${mat}_${d}`, { name, render: 'model', tex: mat, boxes: [[0, 0, 0, 16, 8, 16], STAIR_TOP[d]], hardness: 2, tool, tier: tool === 'pick' ? 1 : 0, sound: tool === 'axe' ? 'wood' : 'stone', item: 99 + i * 4, noItem: d > 0, dir: d, stairs: true });
});
// 양털 16색
export const WOOL_COLORS = [
  ['흰색', '#e9ecec'], ['주황색', '#f07613'], ['자홍색', '#bd44b3'], ['하늘색', '#3aafd9'],
  ['노란색', '#f8c627'], ['연두색', '#70b919'], ['분홍색', '#ed8dac'], ['회색', '#3e4447'],
  ['밝은 회색', '#8e8e86'], ['청록색', '#158991'], ['보라색', '#792aac'], ['파란색', '#35399d'],
  ['갈색', '#724728'], ['초록색', '#546d1b'], ['빨간색', '#a12722'], ['검은색', '#141519'],
];
WOOL_COLORS.forEach(([n], i) => reg(115 + i, 'wool_' + i, { name: n + ' 양털', tex: 'wool_' + i, hardness: 0.8, sound: 'wool', group: 'wool' }));
// 표지판: 131~134 벽(받침 방향), 135~138 기둥(글씨가 향하는 방향)
for (let e = 0; e < 4; e++)
  reg(131 + e, 'sign_wall_' + e, { name: '표지판', render: 'model', tex: 'planks_oak', boxes: [edgeBox(e, 2, 4, 12)], solid: false, hardness: 1, tool: 'axe', sound: 'wood', support: 'wall', dir: e, item: 131, noItem: e > 0, sign: { wall: true, face: (e + 2) % 4 } });
for (let f = 0; f < 4; f++)
  reg(135 + f, 'sign_post_' + f, { name: '표지판', render: 'model', tex: 'planks_oak', boxes: [[7, 0, 7, 9, 8, 9], f % 2 === 0 ? [0, 8, 7, 16, 16, 9] : [7, 8, 0, 9, 16, 16]], solid: false, hardness: 1, tool: 'axe', sound: 'wood', support: 'ground', item: 131, noItem: true, sign: { wall: false, face: f } });

export const NUM_BLOCKS = BLOCKS.length;
for (let i = 0; i < NUM_BLOCKS; i++) if (!BLOCKS[i]) reg(i, 'unused_' + i, { render: 'air', solid: false, opaque: false, hardness: -1, noItem: true });

// 빠른 조회용 테이블
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const LIGHT = new Uint8Array(256);
export const FILTER = new Uint8Array(256);
export const RENDER = new Uint8Array(256); // 0 air 1 cube 2 cross 3 model 4 water
for (const d of BLOCKS) {
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  SOLID[d.id] = d.solid ? 1 : 0;
  LIGHT[d.id] = d.light;
  FILTER[d.id] = d.opaque ? 15 : d.filter;
  RENDER[d.id] = { air: 0, cube: 1, cross: 2, model: 3, water: 4 }[d.render];
}

// 큐브 면의 타일 이름
export function faceTile(id, face) {
  const d = BLOCKS[id], t = d.tex;
  if (!t) return 'stone';
  if (d.front === face && t.front) return t.front;
  const k = ['px', 'nx', 'py', 'ny', 'pz', 'nz'][face];
  if (t[k]) return t[k];
  if (face === 2) return t.top;
  if (face === 3) return t.bottom;
  return t.side;
}

const FULL = [[0, 0, 0, 1, 1, 1]];
const scaled = (boxes) => boxes.map((b) => [b[0] / 16, b[1] / 16, b[2] / 16, b[3] / 16, b[4] / 16, b[5] / 16]);
const COLL = [], SEL = [];
for (const d of BLOCKS) {
  if (d.render === 'cube') { COLL[d.id] = d.solid ? FULL : null; SEL[d.id] = FULL; }
  else if (d.render === 'model') { const s = scaled(d.boxes); COLL[d.id] = d.solid ? s : null; SEL[d.id] = s; }
  else if (d.render === 'cross') { COLL[d.id] = null; SEL[d.id] = scaled(d.sel || [[2, 0, 2, 14, 14, 14]]); }
  else { COLL[d.id] = null; SEL[d.id] = null; }
}
export const collisionBoxes = (id) => COLL[id];
export const selectionBoxes = (id) => SEL[id];

export const isDoor = (id) => id >= 77 && id <= 92;
export const isSign = (id) => id >= 131 && id <= 138;
export const isChest = (id) => id >= 61 && id <= 64;
export const isFurnace = (id) => id >= 57 && id <= 60;
export const isWheat = (id) => id >= 69 && id <= 76;
export const isSapling = (id) => id >= 39 && id <= 41;
export const isTorch = (id) => id >= 52 && id <= 56;
export const isLadder = (id) => id >= 65 && id <= 68;

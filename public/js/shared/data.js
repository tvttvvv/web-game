// 게임 데이터: 직업 · 스킬 · 몬스터 · 아이템 · 퀘스트 · NPC · 상점
export const CLASSES = {
  warrior: {
    name: '전사', icon: '⚔️', color: '#e0574f', weapon: 'sword',
    desc: '튼튼한 몸과 검으로 앞장서는 근접 전투가. 적을 끌어모아 동료를 지켜요.',
    range: 2.7, aspd: 0.75, proj: null, spd: 5.2,
    base: { hp: 130, mp: 40, atk: 12, def: 9, crit: 5 }, grow: { hp: 19, mp: 3, atk: 2.6, def: 1.8, crit: 0.1 },
    skills: ['w1', 'w2', 'w3', 'w4'],
  },
  archer: {
    name: '궁수', icon: '🏹', color: '#5cb85c', weapon: 'bow',
    desc: '멀리서 빠르게 화살을 쏘는 사냥꾼. 치명타와 기동력이 뛰어나요.',
    range: 15, aspd: 0.8, proj: 'arrow', spd: 5.6,
    base: { hp: 95, mp: 55, atk: 13, def: 5, crit: 10 }, grow: { hp: 13, mp: 4, atk: 2.8, def: 1.0, crit: 0.2 },
    skills: ['a1', 'a2', 'a3', 'a4'],
  },
  mage: {
    name: '마법사', icon: '🔮', color: '#5b8def', weapon: 'staff',
    desc: '불과 얼음을 다루는 마법사. 강력한 광역 마법으로 적을 한꺼번에 쓸어요.',
    range: 13, aspd: 0.95, proj: 'bolt', spd: 5.2,
    base: { hp: 85, mp: 90, atk: 15, def: 4, crit: 6 }, grow: { hp: 11, mp: 7, atk: 3.1, def: 0.8, crit: 0.1 },
    skills: ['m1', 'm2', 'm3', 'm4'],
  },
  cleric: {
    name: '성직자', icon: '✨', color: '#f0c040', weapon: 'mace',
    desc: '빛의 힘으로 동료를 치유하고 지키는 성직자. 쓰러진 동료도 일으켜요.',
    range: 11, aspd: 0.9, proj: 'holy', spd: 5.3,
    base: { hp: 110, mp: 80, atk: 11, def: 7, crit: 5 }, grow: { hp: 15, mp: 6, atk: 2.3, def: 1.4, crit: 0.1 },
    skills: ['c1', 'c2', 'c3', 'c4'],
  },
};

// type: aoeSelf | dash | buffSelf | cone | fan | aoePoint | line | projAoe | blink | heal | buffAll | revive
export const SKILLS = {
  w1: { name: '회전베기', lv: 1, mp: 15, cd: 5, type: 'aoeSelf', r: 3.8, mult: 1.7, icon: '🌀', desc: '주변의 모든 적을 벱니다' },
  w2: { name: '돌진 베기', lv: 4, mp: 20, cd: 8, type: 'dash', len: 7, w: 1.8, mult: 2.3, icon: '💨', desc: '앞으로 돌진하며 길 위의 적을 벱니다' },
  w3: { name: '전투의 함성', lv: 8, mp: 25, cd: 20, type: 'buffSelf', buff: { def: 0.4, atk: 0.2 }, dur: 8, taunt: 9, icon: '📯', desc: '방어력·공격력이 오르고 주변 적이 나를 노립니다' },
  w4: { name: '대지 가르기', lv: 15, mp: 40, cd: 28, type: 'cone', len: 9, arc: 70, mult: 4.2, stun: 1.2, icon: '⚡', desc: '앞쪽 넓은 범위를 내려쳐 적을 기절시킵니다' },
  a1: { name: '다발 사격', lv: 1, mp: 15, cd: 5, type: 'fan', n: 5, arc: 50, len: 15, mult: 1.1, icon: '🎯', desc: '부채꼴로 화살 5발을 쏩니다' },
  a2: { name: '화살비', lv: 4, mp: 25, cd: 10, type: 'aoePoint', r: 4.2, range: 15, mult: 0.9, ticks: 4, interval: 0.4, icon: '🌧️', desc: '목표 지점에 화살비를 내립니다' },
  a3: { name: '질풍', lv: 8, mp: 20, cd: 15, type: 'buffSelf', buff: { spd: 0.4, crit: 20 }, dur: 6, dash: -5, icon: '🍃', desc: '뒤로 물러나며 이동 속도와 치명타가 오릅니다' },
  a4: { name: '폭풍 화살', lv: 15, mp: 40, cd: 28, type: 'line', len: 24, w: 2, mult: 4.6, icon: '🌪️', desc: '일직선의 모든 적을 꿰뚫는 거대한 화살' },
  m1: { name: '화염구', lv: 1, mp: 18, cd: 4, type: 'projAoe', r: 2.8, range: 14, mult: 2.4, icon: '🔥', desc: '폭발하는 불덩이를 날립니다' },
  m2: { name: '얼음 폭풍', lv: 4, mp: 30, cd: 10, type: 'aoeSelf', r: 5.5, mult: 1.5, slow: 0.5, slowDur: 3, icon: '❄️', desc: '주변 적에게 피해를 주고 느리게 만듭니다' },
  m3: { name: '순간이동', lv: 8, mp: 15, cd: 8, type: 'blink', len: 8, icon: '💫', desc: '바라보는 방향으로 순간이동합니다' },
  m4: { name: '메테오', lv: 15, mp: 50, cd: 32, type: 'aoePoint', r: 6.5, range: 16, mult: 5.2, delay: 1.0, icon: '☄️', desc: '잠시 후 거대한 운석이 떨어집니다' },
  c1: { name: '치유의 빛', lv: 1, mp: 25, cd: 8, type: 'heal', r: 10, heal: 0.22, healAtk: 2.2, icon: '💚', desc: '나와 주변 동료의 체력을 회복합니다' },
  c2: { name: '신성한 심판', lv: 4, mp: 22, cd: 7, type: 'aoePoint', r: 3.8, range: 12, mult: 2.1, stun: 1.0, icon: '☀️', desc: '목표 지점에 빛의 폭발을 일으켜 기절시킵니다' },
  c3: { name: '수호의 축복', lv: 8, mp: 30, cd: 24, type: 'buffAll', r: 12, buff: { def: 0.3, regen: 0.02 }, dur: 10, icon: '🛡️', desc: '주변 동료의 방어력과 회복력을 높입니다' },
  c4: { name: '부활의 기도', lv: 15, mp: 50, cd: 60, type: 'revive', r: 15, heal: 0.5, icon: '🙏', desc: '주변의 쓰러진 동료를 모두 일으키고 회복시킵니다' },
};
export const DODGE = { cd: 2.5, len: 4.5, invuln: 0.35 };

// 몬스터 (lv[0] 기준 능력치, 레벨당 성장)
export const MONSTERS = {
  slime: { name: '초록 슬라임', lv: [1, 3], hp: 40, atk: 6, def: 2, spd: 2.6, range: 1.4, aspd: 1.6, aggro: 7, xp: 12, gold: [1, 4], model: 'slime', color: '#6fd35e', size: 0.9, drops: [['jelly', 0.5]] },
  boar: { name: '성난 멧돼지', lv: [3, 6], hp: 85, atk: 10, def: 4, spd: 3.6, range: 1.7, aspd: 1.5, aggro: 9, xp: 24, gold: [3, 8], model: 'boar', color: '#8a5a3a', size: 1, drops: [['hide', 0.55]] },
  crab: { name: '호수 게', lv: [4, 7], hp: 110, atk: 11, def: 9, spd: 2.8, range: 1.6, aspd: 1.6, aggro: 7, xp: 28, gold: [4, 9], model: 'crab', color: '#e0623a', size: 1, drops: [['shell', 0.5]] },
  mushroom: { name: '독버섯', lv: [5, 8], hp: 80, atk: 12, def: 5, spd: 2.2, range: 9, aspd: 2.0, aggro: 10, xp: 30, gold: [4, 10], model: 'mushroom', color: '#b84ad6', size: 1, ranged: 'spore', drops: [['spore', 0.5]] },
  wolf: { name: '회색 늑대', lv: [6, 9], hp: 115, atk: 14, def: 6, spd: 4.6, range: 1.7, aspd: 1.2, aggro: 12, xp: 38, gold: [5, 12], model: 'wolf', color: '#8c8f99', size: 1, drops: [['fang', 0.55]] },
  goblin: { name: '고블린', lv: [8, 11], hp: 160, atk: 17, def: 8, spd: 3.8, range: 1.7, aspd: 1.3, aggro: 11, xp: 52, gold: [8, 18], model: 'goblin', color: '#6aa84f', size: 0.9, drops: [['goblin_ear', 0.6]] },
  goblin_archer: { name: '고블린 궁수', lv: [9, 12], hp: 130, atk: 18, def: 6, spd: 3.6, range: 11, aspd: 1.8, aggro: 13, xp: 56, gold: [8, 18], model: 'goblin', color: '#7ab85f', size: 0.9, ranged: 'arrow', bow: true, drops: [['goblin_ear', 0.6]] },
  skeleton: { name: '해골 전사', lv: [12, 15], hp: 250, atk: 24, def: 12, spd: 3.4, range: 1.9, aspd: 1.3, aggro: 12, xp: 80, gold: [12, 26], model: 'skeleton', color: '#e8e2cf', size: 1, drops: [['bone', 0.55]] },
  skeleton_archer: { name: '해골 궁수', lv: [13, 16], hp: 210, atk: 25, def: 10, spd: 3.2, range: 12, aspd: 1.9, aggro: 14, xp: 84, gold: [12, 26], model: 'skeleton', color: '#ddd6c0', size: 1, ranged: 'arrow', bow: true, drops: [['bone', 0.55]] },
  bat: { name: '동굴 박쥐', lv: [12, 14], hp: 160, atk: 21, def: 7, spd: 5.4, range: 1.5, aspd: 1.0, aggro: 13, xp: 72, gold: [10, 22], model: 'bat', color: '#5a4a6a', size: 0.9, fly: true, drops: [['bone', 0.3]] },
  rock_golem: { name: '바위 골렘', lv: [15, 18], hp: 540, atk: 34, def: 22, spd: 2.3, range: 2.4, aspd: 2.0, aggro: 9, xp: 130, gold: [20, 40], model: 'golem', color: '#8f8a80', size: 1.4, drops: [['golem_core', 0.45]] },
  orc: { name: '오크 전사', lv: [18, 22], hp: 660, atk: 42, def: 24, spd: 3.6, range: 2.2, aspd: 1.4, aggro: 12, xp: 170, gold: [26, 52], model: 'orc', color: '#5f8a3a', size: 1.25, drops: [['orc_totem', 0.5]] },
  orc_shaman: { name: '오크 주술사', lv: [19, 23], hp: 520, atk: 44, def: 18, spd: 3.2, range: 12, aspd: 2.0, aggro: 14, xp: 180, gold: [26, 52], model: 'orc', color: '#7a6a3a', size: 1.15, ranged: 'fire', staff: true, drops: [['orc_totem', 0.5]] },
  imp: { name: '불꽃 임프', lv: [22, 26], hp: 560, atk: 50, def: 20, spd: 4.8, range: 1.8, aspd: 1.1, aggro: 13, xp: 210, gold: [30, 60], model: 'imp', color: '#e8542a', size: 1, fly: true, drops: [['flame', 0.5]] },
  // 보스
  slime_king: { name: '슬라임 킹', boss: true, lv: [6, 6], hp: 2600, atk: 20, def: 8, spd: 2.6, range: 3.2, aspd: 1.8, aggro: 16, xp: 700, gold: [90, 160], model: 'slime', color: '#4ab2ff', size: 3.2, respawn: 300, crown: true, drops: [['jelly', 1]] },
  treant: { name: '숲의 수호자', boss: true, lv: [13, 13], hp: 8000, atk: 38, def: 16, spd: 2.2, range: 3.6, aspd: 2.0, aggro: 18, xp: 2600, gold: [300, 500], model: 'treant', color: '#6b4a2a', size: 2.6, respawn: 420, drops: [['fang', 1]] },
  ancient_golem: { name: '고대 골렘', boss: true, lv: [20, 20], hp: 18000, atk: 60, def: 32, spd: 2.2, range: 4.2, aspd: 2.2, aggro: 18, xp: 7000, gold: [800, 1300], model: 'golem', color: '#7a6f62', size: 3.2, respawn: 480, drops: [['golem_core', 1]] },
  lava_giant: { name: '용암 거인', boss: true, lv: [27, 27], hp: 36000, atk: 88, def: 40, spd: 2.4, range: 4.6, aspd: 2.2, aggro: 20, xp: 16000, gold: [2000, 3200], model: 'giant', color: '#b8402a', size: 3.6, respawn: 600, drops: [['flame', 1]] },
};

// ---------- 아이템 ----------
export const RARITY = [
  { name: '일반', color: '#e6e6e6', mult: 1, bonus: 0 },
  { name: '고급', color: '#5ee06a', mult: 1.12, bonus: 1 },
  { name: '희귀', color: '#4aa8ff', mult: 1.28, bonus: 2 },
  { name: '영웅', color: '#c27bff', mult: 1.5, bonus: 3 },
  { name: '전설', color: '#ffa531', mult: 1.85, bonus: 4 },
];
export const TIER_LV = [1, 6, 12, 18, 24];
const WEAPON_NAMES = {
  warrior: ['낡은 검', '강철 장검', '기사의 검', '룬 블레이드', '용살자'],
  archer: ['사냥꾼의 활', '강철 장궁', '엘프의 활', '바람의 활', '태양의 활'],
  mage: ['견습생 지팡이', '수정 지팡이', '현자의 지팡이', '별빛 지팡이', '대마법사의 지팡이'],
  cleric: ['나무 철퇴', '강철 철퇴', '축복의 철퇴', '성기사의 망치', '빛의 망치'],
};
const ARMOR_NAMES = {
  helm: ['가죽 모자', '사슬 투구', '강철 투구', '룬 투구', '영웅의 왕관'],
  armor: ['가죽 갑옷', '사슬 갑옷', '판금 갑옷', '룬 갑옷', '영웅의 갑옷'],
  boots: ['가죽 신발', '사슬 장화', '강철 장화', '룬 장화', '바람의 장화'],
  ring: ['구리 반지', '은 반지', '금 반지', '룬 반지', '별의 반지'],
};
// 부위별 기본 능력치 (단계별)
export const GEAR_BASE = {
  weapon: { atk: [7, 18, 33, 52, 78] },
  helm: { def: [3, 7, 13, 21, 31], hp: [10, 25, 50, 85, 130] },
  armor: { def: [6, 13, 24, 38, 56], hp: [20, 45, 90, 150, 230] },
  boots: { def: [2, 5, 10, 16, 24], spd: [3, 4, 5, 6, 8] },
  ring: { crit: [2, 3, 4, 5, 7], mp: [10, 25, 45, 70, 100], atk: [2, 5, 9, 14, 20] },
};
export const STAT_NAMES = { atk: '공격력', def: '방어력', hp: '최대 체력', mp: '최대 마나', crit: '치명타 확률', aspd: '공격 속도', spd: '이동 속도', critdmg: '치명타 피해' };
export const PCT_STATS = new Set(['crit', 'aspd', 'spd', 'critdmg']);
// 추가 옵션: 아이템 레벨에 따른 최대값
export const BONUS_POOL = {
  atk: (l) => 1 + l * 0.9, def: (l) => 1 + l * 0.7, hp: (l) => 8 + l * 6, mp: (l) => 5 + l * 3,
  crit: (l) => 1 + l * 0.15, aspd: (l) => 3 + l * 0.2, spd: (l) => 2 + l * 0.12, critdmg: (l) => 5 + l * 0.8,
};

export const GEAR = {}; // key → { slot, cls?, tier, name }
for (const cls in WEAPON_NAMES) WEAPON_NAMES[cls].forEach((n, t) => { GEAR[`${cls}_w${t}`] = { slot: 'weapon', cls, tier: t, name: n }; });
for (const slot in ARMOR_NAMES) ARMOR_NAMES[slot].forEach((n, t) => { GEAR[`${slot}_${t}`] = { slot, tier: t, name: n }; });

// 겹쳐지는 아이템 (소모품 · 재료)
export const STACK = {
  hp1: { name: '체력 물약', icon: '🧪', heal: 90, price: 25, desc: '체력을 90 회복' },
  hp2: { name: '중급 체력 물약', icon: '🧪', heal: 300, price: 90, desc: '체력을 300 회복' },
  hp3: { name: '고급 체력 물약', icon: '🧪', heal: 900, price: 260, desc: '체력을 900 회복' },
  mp1: { name: '마나 물약', icon: '💧', mana: 60, price: 25, desc: '마나를 60 회복' },
  mp2: { name: '중급 마나 물약', icon: '💧', mana: 180, price: 90, desc: '마나를 180 회복' },
  mp3: { name: '고급 마나 물약', icon: '💧', mana: 450, price: 260, desc: '마나를 450 회복' },
  scroll: { name: '귀환 주문서', icon: '📜', price: 60, desc: '마을로 돌아갑니다' },
  stone: { name: '강화석', icon: '💎', price: 220, desc: '장비 강화에 쓰여요' },
  jelly: { name: '슬라임 젤리', icon: '🟢', price: 4, desc: '말랑말랑한 젤리' },
  hide: { name: '멧돼지 가죽', icon: '🟤', price: 8, desc: '질긴 가죽' },
  shell: { name: '단단한 게 껍질', icon: '🦀', price: 10, desc: '방패처럼 단단해요' },
  spore: { name: '독 포자', icon: '🍄', price: 10, desc: '맨손으로 만지면 안 돼요' },
  fang: { name: '늑대 송곳니', icon: '🦷', price: 14, desc: '날카로운 송곳니' },
  goblin_ear: { name: '고블린 귀', icon: '👂', price: 18, desc: '고블린 토벌의 증표' },
  bone: { name: '오래된 뼈', icon: '🦴', price: 24, desc: '저주받은 뼈' },
  golem_core: { name: '골렘의 핵', icon: '🔶', price: 40, desc: '희미하게 빛나는 돌' },
  orc_totem: { name: '오크 토템', icon: '🗿', price: 50, desc: '오크 부족의 상징' },
  flame: { name: '불꽃 정수', icon: '🔥', price: 60, desc: '꺼지지 않는 불꽃' },
};
export const POTION_CD = 1.2;

// ---------- NPC · 상점 · 퀘스트 ----------
export const NPCS = {
  chief: { name: '촌장 엘다', title: '새벽 마을 촌장', color: '#8e6bd1', hi: ['어서 오게, 모험가여. 이 섬은 요즘 몬스터 때문에 시끄럽다네.', '자네 같은 젊은이가 있어 든든하구먼.'] },
  merchant: { name: '상인 미나', title: '잡화점', color: '#e47bb2', shop: 'general', hi: ['물약 없이 사냥 나가면 큰일나요!', '필요한 건 다 있어요. 구경하고 가세요~'] },
  smith: { name: '대장장이 볼트', title: '무기 · 방어구 · 강화', color: '#c0392b', shop: 'smith', enhance: true, hi: ['장비가 좋아야 오래 살아남지.', '강화는 운이야. 하지만 실패해도 장비는 안 부서지니 걱정 말게.'] },
  innkeeper: { name: '여관주인 로사', title: '여관', color: '#16a085', heal: true, hi: ['푹 쉬고 가요. 체력과 마나를 모두 채워 드릴게요.'] },
  board: { name: '현상금 게시판', title: '반복 의뢰', color: '#a0784a', board: true, hi: ['[현상금] 섬 곳곳의 몬스터를 처치해 주실 분을 찾습니다.'] },
  scout: { name: '정찰병 카일', title: '숲 야영지', color: '#2a7a4a', shop: 'camp', hi: ['쉿… 숲속에서 큰 기척이 느껴져.'] },
  miner: { name: '광부 두란', title: '협곡 야영지', color: '#7a5a3a', shop: 'camp', hi: ['해골들이 갱도에서 기어나오고 있어!'] },
  scholar: { name: '연구가 세라', title: '황무지 야영지', color: '#d35400', shop: 'camp2', hi: ['용암 거인이 깨어나면 섬 전체가 위험해요.'] },
  fisher: { name: '낚시꾼 한스', title: '호수 야영지', color: '#3a7ad9', shop: 'camp', hi: ['호수 게가 낚싯줄을 다 끊어 먹는다니까.'] },
};
export const SHOPS = {
  general: ['hp1', 'hp2', 'mp1', 'mp2', 'scroll'],
  camp: ['hp1', 'hp2', 'mp1', 'mp2', 'scroll'],
  camp2: ['hp2', 'hp3', 'mp2', 'mp3', 'scroll'],
  smith: ['stone', '@warrior_w0', '@archer_w0', '@mage_w0', '@cleric_w0', '@helm_0', '@armor_0', '@boots_0', '@ring_0',
    '@warrior_w1', '@archer_w1', '@mage_w1', '@cleric_w1', '@helm_1', '@armor_1', '@boots_1', '@ring_1'],
};

// obj.type: talk | kill | collect | boss
export const QUESTS = [
  { id: 'q1', name: '새벽 마을에 오신 걸 환영해요', npc: 'chief', lv: 1, obj: { type: 'talk', npc: 'chief' }, text: '섬에 온 걸 환영하네! 우선 이걸 받게. 물약은 위험할 때 꼭 마시게나.', reward: { xp: 40, gold: 30, items: [['hp1', 5], ['mp1', 3]] } },
  { id: 'q2', name: '말랑말랑한 골칫거리', npc: 'chief', lv: 1, pre: 'q1', obj: { type: 'kill', mob: 'slime', n: 8 }, text: '마을 밖 들판에 슬라임이 너무 많아졌어. 8마리만 처치해 주게.', reward: { xp: 120, gold: 60, gear: 'weapon', rar: 1 } },
  { id: 'q3', name: '멧돼지 가죽 모으기', npc: 'smith', lv: 3, pre: 'q2', obj: { type: 'collect', item: 'hide', n: 5 }, text: '갑옷을 만들 가죽이 필요해. 멧돼지 가죽 5장을 구해 오게.', reward: { xp: 260, gold: 120, gear: 'armor', rar: 1 } },
  { id: 'q4', name: '슬라임 킹 토벌', npc: 'chief', lv: 5, pre: 'q3', obj: { type: 'boss', mob: 'slime_king' }, text: '북동쪽 들판에 거대한 슬라임 킹이 나타났다네! 다른 모험가와 힘을 합쳐 물리쳐 주게.', reward: { xp: 700, gold: 300, gear: 'random', rar: 2 } },
  { id: 'q5', name: '숲의 정찰병을 찾아서', npc: 'chief', lv: 6, pre: 'q4', obj: { type: 'talk', npc: 'scout' }, text: '서쪽 숲에서 정찰병 카일의 연락이 끊겼어. 숲 야영지로 가 보게.', reward: { xp: 300, gold: 80 } },
  { id: 'q6', name: '늑대 무리', npc: 'scout', lv: 6, pre: 'q5', obj: { type: 'kill', mob: 'wolf', n: 12 }, text: '늑대들이 야영지를 노리고 있어. 12마리만 쫓아내 줘.', reward: { xp: 900, gold: 200, items: [['hp2', 5]] } },
  { id: 'q7', name: '고블린의 귀', npc: 'scout', lv: 8, pre: 'q6', obj: { type: 'collect', item: 'goblin_ear', n: 8 }, text: '숲 깊은 곳 고블린들이 무기를 모으고 있어. 고블린 귀 8개를 증거로 가져와.', reward: { xp: 1400, gold: 300, gear: 'weapon', rar: 2 } },
  { id: 'q8', name: '숲의 수호자', npc: 'scout', lv: 11, pre: 'q7', obj: { type: 'boss', mob: 'treant' }, text: '숲의 수호자가 미쳐 날뛰고 있어. 숲 가장 깊은 곳이야. 동료를 모아서 가!', reward: { xp: 3000, gold: 800, gear: 'random', rar: 3 } },
  { id: 'q9', name: '협곡의 광부', npc: 'scout', lv: 12, pre: 'q8', obj: { type: 'talk', npc: 'miner' }, text: '동쪽 협곡의 광부 두란이 도움을 청했어. 협곡 야영지로 가 봐.', reward: { xp: 800, gold: 150 } },
  { id: 'q10', name: '잠들지 못한 해골', npc: 'miner', lv: 12, pre: 'q9', obj: { type: 'kill', mob: 'skeleton', n: 15 }, text: '갱도에서 해골들이 쏟아져 나와. 15마리를 다시 잠재워 줘!', reward: { xp: 3600, gold: 600, items: [['stone', 3]] } },
  { id: 'q11', name: '골렘의 핵', npc: 'miner', lv: 15, pre: 'q10', obj: { type: 'collect', item: 'golem_core', n: 5 }, text: '바위 골렘의 핵이 있으면 갱도를 다시 밝힐 수 있어. 5개 부탁해.', reward: { xp: 5200, gold: 900, gear: 'armor', rar: 3 } },
  { id: 'q12', name: '고대 골렘', npc: 'miner', lv: 18, pre: 'q11', obj: { type: 'boss', mob: 'ancient_golem' }, text: '협곡 끝에서 고대 골렘이 깨어났어. 땅이 흔들린다고!', reward: { xp: 9000, gold: 2000, gear: 'random', rar: 3 } },
  { id: 'q13', name: '황무지의 연구가', npc: 'miner', lv: 18, pre: 'q12', obj: { type: 'talk', npc: 'scholar' }, text: '남쪽 황무지에 불의 기운을 연구하는 세라가 있어. 찾아가 봐.', reward: { xp: 2000, gold: 300 } },
  { id: 'q14', name: '오크 군단', npc: 'scholar', lv: 18, pre: 'q13', obj: { type: 'kill', mob: 'orc', n: 20 }, text: '오크 군단이 용암 거인을 깨우려 해요. 오크 전사 20명을 막아 주세요.', reward: { xp: 12000, gold: 2500, items: [['hp3', 5]] } },
  { id: 'q15', name: '불꽃 정수', npc: 'scholar', lv: 22, pre: 'q14', obj: { type: 'collect', item: 'flame', n: 8 }, text: '거인을 막을 결계에 불꽃 정수 8개가 필요해요.', reward: { xp: 16000, gold: 3500, gear: 'weapon', rar: 3 } },
  { id: 'q16', name: '용암 거인', npc: 'scholar', lv: 25, pre: 'q15', obj: { type: 'boss', mob: 'lava_giant' }, text: '결국 용암 거인이 깨어났어요! 섬의 모든 모험가를 모아 주세요!', reward: { xp: 30000, gold: 8000, gear: 'random', rar: 4, title: '용암을 걷는 자' } },
];
export const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

// 현상금(반복) 의뢰 대상: 레벨에 맞는 몬스터
export const BOUNTY_MOBS = ['slime', 'boar', 'crab', 'mushroom', 'wolf', 'goblin', 'skeleton', 'bat', 'rock_golem', 'orc', 'imp'];

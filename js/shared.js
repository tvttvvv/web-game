// 서버/클라이언트 공용 상수와 로직 (이동·충돌을 양쪽이 똑같이 계산)
export const CHUNK = 32;

export const T = {
  WATER: 0, SAND: 1, GRASS: 2, TREE: 3, ROCK: 4,
  WOOD_WALL: 5, STONE_WALL: 6, FLOOR: 7, FLAG: 8,
};
const SOLID = [1, 0, 0, 1, 1, 1, 1, 0, 1];
export const isSolidTile = (v) => SOLID[v] === 1;

export const SPEED = 5;        // 플레이어 이동속도 (타일/초)
export const PLAYER_R = 0.3;
export const MOB_R = 0.32;
export const REACH = 4.5;      // 채집/건축 가능 거리
export const SAFE_R = 12;      // 마을(안전지대) 반경
export const CLAIM_R = 7;      // 깃발 영역 반경 (15x15)
export const MAX_HP = 10;
export const MAX_FLAGS = 3;
export const DAY_LEN = 300;    // 하루(초)

// 설치 가능한 블록 (cost: 소모 자원)
export const BUILD = {
  wood_wall:  { tile: T.WOOD_WALL,  cost: { wood: 2 },            label: '나무벽' },
  stone_wall: { tile: T.STONE_WALL, cost: { stone: 2 },           label: '돌벽' },
  floor:      { tile: T.FLOOR,      cost: { wood: 1 },            label: '바닥' },
  flag:       { tile: T.FLAG,       cost: { wood: 10, stone: 5 }, label: '깃발' },
};
// 부술 때 얻는 자원
export const DROPS = {
  [T.TREE]: { wood: 2 }, [T.ROCK]: { stone: 2 },
  [T.WOOD_WALL]: { wood: 1 }, [T.STONE_WALL]: { stone: 1 },
  [T.FLOOR]: { wood: 1 }, [T.FLAG]: { wood: 5, stone: 2 },
};

// t: 0..1 하루 중 시각. 0~0.55 낮, 0.55~0.65 해질녘, 0.65~0.9 밤, 0.9~1 새벽
export function darkness(t) {
  if (t < 0.55) return 0;
  if (t < 0.65) return (t - 0.55) / 0.1;
  if (t < 0.9) return 1;
  return 1 - (t - 0.9) / 0.1;
}
export const mobTime = (t) => t > 0.62 && t < 0.93;

export const inSafe = (x, y) => Math.hypot(x, y) < SAFE_R;

function collides(x, y, r, solidAt) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (solidAt(tx, ty)) return true;
  return false;
}

// pos({x,y})를 (dx,dy) 방향으로 dist만큼 이동. 축별로 나눠 벽을 따라 미끄러짐
export function moveEntity(pos, dx, dy, dist, r, solidAt) {
  const nx = pos.x + dx * dist;
  if (!collides(nx, pos.y, r, solidAt)) pos.x = nx;
  const ny = pos.y + dy * dist;
  if (!collides(pos.x, ny, r, solidAt)) pos.y = ny;
}

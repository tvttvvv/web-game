// 설치 규칙 (호스트 판정 + 클라이언트 예측 공용)
import { BLOCKS, B, SOLID, OPAQUE, isSign } from './blocks.js';
import { ITEMS, I } from './items.js';
import { DIRS, FACES } from './constants.js';

export function dirOf(dx, dz) {
  for (let e = 0; e < 4; e++) if (DIRS[e][0] === dx && DIRS[e][1] === dz) return e;
  return 0;
}
export const replaceable = (id) => id === 0 || (BLOCKS[id] && BLOCKS[id].replaceable);
const groundOk = (b) => b === B.grass || b === B.dirt || b === B.snowy_grass || b === B.farmland;

// itemId를 (x,y,z)에 놓을 때 실제 블록 id. f=클릭한 면, d=플레이어가 보는 방향
// → { id, extra:[x,y,z,id]|null } 또는 { err }
export function resolvePlacement(itemId, x, y, z, f, d, getBlock) {
  const it = ITEMS[itemId];
  if (!it || (it.block === undefined && !it.place)) return { err: '' };
  if (!replaceable(getBlock(x, y, z))) return { err: '' };
  const below = getBlock(x, y - 1, z);
  const N = FACES[f] || [0, 1, 0];
  const side = f !== 2 && f !== 3;
  const sup = side ? getBlock(x - N[0], y, z - N[2]) : 0;
  let id = it.block, extra = null;
  if (it.place === 'seeds') {
    if (below !== B.farmland) return { err: '씨앗은 경작지에 심어요 (괭이로 흙을 갈아 주세요)' };
    id = B.wheat_0;
  } else if (BLOCKS[id].support === 'ground' && !isSign(id)) {
    if (!groundOk(below)) return { err: '흙이나 잔디 위에 심어요' };
  } else if (id === B.cactus) {
    if (below !== B.sand && below !== B.cactus) return { err: '선인장은 모래 위에 심어요' };
  } else if (id === B.torch) {
    if (side && SOLID[sup] && OPAQUE[sup]) id = 53 + dirOf(-N[0], -N[2]);
    else if (!SOLID[below]) return { err: '받침이 필요해요' };
  } else if (id === I.ladder) {
    if (!side || !OPAQUE[sup]) return { err: '사다리는 벽에 붙여요' };
    id = 65 + dirOf(-N[0], -N[2]);
  } else if (id === I.sign) {
    if (f === 2) { if (!SOLID[below]) return { err: '받침이 필요해요' }; id = 135 + (d + 2) % 4; }
    else if (side && SOLID[sup]) id = 131 + dirOf(-N[0], -N[2]);
    else return { err: '벽이나 바닥에 붙여요' };
  } else if (id === I.door) {
    if (!SOLID[below]) return { err: '문은 땅 위에 세워요' };
    if (!replaceable(getBlock(x, y + 1, z))) return { err: '문 위에 한 칸이 더 필요해요' };
    id = 77 + d;
    extra = [x, y + 1, z, 77 + 8 + d];
  } else if (BLOCKS[id] && BLOCKS[id].stairs) id += d;
  else if (id === I.furnace || id === I.chest) id += d;
  return { id, extra };
}

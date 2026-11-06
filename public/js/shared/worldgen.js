// 결정적 지형 생성: 같은 시드면 어디서 생성해도 같은 월드
import { makeNoise, hash2, hash3, mulberry32, smoothstep, lerp } from './noise.js';
import { CS, CH, SEA, idx } from './constants.js';
import { B } from './blocks.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, DESERT: 5, SNOWY: 6, TAIGA: 7, MOUNTAIN: 8 };
export const BIOME_NAMES = ['바다', '해변', '평원', '숲', '자작나무 숲', '사막', '설원', '침엽수림', '산'];
export const PLAZA_R = 5;

export function createGenerator(seed) {
  const nC = makeNoise(seed + 11), nH = makeNoise(seed + 13), nM = makeNoise(seed + 23), nR = makeNoise(seed + 37);
  const nT = makeNoise(seed + 41), nW = makeNoise(seed + 53), nF = makeNoise(seed + 59);
  const nK1 = makeNoise(seed + 61), nK2 = makeNoise(seed + 67), nK3 = makeNoise(seed + 71);

  function raw(x, z) {
    const cont = nC.fbm2(x / 420, z / 420, 3);
    const hills = nH.fbm2(x / 96, z / 96, 4);
    const mmask = (nM.fbm2(x / 320, z / 320, 2) + 1) / 2;
    const ridge = 1 - Math.abs(nR.fbm2(x / 150, z / 150, 4));
    const temp = nT.fbm2(x / 700, z / 700, 2) * 1.7;
    const hum = nW.fbm2(x / 560, z / 560, 2) * 1.7;
    const d = Math.hypot(x, z);
    const m = smoothstep(0.52, 0.78, mmask) * smoothstep(50, 120, d);
    let h = SEA + 3 + cont * 16 + hills * 7 + m * ridge * ridge * 46;
    const desert = smoothstep(0.2, 0.45, temp) * smoothstep(0.05, -0.2, hum) * (1 - m);
    h = lerp(h, SEA + 5 + hills * 3, desert * 0.6);
    const land = smoothstep(90, 28, d); // 스폰 근처는 육지
    h = lerp(h, Math.max(h, SEA + 6 + hills * 3), land);
    return { h, temp, hum, m, desert };
  }

  const plazaY = Math.max(SEA + 4, Math.round(raw(0, 0).h));
  const spawn = [0.5, plazaY + 1, 0.5];

  const colCache = new Map();
  function column(x, z) {
    const k = x * 73856093 ^ z * 19349663;
    let c = colCache.get(k);
    if (c && c.x === x && c.z === z) return c;
    const r = raw(x, z);
    let h = r.h;
    const cd = Math.max(Math.abs(x), Math.abs(z));
    if (cd <= PLAZA_R) h = plazaY;
    else if (cd <= PLAZA_R + 8) h = lerp(plazaY, h, (cd - PLAZA_R) / 8);
    h = Math.max(4, Math.min(CH - 12, Math.round(h)));
    let biome;
    if (h < SEA - 1) biome = BIOME.OCEAN;
    else if (h <= SEA + 1 && r.m < 0.3) biome = BIOME.BEACH;
    else if (r.m > 0.45 && h > SEA + 22) biome = BIOME.MOUNTAIN;
    else if (r.desert > 0.5) biome = BIOME.DESERT;
    else if (r.temp < -0.35) biome = r.hum > 0 ? BIOME.TAIGA : BIOME.SNOWY;
    else if (r.hum > 0.25) biome = r.temp > 0.1 ? BIOME.BIRCH : BIOME.FOREST;
    else biome = BIOME.PLAINS;
    c = { x, z, h, biome, cold: r.temp < -0.35, plaza: cd <= PLAZA_R };
    if (colCache.size > 20000) colCache.clear();
    colCache.set(k, c);
    return c;
  }

  // 동굴 판정 (격자 보간 없이 한 점)
  function caveAt(x, y, z) {
    const a = nK1.noise3(x / 45, y / 24, z / 45), b = nK2.noise3(x / 45, y / 24, z / 45);
    if (a * a + b * b < 0.0125) return true;
    return y < 36 && nK3.noise3(x / 90, y / 48, z / 90) > 0.62;
  }

  // ---------- 나무 ----------
  function treeBlocks(type, x, y, z, rnd) {
    const out = [];
    const log = type === 'birch' ? B.log_birch : type === 'spruce' ? B.log_spruce : B.log_oak;
    const leaf = type === 'birch' ? B.leaves_birch : type === 'spruce' ? B.leaves_spruce : B.leaves_oak;
    if (type === 'spruce') {
      const h = 6 + Math.floor(rnd() * 4);
      const top = y + h - 1;
      for (let i = 0; i < h; i++) out.push([x, y + i, z, log]);
      out.push([x, top + 1, z, leaf]);
      let k = 0;
      for (let ly = top; ly >= y + 2; ly--, k++) {
        const r = k === 0 ? 1 : (k % 2 === 1 ? Math.min(2, 1 + (k >> 2)) : 1);
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
            out.push([x + dx, ly, z + dz, leaf]);
          }
      }
      return out;
    }
    const h = (type === 'birch' ? 5 : 4) + Math.floor(rnd() * 3);
    const top = y + h - 1;
    for (let ly = top - 2; ly <= top + 1; ly++) {
      const r = ly <= top - 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (ly === top + 1 || rnd() < 0.5)) continue;
          out.push([x + dx, ly, z + dz, leaf]);
        }
    }
    for (let i = 0; i < h; i++) out.push([x, y + i, z, log]);
    return out;
  }

  const TREE_CHANCE = [0, 0, 0.005, 0.05, 0.05, 0, 0.007, 0.045, 0.012];
  function treeAt(x, z) {
    const c = column(x, z);
    const ch = TREE_CHANCE[c.biome];
    if (!ch || Math.hypot(x, z) < 16) return null;
    if (c.biome === BIOME.MOUNTAIN && c.h > SEA + 30) return null;
    const hv = hash2(seed + 7, x, z);
    if (hv >= ch) return null;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if ((dx || dz) && hash2(seed + 7, x + dx, z + dz) < hv) return null; // 근처 나무와 겹치지 않게
    if (caveAt(x, c.h, z) || caveAt(x, c.h - 1, z)) return null;
    let type = 'oak';
    if (c.biome === BIOME.BIRCH) type = hash2(seed + 9, x, z) < 0.8 ? 'birch' : 'oak';
    else if (c.biome === BIOME.TAIGA || c.biome === BIOME.SNOWY || c.biome === BIOME.MOUNTAIN) type = 'spruce';
    else if (c.biome === BIOME.FOREST && hash2(seed + 9, x, z) < 0.2) type = 'birch';
    return { type, y: c.h + 1 };
  }

  // ---------- 청크 생성 ----------
  function genChunk(cx, cz) {
    const v = new Uint8Array(CS * CS * CH);
    const x0 = cx * CS, z0 = cz * CS;
    const cols = new Array(CS * CS);

    // 동굴 노이즈를 4칸 간격 격자로 계산 후 보간
    const GX = CS / 4 + 1, GY = CH / 4 + 1;
    const ga = new Float32Array(GX * GX * GY), gb = new Float32Array(GX * GX * GY), gc = new Float32Array(GX * GX * GY);
    for (let gx = 0; gx < GX; gx++)
      for (let gz = 0; gz < GX; gz++)
        for (let gy = 0; gy < GY; gy++) {
          const X = x0 + gx * 4, Y = gy * 4, Z = z0 + gz * 4, i = (gy * GX + gz) * GX + gx;
          ga[i] = nK1.noise3(X / 45, Y / 24, Z / 45);
          gb[i] = nK2.noise3(X / 45, Y / 24, Z / 45);
          gc[i] = Y < 44 ? nK3.noise3(X / 90, Y / 48, Z / 90) : -1;
        }
    const tri = (g, lx, y, lz) => {
      const fx = lx / 4, fy = y / 4, fz = lz / 4;
      const ix = Math.min(GX - 2, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(GX - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i000 = (iy * GX + iz) * GX + ix;
      const sY = GX * GX, sZ = GX;
      const c00 = g[i000] * (1 - tx) + g[i000 + 1] * tx;
      const c01 = g[i000 + sZ] * (1 - tx) + g[i000 + sZ + 1] * tx;
      const c10 = g[i000 + sY] * (1 - tx) + g[i000 + sY + 1] * tx;
      const c11 = g[i000 + sY + sZ] * (1 - tx) + g[i000 + sY + sZ + 1] * tx;
      return (c00 * (1 - tz) + c01 * tz) * (1 - ty) + (c10 * (1 - tz) + c11 * tz) * ty;
    };

    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const c = column(x, z);
        cols[lz * CS + lx] = c;
        const h = c.h;
        // 지표 블록
        let top = B.grass, fill = B.dirt, depth = 3, under = B.stone, underDepth = 0;
        switch (c.biome) {
          case BIOME.OCEAN: top = nF.noise2(x / 18, z / 18) > 0.3 ? B.gravel : B.sand; fill = top; depth = 3; break;
          case BIOME.BEACH: top = B.sand; fill = B.sand; depth = 3; under = B.sandstone; underDepth = 2; break;
          case BIOME.DESERT: top = B.sand; fill = B.sand; depth = 4; under = B.sandstone; underDepth = 4; break;
          case BIOME.SNOWY: top = B.snowy_grass; break;
          case BIOME.TAIGA: top = c.cold && hash2(seed + 3, x, z) < 0.5 ? B.snowy_grass : B.grass; break;
          case BIOME.MOUNTAIN:
            if (h > SEA + 42) { top = B.snow; fill = B.stone; }
            else if (h > SEA + 30) { top = B.stone; fill = B.stone; }
            break;
        }
        if (h <= SEA && c.biome !== BIOME.OCEAN && c.biome !== BIOME.DESERT) { top = B.sand; fill = B.sand; }
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === 0) b = B.bedrock;
          else if (y <= 2 && hash3(seed, x, y, z) < (y === 1 ? 0.6 : 0.3)) b = B.bedrock;
          else if (y === h) b = top;
          else if (y > h - 1 - depth) b = fill;
          else if (y > h - 1 - depth - underDepth) b = under;
          else b = B.stone;
          v[idx(lx, y, lz)] = b;
        }
        if (c.plaza) {
          const ax = Math.abs(x), az = Math.abs(z);
          v[idx(lx, h, lz)] = ax === PLAZA_R || az === PLAZA_R || x === 0 || z === 0 ? B.stone_bricks : B.smooth_stone;
          for (let y = h - 3; y < h; y++) v[idx(lx, y, lz)] = B.stone;
        }
        // 물
        for (let y = h + 1; y <= SEA; y++) v[idx(lx, y, lz)] = (y === SEA && c.cold) ? B.ice : B.water;
        // 동굴
        if (!c.plaza) {
          const wet = h <= SEA + 1;
          const maxY = wet ? h - 6 : h;
          for (let y = 3; y <= maxY; y++) {
            const a = tri(ga, lx, y, lz), b2 = tri(gb, lx, y, lz);
            let cave = a * a + b2 * b2 < 0.0125;
            if (!cave && y < 36) cave = tri(gc, lx, y, lz) > 0.62;
            if (cave) {
              const i = idx(lx, y, lz);
              if (v[i] !== B.bedrock && v[i] !== B.water) v[i] = 0;
            }
          }
        }
      }

    // 광물 줄기 (청크 안에서만)
    const rnd = mulberry32(hash2(seed + 101, cx, cz) * 4294967296);
    const VEINS = [[B.coal_ore, 18, 9, 5, 85], [B.iron_ore, 11, 6, 5, 60], [B.gold_ore, 3, 6, 5, 34], [B.diamond_ore, 2, 4, 3, 16], [B.gravel, 5, 14, 5, 70], [B.dirt, 4, 14, 30, 80]];
    for (const [ore, count, size, ymin, ymax] of VEINS) {
      for (let n = 0; n < count; n++) {
        if (ore === B.diamond_ore && rnd() < 0.3) continue;
        let x = Math.floor(rnd() * CS), y = ymin + Math.floor(rnd() * (ymax - ymin)), z = Math.floor(rnd() * CS);
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < CS && z >= 0 && z < CS && y > 0 && y < CH) {
            const i = idx(x, y, z);
            if (v[i] === B.stone) v[i] = ore;
          }
          x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1; z += Math.floor(rnd() * 3) - 1;
        }
      }
    }

    // 나무 (주변 3칸 바깥에서 자란 나무도 이 청크에 걸치면 그림)
    for (let wz = z0 - 3; wz < z0 + CS + 3; wz++)
      for (let wx = x0 - 3; wx < x0 + CS + 3; wx++) {
        const t = treeAt(wx, wz);
        if (!t) continue;
        const tr = mulberry32(hash2(seed + 17, wx, wz) * 4294967296);
        for (const [bx, by, bz, id] of treeBlocks(t.type, wx, t.y, wz, tr)) {
          const lx = bx - x0, lz = bz - z0;
          if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || by <= 0 || by >= CH) continue;
          const i = idx(lx, by, lz), cur = v[i];
          const isLog = id === B.log_oak || id === B.log_birch || id === B.log_spruce;
          if (cur === 0 || (isLog && (cur === B.leaves_oak || cur === B.leaves_birch || cur === B.leaves_spruce))) v[i] = id;
        }
        const lx = wx - x0, lz = wz - z0;
        if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) v[idx(lx, t.y - 1, lz)] = B.dirt;
      }

    // 풀 · 꽃 · 선인장
    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const c = cols[lz * CS + lx];
        const x = x0 + lx, z = z0 + lz, y = c.h + 1;
        if (y >= CH - 4 || c.plaza) continue;
        const ground = v[idx(lx, c.h, lz)];
        if (v[idx(lx, y, lz)] !== 0) continue;
        const r = hash2(seed + 29, x, z);
        if (ground === B.grass) {
          const grassP = c.biome === BIOME.PLAINS ? 0.2 : c.biome === BIOME.TAIGA ? 0.06 : 0.09;
          const flowerP = c.biome === BIOME.PLAINS ? 0.022 : 0.01;
          if (r < flowerP) {
            const f = nF.noise2(x / 24, z / 24);
            v[idx(lx, y, lz)] = f < -0.3 ? B.flower_blue : f < 0 ? B.flower_red : f < 0.3 ? B.flower_yellow : B.flower_white;
          } else if (r < flowerP + grassP) v[idx(lx, y, lz)] = B.tall_grass;
        } else if (ground === B.sand && c.biome === BIOME.DESERT) {
          if (r < 0.005) {
            const hgt = 1 + Math.floor(hash2(seed + 31, x, z) * 3);
            for (let k = 0; k < hgt && y + k < CH; k++) v[idx(lx, y + k, lz)] = B.cactus;
          } else if (r < 0.013) v[idx(lx, y, lz)] = B.dead_bush;
        }
      }

    // 스폰 광장 장식
    if (Math.abs(cx * CS + 8) < 24 && Math.abs(cz * CS + 8) < 24) {
      const put = (x, y, z, id) => {
        const lx = x - x0, lz = z - z0;
        if (lx >= 0 && lx < CS && lz >= 0 && lz < CS && y > 0 && y < CH) v[idx(lx, y, lz)] = id;
      };
      for (let x = -PLAZA_R; x <= PLAZA_R; x++)
        for (let z = -PLAZA_R; z <= PLAZA_R; z++)
          for (let y = plazaY + 1; y <= plazaY + 12; y++) put(x, y, z, 0);
      const Y = plazaY + 1;
      for (const [sx, sz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        put(sx, Y, sz, B.stone_bricks); put(sx, Y + 1, sz, B.stone_bricks); put(sx, Y + 2, sz, B.lamp);
      }
      put(2, Y, -3, B.crafting_table);
      put(3, Y, -3, B.furnace_0);
      put(-2, Y, -3, B.chest_0);
      put(-3, Y, -3, B.chest_0);
      put(0, Y, -3, B.sign_post_2);
      put(0, Y, 3, B.sign_post_0);
      put(-3, Y, 3, B.flower_red); put(3, Y, 3, B.flower_yellow);
    }
    return v;
  }

  return { genChunk, column, plazaY, spawn, treeBlocks, caveAt };
}

// 스폰 광장 표지판 기본 문구
export function defaultSigns(plazaY) {
  return {
    [`0,${plazaY + 1},-3`]: '픽셀 커먼스\n모두의 공개월드\n협동 샌드박스\n밤엔 몬스터 조심!',
    [`0,${plazaY + 1},3`]: '도움말: ⚙️ 메뉴\n/spawn 광장으로\n/home 내 침대로\n상자는 공용이에요',
  };
}

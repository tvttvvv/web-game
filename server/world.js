// 서버용: 공용 World를 파일로 저장/불러오기
import fs from 'node:fs';
import path from 'node:path';
import { World } from '../public/js/core/world.js';

export function loadWorld(dir) {
  const file = path.join(dir, 'world.json');
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const world = new World(saved);
  console.log(world.isNew ? `[world] new world (seed ${world.seed})`
    : `[world] loaded (seed ${world.seed}, ${Object.keys(world.mods).length} chunks edited)`);
  world.save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(world.serialize()));
    fs.renameSync(file + '.tmp', file);
    world.dirty = false;
  };
  return world;
}

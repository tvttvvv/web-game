// 내 캐릭터: 물리(중력·점프·수영·사다리·웅크리기 낭떠러지 보호·자동 점프) + 카메라
import { moveEntity, overlapsBlocks } from '../shared/physics.js';
import { BLOCKS, SOLID, B, collisionBoxes } from '../shared/blocks.js';
import { PLAYER_W, PLAYER_H, EYE, SNEAK_EYE } from '../shared/constants.js';

const WATER = 15;

export class LocalPlayer {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.w = PLAYER_W; this.h = PLAYER_H;
    this.onGround = false; this.inWater = false; this.eyeInWater = false; this.onLadder = false;
    this.peak = null; this.walk = 0; this.eye = EYE; this.frozen = true;
    this.kx = 0; this.kz = 0;
    this.stepAcc = 0;
    this.getB = (x, y, z) => { const b = world.getBlock(x, y, z); return b < 0 ? 6 : b; };
  }

  setPos(x, y, z) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.peak = null; }

  supportAt(px, pz) {
    const hw = this.w / 2 - 0.02, y = this.y - 0.08;
    const by = Math.floor(y);
    for (let bx = Math.floor(px - hw); bx <= Math.floor(px + hw); bx++)
      for (let bz = Math.floor(pz - hw); bz <= Math.floor(pz + hw); bz++) {
        const id = this.getB(bx, by, bz);
        const bs = SOLID[id] && collisionBoxes(id);
        if (!bs) continue;
        for (const b of bs) {
          if (by + b[4] < y - 0.1) continue;
          if (bx + b[3] > px - hw && bx + b[0] < px + hw && bz + b[5] > pz - hw && bz + b[2] < pz + hw) return true;
        }
      }
    return false;
  }

  update(dt, inp, opts) {
    const ev = { landed: 0, bounced: false, splash: false, step: null };
    if (this.frozen) return ev;
    const g = this.getB;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const wasWater = this.inWater;
    this.inWater = g(Math.floor(this.x), Math.floor(this.y + 0.3), Math.floor(this.z)) === WATER ||
      g(Math.floor(this.x), Math.floor(this.y + 1.0), Math.floor(this.z)) === WATER;
    this.eyeInWater = g(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z)) === WATER;
    this.onLadder = overlapsBlocks(this, g, (id) => BLOCKS[id] && BLOCKS[id].climb);
    if (this.inWater && !wasWater && this.vy < -5) ev.splash = true;

    const sneak = inp.sneak && !this.inWater;
    const sprint = inp.sprint && !sneak;
    let speed = sneak ? 1.35 : sprint ? 5.6 : 4.3;
    if (this.inWater) speed *= 0.55;
    const mz = inp.move.z, mx = inp.move.x;
    const wx = (fx * mz + rx * mx) * speed, wz = (fz * mz + rz * mx) * speed;
    const acc = this.onGround ? 14 : this.inWater ? 6 : 3.2;
    this.vx += (wx - this.vx) * Math.min(1, acc * dt);
    this.vz += (wz - this.vz) * Math.min(1, acc * dt);

    const jump = inp.jumping;
    if (this.inWater) {
      this.vy -= 10 * dt;
      if (jump) this.vy += 24 * dt;
      this.vy = Math.max(-3.2, Math.min(3.4, this.vy));
    } else if (this.onLadder) {
      if (jump || (mz > 0.3 && this.hitWall)) this.vy = 3.2;
      else if (sneak) this.vy = Math.max(0, this.vy * 0.5);
      else this.vy = Math.max(this.vy - 32 * dt, -2.6);
    } else {
      this.vy -= 32 * dt;
      if (this.vy < -60) this.vy = -60;
    }
    if (jump && this.onGround && !this.inWater) this.vy = 8.9;

    let dx = (this.vx + this.kx) * dt, dz = (this.vz + this.kz) * dt;
    this.kx *= Math.pow(0.002, dt); this.kz *= Math.pow(0.002, dt);
    // 웅크리면 낭떠러지로 떨어지지 않음
    if (sneak && this.onGround) {
      if (!this.supportAt(this.x + dx, this.z)) dx = 0;
      if (!this.supportAt(this.x + dx, this.z + dz)) dz = 0;
    }
    const vyBefore = this.vy;
    const res = moveEntity(this, dx, this.vy * dt, dz, g, this.onGround || this.inWater ? 0.6 : 0);
    this.hitWall = res.hitX || res.hitZ;
    if (res.hitY) {
      if (vyBefore < 0) {
        const below = g(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z));
        if (below === B.slime_block && !sneak && vyBefore < -4) { this.vy = -vyBefore * 0.8; ev.bounced = true; this.peak = null; }
        else this.vy = 0;
      } else this.vy = 0;
    }
    if (res.hitX) this.vx = 0;
    if (res.hitZ) this.vz = 0;
    const wasGround = this.onGround;
    this.onGround = res.onGround && !ev.bounced;

    // 자동 점프 (터치): 한 칸 턱에 막히면 점프
    if (opts.autoJump && this.onGround && this.hitWall && Math.hypot(mx, mz) > 0.3 && !sneak) {
      const up = { x: this.x + fx * 0.3 * Math.sign(mz || 1), y: this.y + 1.02, z: this.z + fz * 0.3 * Math.sign(mz || 1), w: this.w, h: this.h };
      const blocked = overlapsBlocks(up, g, (id) => SOLID[id] && collisionBoxes(id));
      if (!blocked) this.vy = 8.9;
    }

    // 낙하 거리
    if (this.onGround || this.inWater || this.onLadder) {
      if (this.peak !== null && this.onGround && !wasGround) {
        let d = this.peak - this.y;
        const below = g(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z));
        if (below === B.hay_bale) d *= 0.2;
        if (!this.inWater && d > 3.4) ev.landed = d;
        ev.step = below;
      }
      this.peak = this.y;
    } else if (this.peak === null || this.y > this.peak) this.peak = this.y;

    // 걷는 소리/흔들림
    const hs = Math.hypot(this.vx, this.vz);
    if (this.onGround && hs > 0.5) {
      this.walk += hs * dt;
      this.stepAcc += hs * dt;
      if (this.stepAcc > (sprint ? 2.1 : 1.7)) { this.stepAcc = 0; ev.step = g(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z)); }
    }
    const targetEye = sneak ? SNEAK_EYE : EYE;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    this.sneaking = sneak; this.sprinting = sprint && hs > 3;
    return ev;
  }

  knock(kx, kz) { this.kx = kx * 7; this.kz = kz * 7; if (this.onGround) this.vy = 5.5; }

  eyePos() { return [this.x, this.y + this.eye, this.z]; }
  dir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }
}

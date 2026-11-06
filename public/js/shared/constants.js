// 공용 상수 (서버 · 호스트 · 클라이언트)
export const PROTO = 4;            // 프로토콜 버전 (P2P 방 이름에도 들어감)
export const SEED = 4242;          // 월드 지형 시드 (모두 같은 섬)
export const WORLD_R = 300;        // 섬 반지름
export const TOWN_R = 38;          // 마을(안전 지대) 반지름
export const MAX_LEVEL = 30;
export const INV_SIZE = 30;
export const PLAYER_R = 0.45;      // 충돌 반지름
export const INTERACT_R = 6;       // NPC와 대화 가능한 거리
export const SHARE_R = 45;         // 경험치/퀘스트 공유 거리
export const EQUIP_SLOTS = ['weapon', 'helm', 'armor', 'boots', 'ring'];
export const EQUIP_NAMES = { weapon: '무기', helm: '투구', armor: '갑옷', boots: '신발', ring: '장신구' };

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
// 바라보는 각도 ry: 0이면 -Z(북쪽)를 봄. 방향 벡터 = (-sin ry, -cos ry)
export const dirOf = (ry) => [-Math.sin(ry), -Math.cos(ry)];
export const ryTo = (dx, dz) => Math.atan2(-dx, -dz);
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

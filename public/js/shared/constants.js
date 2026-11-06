// 게임 전체에서 쓰는 상수 (서버·호스트·클라이언트 공용)
export const PROTO = 3;            // 프로토콜/월드 버전 (P2P 방 이름에도 들어감)
export const WORLD_SEED = 20261106; // 공개월드는 항상 같은 지형
export const CS = 16;              // 청크 가로/세로
export const CH = 96;              // 월드 높이
export const SEA = 40;             // 해수면
export const DAY_LEN = 720;        // 하루 길이(초)
export const SAFE_R = 22;          // 스폰 보호 반경
export const CLAIM_R = 8;          // 깃발 영역 반경 (17x17)
export const MAX_CLAIMS = 3;
export const MAX_HP = 20, MAX_FOOD = 20, MAX_AIR = 10;
export const REACH = 6;
export const PLAYER_W = 0.6, PLAYER_H = 1.8, EYE = 1.62, SNEAK_EYE = 1.35;

export const idx = (x, y, z) => (y * CS + z) * CS + x; // 청크 내부 인덱스
export const ckey = (cx, cz) => cx + ',' + cz;
export const bkey = (x, y, z) => x + ',' + y + ',' + z;

// 방향: 0=북(-Z) 1=동(+X) 2=남(+Z) 3=서(-X)
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// 면: 0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z
export const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const faceToDir = (f) => (f === 0 ? 1 : f === 1 ? 3 : f === 4 ? 2 : f === 5 ? 0 : -1);
export const yawToDir = (yaw) => ((Math.round(-yaw / (Math.PI / 2)) % 4) + 4) % 4;

// 시간: t=0 해 뜸, 0.25 정오, 0.5 해 짐, 0.75 자정
export const timeOfDay = (epoch, now) => ((((now - epoch) / 1000) / DAY_LEN) % 1 + 1) % 1;
export const sunHeight = (t) => Math.sin(t * Math.PI * 2);
export function daylight(t) {
  const s = sunHeight(t);
  const k = Math.max(0, Math.min(1, (s + 0.22) / 0.44));
  return 0.14 + 0.86 * k * k * (3 - 2 * k);
}
export const isNight = (t) => sunHeight(t) < -0.18;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

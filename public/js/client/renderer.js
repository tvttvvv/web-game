// Three.js 장면: 청크 셰이더, 하늘/해/달/별/구름, 선택 테두리, 금 간 효과, 파티클
import * as THREE from '../../vendor/three.module.min.js';
import { CH, daylight, sunHeight } from '../shared/constants.js';

export { THREE };

const VS = `
attribute vec4 light;
varying vec2 vUv;
varying vec4 vLight;
varying float vDist;
uniform float uTime;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float fl = floor(light.w * 255.0 + 0.5);
  if (fl == 1.0) {
    wp.x += sin(uTime * 1.8 + wp.x * 0.7 + wp.z * 0.5) * 0.06;
    wp.z += cos(uTime * 1.5 + wp.x * 0.4 + wp.z * 0.8) * 0.05;
  } else if (fl == 2.0) {
    wp.y += (sin(uTime * 1.6 + wp.x * 0.9) + cos(uTime * 1.3 + wp.z * 0.8)) * 0.025 - 0.02;
  }
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vDist = length(mv.xyz);
  vUv = uv;
  vLight = light;
}`;
const LIGHT_FN = `
uniform sampler2D uAtlas;
uniform float uDay, uAmbient, uFogNear, uFogFar;
uniform vec3 uSkyTint, uTorch, uFogColor;
varying vec2 vUv;
varying vec4 vLight;
varying float vDist;
vec3 lit(vec3 c) {
  float s = pow(0.8, (1.0 - vLight.x) * 15.0);
  float b = vLight.y > 0.003 ? pow(0.8, (1.0 - vLight.y) * 15.0) : 0.0;
  vec3 l = max(uSkyTint * (s * uDay), uTorch * b);
  l = max(l, vec3(uAmbient));
  return c * l * vLight.z;
}`;
const FS_SOLID = LIGHT_FN + `
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec3 c = lit(t.rgb);
  gl_FragColor = vec4(mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDist)), 1.0);
}`;
const FS_WATER = LIGHT_FN + `
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  vec3 c = lit(t.rgb * vec3(0.85, 0.95, 1.1));
  float f = smoothstep(uFogNear, uFogFar, vDist);
  gl_FragColor = vec4(mix(c, uFogColor, f), mix(0.74, 1.0, f * 0.5));
}`;

function pixelCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

const col = (h) => new THREE.Color(h);
const SKY = {
  dayTop: col('#5f97ff'), dayHorizon: col('#b9d6ff'),
  nightTop: col('#03050c'), nightHorizon: col('#0a1124'),
  sunset: col('#ff9a55'),
};

export class Renderer {
  constructor(canvas, atlas) {
    THREE.ColorManagement.enabled = false;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    this.gl.setClearColor(0x000000);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.06, 900);
    this.scene.fog = new THREE.Fog(0xb9d6ff, 50, 100);

    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    this.atlasTex = tex;
    this.U = {
      uAtlas: { value: tex }, uDay: { value: 1 }, uAmbient: { value: 0.03 }, uTime: { value: 0 },
      uSkyTint: { value: new THREE.Color(1, 1, 1) }, uTorch: { value: new THREE.Color(1.0, 0.86, 0.62) },
      uFogColor: { value: new THREE.Color(0xb9d6ff) }, uFogNear: { value: 50 }, uFogFar: { value: 100 },
    };
    this.solidMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: VS, fragmentShader: FS_SOLID });
    this.waterMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: VS, fragmentShader: FS_WATER, transparent: true, depthWrite: false, side: THREE.DoubleSide });

    this.buildSky();
    this.buildOverlays(atlas);
    this.buildParticles();
    this.entityRoot = new THREE.Group();
    this.scene.add(this.entityRoot);

    // 1인칭 손
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handScene.add(this.handCam);

    this.fogDist = 100;
    this.underwater = false;
    this.brightness = 0.5;
  }

  buildSky() {
    this.skyU = {
      uTop: { value: SKY.dayTop.clone() }, uHorizon: { value: SKY.dayHorizon.clone() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: SKY.sunset.clone() }, uGlowAmt: { value: 0 },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uHorizon, uGlow, uSunDir; uniform float uGlowAmt; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.7)) : mix(uHorizon, uHorizon * 0.55, smoothstep(0.0, -0.3, h));
          float g = pow(max(dot(d, uSunDir), 0.0), 5.0) * uGlowAmt * (1.0 - smoothstep(0.1, 0.6, h));
          c = mix(c, uGlow, clamp(g, 0.0, 0.85));
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.sky = sky; this.scene.add(sky);

    const sunTex = pixelCanvas(16, 16, (g) => {
      g.fillStyle = 'rgba(255,240,170,0.35)'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#fff3a8'; g.fillRect(2, 2, 12, 12);
      g.fillStyle = '#fffbe0'; g.fillRect(4, 4, 8, 8);
    });
    const moonTex = pixelCanvas(16, 16, (g) => {
      g.fillStyle = 'rgba(200,210,255,0.25)'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#e8ecf6'; g.fillRect(3, 3, 10, 10);
      g.fillStyle = '#bfc6d6'; g.fillRect(5, 5, 2, 2); g.fillRect(9, 8, 3, 2); g.fillRect(6, 10, 2, 1);
    });
    const mk = (t, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false, depthWrite: false, depthTest: false }));
      m.renderOrder = -9; m.frustumCulled = false; this.scene.add(m); return m;
    };
    this.sun = mk(sunTex, 70); this.moon = mk(moonTex, 50);

    const sp = [];
    const r = mulberry(99);
    for (let i = 0; i < 900; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp.push(Math.cos(a) * s * 500, u * 500, Math.sin(a) * s * 500);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, depthTest: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // 구름 (텍셀 하나 = 10블록)
    const cr = mulberry(7);
    const cloudTex = pixelCanvas(64, 64, (g) => {
      const cells = new Float32Array(64 * 64);
      for (let i = 0; i < 64 * 64; i++) cells[i] = cr();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += cells[((y + dy + 64) % 64) * 64 + ((x + dx + 64) % 64)];
        if (s / 25 > 0.535) { g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); }
      }
    });
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.repeat.set(4, 4);
    this.cloudU = { uMap: { value: cloudTex }, uOff: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(1, 1, 1) }, uCam: { value: new THREE.Vector3() } };
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2560, 2560), new THREE.ShaderMaterial({
      uniforms: this.cloudU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'uniform vec2 uOff; varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv * 4.0 + uOff; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform sampler2D uMap; uniform vec3 uColor, uCam; varying vec2 vUv; varying vec3 vW; void main(){ vec4 t = texture2D(uMap, vUv); if (t.a < 0.5) discard; float d = length(vW.xz - uCam.xz); gl_FragColor = vec4(uColor, 0.82 * (1.0 - smoothstep(380.0, 900.0, d))); }',
    }));
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = CH + 36;
    clouds.renderOrder = 5; clouds.frustumCulled = false;
    this.clouds = clouds; this.scene.add(clouds);
    this.cloudsOn = true;
  }

  buildOverlays(atlas) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this.crackTex = [];
    for (let k = 0; k < 10; k++) {
      const i = atlas.index.get('crack_' + k);
      this.crackTex.push(pixelCanvas(16, 16, (g) => g.drawImage(atlas.canvas, (i % atlas.cols) * 16, ((i / atlas.cols) | 0) * 16, 16, 16, 0, 0, 16, 16)));
    }
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({
      map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: false,
    }));
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  buildParticles() {
    this.maxParticles = 300;
    this.pmesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.maxParticles);
    this.pmesh.frustumCulled = false;
    this.pmesh.count = 0;
    this.pmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles = [];
    this.scene.add(this.pmesh);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color();
  }

  burst(x, y, z, rgb, n = 14, opts = {}) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const shade = 0.75 + Math.random() * 0.35;
      this.particles.push({
        x: x + (Math.random() - 0.5) * (opts.spread ?? 0.8), y: y + (Math.random() - 0.5) * (opts.spread ?? 0.8), z: z + (Math.random() - 0.5) * (opts.spread ?? 0.8),
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * (opts.up ?? 3.5), vz: (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.5, size: (opts.size ?? 0.1) * (0.7 + Math.random() * 0.6),
        r: rgb[0] * shade, g: rgb[1] * shade, b: rgb[2] * shade, grav: opts.grav ?? 14,
      });
    }
  }

  updateParticles(dt, getBlockSolid, brightness) {
    let n = 0;
    const m = this._m, c = this._c;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      const ny = p.y + p.vy * dt;
      if (getBlockSolid(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { p.vy *= -0.2; p.vx *= 0.6; p.vz *= 0.6; } else p.y = ny;
      p.x += p.vx * dt; p.z += p.vz * dt;
    }
    for (const p of this.particles) {
      if (n >= this.maxParticles) break;
      m.makeScale(p.size, p.size, p.size); m.setPosition(p.x, p.y, p.z);
      this.pmesh.setMatrixAt(n, m);
      c.setRGB(p.r * brightness, p.g * brightness, p.b * brightness);
      this.pmesh.setColorAt(n, c);
      n++;
    }
    this.pmesh.count = n;
    this.pmesh.instanceMatrix.needsUpdate = true;
    if (this.pmesh.instanceColor) this.pmesh.instanceColor.needsUpdate = true;
  }

  // 청크 메시 생성
  makeMesh(part, water) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3, false));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2, true));
    g.setAttribute('light', new THREE.BufferAttribute(part.lt, 4, true));
    g.setIndex(new THREE.BufferAttribute(part.idx, 1));
    const m = new THREE.Mesh(g, water ? this.waterMat : this.solidMat);
    m.scale.setScalar(1 / 16);
    m.matrixAutoUpdate = false;
    if (water) m.renderOrder = 2;
    return m;
  }

  resize(w, h, pixelRatio) {
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
  }

  setRenderDistance(chunks) {
    this.fogDist = chunks * 16;
  }

  // 시간대에 따라 하늘/안개/빛 갱신
  updateSky(t, camPos, dt, time) {
    const day = daylight(t);
    const sh = sunHeight(t);
    const k = (day - 0.14) / 0.86;
    const top = SKY.nightTop.clone().lerp(SKY.dayTop, k);
    const hor = SKY.nightHorizon.clone().lerp(SKY.dayHorizon, k);
    const ang = t * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    // 해 질 녘/해 뜰 녘 노을
    const dusk = Math.max(0, 1 - Math.abs(sh) / 0.35);
    hor.lerp(SKY.sunset, dusk * 0.45);
    this.skyU.uTop.value.copy(top);
    this.skyU.uHorizon.value.copy(hor);
    this.skyU.uSunDir.value.copy(sunDir);
    this.skyU.uGlowAmt.value = dusk * 0.9;

    this.sky.position.copy(camPos);
    this.sun.position.copy(camPos).addScaledVector(sunDir, 450);
    this.sun.lookAt(camPos);
    this.moon.position.copy(camPos).addScaledVector(sunDir, -450);
    this.moon.lookAt(camPos);
    this.stars.position.copy(camPos);
    this.stars.rotation.z = ang;
    this.starMat.opacity = Math.max(0, Math.min(1, (0.45 - day) * 3));

    const fogC = this.underwater ? new THREE.Color(0.06, 0.16, 0.38).multiplyScalar(0.4 + day * 0.6) : hor.clone();
    this.U.uFogColor.value.copy(fogC);
    this.scene.fog.color.copy(fogC);
    const far = this.underwater ? 18 : this.fogDist;
    const near = this.underwater ? 1 : this.fogDist * 0.55;
    this.U.uFogNear.value = near; this.U.uFogFar.value = far;
    this.scene.fog.near = near; this.scene.fog.far = far;
    this.U.uDay.value = day;
    this.U.uSkyTint.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.62, 0.7, 1.0), 1 - k).lerp(new THREE.Color(1.0, 0.82, 0.7), dusk * 0.35);
    this.U.uAmbient.value = 0.015 + this.brightness * 0.07;
    this.U.uTime.value = time;

    this.clouds.visible = this.cloudsOn;
    const snap = 640;
    this.clouds.position.x = Math.round(camPos.x / snap) * snap;
    this.clouds.position.z = Math.round(camPos.z / snap) * snap;
    const wind = time * 0.6;
    this.cloudU.uOff.value.set((this.clouds.position.x + wind) / 640, -(this.clouds.position.z) / 640);
    this.cloudU.uCam.value.copy(camPos);
    this.cloudU.uColor.value.setRGB(1, 1, 1).multiplyScalar(0.25 + day * 0.75).lerp(SKY.sunset, dusk * 0.25);
    return { day, fog: fogC };
  }

  render() {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    this.gl.clearDepth();
    this.gl.render(this.handScene, this.handCam);
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

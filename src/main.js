import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ===== 物理パラメータ（1倍 = 1秒に2回の前とび） ===== */
const G = 9.8;
const CYCLE = 0.5;            // 1回旋の時間（秒）
const AIR0 = 0.30, AIR1 = 0.70; // 空中にいる区間（1周の割合）
const AIRT = (AIR1 - AIR0) * CYCLE;
const V0 = G * AIRT / 2;       // ふみきりの速さ
const TC = CYCLE - AIRT;       // 接地時間
const DIP = 0.85 * V0 * TC / Math.PI; // 着地で沈みこむ量（速さがつながるように計算）

/* 体の寸法（m） */
const THIGH = 0.42, SHIN = 0.42, UPPER = 0.29, FORE = 0.26;
const HIP_X = 0.085, BALL_Z = 0.08;
const PF_MAX = 0.75, PF_MIN = 0.15; // 足首の底屈（つま先立ち）の角度
const FOOT_BALL = new THREE.Vector3(0, -0.06, 0.13); // 足首→母指球

const rotX = (v, a) => new THREE.Vector3(v.x, v.y * Math.cos(a) - v.z * Math.sin(a), v.y * Math.sin(a) + v.z * Math.cos(a));
const ankleOnGround = (sx, pf) => new THREE.Vector3(sx * HIP_X, 0, BALL_Z).sub(rotX(FOOT_BALL, pf));

// ふみきり瞬間の脚（ほぼまっすぐ）から、立ち位置の股関節の高さを決める
const L_TAKE = (THIGH + SHIN) * 0.993;
const ankT = ankleOnGround(1, PF_MAX);
const H0 = ankT.y + Math.sqrt(L_TAKE * L_TAKE - ankT.z * ankT.z);
const TAKE_DIR = new THREE.Vector3(0, ankT.y - H0, ankT.z).normalize();

function ik(a, c, l1, l2, pole) {
  const d = c.clone().sub(a);
  const L = Math.min(d.length(), l1 + l2 - 1e-4);
  const dir = d.normalize();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return a.clone().add(dir.clone().multiplyScalar(l1 * cosA)).add(p.multiplyScalar(l1 * sinA));
}

/* ===== 1周の中の位置 ph(0〜1) から全身の姿勢を計算 ===== */
/* 技の定義：cross(n) は n回旋目の時点の「腕の交差ぐあい」0〜1 */
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const parity = k => ((k % 2) + 2) % 2;
function ayaCross(n) { // 偶数回旋=ひらく、奇数回旋=こうさ。縄が後ろ〜頭上にある間に組みかえる
  const k = Math.floor(n), ph = n - k;
  if (ph >= 0.94) return parity(k) + (parity(k + 1) - parity(k)) * smooth((ph - 0.94) / 0.26);
  if (ph < 0.20) return parity(k - 1) + (parity(k) - parity(k - 1)) * smooth((ph + 0.06) / 0.26);
  return parity(k);
}
const TECHS = {
  mae: { cycles: 1, cross: () => 0 },
  aya: { cycles: 2, cross: ayaCross },
};
let tech = 'mae';
function pose(n) {
  const w = TECHS[tech].cross(n);
  let ph = ((n % 1) + 1) % 1;
  const th = 2 * Math.PI * ph; // 縄の角度 0=頭上, π/2=前, π=足の下
  let hipY, pf, legScale = 1, air = false, dip = 0;
  if (ph >= AIR0 && ph < AIR1) {
    air = true;
    const u = (ph - AIR0) / (AIR1 - AIR0), t = u * AIRT;
    hipY = H0 + V0 * t - 0.5 * G * t * t;
    pf = PF_MAX - 0.10 * Math.sin(Math.PI * u);
    legScale = 1 - 0.025 * Math.sin(Math.PI * u);
  } else {
    const v = (((ph - AIR1) % 1) + 1) % 1 / (1 - (AIR1 - AIR0));
    dip = Math.sin(Math.PI * v);
    hipY = H0 - DIP * dip;
    pf = PF_MIN + (PF_MAX - PF_MIN) * (Math.cos(2 * Math.PI * v) + 1) / 2;
  }
  const lean = 0.07 + 0.05 * dip + 0.09 * w; // あやとびの交差時は上体を少し前へ
  const chestA = lean + 0.18 * w;            // 交差時は胸を丸める（肩が前へ出る）
  const hipC = new THREE.Vector3(0, hipY, 0);
  const pelvis = hipC.clone().add(new THREE.Vector3(0, 0.05, 0));
  const o = { ph, th, air, pf, lean, chestA, pelvis, w, sides: {} };
  const waist = pelvis.clone().add(rotX(new THREE.Vector3(0, 0.20, 0), lean));
  o.waist = waist;
  o.chestC = waist.clone().add(rotX(new THREE.Vector3(0, 0.12, -0.015), chestA));
  o.bellyC = pelvis.clone().add(rotX(new THREE.Vector3(0, 0.08, 0.005), lean));
  o.notch = waist.clone().add(rotX(new THREE.Vector3(0, 0.27, 0.05), chestA));
  o.neck = waist.clone().add(rotX(new THREE.Vector3(0, 0.31, 0), chestA));
  o.head = o.neck.clone().add(rotX(new THREE.Vector3(0, 0.15, 0.015), lean * 0.6 + 0.35 * w)); // 交差時は手元を見る
  const thH = th + Math.PI * 0.45; // 手首の円は縄より少し先に動く
  for (const sx of [1, -1]) {
    const s = {};
    s.hip = hipC.clone().add(new THREE.Vector3(sx * HIP_X, 0, 0));
    s.ankle = air
      ? s.hip.clone().add(TAKE_DIR.clone().multiplyScalar(L_TAKE * legScale))
      : ankleOnGround(sx, pf);
    s.knee = ik(s.hip, s.ankle, THIGH, SHIN, new THREE.Vector3(sx * 0.08, 0, 1));
    s.shoulder = waist.clone().add(rotX(new THREE.Vector3(sx * (0.19 - 0.02 * w), 0.26, 0.07 * w), chestA));
    const circle = new THREE.Vector3(0, 0.04 * Math.cos(thH), 0.04 * Math.sin(thH));
    const wOpen = new THREE.Vector3(sx * 0.36, -0.02, 0.10);
    const wCross = new THREE.Vector3(-sx * 0.17, 0.02 + 0.03 * sx, 0.30 + 0.07 * sx); // 右手側(sx=1)が前で上
    s.wrist = pelvis.clone().add(rotX(wOpen.lerp(wCross, w).add(new THREE.Vector3(0, 0.03 * sx, 0.12 + 0.05 * sx).multiplyScalar(Math.sin(Math.PI * w))), lean * 0.3)).add(circle);
    s.elbow = ik(s.shoulder, s.wrist, UPPER, FORE, new THREE.Vector3(-sx * 0.8, 0, -0.6).lerp(new THREE.Vector3(sx * 0.6, -0.3, 0.3), w).normalize());
    const fdir = s.wrist.clone().sub(s.elbow).normalize();
    s.fist = s.wrist.clone().add(fdir.multiplyScalar(0.045));
    // グリップ：手首の返しで先が縄の方向へかたむく
    // グリップは前・やや内向きでほぼ水平に持ち、先が手首の返しで小さく円をかく
    s.gripDir = new THREE.Vector3(sx * 0.75 * (1 - 2 * w), -0.1, 0.65)
      .add(new THREE.Vector3(0, 0.22 * Math.cos(th), 0.22 * Math.sin(th))).normalize();
    s.tip = s.fist.clone().add(s.gripDir.clone().multiplyScalar(0.12));
    o.sides[sx] = s;
  }
  // 縄の形
  const tL = o.sides[1].tip, tR = o.sides[-1].tip;
  const C = tL.clone().add(tR).multiplyScalar(0.5);
  o.rope = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const f = Math.pow(Math.sin(Math.PI * s), 0.55);
    const a = th - 0.25 * f; // 縄の真ん中は少し遅れてついてくる
    const base = tL.clone().lerp(tR, s);
    const orbit = new THREE.Vector3(base.x, C.y - 0.15 * w + (1.00 - 0.06 * Math.cos(a)) * Math.cos(a), 0.03 + 0.60 * Math.sin(a));
    const p = base.lerp(orbit, f);
    p.x += Math.max(-1, Math.min(1, (tL.x - tR.x) / 0.25)) * (0.12 + 0.22 * w) * Math.sin(2 * Math.PI * s);
    p.z += 0.22 * Math.sin(Math.PI * w) * Math.sin(Math.PI * s); // 組みかえ中は縄が体の前へふくらむ
    if (p.y < 0.009) p.y = 0.009;
    o.rope.push(p);
  }
  return o;
}

/* ===== シーン ===== */
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef2f5);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
camera.position.set(0, 1.1, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.minDistance = 1.5; controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.52;

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4ae, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(2.5, 5, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
scene.add(sun);

const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0xd9dee3 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(6, 24, 0xb8c0c8, 0xc8cfd6); grid.position.y = 0.001; scene.add(grid);

const matBody = new THREE.MeshStandardMaterial({ color: 0xe8d2b0, roughness: 0.7 });
const matJoint = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.6 });
const matGrip = new THREE.MeshStandardMaterial({ color: 0xc8443c });
const matRope = new THREE.MeshStandardMaterial({ color: 0x24508c });
const matShoe = new THREE.MeshStandardMaterial({ color: 0x4a5560 });

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const sphGeo = new THREE.SphereGeometry(1, 18, 12);
const UP = new THREE.Vector3(0, 1, 0);
function seg(r, mat, sx = 1, sz = 1) {
  const m = new THREE.Mesh(cylGeo, mat); m.castShadow = true; scene.add(m);
  return (a, b) => {
    const d = b.clone().sub(a); const len = d.length();
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    m.scale.set(r * sx, len, r * sz);
  };
}
function ball(r, mat) {
  const m = new THREE.Mesh(sphGeo, mat); m.scale.setScalar(r); m.castShadow = true; scene.add(m);
  return p => m.position.copy(p);
}
const parts = {
  neck: seg(0.04, matBody),
  head: ball(0.105, matBody),
  hips: seg(0.06, matBody),
};
/* 胴：胸郭と腹を楕円体で表す（筒だと肩・腕が貫通するため） */
const CHEST_R = new THREE.Vector3(0.13, 0.18, 0.09), BELLY_R = new THREE.Vector3(0.125, 0.14, 0.085);
function ellip(r) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), matBody); m.scale.copy(r); m.castShadow = true; scene.add(m); return m; }
const chestMesh = ellip(CHEST_R), bellyMesh = ellip(BELLY_R);
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 10), matJoint);
nose.rotation.x = Math.PI / 2; scene.add(nose);
const side = {};
for (const sx of [1, -1]) {
  const footGeo = new THREE.BoxGeometry(0.09, 0.06, 0.24); footGeo.translate(0, -0.03, 0.06);
  const foot = new THREE.Mesh(footGeo, matShoe); foot.castShadow = true; scene.add(foot);
  side[sx] = {
    clav: seg(0.026, matBody), upper: seg(0.042, matBody), fore: seg(0.034, matBody), thigh: seg(0.062, matBody), shin: seg(0.046, matBody),
    grip: seg(0.016, matGrip), sh: ball(0.05, matJoint), el: ball(0.038, matJoint), wr: ball(0.03, matJoint),
    fist: ball(0.045, matBody), hip: ball(0.064, matJoint), kn: ball(0.052, matJoint), an: ball(0.04, matJoint), foot,
  };
}
let ropeMesh = null;

/* 見るポイント：関節の強調と軌跡 */
const POINTS = {
  none: { label: 'なし', key: null, tip: 'ドラッグで回転、ホイールやピンチで拡大できます。' },
  wrist: { label: '手首', key: 'wrist', tip: 'ひじはわきにつけ、手首で小さな円をかいて回す。あやとびは手をおへその前で深く交差。' },
  knee: { label: 'ひざ', key: 'knee', tip: 'ひざは軽く曲げてクッションに。深く曲げすぎない。' },
  ankle: { label: '足首', key: 'ankle', tip: 'つま先（母指球）でとぶ。かかとは地面につけない。' },
};
let point = 'none';
const matHi = new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.55, depthTest: false });
const hiMarks = [1, -1].map(() => { const m = new THREE.Mesh(sphGeo, matHi); m.scale.setScalar(0.07); m.renderOrder = 10; m.visible = false; scene.add(m); return m; });
const trailMat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false });
const trails = [1, -1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry(), trailMat); l.renderOrder = 9; l.visible = false; scene.add(l); return l; });
function buildTrails() {
  const key = POINTS[point].key;
  [1, -1].forEach((sx, i) => {
    trails[i].visible = hiMarks[i].visible = !!key;
    if (!key) return;
    const pts = [];
    const cyc = TECHS[tech].cycles;
    for (let k = 0; k <= 120 * cyc; k++) pts.push(pose(k / 120).sides[sx][key]);
    trails[i].geometry.dispose();
    trails[i].geometry = new THREE.BufferGeometry().setFromPoints(pts);
  });
}

function apply(o) {
  chestMesh.position.copy(o.chestC); chestMesh.rotation.x = o.chestA;
  bellyMesh.position.copy(o.bellyC); bellyMesh.rotation.x = o.lean;
  parts.neck(o.neck, o.head); parts.head(o.head);
  nose.position.copy(o.head).add(new THREE.Vector3(0, 0, 0.11));
  for (const sx of [1, -1]) side[sx].clav(o.notch, o.sides[sx].shoulder);
  parts.hips(o.sides[1].hip, o.sides[-1].hip);
  for (const sx of [1, -1]) {
    const s = o.sides[sx], m = side[sx];
    m.upper(s.shoulder, s.elbow); m.fore(s.elbow, s.wrist); m.thigh(s.hip, s.knee); m.shin(s.knee, s.ankle);
    m.grip(s.fist.clone().sub(s.gripDir.clone().multiplyScalar(0.03)), s.tip);
    m.sh(s.shoulder); m.el(s.elbow); m.wr(s.wrist); m.fist(s.fist); m.hip(s.hip); m.kn(s.knee); m.an(s.ankle);
    m.foot.position.copy(s.ankle); m.foot.rotation.set(o.pf, 0, 0);
  }
  if (ropeMesh) { ropeMesh.geometry.dispose(); scene.remove(ropeMesh); }
  ropeMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(o.rope), 64, 0.007, 6), matRope);
  ropeMesh.castShadow = true; scene.add(ropeMesh);
  const key = POINTS[point].key;
  if (key) [1, -1].forEach((sx, i) => hiMarks[i].position.copy(o.sides[sx][key]));
}

/* ===== 段階の表示 ===== */
const PHASES = [
  { a: 0.00, b: 0.15, name: 'しずみこみ', desc: '縄は頭の上。ひざと足首でクッション。', c: '#7fa7d6' },
  { a: 0.15, b: 0.30, name: 'ふみきり', desc: '縄が前へ。足首で地面をけって、小さくとぶ。', c: '#e0a24a' },
  { a: 0.30, b: 0.70, name: '空中', desc: '縄が足の下を通る。とぶ高さは数センチで十分。', c: '#6cbf84' },
  { a: 0.70, b: 0.80, name: '着地', desc: 'つま先からやわらかく着地する。', c: '#c97a9a' },
  { a: 0.80, b: 1.00, name: 'しずみこみ', desc: '縄は後ろから頭の上へ。次のジャンプのため力をためる。', c: '#7fa7d6' },
];
const bar = document.getElementById('bar');
PHASES.forEach(p => { const d = document.createElement('div'); d.style.left = p.a * 100 + '%'; d.style.width = (p.b - p.a) * 100 + '%'; d.style.background = p.c; bar.appendChild(d); });
const marker = document.createElement('i'); bar.appendChild(marker);
const phName = document.getElementById('phName'), phDesc = document.getElementById('phDesc'), tipEl = document.getElementById('tip');

/* ===== 操作 ===== */
const VIEWS = { front: [0, 1.1, 4.2], side: [4.2, 1.1, 0], back: [0, 1.1, -4.2], diag: [3.0, 1.6, 3.0] };
let camGoal = null;
let speed = 1, playing = true, simT = 0;
function group(sel, fn) {
  const btns = [...document.querySelectorAll(sel)];
  btns.forEach(b => b.addEventListener('click', () => { btns.forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v); }));
}
group('[data-g=view]', v => { camGoal = new THREE.Vector3(...VIEWS[v]); });
group('[data-g=speed]', v => { speed = +v; });
group('[data-g=tech]', v => { tech = v; simT = 0; prevT = 0; lastPh = -1; buildTrails(); });
group('[data-g=point]', v => { point = v; tipEl.textContent = POINTS[v].tip; buildTrails(); });
const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? '停止' : '再生'; });
document.getElementById('step').addEventListener('click', () => {
  playing = false; playBtn.textContent = '再生'; simT += CYCLE / 40;
});
controls.addEventListener('start', () => { camGoal = null; });

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 50 : 35; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view); resize();

/* 着地の効果音（足が地面についた瞬間に鳴らす） */
let actx = null, seBuf = null;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const bin = atob('__SE_LAND__'), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    actx.decodeAudioData(arr.buffer, b => { seBuf = b; }, () => {});
  } catch (e) { actx = null; }
}
window.addEventListener('pointerdown', initAudio);
window.addEventListener('keydown', initAudio);
function playLand() {
  if (!actx || !seBuf || actx.state !== 'running') return;
  const src = actx.createBufferSource(); src.buffer = seBuf; src.connect(actx.destination); src.start();
}

let last = performance.now(), lastPh = -1, prevT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing) simT += dt * speed;
  if (Math.floor(simT / CYCLE - AIR1) > Math.floor(prevT / CYCLE - AIR1)) playLand();
  prevT = simT;
  const n = (simT / CYCLE) % TECHS[tech].cycles, ph = n % 1;
  if (n !== lastPh) {
    const o = pose(n); apply(o); lastPh = n;
    marker.style.left = ph * 100 + '%';
    const p = PHASES.find(p => ph >= p.a && ph < p.b) || PHASES[0];
    if (phName.textContent !== p.name) phName.textContent = p.name;
    const d = tech === 'aya' ? (Math.round(o.w) ? 'こうさの回：' : 'ひらきの回：') + p.desc : p.desc;
    if (phDesc.textContent !== d) phDesc.textContent = d;
  }
  if (camGoal) {
    camera.position.lerp(camGoal, 0.12);
    if (camera.position.distanceTo(camGoal) < 0.01) camGoal = null;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__pose = pose;
window.__ell = { CHEST_R, BELLY_R };
window.__tech = v => { tech = v; lastPh = -1; };
window.__set = v => { simT = prevT = v * CYCLE; playing = false; playBtn.textContent = '再生'; };

/**
 * main.js — Uygulama giriş noktası
 *
 * Sorumluluklar: renderer/sahne kurulumu, modüllerin bağlanması, UI, tek render
 * döngüsü (renderer.setAnimationLoop) ve XR / masaüstü mod geçişleri.
 */
import * as THREE from 'three';
import { XRManager } from './xr-manager.js';
import { XRHandTracker } from './hand-tracking.js';
import { DesktopHands } from './desktop-hands.js';
import { GestureEngine, GESTURE_LABELS_TR } from './gestures.js';
import { Locomotion } from './locomotion.js';
import {
  ScaleSystem, REFERENCE_EYE_HEIGHT, DEFAULT_SCALE_DENOMINATOR, SUPPORTED_DENOMINATORS,
  parseScaleDenominator,
} from './scale.js';
import { createEnvironment, loadArchitectureModel, parseUnitScale } from './environment.js';
import { StatusHUD } from './hud.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  app: $('app'),
  enterVR: $('btn-vr'),
  startCam: $('btn-cam-start'),
  stopCam: $('btn-cam-stop'),
  reset: $('btn-reset'),
  scale: $('scale-select'),
  camView: $('camera-view'),
  video: $('cam-video'),
  overlay: $('cam-overlay'),
  camStatus: $('cam-status'),
  consent: $('consent'),
  consentOk: $('consent-ok'),
  consentCancel: $('consent-cancel'),
  toast: $('toast'),
  dbg: {
    xr: $('dbg-xr'),
    tracking: $('dbg-tracking'),
    hand: $('dbg-hand'),
    pinch: $('dbg-pinch'),
    speed: $('dbg-speed'),
    turn: $('dbg-turn'),
    scale: $('dbg-scale'),
    eye: $('dbg-eye'),
    dist: $('dbg-dist'),
    fps: $('dbg-fps'),
  },
};

let toastTimer = 0;
function toast(message, kind = 'info', ms = 5000) {
  ui.toast.textContent = message;
  ui.toast.dataset.kind = kind;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Renderer & sahne
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// Kamerayı kendimiz, locomotion'dan SONRA güncelliyoruz (HUD ve eller titremez).
renderer.xr.cameraAutoUpdate = false;
ui.app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde5ec);
scene.add(new THREE.HemisphereLight(0xffffff, 0x7f8790, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(3, 10, 4);
scene.add(sun);

// Maket kökü: içindeki her şey maket biriminde. scale = payda → insan perspektifi
const modelRoot = new THREE.Group();
modelRoot.name = 'ModelRoot';
scene.add(modelRoot);

const initialDen = parseScaleDenominator(params.get('scale')) ?? DEFAULT_SCALE_DENOMINATOR;
const scaleSystem = new ScaleSystem(modelRoot, initialDen);

const env = createEnvironment();
modelRoot.add(env.root);

// Oyuncu: rig (locomotion) → tracking (referans alanı ofseti) → camera + eller
const rig = new THREE.Group();
rig.name = 'PlayerRig';
scene.add(rig);
const tracking = new THREE.Group();
tracking.name = 'TrackingSpace';
rig.add(tracking);

const DESKTOP_FOV = 70;
const camera = new THREE.PerspectiveCamera(DESKTOP_FOV, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.rotation.order = 'YXZ';
tracking.add(camera);

const look = { yaw: 0, pitch: 0 };
function applyDesktopCamera() {
  camera.position.set(0, REFERENCE_EYE_HEIGHT, 0);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  camera.scale.set(1, 1, 1);
  camera.fov = DESKTOP_FOV;
  camera.zoom = 1;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
applyDesktopCamera();

// Spawn (maket biriminde saklanır, görüntü uzayına her seferinde çevrilir)
const spawn = { model: env.spawn.position.clone(), yaw: env.spawn.yaw };
const spawnParam = params.get('spawn'); // "x,z,yawDeg" — bina metresi
if (spawnParam) {
  const [x, z, yawDeg] = spawnParam.split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(z)) {
    spawn.model.set(scaleSystem.buildingToModel(x), 0, scaleSystem.buildingToModel(z));
    if (Number.isFinite(yawDeg)) spawn.yaw = THREE.MathUtils.degToRad(yawDeg);
  }
}
function spawnDisplayPosition() {
  return new THREE.Vector3(
    scaleSystem.modelToDisplay(spawn.model.x),
    0,
    scaleSystem.modelToDisplay(spawn.model.z),
  );
}

// ---------------------------------------------------------------------------
// Modüller
// ---------------------------------------------------------------------------
const xr = new XRManager(renderer);
const xrHands = new XRHandTracker(tracking);
const desktop = new DesktopHands({
  video: ui.video,
  canvas: ui.overlay,
  onStatus: (text) => { ui.camStatus.textContent = text; },
});
const engine = new GestureEngine();
const loco = new Locomotion({ rig, camera, scale: scaleSystem });
const hud = new StatusHUD(camera);

function resetPosition() {
  if (!renderer.xr.isPresenting) {
    look.yaw = 0;
    look.pitch = 0;
    applyDesktopCamera();
  }
  loco.resetTo(spawnDisplayPosition(), spawn.yaw);
}
resetPosition();

// İsteğe bağlı .glb/.gltf: ?model=assets/models/bina.glb&units=maket|real|<sayı>
const modelParam = params.get('model');
if (modelParam) {
  const unitScale = parseUnitScale(params.get('units'), scaleSystem.denominator);
  toast(`Model yükleniyor: ${modelParam}`, 'info', 3000);
  loadArchitectureModel(modelParam, { unitScale })
    .then((group) => {
      env.demo.visible = params.get('demo') === '1';
      modelRoot.add(group);
      toast('Model yüklendi.', 'ok', 2500);
    })
    .catch((err) => {
      console.error(err);
      toast(`Model yüklenemedi (${modelParam}): ${err.message}. Demo sahne gösteriliyor.`, 'error', 8000);
    });
}

// ---------------------------------------------------------------------------
// Ölçek seçimi
// ---------------------------------------------------------------------------
if (!SUPPORTED_DENOMINATORS.includes(initialDen)) {
  const opt = document.createElement('option');
  opt.value = String(initialDen);
  opt.textContent = `1:${initialDen}`;
  ui.scale.appendChild(opt);
}
ui.scale.value = String(initialDen);
ui.scale.addEventListener('change', () => {
  const k = scaleSystem.setDenominator(Number(ui.scale.value));
  loco.rescaleAroundOrigin(k);
  toast(`Ölçek 1:${scaleSystem.denominator}. Model bu ölçekte yorumlanıyor.`, 'info', 3000);
});

// ---------------------------------------------------------------------------
// XR oturumu
// ---------------------------------------------------------------------------
let xrStartedAt = 0;

function updateVRButton() {
  if (xr.isPresenting) {
    ui.enterVR.textContent = 'Exit VR';
    ui.enterVR.disabled = false;
  } else if (xr.status === 'starting') {
    ui.enterVR.textContent = 'Başlatılıyor…';
    ui.enterVR.disabled = true;
  } else if (!xr.supported) {
    ui.enterVR.textContent = 'VR desteklenmiyor';
    ui.enterVR.disabled = true;
    ui.enterVR.title = xr.unsupportedReason;
  } else {
    ui.enterVR.textContent = 'Enter VR';
    ui.enterVR.disabled = false;
  }
}

xr.addEventListener('statuschange', updateVRButton);

xr.addEventListener('sessionstart', (e) => {
  const { referenceSpaceType, handTrackingEnabled } = e.detail;
  if (desktop.running || desktop.starting) {
    desktop.stop();
    hideCameraView();
  }
  updateCameraButtons();
  // 'local' fallback: zemin bilgisi yok → başlangıç baş konumunu referans göz yüksekliğine koy
  tracking.position.y = referenceSpaceType === 'local' ? REFERENCE_EYE_HEIGHT : 0;
  engine.reset();
  loco.stop();
  xrHands.setVisible(true);
  hud.setVisible(true);
  xrStartedAt = performance.now();
  lastTime = null;
  if (handTrackingEnabled === false) {
    console.warn('Bu oturumda hand-tracking özelliği etkin değil.');
  }
});

xr.addEventListener('sessionend', () => {
  tracking.position.y = 0;
  engine.reset();
  loco.stop();
  xrHands.clear();
  xrHands.setVisible(false);
  hud.setVisible(false);
  applyDesktopCamera();
  onResize();
  lastTime = null;
  updateCameraButtons();
  toast('VR oturumu kapatıldı. Masaüstü moda dönüldü.', 'info', 3000);
});

ui.enterVR.addEventListener('click', async () => {
  if (xr.isPresenting) {
    await xr.exit();
    return;
  }
  try {
    await xr.enter();
  } catch (err) {
    console.error(err);
    toast(`VR başlatılamadı: ${err.message || err.name}`, 'error', 8000);
  }
  updateVRButton();
});

xr.checkSupport().then((res) => {
  updateVRButton();
  if (!res.supported) console.info('VR:', res.reason);
});

// ---------------------------------------------------------------------------
// Masaüstü kamera
// ---------------------------------------------------------------------------
let consentGiven = false;

function showCameraView() { ui.camView.hidden = false; }
function hideCameraView() { ui.camView.hidden = true; }

function updateCameraButtons() {
  const busy = desktop.running || desktop.starting;
  ui.startCam.disabled = busy || xr.isPresenting;
  ui.stopCam.disabled = !busy;
}

async function startCamera() {
  showCameraView();
  updateCameraButtons();
  const pending = desktop.start();
  updateCameraButtons();
  try {
    await pending;
    if (desktop.running) toast('Kamera açık. Pinch hareketleriyle gezinin.', 'ok', 2500);
  } catch (err) {
    console.error(err);
    toast(err.message, 'error', 8000);
    hideCameraView();
  }
  updateCameraButtons();
}

ui.startCam.addEventListener('click', () => {
  if (xr.isPresenting) return;
  if (consentGiven) {
    startCamera();
  } else {
    ui.consent.hidden = false;
    ui.consentOk.focus();
  }
});
ui.consentOk.addEventListener('click', () => {
  consentGiven = true;
  ui.consent.hidden = true;
  startCamera();
});
ui.consentCancel.addEventListener('click', () => {
  ui.consent.hidden = true;
  toast('Kamera başlatılmadı. Klavye ile de test edebilirsiniz (W / A / D).', 'info', 4000);
});
ui.stopCam.addEventListener('click', () => {
  desktop.stop();
  engine.reset();
  hideCameraView();
  updateCameraButtons();
});
ui.reset.addEventListener('click', resetPosition);
updateCameraButtons();

// ---------------------------------------------------------------------------
// Masaüstü test kontrolleri: klavye ve fare ile bakış
// ---------------------------------------------------------------------------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys.add(e.code);
  if (e.code === 'KeyR') resetPosition();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function keyboardIntent() {
  if (renderer.xr.isPresenting) return { forward: false, turn: 0 };
  const forward = keys.has('KeyW') || keys.has('ArrowUp');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  return { forward, turn: right && !left ? 1 : left && !right ? -1 : 0 };
}

let dragging = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || dragging.id !== e.pointerId) return;
  look.yaw -= (e.clientX - dragging.x) * 0.004;
  look.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - dragging.y) * 0.004, -1.3, 1.3);
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
});
const endDrag = () => { dragging = null; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// FPS ve debug paneli
// ---------------------------------------------------------------------------
const fps = { value: 0, frames: 0, since: performance.now() };
function tickFps(now) {
  fps.frames += 1;
  const elapsed = now - fps.since;
  if (elapsed >= 500) {
    fps.value = (fps.frames * 1000) / elapsed;
    fps.frames = 0;
    fps.since = now;
  }
}

const HAND_TR = { left: 'Sol', right: 'Sağ' };
const FINGER_SHORT = { index: 'İşr', middle: 'Ort', ring: 'Yzk', pinky: 'Srç' };
const _headWorld = new THREE.Vector3();
let lastDebug = 0;

function currentEyeHeight() {
  camera.getWorldPosition(_headWorld);
  return _headWorld.y - rig.position.y;
}

function xrWarning(now) {
  if (!renderer.xr.isPresenting) return '';
  if (xr.handTrackingEnabled === false) return 'Hand tracking bu oturumda etkin değil';
  if (xrHands.status.hands === 0 && now - xrStartedAt > 2500) {
    return xrHands.status.controllers > 0
      ? 'Kontrolcüleri bırakın: el takibine geçin'
      : 'Eller görünmüyor · Ayarlar > El takibi';
  }
  return '';
}

function updateDebug(now, gesture, intent, source) {
  if (now - lastDebug < 100) return;
  lastDebug = now;
  const d = ui.dbg;
  const presenting = renderer.xr.isPresenting;

  if (presenting) d.xr.textContent = `VR aktif (${xr.referenceSpaceType})`;
  else if (xr.status === 'starting') d.xr.textContent = 'Başlatılıyor…';
  else if (!xr.supported) d.xr.textContent = `Masaüstü · VR yok`;
  else d.xr.textContent = 'Masaüstü · VR hazır';
  d.xr.title = xr.unsupportedReason || '';

  const trackedIds = Object.entries(gesture.perHand).filter(([, s]) => s.tracked).map(([id]) => HAND_TR[id] || id);
  if (presenting) {
    const ht = xr.handTrackingEnabled === false ? ' · özellik kapalı' : '';
    d.tracking.textContent = `WebXR · ${xrHands.status.hands} el${xrHands.status.controllers ? ` · ${xrHands.status.controllers} kontrolcü` : ''}${ht}`;
  } else if (desktop.running) {
    d.tracking.textContent = `MediaPipe · ${trackedIds.length} el`;
  } else if (desktop.starting) {
    d.tracking.textContent = 'MediaPipe başlatılıyor…';
  } else {
    d.tracking.textContent = 'Kapalı';
  }

  const active = gesture.activeHands.map((id) => HAND_TR[id] || id);
  d.hand.textContent = active.length ? active.join(' + ') : (trackedIds.length ? `— (görünen: ${trackedIds.join(', ')})` : '—');

  let pinchText = GESTURE_LABELS_TR[gesture.active] || gesture.active;
  if (gesture.turnConflict) pinchText += ' (sağ+sol çakışması → dönüş iptal)';
  if (source === 'keyboard') pinchText = `Klavye: ${intent.forward ? 'ileri ' : ''}${intent.turn > 0 ? 'sağ' : intent.turn < 0 ? 'sol' : ''}`.trim();
  d.pinch.textContent = pinchText;

  const den = scaleSystem.denominator;
  d.speed.textContent = `${loco.speed.toFixed(2)} m/s (bina) · ${(loco.speed / den).toFixed(4)} maket/s`;
  d.turn.textContent = `${loco.turnVelocity.toFixed(0)} °/s ${loco.turnVelocity > 0 ? '(sağ)' : loco.turnVelocity < 0 ? '(sol)' : ''}`;
  d.scale.textContent = `${scaleSystem.label} (oran ${scaleSystem.ratio.toFixed(5)})`;
  const eye = currentEyeHeight();
  d.eye.textContent = `${eye.toFixed(2)} m gerçek ≈ ${scaleSystem.displayToModel(eye).toFixed(5)} maket birimi`;

  const distParts = [];
  for (const [id, snap] of Object.entries(gesture.perHand)) {
    if (!snap.tracked || !snap.distances) continue;
    const txt = ['index', 'middle', 'ring', 'pinky']
      .map((f) => `${FINGER_SHORT[f]} ${snap.distances[f].toFixed(2)}`).join(' ');
    distParts.push(`${HAND_TR[id] || id}: ${txt}`);
  }
  d.dist.textContent = distParts.length ? distParts.join(' | ') : '—';
  d.fps.textContent = fps.value.toFixed(0);
}

// ---------------------------------------------------------------------------
// Tek render döngüsü (masaüstü + VR)
// ---------------------------------------------------------------------------
const NO_HANDS = [];
let lastTime = null;

function onFrame(time, frame) {
  const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  const now = performance.now();
  tickFps(now);

  const presenting = renderer.xr.isPresenting;
  let handFrames = NO_HANDS;

  if (presenting) {
    // 1) Bu karenin baş pozunu kameraya uygula (yürüme yönü için)
    rig.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);
    // 2) Native WebXR el eklemleri
    handFrames = xrHands.update(frame, renderer.xr.getReferenceSpace(), renderer.xr.getSession());
  } else if (desktop.running) {
    handFrames = desktop.update(now);
  }

  const gesture = engine.update(handFrames, dt);
  const kb = keyboardIntent();
  const gestureActive = gesture.forward || gesture.turn !== 0;
  const intent = {
    forward: gesture.forward || kb.forward,
    turn: gesture.turn !== 0 ? gesture.turn : kb.turn,
  };
  const source = !gestureActive && (kb.forward || kb.turn !== 0) ? 'keyboard' : 'hands';

  loco.update(dt, intent);

  if (presenting) {
    // 3) Rig hareket etti → kamera ve kameraya bağlı HUD'u aynı karede güncelle
    rig.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);
    xrHands.updateVisuals(gesture.perHand);
  } else if (desktop.running) {
    desktop.draw(gesture.perHand);
  }

  hud.update({
    gesture: gesture.active,
    left: !!(gesture.perHand.left && gesture.perHand.left.tracked),
    right: !!(gesture.perHand.right && gesture.perHand.right.tracked),
    speed: loco.speed,
    turn: loco.turnVelocity,
    fps: fps.value,
    warning: xrWarning(now),
    scaleLabel: scaleSystem.label,
  }, now);

  updateDebug(now, gesture, intent, source);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(onFrame);

// ---------------------------------------------------------------------------
// Temizlik
// ---------------------------------------------------------------------------
window.addEventListener('pagehide', () => {
  desktop.dispose();
  if (xr.isPresenting) xr.exit();
});

// Hata ayıklama için konsoldan erişim
window.__app = { THREE, renderer, scene, camera, rig, modelRoot, scaleSystem, engine, loco, xr, desktop };

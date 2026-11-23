/**
 * gestures.js — Ortak jest motoru
 *
 * Hem Quest 3 WebXR joint verisi (hand-tracking.js) hem de MediaPipe landmark
 * verisi (desktop-hands.js) aynı formata dönüştürülüp bu motora verilir:
 *
 *   handFrame = {
 *     id: 'left' | 'right',
 *     tracked: boolean,
 *     points: {                      // metre cinsinden 3B noktalar ([x,y,z] veya {x,y,z})
 *       wrist, thumbTip, indexTip, middleTip, ringTip, pinkyTip, middleMcp, ...
 *     }
 *   }
 *
 * Saf JavaScript'tir; Three.js veya DOM kullanmaz, bu yüzden Node ile test edilir.
 *
 * Algılama matematiği
 * -------------------
 *   handSize  = |wrist − middleMcp|                (orta parmak kök eklemi, ~8–9 cm)
 *   d_finger  = |thumbTip − fingerTip| / handSize  (boyutsuz, el büyüklüğünden bağımsız)
 *
 *   Basma eşiği  (press)   : d < 0.30  → pinch adayı
 *   Bırakma eşiği (release): d > 0.45  → aktif pinch biter   (hysteresis bandı 0.30–0.45)
 *
 * Öncelik kuralları (yüksekten düşüğe)
 * ------------------------------------
 *   1. Takip kaybı → o elin durumu sıfırlanır, hareket durur.
 *   2. Kilitli (aktif) pinch, mesafesi bırakma eşiğinin altında kaldıkça korunur.
 *   3. Yeni pinch: basma eşiğinin altındaki en yakın parmak kazanır, ANCAK ikinci
 *      adaydan en az `ambiguityMargin` kadar yakın olmalıdır; aksi hâlde belirsizdir
 *      ve hiçbir hareket üretilmez (yumruk, gevşek el vb.).
 *   4. Yeni pinch `activationTime` saniye kararlı kalmadan etkinleşmez (titreme filtresi).
 *      Bırakma ise anında gerçekleşir.
 *   5. Orta parmak pinch'i bir harekete bağlı değildir; "engelleyici" olarak çalışır
 *      ve yüzük/serçe pinch'iyle karışmasını önler.
 *   6. İki el: herhangi bir elde ileri → ileri. Sağ ve sol dönüş aynı anda
 *      (farklı ellerde) istenirse dönüş iptal edilir. İleri + dönüş birlikte olabilir.
 */

export const PINCH_FINGERS = Object.freeze(['index', 'middle', 'ring', 'pinky']);

export const GESTURES = Object.freeze({
  NONE: 'none',
  FORWARD: 'forward',
  TURN_RIGHT: 'turnRight',
  TURN_LEFT: 'turnLeft',
});

export const FINGER_TO_GESTURE = Object.freeze({
  index: GESTURES.FORWARD,     // başparmak + işaret  → ileri
  middle: GESTURES.NONE,       // başparmak + orta    → (engelleyici, hareket yok)
  ring: GESTURES.TURN_LEFT,    // başparmak + yüzük   → sola dönüş
  pinky: GESTURES.TURN_RIGHT,  // başparmak + serçe   → sağa dönüş
});

export const DEFAULT_GESTURE_CONFIG = Object.freeze({
  pressThreshold: 0.30,
  releaseThreshold: 0.45,
  ambiguityMargin: 0.06,
  activationTime: 0.06, // s
  minHandSize: 1e-4,    // birim; bundan küçük el boyutu = geçersiz veri
});

const TIP_KEYS = Object.freeze({
  index: 'indexTip',
  middle: 'middleTip',
  ring: 'ringTip',
  pinky: 'pinkyTip',
});

export const REQUIRED_POINTS = Object.freeze([
  'wrist', 'thumbTip', 'indexTip', 'middleTip', 'ringTip', 'pinkyTip', 'middleMcp',
]);

function cx(p) { return p.x !== undefined ? p.x : p[0]; }
function cy(p) { return p.y !== undefined ? p.y : p[1]; }
function cz(p) { return p.z !== undefined ? p.z : p[2]; }

function isFiniteVec(p) {
  return p != null && Number.isFinite(cx(p)) && Number.isFinite(cy(p)) && Number.isFinite(cz(p) ?? 0);
}

/** İki 3B nokta arasındaki Öklid mesafesi. [x,y,z] ve {x,y,z} kabul eder. */
export function distance3(a, b) {
  return Math.hypot(cx(a) - cx(b), cy(a) - cy(b), (cz(a) ?? 0) - (cz(b) ?? 0));
}

/** El büyüklüğü referansı: bilek → orta parmak kök eklemi (MCP). */
export function computeHandSize(points) {
  return distance3(points.wrist, points.middleMcp);
}

/**
 * Başparmak ucunun diğer parmak uçlarına normalize mesafeleri.
 * @returns {{handSize:number,index:number,middle:number,ring:number,pinky:number}|null}
 */
export function normalizedPinchDistances(points, config = DEFAULT_GESTURE_CONFIG) {
  if (!points) return null;
  for (const key of REQUIRED_POINTS) {
    if (!isFiniteVec(points[key])) return null;
  }
  const handSize = computeHandSize(points);
  if (!(handSize > config.minHandSize)) return null;
  const out = { handSize, index: 0, middle: 0, ring: 0, pinky: 0 };
  for (const finger of PINCH_FINGERS) {
    out[finger] = distance3(points.thumbTip, points[TIP_KEYS[finger]]) / handSize;
  }
  return out;
}

/**
 * Hysteresis + öncelik kurallarıyla bu kare için pinch adayını seçer.
 * @param {object} dist normalizedPinchDistances çıktısı
 * @param {string|null} activeFinger şu an kilitli parmak
 * @returns {string|null}
 */
export function selectPinchCandidate(dist, activeFinger, config = DEFAULT_GESTURE_CONFIG) {
  if (activeFinger && dist[activeFinger] < config.releaseThreshold) {
    return activeFinger; // kural 2: kilitli pinch korunur
  }
  const candidates = PINCH_FINGERS
    .filter((f) => dist[f] < config.pressThreshold)
    .sort((a, b) => dist[a] - dist[b]);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && dist[candidates[1]] - dist[candidates[0]] < config.ambiguityMargin) {
    return null; // kural 3: belirsiz → hareket yok
  }
  return candidates[0];
}

/** Tek bir elin jest durum makinesi: idle → pending → active. */
export class HandGestureState {
  constructor(config = DEFAULT_GESTURE_CONFIG) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.tracked = false;
    this.activeFinger = null;
    this.pendingFinger = null;
    this.pendingTime = 0;
    this.distances = null;
  }

  get gesture() {
    return this.activeFinger ? FINGER_TO_GESTURE[this.activeFinger] : GESTURES.NONE;
  }

  /**
   * @param {object|null} points  null = takip yok
   * @param {number} dt saniye
   */
  update(points, dt) {
    const dist = normalizedPinchDistances(points, this.config);
    if (!dist) {
      this.reset();
      return this.snapshot();
    }
    this.tracked = true;
    this.distances = dist;

    const candidate = selectPinchCandidate(dist, this.activeFinger, this.config);

    if (candidate === this.activeFinger) {
      this.pendingFinger = null;
      this.pendingTime = 0;
    } else if (candidate === null) {
      // bırakma anında gerçekleşir
      this.activeFinger = null;
      this.pendingFinger = null;
      this.pendingTime = 0;
    } else {
      // farklı bir parmak: önce mevcut hareket durur, yeni jest kararlı olunca başlar
      this.activeFinger = null;
      if (this.pendingFinger === candidate) {
        this.pendingTime += Math.max(0, dt);
      } else {
        this.pendingFinger = candidate;
        this.pendingTime = 0;
      }
      if (this.pendingTime >= this.config.activationTime) {
        this.activeFinger = candidate;
        this.pendingFinger = null;
        this.pendingTime = 0;
      }
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      tracked: this.tracked,
      activeFinger: this.activeFinger,
      pendingFinger: this.pendingFinger,
      gesture: this.gesture,
      distances: this.distances,
    };
  }
}

/**
 * Ellerin jestlerini tek bir hareket niyetine birleştirir.
 * turn: +1 = sağa, −1 = sola, 0 = dönüş yok
 */
export function combineHands(perHand) {
  let forward = false;
  let right = false;
  let left = false;
  const forwardHands = [];
  const turnHands = [];
  let trackedCount = 0;

  for (const [id, snap] of Object.entries(perHand)) {
    if (!snap || !snap.tracked) continue;
    trackedCount += 1;
    if (snap.gesture === GESTURES.FORWARD) { forward = true; forwardHands.push(id); }
    if (snap.gesture === GESTURES.TURN_RIGHT) { right = true; turnHands.push(id); }
    if (snap.gesture === GESTURES.TURN_LEFT) { left = true; turnHands.push(id); }
  }

  const turnConflict = right && left;
  const turn = turnConflict ? 0 : right ? 1 : left ? -1 : 0;

  const parts = [];
  if (forward) parts.push(GESTURES.FORWARD);
  if (turn === 1) parts.push(GESTURES.TURN_RIGHT);
  if (turn === -1) parts.push(GESTURES.TURN_LEFT);

  const activeHands = [...new Set([...forwardHands, ...(turnConflict ? [] : turnHands)])];

  return {
    forward,
    turn,
    turnConflict,
    active: parts.length ? parts.join('+') : GESTURES.NONE,
    activeHands,
    trackedCount,
    anyTracked: trackedCount > 0,
    perHand,
  };
}

/** Çok elli jest motoru. Her el kendi durum makinesine sahiptir. */
export class GestureEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
    this.hands = new Map();
    this.last = combineHands({});
  }

  /**
   * @param {Array<{id:string,tracked:boolean,points:object|null}>} handFrames
   * @param {number} dt saniye
   */
  update(handFrames, dt) {
    const seen = new Set();
    const perHand = {};
    for (const frame of handFrames || []) {
      if (!frame || !frame.id || seen.has(frame.id)) continue;
      seen.add(frame.id);
      let state = this.hands.get(frame.id);
      if (!state) {
        state = new HandGestureState(this.config);
        this.hands.set(frame.id, state);
      }
      perHand[frame.id] = state.update(frame.tracked === false ? null : frame.points, dt);
    }
    // bu karede görünmeyen eller: takip kaybı → sıfırla
    for (const [id, state] of this.hands) {
      if (!seen.has(id)) state.reset();
    }
    this.last = combineHands(perHand);
    return this.last;
  }

  reset() {
    for (const state of this.hands.values()) state.reset();
    this.last = combineHands({});
  }
}

/** Debug arayüzü için Türkçe etiketler. */
export const GESTURE_LABELS_TR = Object.freeze({
  none: 'Yok',
  forward: 'Başparmak + İşaret → İleri',
  turnRight: 'Başparmak + Serçe → Sağa dön',
  turnLeft: 'Başparmak + Yüzük → Sola dön',
  'forward+turnRight': 'İleri + Sağa dön',
  'forward+turnLeft': 'İleri + Sola dön',
});

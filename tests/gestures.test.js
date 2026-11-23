// Jest motoru birim testleri — çalıştırma: npm test  (veya: node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureEngine, HandGestureState, GESTURES, DEFAULT_GESTURE_CONFIG,
  normalizedPinchDistances, selectPinchCandidate, combineHands, distance3,
} from '../js/gestures.js';

const NO_DELAY = { ...DEFAULT_GESTURE_CONFIG, activationTime: 0 };

/**
 * Sentetik el (metre). s: el boyutu çarpanı. pinch: { finger: normalize mesafe }
 * Başparmak ucu sabit; parmak ucu, istenen normalize mesafede başparmağın +X yönüne konur.
 */
function makeHand({ s = 1, pinch = {}, offset = [0, 0, 0] } = {}) {
  const handSize = 0.09 * s;
  const thumb = [0.04 * s, 0.08 * s, 0.03 * s];
  const open = { index: 1.0, middle: 1.1, ring: 1.05, pinky: 1.0 };
  const dirs = {
    index: [1, 0.2, 0], middle: [0.6, 0.8, 0], ring: [0, 1, 0.3], pinky: [-0.5, 0.8, 0.3],
  };
  const tip = (finger) => {
    const n = pinch[finger] ?? open[finger];
    const d = dirs[finger];
    const len = Math.hypot(...d);
    return d.map((v, i) => thumb[i] + (v / len) * n * handSize);
  };
  const add = (p) => p.map((v, i) => v + offset[i]);
  return {
    wrist: add([0, 0, 0]),
    middleMcp: add([0, handSize, 0]),
    thumbTip: add(thumb),
    indexTip: add(tip('index')),
    middleTip: add(tip('middle')),
    ringTip: add(tip('ring')),
    pinkyTip: add(tip('pinky')),
  };
}

test('distance3 dizi ve nesne biçimlerini kabul eder', () => {
  assert.equal(distance3([0, 0, 0], [3, 4, 0]), 5);
  assert.equal(distance3({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 4 }), 5);
});

test('normalize mesafeler el büyüklüğünden bağımsızdır', () => {
  const small = normalizedPinchDistances(makeHand({ s: 0.7, pinch: { index: 0.2 } }));
  const large = normalizedPinchDistances(makeHand({ s: 1.4, pinch: { index: 0.2 } }));
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    assert.ok(Math.abs(small[f] - large[f]) < 1e-9, f);
  }
  assert.ok(Math.abs(small.index - 0.2) < 1e-9);
});

test('eksik veya geçersiz nokta → null', () => {
  const h = makeHand();
  delete h.ringTip;
  assert.equal(normalizedPinchDistances(h), null);
  assert.equal(normalizedPinchDistances(makeHand({ s: 0 })), null);
  assert.equal(normalizedPinchDistances({ ...makeHand(), wrist: [NaN, 0, 0] }), null);
});

test('her parmak doğru harekete eşlenir', () => {
  const cases = [
    ['index', GESTURES.FORWARD],
    ['pinky', GESTURES.TURN_RIGHT],
    ['ring', GESTURES.TURN_LEFT],
    ['middle', GESTURES.NONE],
  ];
  for (const [finger, gesture] of cases) {
    const st = new HandGestureState(NO_DELAY);
    const snap = st.update(makeHand({ pinch: { [finger]: 0.15 } }), 1 / 72);
    assert.equal(snap.activeFinger, finger);
    assert.equal(snap.gesture, gesture, finger);
  }
});

test('pinch yok → hareket yok', () => {
  const st = new HandGestureState(NO_DELAY);
  assert.equal(st.update(makeHand(), 1 / 72).gesture, GESTURES.NONE);
});

test('hysteresis: bant içinde aktif kalır, eşik aşılınca bırakılır', () => {
  const st = new HandGestureState(NO_DELAY);
  st.update(makeHand({ pinch: { index: 0.2 } }), 0.016);
  assert.equal(st.gesture, GESTURES.FORWARD);
  st.update(makeHand({ pinch: { index: 0.40 } }), 0.016); // 0.30 < 0.40 < 0.45
  assert.equal(st.gesture, GESTURES.FORWARD, 'bırakma eşiğinin altında aktif kalmalı');
  st.update(makeHand({ pinch: { index: 0.50 } }), 0.016);
  assert.equal(st.gesture, GESTURES.NONE, 'bırakma eşiği aşılınca anında durmalı');
});

test('hysteresis: bant içindeki değer yeni pinch başlatmaz', () => {
  const st = new HandGestureState(NO_DELAY);
  st.update(makeHand({ pinch: { index: 0.40 } }), 0.016);
  assert.equal(st.gesture, GESTURES.NONE);
});

test('belirsiz çoklu pinch (iki parmak eşit yakın) → hareket yok', () => {
  const st = new HandGestureState(NO_DELAY);
  st.update(makeHand({ pinch: { ring: 0.2, pinky: 0.22 } }), 0.016);
  assert.equal(st.gesture, GESTURES.NONE);
});

test('açıkça daha yakın parmak kazanır', () => {
  const dist = { index: 1, middle: 1, ring: 0.27, pinky: 0.12 };
  assert.equal(selectPinchCandidate(dist, null, NO_DELAY), 'pinky');
});

test('kilitli pinch, ikinci parmak yaklaşsa da korunur (öncelik)', () => {
  const st = new HandGestureState(NO_DELAY);
  st.update(makeHand({ pinch: { pinky: 0.15 } }), 0.016);
  assert.equal(st.gesture, GESTURES.TURN_RIGHT);
  st.update(makeHand({ pinch: { pinky: 0.2, ring: 0.1 } }), 0.016);
  assert.equal(st.gesture, GESTURES.TURN_RIGHT);
});

test('orta parmak engelleyicidir: yüzük pinch’ini maskeler', () => {
  const st = new HandGestureState(NO_DELAY);
  st.update(makeHand({ pinch: { middle: 0.1, ring: 0.25 } }), 0.016);
  assert.equal(st.activeFinger, 'middle');
  assert.equal(st.gesture, GESTURES.NONE);
});

test('aktivasyon gecikmesi: kısa titreme hareket üretmez', () => {
  const st = new HandGestureState({ ...DEFAULT_GESTURE_CONFIG, activationTime: 0.06 });
  const pinched = makeHand({ pinch: { index: 0.15 } });
  st.update(pinched, 0.02);
  assert.equal(st.gesture, GESTURES.NONE);
  st.update(makeHand(), 0.02); // titreme: bırakıldı
  st.update(pinched, 0.02);
  st.update(pinched, 0.02);
  st.update(pinched, 0.02);
  assert.equal(st.gesture, GESTURES.NONE, '0.04 s < 0.06 s');
  st.update(pinched, 0.02);
  assert.equal(st.gesture, GESTURES.FORWARD, '0.06 s sonra aktif');
});

test('takip kaybı → anında sıfırlanır', () => {
  const engine = new GestureEngine({ activationTime: 0 });
  let r = engine.update([{ id: 'right', tracked: true, points: makeHand({ pinch: { index: 0.1 } }) }], 0.016);
  assert.equal(r.forward, true);
  r = engine.update([{ id: 'right', tracked: false, points: null }], 0.016);
  assert.equal(r.forward, false);
  assert.equal(r.anyTracked, false);
});

test('el kadrajdan çıkınca (frame yok) durum sıfırlanır', () => {
  const engine = new GestureEngine({ activationTime: 0 });
  engine.update([{ id: 'left', tracked: true, points: makeHand({ pinch: { ring: 0.1 } }) }], 0.016);
  const r = engine.update([], 0.016);
  assert.equal(r.turn, 0);
  assert.equal(engine.hands.get('left').activeFinger, null);
});

test('iki el: ileri + sağa dönüş birlikte', () => {
  const engine = new GestureEngine({ activationTime: 0 });
  const r = engine.update([
    { id: 'left', tracked: true, points: makeHand({ pinch: { index: 0.1 } }) },
    { id: 'right', tracked: true, points: makeHand({ pinch: { pinky: 0.1 }, offset: [0.3, 0, 0] }) },
  ], 0.016);
  assert.equal(r.forward, true);
  assert.equal(r.turn, 1);
  assert.equal(r.active, 'forward+turnRight');
  assert.deepEqual(r.activeHands.sort(), ['left', 'right']);
});

test('iki el: zıt dönüşler birbirini iptal eder', () => {
  const r = combineHands({
    left: { tracked: true, gesture: GESTURES.TURN_LEFT },
    right: { tracked: true, gesture: GESTURES.TURN_RIGHT },
  });
  assert.equal(r.turn, 0);
  assert.equal(r.turnConflict, true);
  assert.equal(r.active, GESTURES.NONE);
});

test('MediaPipe tarzı {x,y,z} noktalarla çalışır', () => {
  const arr = makeHand({ pinch: { ring: 0.1 } });
  const obj = Object.fromEntries(Object.entries(arr).map(([k, [x, y, z]]) => [k, { x, y, z }]));
  const engine = new GestureEngine({ activationTime: 0 });
  const r = engine.update([{ id: 'right', tracked: true, points: obj }], 0.016);
  assert.equal(r.turn, -1);
});

test('aynı karede aynı id iki kez gelirse ilki kullanılır', () => {
  const engine = new GestureEngine({ activationTime: 0 });
  const r = engine.update([
    { id: 'right', tracked: true, points: makeHand({ pinch: { index: 0.1 } }) },
    { id: 'right', tracked: true, points: makeHand({ pinch: { pinky: 0.1 } }) },
  ], 0.016);
  assert.equal(r.forward, true);
  assert.equal(r.turn, 0);
});

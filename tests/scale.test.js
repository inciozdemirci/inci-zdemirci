// Ölçek sistemi birim testleri
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ScaleSystem, scaledEyeHeight, scaleRatio, parseScaleDenominator, REFERENCE_EYE_HEIGHT,
} from '../js/scale.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function mockRoot() {
  return { scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
}

test('1:70 oranı ve ölçeklenmiş göz yüksekliği', () => {
  close(scaleRatio(70), 1 / 70);
  close(scaledEyeHeight(70), 1.6 / 70);
  close(scaledEyeHeight(70), 0.022857142857, 1e-9);
});

test('modelRoot payda kadar büyütülür (insan perspektifi)', () => {
  const root = mockRoot();
  const s = new ScaleSystem(root, 70);
  assert.equal(root.scale.x, 70);
  assert.equal(s.label, '1:70');
});

test('maket ↔ bina ↔ görüntü dönüşümleri tutarlı', () => {
  const s = new ScaleSystem(null, 70);
  const wallModel = 3 / 70;                   // makette 3 m duvar
  close(s.modelToBuilding(wallModel), 3);     // gerçek binada 3 m
  close(s.modelToDisplay(wallModel), 3);      // kullanıcı 3 m görür
  close(s.displayToModel(REFERENCE_EYE_HEIGHT), 1.6 / 70);
  close(s.displayToModel(1), 1 / 70);         // 1 m gerçek baş hareketi = 1/70 maket
});

test('ölçek değişimi oran döndürür', () => {
  const root = mockRoot();
  const s = new ScaleSystem(root, 70);
  close(s.setDenominator(100), 100 / 70);
  assert.equal(root.scale.x, 100);
  assert.throws(() => s.setDenominator(0), RangeError);
});

test('ölçek parametresi ayrıştırma', () => {
  assert.equal(parseScaleDenominator('70'), 70);
  assert.equal(parseScaleDenominator('1:50'), 50);
  assert.equal(parseScaleDenominator('1/200'), 200);
  assert.equal(parseScaleDenominator('abc'), null);
  assert.equal(parseScaleDenominator('-5'), null);
  assert.equal(parseScaleDenominator(null), null);
});

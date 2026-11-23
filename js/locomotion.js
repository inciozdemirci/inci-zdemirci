/**
 * locomotion.js — Frame-rate bağımsız yürüme ve dönüş
 *
 * Sahne grafiği:
 *   scene
 *    ├─ modelRoot (scale = payda)      ← 1:70 maket
 *    └─ rig      (konum + yalnızca Y rotasyonu, locomotion burayı hareket ettirir)
 *        └─ tracking (yalnızca 'local' referans alanı fallback'inde Y ofseti)
 *            ├─ camera   ← WebXR head pose (dokunulmaz)
 *            └─ el eklemleri
 *
 * Yürüme yönü: kafanın yatay (XZ) bakış yönü. Dikey baş hareketi etkisizdir.
 * Dönüş: dünya Y ekseni etrafında, kullanıcının BAŞ konumu pivot alınarak
 * (oda ölçeğinde rig merkezinden uzakta dursanız bile yerinizde dönersiniz).
 */
import * as THREE from 'three';

export const DEFAULT_LOCOMOTION = Object.freeze({
  walkSpeed: 1.4,     // m/s (bina) — rahat insan yürüyüşü
  turnRate: 45,       // °/s
  acceleration: 10,   // 1/s — kalkış yumuşatma (duruş anındadır)
  turnAcceleration: 10,
  maxDeltaTime: 0.1,  // s — sekme/duraklama sonrası ani sıçramayı önler
  minHorizontal: 0.2, // bakış neredeyse dikeyse son geçerli yön kullanılır
});

const UP = new THREE.Vector3(0, 1, 0);

export class Locomotion {
  /**
   * @param {{rig:THREE.Object3D, camera:THREE.Camera, scale:import('./scale.js').ScaleSystem, options?:object}} p
   */
  constructor({ rig, camera, scale, options = {} }) {
    this.rig = rig;
    this.camera = camera;
    this.scale = scale;
    this.options = { ...DEFAULT_LOCOMOTION, ...options };

    this.speed = 0;        // m/s (bina)
    this.turnVelocity = 0; // °/s, + = sağa

    this._dir = new THREE.Vector3(0, 0, -1);
    this._tmp = new THREE.Vector3();
    this._head = new THREE.Vector3();
    this._offset = new THREE.Vector3();
  }

  /**
   * @param {number} dt saniye
   * @param {{forward:boolean, turn:number}} intent
   */
  update(dt, intent) {
    const o = this.options;
    const step = Math.min(Math.max(dt, 0), o.maxDeltaTime);
    if (step === 0) return;

    // --- hız: kalkışta yumuşak, bırakınca ANINDA dur ---
    if (intent.forward) {
      this.speed += (o.walkSpeed - this.speed) * (1 - Math.exp(-o.acceleration * step));
    } else {
      this.speed = 0;
    }

    const targetTurn = Math.sign(intent.turn || 0) * o.turnRate;
    if (targetTurn === 0) {
      this.turnVelocity = 0;
    } else {
      if (Math.sign(this.turnVelocity) !== Math.sign(targetTurn)) this.turnVelocity = 0;
      this.turnVelocity += (targetTurn - this.turnVelocity) * (1 - Math.exp(-o.turnAcceleration * step));
    }

    if (this.turnVelocity !== 0) {
      // Three.js'te +Y rotasyonu sola dönüştür → sağa dönüş negatif açı
      this.rotateAroundHead(-THREE.MathUtils.degToRad(this.turnVelocity) * step);
    }

    if (this.speed > 0) {
      const dir = this.getHorizontalHeadDirection();
      const distance = this.scale.buildingToDisplay(this.speed * step);
      this.rig.position.addScaledVector(dir, distance);
    }
  }

  /** Başın dünya uzayındaki yatay bakış yönü (birim vektör). */
  getHorizontalHeadDirection() {
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldDirection(this._tmp);
    this._tmp.y = 0;
    const len = this._tmp.length();
    if (len > this.options.minHorizontal) {
      this._dir.copy(this._tmp).divideScalar(len);
    }
    return this._dir;
  }

  /** Rig'i baş konumu etrafında dünya Y ekseninde döndürür. */
  rotateAroundHead(angle) {
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this._head);
    this._offset.copy(this.rig.position).sub(this._head);
    this._offset.applyAxisAngle(UP, angle);
    this.rig.position.copy(this._head).add(this._offset);
    this.rig.rotation.y += angle;
    this._dir.applyAxisAngle(UP, angle);
  }

  /**
   * Başı (XZ) hedef noktaya, bakış yönünü hedef yaw'a hizalar.
   * VR'da kullanıcının oda içindeki konumu/yönü korunarak düzeltme yapılır.
   * @param {THREE.Vector3} position görüntü uzayında hedef (y = zemin)
   * @param {number} yaw radyan, 0 = −Z (kuzey)
   */
  resetTo(position, yaw = 0) {
    this.stop();
    this.rig.updateWorldMatrix(true, true);
    this.camera.getWorldPosition(this._head);
    const headInRig = this.rig.worldToLocal(this._head.clone());

    this.camera.getWorldDirection(this._tmp);
    const headWorldYaw = Math.atan2(-this._tmp.x, -this._tmp.z);
    const headYawInRig = headWorldYaw - this.rig.rotation.y;

    const newYaw = yaw - headYawInRig;
    this.rig.rotation.set(0, newYaw, 0);
    this._offset.set(headInRig.x, 0, headInRig.z).applyAxisAngle(UP, newYaw);
    this.rig.position.set(position.x - this._offset.x, position.y, position.z - this._offset.z);
    this.rig.updateWorldMatrix(false, true);
    this._dir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  /** Ölçek değişince başın sahnedeki konumunu orijine göre k kat ölçekler. */
  rescaleAroundOrigin(k) {
    this.rig.updateWorldMatrix(true, true);
    this.camera.getWorldPosition(this._head);
    this.rig.position.x += this._head.x * (k - 1);
    this.rig.position.z += this._head.z * (k - 1);
  }

  stop() {
    this.speed = 0;
    this.turnVelocity = 0;
  }
}

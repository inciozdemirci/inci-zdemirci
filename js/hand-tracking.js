/**
 * hand-tracking.js — Quest 3 native WebXR Hand Tracking
 *
 * Her XR karesinde XRFrame.getJointPose() ile 25 eklemin pozu tracking
 * (referans) uzayında okunur. Gesture engine'in ortak formatına dönüştürülür ve
 * eklemler tek bir InstancedMesh (1 draw call) ile görselleştirilir.
 *
 * Eklem pozları referans uzayındadır; bu yüzden görselleştirme mesh'i kamerayla
 * AYNI ebeveynin (tracking grubu) altına eklenir. Locomotion rig'i hareket
 * ettirdiğinde eller de kamerayla birlikte hareket eder.
 */
import * as THREE from 'three';

const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];

export const XR_HAND_JOINTS = Object.freeze([
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => FINGER_JOINTS.map((j) => `${f}-finger-${j}`)),
]);

const JOINT_INDEX = Object.freeze(Object.fromEntries(XR_HAND_JOINTS.map((name, i) => [name, i])));
const JOINT_COUNT = XR_HAND_JOINTS.length; // 25

/** Gesture engine noktası → WebXR eklem adı. MCP = proksimal falanksın başladığı eklem. */
const KEY_JOINTS = Object.freeze([
  ['wrist', 'wrist'],
  ['thumbTip', 'thumb-tip'],
  ['indexTip', 'index-finger-tip'],
  ['middleTip', 'middle-finger-tip'],
  ['ringTip', 'ring-finger-tip'],
  ['pinkyTip', 'pinky-finger-tip'],
  ['indexMcp', 'index-finger-phalanx-proximal'],
  ['middleMcp', 'middle-finger-phalanx-proximal'],
  ['pinkyMcp', 'pinky-finger-phalanx-proximal'],
].map(([key, joint]) => [key, JOINT_INDEX[joint]]));

const FINGER_TIP_INDEX = Object.freeze({
  index: JOINT_INDEX['index-finger-tip'],
  middle: JOINT_INDEX['middle-finger-tip'],
  ring: JOINT_INDEX['ring-finger-tip'],
  pinky: JOINT_INDEX['pinky-finger-tip'],
});
const THUMB_TIP_INDEX = JOINT_INDEX['thumb-tip'];

const HAND_IDS = ['left', 'right'];
const COLORS = {
  left: new THREE.Color(0x7fb2ff),
  right: new THREE.Color(0xffb27f),
  active: new THREE.Color(0x2fe08a),
  pending: new THREE.Color(0xffe14d),
};

function createHandState(id) {
  const points = {};
  for (const [key] of KEY_JOINTS) points[key] = [0, 0, 0];
  return {
    id,
    present: false,
    tracked: false,
    positions: new Float32Array(JOINT_COUNT * 3),
    radii: new Float32Array(JOINT_COUNT),
    valid: new Uint8Array(JOINT_COUNT),
    points,
  };
}

export class XRHandTracker {
  /** @param {THREE.Object3D} parent kameranın ebeveyni (tracking grubu) */
  constructor(parent) {
    this.hands = { left: createHandState('left'), right: createHandState('right') };
    this.status = { hands: 0, controllers: 0 };
    this._frames = [];

    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, material, JOINT_COUNT * 2);
    this.mesh.name = 'XRHandJoints';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._dummy = new THREE.Object3D();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < JOINT_COUNT * 2; i++) {
      this.mesh.setMatrixAt(i, this._zero);
      this.mesh.setColorAt(i, i < JOINT_COUNT ? COLORS.left : COLORS.right);
    }
    parent.add(this.mesh);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * @param {XRFrame|undefined} frame
   * @param {XRReferenceSpace|null} refSpace
   * @param {XRSession|null} session
   * @returns {Array<{id:string,tracked:boolean,points:object|null}>}
   */
  update(frame, refSpace, session) {
    for (const id of HAND_IDS) {
      this.hands[id].present = false;
      this.hands[id].tracked = false;
    }
    this._frames.length = 0;
    let hands = 0;
    let controllers = 0;

    if (frame && refSpace && session) {
      for (const source of session.inputSources) {
        if (!source.hand) {
          if (source.targetRayMode === 'tracked-pointer') controllers += 1;
          continue;
        }
        const id = source.handedness === 'left' || source.handedness === 'right' ? source.handedness : null;
        if (!id) continue;
        const hand = this.hands[id];
        if (hand.present) continue; // aynı elin ikinci kaynağı (olmamalı)
        hand.present = true;
        hands += 1;
        this._readJoints(frame, refSpace, source.hand, hand);
        this._frames.push({ id, tracked: hand.tracked, points: hand.tracked ? hand.points : null });
      }
    }

    this.status.hands = hands;
    this.status.controllers = controllers;
    return this._frames;
  }

  _readJoints(frame, refSpace, xrHand, hand) {
    hand.valid.fill(0);
    for (let i = 0; i < JOINT_COUNT; i++) {
      const space = xrHand.get(XR_HAND_JOINTS[i]);
      if (!space) continue;
      let pose = null;
      try {
        pose = frame.getJointPose(space, refSpace);
      } catch {
        pose = null;
      }
      if (!pose) continue;
      const p = pose.transform.position;
      hand.positions[i * 3] = p.x;
      hand.positions[i * 3 + 1] = p.y;
      hand.positions[i * 3 + 2] = p.z;
      hand.radii[i] = pose.radius || 0.008;
      hand.valid[i] = 1;
    }

    let ok = true;
    for (const [key, index] of KEY_JOINTS) {
      if (!hand.valid[index]) { ok = false; break; }
      const v = hand.points[key];
      v[0] = hand.positions[index * 3];
      v[1] = hand.positions[index * 3 + 1];
      v[2] = hand.positions[index * 3 + 2];
    }
    hand.tracked = ok;
  }

  /** @param {Record<string, {activeFinger:string|null, pendingFinger:string|null}>} perHand */
  updateVisuals(perHand = {}) {
    if (!this.mesh.visible) return;
    const dummy = this._dummy;
    HAND_IDS.forEach((id, h) => {
      const hand = this.hands[id];
      const snap = perHand[id];
      const activeTip = snap && snap.activeFinger ? FINGER_TIP_INDEX[snap.activeFinger] : -1;
      const pendingTip = snap && snap.pendingFinger ? FINGER_TIP_INDEX[snap.pendingFinger] : -1;

      for (let i = 0; i < JOINT_COUNT; i++) {
        const slot = h * JOINT_COUNT + i;
        if (!hand.present || !hand.valid[i]) {
          this.mesh.setMatrixAt(slot, this._zero);
          continue;
        }
        dummy.position.set(hand.positions[i * 3], hand.positions[i * 3 + 1], hand.positions[i * 3 + 2]);
        const r = Math.max(hand.radii[i], 0.004) * 0.85;
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(slot, dummy.matrix);

        let color = COLORS[id];
        if (activeTip >= 0 && (i === activeTip || i === THUMB_TIP_INDEX)) color = COLORS.active;
        else if (pendingTip >= 0 && (i === pendingTip || i === THUMB_TIP_INDEX)) color = COLORS.pending;
        this.mesh.setColorAt(slot, color);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const id of HAND_IDS) {
      this.hands[id].present = false;
      this.hands[id].tracked = false;
    }
    for (let i = 0; i < JOINT_COUNT * 2; i++) this.mesh.setMatrixAt(i, this._zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.status.hands = 0;
    this.status.controllers = 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

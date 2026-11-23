/**
 * hud.js — VR içi küçük 3B durum göstergesi
 *
 * Kameraya bağlı, görüş alanının alt kısmında (~17° aşağıda), 20 × 7.5 cm'lik
 * yarı saydam bir panel. depthTest kapalı → duvara yaklaşınca kesilmez.
 * Canvas yalnızca içerik değişince (en fazla 10 Hz) yeniden çizilir.
 */
import * as THREE from 'three';

const W = 512;
const H = 192;

const GESTURE_TEXT = {
  none: 'DUR',
  forward: 'İLERİ',
  turnRight: 'SAĞA',
  turnLeft: 'SOLA',
  'forward+turnRight': 'İLERİ + SAĞA',
  'forward+turnLeft': 'İLERİ + SOLA',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawIcon(ctx, gesture, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  const moving = gesture !== 'none';
  ctx.fillStyle = moving ? '#2fe08a' : '#9aa6b5';
  ctx.beginPath();
  if (gesture === 'none') {
    roundRect(ctx, -s * 0.38, -s * 0.38, s * 0.76, s * 0.76, s * 0.12);
  } else {
    let angle = 0; // yukarı
    if (gesture === 'turnRight') angle = Math.PI / 2;
    if (gesture === 'turnLeft') angle = -Math.PI / 2;
    if (gesture === 'forward+turnRight') angle = Math.PI / 4;
    if (gesture === 'forward+turnLeft') angle = -Math.PI / 4;
    ctx.rotate(angle);
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(s * 0.42, 0);
    ctx.lineTo(s * 0.16, 0);
    ctx.lineTo(s * 0.16, s * 0.45);
    ctx.lineTo(-s * 0.16, s * 0.45);
    ctx.lineTo(-s * 0.16, 0);
    ctx.lineTo(-s * 0.42, 0);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

export class StatusHUD {
  /** @param {THREE.Camera} camera */
  constructor(camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2 * (H / W)), material);
    this.mesh.name = 'StatusHUD';
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.position.set(0, -0.17, -0.55);
    this.mesh.rotation.x = 0.3; // göze doğru hafif eğim
    this.mesh.visible = false;
    camera.add(this.mesh);

    this._key = '';
    this._lastDraw = 0;
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this._key = '';
  }

  /**
   * @param {{gesture:string, left:boolean, right:boolean, speed:number, turn:number, fps:number, warning?:string, scaleLabel:string}} info
   * @param {number} nowMs
   */
  update(info, nowMs) {
    if (!this.mesh.visible) return;
    if (nowMs - this._lastDraw < 100) return;
    const key = [
      info.gesture, info.left, info.right, info.speed.toFixed(1), Math.round(info.turn),
      Math.round(info.fps / 5), info.warning || '', info.scaleLabel,
    ].join('|');
    if (key === this._key) return;
    this._key = key;
    this._lastDraw = nowMs;
    this._draw(info);
    this.texture.needsUpdate = true;
  }

  _draw(info) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(12,16,24,0.72)';
    roundRect(ctx, 4, 4, W - 8, H - 8, 26);
    ctx.fill();

    drawIcon(ctx, info.gesture, 92, 96, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 46px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(GESTURE_TEXT[info.gesture] || info.gesture, 176, 66);

    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillStyle = '#c9d3df';
    ctx.fillText(`${info.speed.toFixed(2)} m/s · ${Math.round(info.turn)}°/s · ${info.scaleLabel}`, 176, 106);

    // el durumu
    const dot = (x, label, on, color) => {
      ctx.fillStyle = on ? color : '#4a5361';
      ctx.beginPath();
      ctx.arc(x, 132, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? '#ffffff' : '#7d8794';
      ctx.font = '600 24px system-ui, sans-serif';
      ctx.fillText(label, x + 18, 141);
    };
    dot(186, 'Sol', info.left, '#7fb2ff');
    dot(276, 'Sağ', info.right, '#ffb27f');
    ctx.fillStyle = '#7d8794';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText(`${Math.round(info.fps)} FPS`, 380, 141);

    if (info.warning) {
      ctx.fillStyle = 'rgba(255,170,40,0.95)';
      roundRect(ctx, 14, H - 42, W - 28, 32, 10);
      ctx.fill();
      ctx.fillStyle = '#1b1300';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText(info.warning, 26, H - 19);
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}

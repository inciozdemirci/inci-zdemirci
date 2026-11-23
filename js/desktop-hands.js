/**
 * desktop-hands.js — Masaüstü webcam el takibi (MediaPipe Hand Landmarker)
 *
 * - MediaPipe yalnızca "Start Camera" ile ve izin onayından sonra yüklenir
 *   (Quest'te hiç indirilmez).
 * - Jest hesabı için worldLandmarks (metre, el merkezli 3B) kullanılır; bu sayede
 *   kameraya uzaklıktan bağımsız ve Quest'teki joint verisiyle aynı ölçektedir.
 * - Görüntü üzerine çizim için normalize image landmarks kullanılır.
 */

const MP_VERSION = '0.10.14';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** MediaPipe 21 landmark indeksleri → ortak nokta adları */
const LM = Object.freeze({
  wrist: 0, thumbTip: 4, indexMcp: 5, indexTip: 8, middleMcp: 9, middleTip: 12,
  ringMcp: 13, ringTip: 16, pinkyMcp: 17, pinkyTip: 20,
});
const TIP_INDEX = Object.freeze({ index: 8, middle: 12, ring: 16, pinky: 20 });

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const HAND_COLORS = { left: '#6aa8ff', right: '#ffb36a' };

function cameraErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamera izni reddedildi. Adres çubuğundaki kamera simgesinden izni açıp tekrar deneyin.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kullanılabilir bir kamera bulunamadı.';
    case 'NotReadableError':
      return 'Kamera başka bir uygulama tarafından kullanılıyor olabilir.';
    case 'AbortError':
      return 'Kamera başlatma iptal edildi.';
    default:
      return `Kamera başlatılamadı: ${err && err.message ? err.message : err}`;
  }
}

export class DesktopHands {
  /**
   * @param {{video:HTMLVideoElement, canvas:HTMLCanvasElement, onStatus?:(text:string)=>void}} p
   */
  constructor({ video, canvas, onStatus = () => {} }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStatus = onStatus;

    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.starting = false;
    this._cancelToken = 0;

    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.lastResult = null;
    this.lastIds = [];
    this.lastFrames = [];
    this.delegate = null;
  }

  async start() {
    if (this.running || this.starting) return;
    if (!window.isSecureContext) throw new Error('Kamera erişimi için HTTPS gerekli.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Bu tarayıcı kamera erişimini (getUserMedia) desteklemiyor.');
    }

    this.starting = true;
    const token = ++this._cancelToken;
    try {
      this.onStatus('Kamera izni isteniyor…');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        throw new Error(cameraErrorMessage(err));
      }
      if (token !== this._cancelToken) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();

      this.onStatus('El modeli yükleniyor…');
      await this._ensureLandmarker();
      if (token !== this._cancelToken) { this._releaseStream(); return; }

      this.lastVideoTime = -1;
      this.running = true;
      this.onStatus(`Kamera açık · MediaPipe (${this.delegate})`);
    } catch (err) {
      this._releaseStream();
      throw err;
    } finally {
      if (token === this._cancelToken) this.starting = false;
    }
  }

  async _ensureLandmarker() {
    if (this.landmarker) return;
    let vision;
    try {
      vision = await import('@mediapipe/tasks-vision');
    } catch (err) {
      throw new Error(`MediaPipe kütüphanesi yüklenemedi (ağ bağlantısını kontrol edin): ${err.message}`);
    }
    const { FilesetResolver, HandLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const taskOptions = {
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        ...taskOptions,
      });
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('MediaPipe GPU delegate başarısız, CPU deneniyor:', gpuErr);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        ...taskOptions,
      });
      this.delegate = 'CPU';
    }
  }

  stop() {
    this._cancelToken += 1;
    this.starting = false;
    this.running = false;
    this._releaseStream();
    this.lastResult = null;
    this.lastIds = [];
    this.lastFrames = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onStatus('Kamera kapalı');
  }

  _releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.pause();
    this.video.srcObject = null;
  }

  /**
   * Yeni bir video karesi varsa algılama yapar.
   * @param {number} nowMs performance.now()
   * @returns {Array<{id:string,tracked:boolean,points:object}>}
   */
  update(nowMs) {
    if (!this.running || !this.landmarker) return [];
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0) return this.lastFrames;
    if (video.currentTime === this.lastVideoTime) return this.lastFrames;
    this.lastVideoTime = video.currentTime;

    const timestamp = Math.max(nowMs, this.lastTimestamp + 1); // MediaPipe artan zaman damgası ister
    this.lastTimestamp = timestamp;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestamp);
    } catch (err) {
      console.warn('MediaPipe algılama hatası:', err);
      this.lastResult = null;
      this.lastFrames = [];
      return this.lastFrames;
    }
    this.lastResult = result;
    this.lastFrames = this._toHandFrames(result);
    return this.lastFrames;
  }

  _toHandFrames(result) {
    const frames = [];
    const ids = [];
    const landmarks = result.landmarks || [];
    const world = result.worldLandmarks || [];
    const handedness = result.handedness || result.handednesses || [];
    const used = new Set();

    for (let i = 0; i < landmarks.length; i++) {
      const label = handedness[i] && handedness[i][0] ? handedness[i][0].categoryName : '';
      // MediaPipe, girdinin aynalanmış (selfie) olduğunu varsayar. getUserMedia kareleri
      // aynalanmamış geldiği için etiketi ters çeviriyoruz.
      let id = label === 'Left' ? 'right' : label === 'Right' ? 'left' : `hand${i}`;
      if (used.has(id)) id = `${id}-${i}`;
      used.add(id);
      ids.push(id);

      const pts = world[i] && world[i].length === 21 ? world[i] : this._imageToMetricLike(landmarks[i]);
      const points = {};
      for (const [key, index] of Object.entries(LM)) points[key] = pts[index];
      frames.push({ id, tracked: true, points });
    }
    this.lastIds = ids;
    return frames;
  }

  /** worldLandmarks yoksa: piksel en-boy oranını düzelterek göreli mesafeler elde edilir. */
  _imageToMetricLike(lms) {
    const w = this.video.videoWidth || 1;
    const h = this.video.videoHeight || 1;
    return lms.map((p) => ({ x: p.x * w, y: p.y * h, z: (p.z || 0) * w }));
  }

  /** Video üzerine landmark ve aktif pinch çizer. */
  draw(perHand = {}) {
    const { canvas, ctx, video } = this;
    if (video.videoWidth && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const result = this.lastResult;
    if (!this.running || !result || !result.landmarks) return;

    const W = canvas.width;
    const H = canvas.height;
    result.landmarks.forEach((lm, i) => {
      const id = this.lastIds[i];
      const base = HAND_COLORS[id] || '#d0d0d0';
      const snap = perHand[id];

      ctx.lineWidth = 3;
      ctx.strokeStyle = base;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const finger = snap && (snap.activeFinger || snap.pendingFinger);
      if (finger) {
        const color = snap.activeFinger ? '#2fe08a' : '#ffe14d';
        const t = lm[LM.thumbTip];
        const f = lm[TIP_INDEX[finger]];
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(t.x * W, t.y * H);
        ctx.lineTo(f.x * W, f.y * H);
        ctx.stroke();
        for (const p of [t, f]) {
          ctx.beginPath();
          ctx.arc(p.x * W, p.y * H, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  dispose() {
    this.stop();
    if (this.landmarker) {
      try { this.landmarker.close(); } catch { /* yoksay */ }
      this.landmarker = null;
    }
  }
}

/**
 * xr-manager.js — WebXR immersive-vr oturum yaşam döngüsü
 *
 * - Destek kontrolü (HTTPS, navigator.xr, immersive-vr)
 * - optionalFeatures: ['hand-tracking', 'local-floor'] ile oturum isteği
 * - Referans alanı fallback'i: 'local-floor' → 'local'
 * - Oturum bitince olaylar ve temizlik
 *
 * Olaylar (EventTarget):
 *   'statuschange'  detail: { status }
 *   'sessionstart'  detail: { session, referenceSpaceType, handTrackingEnabled }
 *   'sessionend'
 */

const REFERENCE_SPACE_PREFERENCE = ['local-floor', 'local'];

export class XRManager extends EventTarget {
  /** @param {import('three').WebGLRenderer} renderer */
  constructor(renderer) {
    super();
    this.renderer = renderer;
    this.session = null;
    this.referenceSpaceType = null;
    this.handTrackingEnabled = null; // true / false / null (tarayıcı bildirmiyor)
    this.supported = false;
    this.unsupportedReason = '';
    this.status = 'idle'; // idle | unsupported | starting | active | ending | error
    this._requesting = false;

    this._onSessionEnd = this._onSessionEnd.bind(this);
    // Three.js kendi temizliğini (piksel oranı, boyut, animasyon döngüsü) yaptıktan
    // SONRA bizim 'sessionend' olayımızı yayınlamak için renderer.xr olayını dinliyoruz.
    this.renderer.xr.addEventListener('sessionend', () => this._finalizeEnd());
  }

  async checkSupport() {
    if (!window.isSecureContext) {
      return this._unsupported('WebXR için HTTPS gerekli (GitHub Pages veya localhost).');
    }
    if (!('xr' in navigator) || !navigator.xr) {
      return this._unsupported('Bu tarayıcı WebXR desteklemiyor.');
    }
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      if (!ok) return this._unsupported('Bu cihazda immersive-vr desteklenmiyor.');
      this.supported = true;
      this.unsupportedReason = '';
      this._setStatus('idle');
      return { supported: true };
    } catch (err) {
      return this._unsupported(`WebXR destek kontrolü başarısız: ${err.message}`);
    }
  }

  get isPresenting() {
    return this.session !== null;
  }

  async enter() {
    if (this.session || this._requesting) return;
    if (!navigator.xr) throw new Error('WebXR kullanılamıyor.');
    this._requesting = true;
    this._setStatus('starting');
    let session = null;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['hand-tracking', 'local-floor'],
      });

      const type = await this._pickReferenceSpace(session);
      this.referenceSpaceType = type;
      this.renderer.xr.setReferenceSpaceType(type);

      session.addEventListener('end', this._onSessionEnd);
      this.session = session;
      await this.renderer.xr.setSession(session);

      const features = session.enabledFeatures;
      this.handTrackingEnabled = Array.isArray(features) || (features && typeof features.includes === 'function')
        ? features.includes('hand-tracking')
        : null;

      this._setStatus('active');
      this.dispatchEvent(new CustomEvent('sessionstart', {
        detail: { session, referenceSpaceType: type, handTrackingEnabled: this.handTrackingEnabled },
      }));
    } catch (err) {
      this.session = null;
      if (session) {
        session.removeEventListener('end', this._onSessionEnd);
        try { await session.end(); } catch { /* zaten kapalı */ }
      }
      this._setStatus('error');
      throw err;
    } finally {
      this._requesting = false;
    }
  }

  async exit() {
    if (!this.session) return;
    this._setStatus('ending');
    try {
      await this.session.end();
    } catch {
      // Oturum zaten bitmişse sessizce geç
      this._finalizeEnd();
    }
  }

  async _pickReferenceSpace(session) {
    for (const type of REFERENCE_SPACE_PREFERENCE) {
      try {
        await session.requestReferenceSpace(type);
        return type;
      } catch {
        // sıradaki türü dene
      }
    }
    throw new Error('Desteklenen bir WebXR referans alanı bulunamadı.');
  }

  _onSessionEnd() {
    if (this.session) this.session.removeEventListener('end', this._onSessionEnd);
    // renderer.xr 'sessionend' olayı gelmezse (ör. setSession tamamlanmadan bitti) yine de kapat
    queueMicrotask(() => {
      if (this.session) this._finalizeEnd();
    });
  }

  _finalizeEnd() {
    if (!this.session && this.status !== 'ending' && this.status !== 'active') return;
    this.session = null;
    this.referenceSpaceType = null;
    this.handTrackingEnabled = null;
    this._setStatus(this.supported ? 'idle' : 'unsupported');
    this.dispatchEvent(new CustomEvent('sessionend'));
  }

  _unsupported(reason) {
    this.supported = false;
    this.unsupportedReason = reason;
    this._setStatus('unsupported');
    return { supported: false, reason };
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent('statuschange', { detail: { status } }));
  }
}

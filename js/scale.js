/**
 * scale.js — 1:70 ölçek sistemi (saf JavaScript, Three.js / DOM bağımlılığı yok)
 *
 * Projede birbirinden AYRI tutulan üç koordinat uzayı vardır:
 *
 *  1. MAKET uzayı   : Mimari modelin kendi birimleri. 1 birim = maket üzerinde 1 m.
 *                     1:70 bir makette 3 m'lik duvar 3/70 ≈ 0.0429 birimdir.
 *  2. BİNA uzayı    : Maketin temsil ettiği gerçek bina.  bina = maket × payda (70).
 *  3. GÖRÜNTÜ uzayı : Three.js sahnesi ve WebXR tracking uzayı.
 *                     1 birim = kullanıcının fiziksel dünyasında 1 m (Quest 3 bunu ölçer).
 *
 * İnsan perspektifi = görüntü uzayı ile bina uzayının 1:1 eşleşmesi demektir.
 * Bunu sağlamak için XR head pose'a DOKUNULMAZ; bunun yerine maketin kök grubu
 * (modelRoot) `payda` kadar büyütülür:
 *
 *      görüntü = maket × payda      (modelRoot.scale = payda)
 *
 * Böylece kullanıcının gerçek 1.60 m göz yüksekliği, makette 1.60 / 70 ≈ 0.02286
 * birime karşılık gelir; gerçek dünyada 1 m baş hareketi makette 1/70 m'dir.
 * Matematiksel olarak "kullanıcıyı 1/70 küçültmek" ile eşdeğerdir, fakat tracking
 * verisi, el eklemleri, jest eşikleri ve kamera near-plane metre cinsinden kalır.
 */

export const DEFAULT_SCALE_DENOMINATOR = 70;

/** Demo sahnesi 1:70 maket olarak modellenmiştir (bkz. environment.js). */
export const AUTHORING_DENOMINATOR = 70;

export const REFERENCE_HUMAN_HEIGHT = 1.70; // m (bina)
export const REFERENCE_EYE_HEIGHT = 1.60;   // m (bina)

export const SUPPORTED_DENOMINATORS = Object.freeze([50, 70, 100, 200]);

/** 1:payda ölçek oranı (ör. 1/70). */
export function scaleRatio(denominator = DEFAULT_SCALE_DENOMINATOR) {
  return 1 / denominator;
}

/** Gerçek göz yüksekliğinin maket birimindeki karşılığı. 1:70 → 1.60/70 ≈ 0.022857 */
export function scaledEyeHeight(denominator = DEFAULT_SCALE_DENOMINATOR, eyeHeight = REFERENCE_EYE_HEIGHT) {
  return eyeHeight / denominator;
}

/**
 * "70", "1:70", "1/70" biçimlerini kabul eder. Geçersizse null döner.
 * @param {string|number|null|undefined} value
 */
export function parseScaleDenominator(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  const match = str.match(/^(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const den = Number(match[1]);
  return Number.isFinite(den) && den > 0 ? den : null;
}

export class ScaleSystem {
  /**
   * @param {{scale:{set:(x:number,y:number,z:number)=>void}}|null} modelRoot  maket kök grubu
   * @param {number} denominator  ölçek paydası (1:payda)
   */
  constructor(modelRoot = null, denominator = DEFAULT_SCALE_DENOMINATOR) {
    this.modelRoot = modelRoot;
    this.denominator = DEFAULT_SCALE_DENOMINATOR;
    this.setDenominator(denominator);
  }

  /** 1/payda */
  get ratio() {
    return 1 / this.denominator;
  }

  /** modelRoot'a uygulanan ölçek (maket → görüntü). İnsan perspektifinde = payda. */
  get displayScale() {
    return this.denominator;
  }

  get label() {
    return `1:${this.denominator}`;
  }

  /**
   * Ölçeği değiştirir ve modelRoot'u günceller.
   * @returns {number} yeni/eski görüntü ölçeği oranı (rig konumunu yeniden ölçeklemek için)
   */
  setDenominator(denominator) {
    const den = Number(denominator);
    if (!Number.isFinite(den) || den <= 0) {
      throw new RangeError(`Geçersiz ölçek paydası: ${denominator}`);
    }
    const previous = this.denominator;
    this.denominator = den;
    if (this.modelRoot) this.modelRoot.scale.set(den, den, den);
    return den / previous;
  }

  modelToBuilding(v) { return v * this.denominator; }
  buildingToModel(v) { return v / this.denominator; }
  modelToDisplay(v) { return v * this.displayScale; }
  displayToModel(v) { return v / this.displayScale; }
  /** İnsan perspektifinde görüntü metresi = bina metresi. */
  displayToBuilding(v) { return v; }
  buildingToDisplay(v) { return v; }

  /** Debug/README için özet. eyeHeightDisplay: kullanıcının (gerçek) göz yüksekliği, m. */
  describe(eyeHeightDisplay = REFERENCE_EYE_HEIGHT) {
    return {
      label: this.label,
      ratio: this.ratio,
      eyeHeightBuilding: this.displayToBuilding(eyeHeightDisplay),
      eyeHeightModel: this.displayToModel(eyeHeightDisplay),
    };
  }
}

# WebXR Quest 3: El Takipli VR Gezinti (1:70 Ölçek)

Meta Quest 3 Browser'da **Enter VR** ile başlayan ve kontrolcü kullanmadan, yalnızca el hareketleriyle gezilen bir WebXR deneyimi. 1:70 ölçekli bir mimari maketin içinde, insan gözü perspektifinden dolaşılır. Masaüstünde aynı jestler webcam ve MediaPipe ile çalışır.

Statik dosyalardan oluşur: backend, Node sunucusu veya build adımı yoktur. GitHub Pages'te doğrudan çalışır.

> **Doğrulama durumu.** Jest motoru ve ölçek matematiği otomatik testlerle doğrulandı (`npm test`, 23 test). WebXR, Quest 3 hand tracking ve MediaPipe kısımları WebXR ve MediaPipe spesifikasyonlarına ve Three.js r170 API'sine göre yazıldı, **ancak gerçek bir Quest 3 cihazında veya tarayıcıda çalıştırılarak test edilmedi.** Aşağıdaki test listesini cihazda uygulayın. Pinch eşiklerinin ince ayarı gerekebilir (bkz. [Jest eşikleri](#jest-eşikleri-ve-ince-ayar)).

---

## Dosya yapısı

```text
webxr-quest3/
├── index.html            Arayüz + import map (sabit sürümlü CDN)
├── css/style.css
├── js/
│   ├── main.js           Kurulum, UI, tek render döngüsü, mod geçişleri
│   ├── xr-manager.js     immersive-vr oturumu, referans alanı fallback'i, yaşam döngüsü
│   ├── hand-tracking.js  Quest 3 native WebXR joint verisi → ortak format + el görselleştirme
│   ├── desktop-hands.js  Webcam + MediaPipe Hand Landmarker → ortak format
│   ├── gestures.js       ORTAK jest motoru (saf JS, iki takip sistemi de bunu kullanır)
│   ├── locomotion.js     Frame-rate bağımsız yürüme/dönüş, baş pivotlu rotasyon
│   ├── scale.js          1:70 ölçek sistemi (saf JS)
│   ├── environment.js    Demo 1:70 bina + .glb/.gltf yükleyici
│   └── hud.js            VR içi küçük durum göstergesi
├── assets/models/        Kendi .glb/.gltf modelleriniz
├── tests/                Node yerleşik test koşucusuyla birim testleri
├── package.json          Yalnızca `npm test` için (bağımlılık yok)
├── .nojekyll
└── README.md
```

İstenen yapıya ek olarak `scale.js`, `environment.js`, `hud.js` ve `tests/` eklendi. Ölçek matematiği ve jest motoru böylece Three.js olmadan test edilebiliyor.

**Bağımlılıklar** (`index.html` içindeki import map):

| Kütüphane | Sürüm | Kaynak |
|---|---|---|
| three (+ addons) | 0.170.0 | cdn.jsdelivr.net |
| @mediapipe/tasks-vision | 0.10.14 | cdn.jsdelivr.net (yalnızca **Start Camera** ile yüklenir) |
| Hand Landmarker modeli | float16/1 | storage.googleapis.com |
| Draco decoder | 1.5.7 | gstatic.com (yalnızca Draco sıkıştırmalı .glb için) |

Tüm yerel modüller `./js/...` göreli yoluyla yüklenir. Bu yüzden `kullanici.github.io/repo-adi/` gibi alt dizinlerde de çalışır.

---

## GitHub Pages'te yayınlama

1. GitHub'da yeni bir repo oluşturun (ör. `webxr-quest3`).
2. Bu klasörün **içeriğini** repo köküne yükleyin (`index.html` kökte olmalı):
   ```bash
   cd webxr-quest3
   git init && git add . && git commit -m "WebXR hand locomotion"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/webxr-quest3.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, klasör = `/ (root)` → **Save**.
4. 1–2 dakika sonra adres: `https://KULLANICI.github.io/webxr-quest3/`

GitHub Pages HTTPS sunar. WebXR ve kamera erişimi yalnızca güvenli bağlamda (HTTPS veya `localhost`) çalışır.

### Yerelde çalıştırma

```bash
cd webxr-quest3
python3 -m http.server 8080      # veya: npx serve
# → http://localhost:8080
```

`file://` ile açmak çalışmaz (ES modülleri ve import map sunucu ister). Quest'ten yerel sunucuya bağlanmak için HTTPS gerekir. En kolay yol GitHub Pages'e göndermektir. Alternatif olarak USB ile `adb reverse tcp:8080 tcp:8080` yapıp Quest'te `http://localhost:8080` açabilirsiniz.

---

## Quest 3'te test

1. **El takibini açın:** Quest Ayarları → *Movement tracking* (Hareket takibi) → *Hand and body tracking* (El ve vücut takibi) açık. Menü adları sistem sürümüne göre değişebilir.
2. Kontrolcüleri bir kenara bırakın. Quest birkaç saniye içinde ellere geçer.
3. Quest Browser'da GitHub Pages adresini açın.
4. **Enter VR**'a basın (kontrolcüyle ya da elle pinch yaparak).
5. VR'da görüşünüzün altında küçük bir durum paneli belirir. Eller algılanmazsa panel turuncu bir uyarı gösterir. Ellerinizin eklemleri renkli küreler olarak görünür (sol mavi, sağ turuncu). Aktif pinch'te başparmak ve ilgili parmak ucu yeşile döner, aktivasyon beklenirken sarı olur.
6. Jestler:

   | Jest | Hareket |
   |---|---|
   | Başparmak + işaret parmağı | İleri yürü (başın baktığı yatay yönde) |
   | Başparmak + serçe parmak | Sağa dön |
   | Başparmak + yüzük parmağı | Sola dön |
   | Pinch yok | Dur |

7. Çıkış: Quest'in Meta/menü tuşu veya sistem menüsü. Uygulama masaüstü görünüme döner.

**Quest'e özgü notlar:**
- Avuç içi size dönükken başparmak + işaret pinch'i Quest **sistem menüsünü** açar. Yürürken avucunuzu aşağı veya yana çevirin.
- Başparmak + işaret pinch'i Quest Browser'da ayrıca WebXR `select` olayı üretir. Uygulama bu olayı kullanmaz, bu yüzden bir yan etkisi olmaz.
- Yüzük ve serçe pinch'leri, işaret pinch'ine göre daha zayıf izlenir. Ellerinizi göğüs hizasında, kafa kameralarının görüş alanında tutun.

### Cihazda doğrulanacak kontrol listesi

| # | Kontrol | Nasıl |
|---|---|---|
| 1 | Masaüstünde açılış | Sayfa açılır, sahne görünür, konsolda kırmızı hata yok |
| 2 | Webcam takibi | Start Camera → izin → videoda el iskeleti |
| 3 | Masaüstü jestleri | Debug panelinde "Aktif pinch" değişir, sahne hareket eder |
| 4–5 | Quest'te açılış + Enter VR | Buton etkin, VR'a geçiş |
| 6 | Native hand tracking | Debug/HUD: "WebXR · 2 el", el küreleri görünür |
| 7–9 | İleri / sağ / sol | HUD ikonu ve hareket |
| 10 | Bırakınca dur | Pinch bırakılınca hareket aynı karede durur |
| 11 | Baş yönü | Kafa çevrilince görüş doğal döner. Yürüme, bakılan yatay yöne gider |
| 12 | 1:70 | 1.70 m insan figürü göz hizanızda, 2.10 m kapılar doğal görünür |
| 13 | Oturum kapanışı | VR'dan çıkınca masaüstü görünüm, hata yok |
| 14 | Konsol | Quest Browser'ı USB ile `chrome://inspect` üzerinden inceleyin |

---

## 1:70 ölçek yöntemi

### Problem

1:70 bir makette 3 m'lik duvar 3/70 ≈ 4.3 cm'dir. İnsan gözünden bakmak için göz, maket zemininden 1.60/70 ≈ **0.02286 maket birimi** yukarıda olmalıdır.

Akla gelen ilk çözüm, Quest'ten gelen baş pozunu 1/70 ile çarpmak ya da kamera yüksekliğini 0.02286'ya sabitlemektir. Bu yöntem tracking'i bozar:

- Kamera yüksekliği sabitlenirse kullanıcı eğildiğinde veya ayağa kalktığında görüş değişmez.
- Head pose 1/70 ile çarpılırsa WebXR'ın göz başına projeksiyon ve görüş matrisleri ile göz arası mesafe (IPD) tutarsızlaşır. Sonuç: yanlış stereo derinlik, mide bulantısı.
- El eklemleri, jest eşikleri ve kamera near-plane metre cinsinden olmaktan çıkar.

### Çözüm: üç ayrı uzay, tek dönüşüm

| Uzay | Birim | Örnek: 3 m duvar |
|---|---|---|
| **Maket** (model dosyası) | 1 birim = makette 1 m | 0.04286 |
| **Bina** (temsil edilen yapı) | 1 m gerçek bina | 3.0 |
| **Görüntü** (Three.js sahnesi = WebXR tracking uzayı) | 1 m kullanıcının fiziksel dünyası | 3.0 |

Tek dönüşüm, maket kök grubuna uygulanır:

```text
görüntü = maket × S        S = payda = 70        (modelRoot.scale = 70)
```

Sahne grafiği:

```text
scene
 ├─ modelRoot   scale = 70        ← tüm mimari içerik maket biriminde
 └─ rig         konum + Y dönüşü  ← locomotion yalnızca bunu değiştirir
     └─ tracking   (yalnızca 'local' fallback'inde Y ofseti)
         ├─ camera   ← Quest 3 head pose, HİÇ değiştirilmez
         └─ el eklemleri (XRFrame.getJointPose, referans uzayında)
```

### Neden tutarlı?

WebXR'ın verdiği her şey (baş konumu, rotasyonu, IPD, el eklemleri) metre cinsindendir ve olduğu gibi kullanılır. Maket 70 kat büyütüldüğü için:

- Gerçek göz yüksekliğiniz *h* (ör. 1.60 m), maket uzayında *h*/70 = **0.02286** birime karşılık gelir: `scale.js → scaledEyeHeight(70)`.
- Fiziksel olarak 1 m yürümeniz makette 1/70 m = 1.43 cm'dir. Bu, 1:70 bir insanın adımıyla birebir aynıdır.
- 63 mm'lik IPD'niz maket uzayında 0.9 mm'ye karşılık gelir. Stereo derinlik algısı da 1:70 boyutundaki bir insanınkiyle aynıdır.
- Bu dönüşüm matematiksel olarak "kullanıcıyı 1/70 küçültmek" ile eşdeğerdir. Tek fark, ölçeğin tracking verisine değil dünyaya uygulanmasıdır. Bu sayede Quest'in gerçek baş hareketleri korunur ve göz yüksekliği yapay bir değere zorlanmaz.

Debug panelindeki **Göz yüksekliği** satırı bunu canlı gösterir, ör. `1.62 m gerçek ≈ 0.02314 maket birimi`.

**Masaüstü modunda** tracking olmadığı için kamera, görüntü uzayında 1.60 m'ye (= 0.02286 maket birimi) konur.

**`local` fallback'i:** Cihaz `local-floor` sağlamazsa `local` kullanılır. Bu referans alanında zemin bilgisi yoktur, başlangıç baş konumu orijindir. Bu yüzden `tracking` grubu 1.60 m yukarı kaydırılır. Baş hareketleri yine olduğu gibi korunur. Quest 3 `local-floor` desteklediği için bu yol normalde kullanılmaz.

### Hareket hızları

Hızlar **bina metresi** ile tanımlıdır: yürüme 1.4 m/s, dönüş 45 °/s. İnsan perspektifinde görüntü metresi = bina metresi olduğundan, makette karşılığı 1.4/70 = 0.02 birim/s'dir. Debug panelinde ikisi de gösterilir.

### Ölçek seçimi

Arayüzdeki **Model ölçeği** (1:50 / 1:70 / 1:100 / 1:200) modelin hangi ölçekte yorumlanacağını belirler ve `S`'yi değiştirir. Örnek: demo bina 1:70 olarak modellendiği için 1:100 seçildiğinde 100/70 kat büyük görünür. Bu doğru bir sonuçtur: aynı maket 1:100 olarak okunursa temsil ettiği bina gerçekten daha büyüktür. Kendi modelinizin ölçeğini burada veya `?scale=` parametresiyle belirtin.

---

## Jest algılama

Her iki takip sistemi aynı noktaları üretir ve `gestures.js` içindeki aynı `GestureEngine`'e verir:

| Ortak ad | Quest 3 WebXR eklemi | MediaPipe indeksi |
|---|---|---|
| wrist | `wrist` | 0 |
| thumbTip | `thumb-tip` | 4 |
| indexTip | `index-finger-tip` | 8 |
| middleTip | `middle-finger-tip` | 12 |
| ringTip | `ring-finger-tip` | 16 |
| pinkyTip | `pinky-finger-tip` | 20 |
| middleMcp | `middle-finger-phalanx-proximal` | 9 |

Quest tarafında `XRFrame.getJointPose()` (metre, referans uzayı), masaüstünde MediaPipe `worldLandmarks` (metre, el merkezli) kullanılır. İkisi de gerçek ölçekli 3B veridir.

### Matematik

```text
el boyutu  E  = |wrist − middleMcp|              (~8–9 cm)
mesafe     dᶠ = |thumbTip − fingerTipᶠ| / E      (boyutsuz → el büyüklüğüne göre normalize)

basma   : dᶠ < 0.30  → aday
bırakma : dᶠ > 0.45  → aktif pinch biter         (0.30–0.45 hysteresis bandı)
```

### Öncelik kuralları

1. **Takip kaybı** (el görünmüyor veya eklem verisi eksik) → o elin durumu sıfırlanır, hareket durur.
2. **Kilitli pinch önceliklidir:** aktif pinch, mesafesi bırakma eşiğinin altında kaldıkça korunur.
3. **Yeni pinch:** basma eşiğinin altındaki en yakın parmak kazanır. Ancak ikinci adaydan en az 0.06 daha yakın olmalıdır. Aksi halde jest belirsiz sayılır ve hareket üretilmez (yumruk, gevşek el).
4. **Aktivasyon gecikmesi** 60 ms: kısa titremeler hareket başlatmaz. Bırakma ise anında gerçekleşir.
5. **Orta parmak engelleyicidir:** başparmak + orta pinch'i bir harekete bağlı değildir. Yüzük pinch'i sırasında orta parmak daha yakınsa sola dönüş tetiklenmez.
6. **Bir elde tek jest.** İki el birleştirilirken herhangi bir elde ileri → ileri. Sağ ve sol dönüş aynı anda istenirse dönüş iptal edilir. Bir elle ileri, diğeriyle dönüş birlikte kullanılabilir.

### Jest eşikleri ve ince ayar

Varsayılanlar `gestures.js → DEFAULT_GESTURE_CONFIG` içindedir. Debug panelindeki **Pinch mesafesi** satırı her parmağın normalize mesafesini canlı gösterir (`İşr 0.18 Ort 0.92 …`). Cihazda kendi elinizle:

- Pinch yaparken değer 0.30'un altına inmiyorsa `pressThreshold` değerini yükseltin.
- Açık elde yanlış tetikleme varsa `pressThreshold` değerini düşürün veya `ambiguityMargin` değerini artırın.
- Hareket kesik kesik oluyorsa `releaseThreshold` değerini yükseltin.

---

## Locomotion

- **Yön:** `camera.getWorldDirection()` XZ düzlemine izdüşürülür. Dikey baş hareketi yürüyüşü etkilemez. Neredeyse dik yukarı veya aşağı bakılırsa son geçerli yatay yön kullanılır.
- **Frame-rate bağımsız:** tüm hareket `deltaTime` ile ölçeklenir. `dt` en fazla 0.1 s ile sınırlanır, böylece sekme değişiminden sonra sıçrama olmaz.
- **Yumuşaklık:** kalkışta üstel hızlanma (~0.1 s), bırakınca **anında duruş**.
- **Dönüş:** dünya Y ekseni etrafında, **baş konumu pivot** alınarak. Oda ölçeğinde rig merkezinden uzakta dursanız bile yerinizde dönersiniz.
- **Kamera güncelleme sırası:** `renderer.xr.cameraAutoUpdate = false`. Her karede şu sıra izlenir: baş pozu → el eklemleri → jest → rig hareketi → kamera yeniden. Böylece kameraya bağlı HUD ve el küreleri bir kare gecikmeyle titremez.

---

## Masaüstü modu

1. **Start Camera** → uygulama içi izin açıklaması → **İzin ver ve başlat** → tarayıcının kamera izni.
2. Sağ altta aynalı video ve el iskeleti görünür. Aktif pinch yeşil, aktivasyon bekleyen pinch sarı çizilir.
3. Kamera reddedilirse, bulunamazsa veya meşgulse anlaşılır bir hata mesajı gösterilir.
4. Test kısayolları (aynı locomotion'a gider): `W`/`↑` ileri, `A`/`←` sol, `D`/`→` sağ, `R` sıfırla, fareyle sürükleyerek bakış (baş dönüşünü simüle eder).

VR oturumu başladığında webcam ve MediaPipe otomatik durdurulur, böylece iki takip sistemi çakışmaz. VR'dan çıkınca kamerayı yeniden başlatmak için **Start Camera**'ya basın.

---

## Kendi modelinizi yükleme

`.glb` veya `.gltf` dosyanızı `assets/models/` klasörüne koyun ve URL parametreleriyle açın:

```text
https://KULLANICI.github.io/webxr-quest3/?model=assets/models/bina.glb&units=real&scale=70
```

| Parametre | Değerler | Açıklama |
|---|---|---|
| `model` | göreli/mutlak yol | Yüklenecek dosya. Göreli yol sayfaya göre çözülür (alt dizin uyumlu) |
| `units` | `maket` (varsayılan) | Dosya, 1:70 maket metresinde (3 m duvar = 0.0429) |
| | `real` | Dosya gerçek boyutlu bina metresinde (Revit/Rhino'dan 1:1 export) → otomatik ×1/payda |
| | `mm-maket` | Maket milimetresinde |
| | sayı | Doğrudan çarpan |
| `scale` | `70`, `1:70`, `1/100` | Model ölçeği |
| `spawn` | `x,z,yaw` | Başlangıç noktası (bina metresi, yaw derece) |
| `demo` | `1` | Model yüklenince demo binayı da göster |

Model, `modelRoot` altına (maket uzayına) eklenir. Böylece ölçek sistemi otomatik olarak uygulanır. Draco sıkıştırmalı dosyalar desteklenir. Quest performansı için modeli ~100–300 bin üçgen ve birkaç yüz draw call altında tutun, dokuları 2K ile sınırlayın.

---

## Örnek sahne

16 × 12 m bina, 3 m duvarlar ve 0.9 / 1.4 m genişliğinde, 2.1 m yüksekliğinde kapılar (üçü açık kanatlı). Batı duvarı boyunca 0.45–2.40 m arasında altı yükseklik referans kutusu ve etiketleri var. Ayrıca 1.70 m insan figürü, 5 m ölçek çubuğu, 1 m / 5 m grid, turuncu rota okları ve K/G/D/B pusula direkleri bulunur. Tüm mimari geometri vertex color ile **tek bir draw call**'da birleştirilmiştir. Toplam ~20 draw call (çoğu etiket sprite'ı).

---

## Testler

```bash
npm test
# veya
node --test tests/gestures.test.js tests/scale.test.js
```

Node 18+ gerekir, bağımlılık yoktur. Kapsam: normalizasyonun el büyüklüğünden bağımsızlığı, parmak → hareket eşlemesi, hysteresis, belirsiz çoklu pinch, kilitli pinch önceliği, orta parmak engeli, aktivasyon gecikmesi, takip kaybı, iki el birleştirme ve zıt dönüş iptali, `{x,y,z}` biçimi, 1:70 dönüşümleri.

WebXR ve MediaPipe katmanları için otomatik test yoktur; bunlar cihazda yukarıdaki kontrol listesiyle doğrulanmalıdır.

---

## Sorun giderme

| Belirti | Olası neden / çözüm |
|---|---|
| "VR desteklenmiyor" | HTTPS değil, WebXR'sız tarayıcı veya masaüstünde VR başlığı yok |
| VR'da HUD: "Kontrolcüleri bırakın" | Quest kontrolcü modunda. Kontrolcüleri bırakın |
| VR'da HUD: "Eller görünmüyor" | El takibi ayarlardan kapalı veya eller kamera görüşünde değil |
| Pinch algılanmıyor | Debug'daki pinch mesafesine bakın, eşikleri ayarlayın. Işığı artırın |
| Kamera hatası | Tarayıcı izni (adres çubuğu), başka uygulama kamerayı kullanıyor olabilir |
| MediaPipe yüklenmiyor | jsdelivr ve storage.googleapis.com erişimini (kurumsal ağ, reklam engelleyici) kontrol edin |
| Model görünmüyor | `units` yanlış olabilir (ör. 1:1 export için `units=real`). Konsoldaki yükleme hatasına bakın |

## Bilinen sınırlamalar

- Çarpışma algılama yoktur. Duvarların içinden geçilebilir.
- Zemin yüksekliği sabittir, merdiven veya rampa takibi yoktur.
- Pinch eşikleri ortalama bir ele göre seçildi ve cihazda doğrulanmadı.
- MediaPipe el sınıflandırması (sol/sağ) ara sıra karışabilir. Jestler her elde bağımsız işlendiği için bu durum hareketi etkilemez, yalnızca debug etiketini etkiler.

# BOUN Toolbox

Boğaziçi Üniversitesi ders programlayıcı, GPA ve müfredat araçları. React + TypeScript + Vite.

## Çalıştırma

Node.js 20.19+ veya 22.13+ gerektirir.

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

`dist/` statik sunucuya yüklenebilir. Göreli Vite tabanı ve hash yönlendirme sayesinde GitHub Pages alt dizinlerinde de çalışır (`/#/planner`, `/#/gpa`, `/#/curriculum`). Eski `/planner` gibi doğrudan yollar yerine hash bağlantıları kullanılır.

## Resmî ders verisini güncelleme

```sh
npm run update:courses
# İstenirse BUIS'te sunulan belirli dönem:
npm run update:courses -- --semester 2026/2027-1
npm test && npm run lint && npm run build
```

Komut varsayılan dönemi BUIS'in dönem listesinden okur. Üniversitenin herkese açık `/scripts/schdepsel.asp` bölüm listesini ve `/scripts/sch.asp` ders tablolarını toplar. Kullanıcı adı, şifre, reCAPTCHA çözümü veya üçüncü taraf proxy gerekmez. Tarayıcı BUIS'e doğrudan istek atmaz; kontrol edilmiş JSON dosyası uygulama derlemesine dahil edilir.

- `src/data/allCourses.json`: Dersler ve ayrı LAB/P.S. kayıtları.
- `src/data/courseMetadata.json`: Dönem, çekim zamanı, kaynak, bölüm kapsamı, kayıt sayıları, HSS bağlantısı.
- `scripts/update-courses.mjs`: Yeniden çalıştırılabilir veri çekici. Bölümleri sırayla okur, istekler arasında bekler; geçici hatalarda en fazla üç kez dener.

Tüm bölüm sayfaları doğrulanmadan dosyalar değiştirilmez. Yanlış dönem, değişen tablo yapısı, çok küçük katalog veya aynı dönem için %20'den fazla kayıt kaybı güncellemeyi durdurur. Hata durumunda mevcut veri korunur. Yapısal olarak geçerli sıfır dersli bölümler metadata'da sıfır olarak kaydedilir. Kaynağın kendisindeki eksiklikler nedeniyle kapsamın üniversitenin yayımladığı tablolarla sınırlı olduğu unutulmamalıdır.

Gün/saatler eşleşmiyorsa saat uydurulmaz; ham değer ve uyarı saklanır. Yalnız derslik sayısı uyuşmuyorsa geçerli saatler korunur, derslik boş gösterilir. BUIS'in A–E saat kodları 10–14. slotlara karşılık gelir. Bütünlük testleri ders, gün, saat ve derslik dizilerinin uyumunu denetler.

Veri değişikliğinin yayına yansıması için yeniden derleme ve dağıtım gerekir. Bu depo kendi başına canlı veri çekmez veya zamanlanmış güncelleme yapmaz. Kaynak erişimini kaybederse eski veriyi yeniymiş gibi etiketlemez.

## Programlayıcı davranışı

- Kredi/AKTS yalnız ana derslerden bir kez hesaplanır; yeni şube seçimi aynı dersin eski şubesini değiştirir.
- Tek LAB/P.S. varsayılan eklenir. Birden fazla kayıt varsa kullanıcı resmî bölüm bilgisine göre gereken oturumları seçer; kaynak bunların alternatif/zorunlu oluşunu her zaman açıkça belirtmediğinden tümü otomatik eklenmez.
- Çakışma hesabı varsayılan veya seçilmiş oturumları kapsar. Henüz seçilmemiş LAB/P.S. seçenekleri kendi çakışma uyarılarını gösterir.
- Haftanın yedi günü desteklenir; seçilen ders gerektiğinde hafta sonu sütunları açılır. 09:00–22:00 arası tüm slotlar görünür.
- Çakışan dersler aynı hücrede üst üste örtülmeden listelenir. Takvimdeki kaldır düğmesi bütün dersi veya bütün ilgili oturumu kaldırır.
- Saat açıklanmamış dersler seçilebilir ve krediye katılır.
- Program, dönem anahtarıyla tarayıcıda saklanır. Sayfa yenileme seçimleri silmez.
- PNG/PDF dışa aktarma tüm takvimi kapsar. Dışa aktarma kütüphaneleri yalnız gerektiğinde yüklenir.

GPA ve müfredat verisi (`public/data.json`) dönemlik açılan derslerden farklıdır; bu çalışmada resmî müfredat doğrulaması yapılmamıştır.

## Referans proje incelemesi

12 Eylül 2026 kontrolü:

- [kilicbaran/boun-course-planner ana dalı](https://github.com/kilicbaran/boun-course-planner/blob/main/public/data/semesters.json): son dönem **2025/2026-1**. Bu dönemin veri commit'i `8ec9b6e`, 4 Eylül 2025.
- [Yayındaki dönem listesi](https://kilicbaran.github.io/boun-course-planner/data/semesters.json): son dönem **2025/2026-2**. `gh-pages` dalındaki son deploy commit'i `709ef11`, 8 Şubat 2026. Bahar dosyası 3.528 kayıt içeriyor.
- [SemesterSelect.svelte](https://github.com/kilicbaran/boun-course-planner/blob/main/src/lib/SemesterSelect.svelte): site kendi statik JSON dosyalarını `fetch` ile okuyor. İncelenen dallarda ve dosya geçmişinde scraper yayımlanmamış; yazarın veri toplama yöntemini kesin söylemek mümkün değil.
- Toolbox'ın önceki `allCourses.json` dosyası 3.362 kayıttı ve referansın bahar dosyasıyla birebir aynı değildi. Önceki dosyada çekim zamanı/dönem metadata'sı bulunmuyordu; syllabus bağlantısında 2025/2026-2 sabitlenmişti.
- [BUIS](https://registration.bogazici.edu.tr/BUIS/General/schedule.aspx?p=semester): varsayılan dönem **2026/2027-1**. Referans projenin iki dalı da bu döneme göre güncel değil.

Güncel ders verisi referans projeden kopyalanmadı; üniversitenin yayımladığı tablolardan yeniden alındı.

## Kayıt Asistanı ve BUIS yardımcısı

Planner'daki **🎓 Kayıt Asistanı**, seçili ana dersleri `ABBR KOD.ŞUBE`
biçiminde listeler (`CMPE 150.01`). **Planı kopyala** ve **JSON indir** dönem
bilgisini de taşır; **Listeyi kopyala** düz metin verir. LAB/P.S. seçimleri
programlama bağlamıdır; bunların BUIS'teki kayıt/atama kuralları henüz
doğrulanmadı. Yardımcı bu oturumları ayrıca kaydetmez.

`public/buis-kayit-yardimcisi.user.js` sürüm 1.4.0, kullanıcının açık BUIS
sekmesinde çalışır. Tampermonkey/Violentmonkey ile kurulabilir; 1.3.0'dan sonra
`@updateURL` ile canlı siteden güncellenir, daha eski kurulumlar bir kez elle
güncellenmelidir. **Quick Add ve consent formları kapalı olduğundan canlı uyumluluk henüz doğrulanmadı.**
Eklenti kurmadan kullanmak için Kayıt Asistanı bir **yer imi** (bookmarklet) verir:
yer imleri çubuğuna sürüklenir, BUIS ekranında basılınca aynı script'i canlı siteden
yükler. Course List Preparation aynı kökenli `#ifCPL` çerçevesinde olduğundan script
o çerçeveye eklenir; BUIS `script-src` CSP göndermediği için yükleme engellenmez.
Çerçeve yenilendikçe script kendiliğinden yeniden eklenir; başka sayfaya geçilirse yer imine yeniden basılmalıdır.
Kayıt Asistanı'nda bölüm/düzey seçilebilir ve ders başına consent mesajı yazılabilir;
ikisi de **Planı kopyala** JSON'una eklenir.

**Formu tanı → Quick Add düğmesini seç → Kontrol kutusunu işaretle → Doldur ve
gönder** ile bütün ders alanları yazılıp düğmeye bir kez basılır. **Saatli gönderim**,
önceden açılmış ve tanınmış formda Türkiye saatine göre çalışır. Kapalı ekrandan
form açmaz; yenileme, gizlenen sekme, değişen form veya saat kayması zamanlamayı
iptal eder. [Deneme sayfası](https://boun-toolbox.vercel.app/buis-helper-demo.html)
gerçek kayıt yapmadan aynı yardımcıyı denemeyi sağlar.

[BUIS ve İTÜ incelemesi, kurulum ve doğrulama sınırları](docs/buis-registration.md).

- **Formu doldur**, bilinen ad desenleriyle (`abbr1`, `code1`, `section1`) tek
  formdaki ders alanlarını arar ve tek tıkla bütün dersleri yazar. Kendiliğinden
  tablo düzeninden tahmin yapmaz. Bulamazsa **Alanları tanıt** ile ilk satırın
  üç alanı seçilir; diğer satırlar alan numarasından (`…1` → `…2`), numara yoksa
  aynı tablodaki sonraki satırlardan bulunur.
- Plan formdaki satırlardan uzunsa sığan dersler yazılır, kalanlar adıyla
  bildirilir. **Tur tur ekleme** (varsayılan açık): kullanıcı Quick Add'e bir kez
  basınca (kendisi veya **Doldur ve gönder** ile) iş `sessionStorage`'a yazılır;
  yenilenen sayfada listede görünen şubeler sayılır ve kalanlar aynı düğmeyle
  gönderilir. Her ders otomatik olarak en fazla bir kez gönderilir; hata metni,
  ilerleme olmaması, değişen plan/düğme, 3 dakikayı aşan bekleme veya 12 tur
  sınırı işi durdurur. Yer imi, `#ifCPL` çerçevesi yenilendikçe script'i yeniden
  ekler. Quick Add sonrası sayfada listede görünen şubeler (açılır liste
  metni hariç) bir sonraki **Formu doldur**'da atlanır. Sayfada "couldn't be
  added" gibi bir hata yazıyorsa hiçbir ders atlanmaz.
- Geçersiz satır, yinelenen ders veya mevcut farklı değer varsa tüm doldurma
  durur; mevcut dersler ezilmez.
- Doldurma sırasında değişim olayları üretilmez; böylece alanlara değer yazmak
  kendi başına ASP.NET AutoPostBack tetiklemez.
- Kullanıcı tanınan **ders ekleme düğmesini** listeden seçer, ardından **Formu
  gönder** o düğmeye bir kez basar. İlk gönderme düğmesine basma veya ham
  `form.submit()` yedeği yoktur. Plan/alan/düğme/hedef değişirse yeniden kontrol
  gerekir. İşlemin başarı durumu BUIS yanıtından kullanıcı tarafından okunur.
- **Kontenjan kontrol**, dönemli JSON gerektirir. `/scripts/quotasearch.asp`
  sorgularını sırayla yapar; yanıt giriş/hata sayfasıysa kontenjanmış gibi
  göstermez. Bölüm seçildiyse önce bölümün, yoksa `ALL` satırını okuyup
  **consent gerekiyor / boş yer / dolu / bölüme açık değil** der. Sonuç,
  öğrencinin ders alabileceğine dair onay değildir.
- **Consent isteği**, Consent Requests ekranında kısaltmayı ve şubeyi seçip
  Toolbox'ta yazılan mesajı boş alana yazar. Seçim sayfayı yenilerse 60 saniye
  içinde kaldığı yerden sürer, dört denemeden sonra durur. Hiçbir düğmeye
  basmaz: BUIS aynı şubeye en fazla 2, toplam 10 derse istek kabul ediyor.
  [Consent deneme sayfası](https://boun-toolbox.vercel.app/buis-consent-demo.html).
- **Form raporu**, planı silmeden ayrı alana yazılır. URL sorgu parametreleri,
  alan değerleri, parolalar, çerezler ve gizli form değerleri rapora alınmaz.

Plan ve tanıtılan alanlar BUIS kökeninin yerel tarayıcı deposunda sayfa yoluna
göre saklanır. Yardımcı şifre toplamaz. Kontenjan ve kullanıcının seçtiği ekleme
isteği BUIS'e gider; Toolbox sunucusuna oturum bilgisi aktarılmaz.

### BUIS incelemesinin sınırı (14 Eylül 2026)

- Oturumsuz `BuisDashboard.aspx` açılışı giriş ekranına dönüyor. Mevcut tarayıcı
  oturumunda Course List Preparation açıldı: `ObikasASPFrame.aspx` içindeki
  `iframe#ifCPL`, `/scripts/loginst.asp` yükledi. İçerik `SERVICE IS CURRENTLY CLOSED!`
  olduğundan gerçek ders ekleme formu ve istek hedefi henüz incelenemedi.
- Herkese açık giriş sayfasında ASP.NET WebForms alanları var. Bu bulgu,
  oturum içindeki bütün ekranların aynı yöntemle çalıştığını veya BUIS'te
  JSON API olmadığını kanıtlamaz. Kayıt endpoint'i tahmin edilmedi.
- Resmî ders kataloğu `/scripts/schdepsel.asp` ve `/scripts/sch.asp` üzerinden
  okunuyor. Katalogdaki kod/şube, kayıt formunun doğrulandığı anlamına gelmez.
- Toolbox ile BUIS ayrı kökenlerde. Tarayıcının aynı köken kuralı nedeniyle
  Toolbox sayfası BUIS ekranını doğrudan okuyup dolduramaz. Mevcut yardımcı bu
  nedenle kullanıcının BUIS sekmesinde çalışır.

Canlı kayıt uyumluluğu için sonraki adım: kullanıcının oturum açtığı ders ekleme
sayfasında gerçek alanları, dönem bilgisini, gönderme hedefini ve BUIS başarı/
hata durumlarını doğrulamak. Bu incelemede gerçek bir ders kayıt isteği
gönderilmedi. Sentetik form testleri gerçek BUIS uyumluluğunun yerine geçmez.

### Yardımcı doğrulaması (14 Eylül 2026)

Otomatik testler gerçek yardımcı dosyasını yerel, sentetik formlarda çalıştırır.
Yanlış düğme seçimi, kısmi doldurma, dolu alanlar, geçersiz plan, değişen form,
tekrarlanan gönderme, dönem eksikliği ve raporda değer sızıntısı denetlenir.
Testlerde gerçek BUIS oturumu veya ağ isteği kullanılmaz.

## Doğrulama (12 Eylül 2026)

- 20 otomatik test geçti; ESLint ve TypeScript/Vite üretim derlemesi başarılı.
- `npm audit`: tüm bağımlılıklarda 0 bilinen açık (kontrol anındaki npm veritabanına göre).
- Tarayıcıda kompakt kodla arama, tek LAB ekleme, kredi toplamı, hafta sonu görünümü, saati olmayan ders ekleme ve sayfa yenilendikten sonra programı geri yükleme kontrol edildi.
- Üretim derlemesi `/Boun-Toolbox-/` alt dizininde çalıştırıldı; GPA katalog yüklemesi ve sayfa yenileme doğrulandı.
- PNG/PDF indirildi; PNG'de 09:00–22:00 takvimin tamamı görsel olarak kontrol edildi. PDF dosyasının oluşumu doğrulandı.
- GPA: AA seçimi 4.00; bölüm değişimi ek dersleri/notları sıfırlıyor. Tekrar dersin eski BB notu yeni not seçilene kadar 3.00, yeni AA seçilince 4.00 olarak hesaba katılıyor.
- Müfredatta sürükleme başlangıcında atama silinmez; başarılı bırakmada taşınır. Atamayı kaldırmak için ayrı düğme eklendi. Bu sürükleme düzeltmesi kod incelemesiyle kontrol edildi; tam tarayıcı sürükle-bırak testi yapılmadı.

Derleme, ders kataloğunun ana pakete dahil olması nedeniyle 500 kB üzeri paket uyarısı veriyor; bu bir derleme hatası değil. Mobil kırılımlar düzenlendi fakat ayrı cihaz testi yapılmadı.

Canlı site: https://boun-toolbox.vercel.app. Vercel, GitHub deposunun `main` dalına bağlıdır; bu dala gönderilen değişiklikler üretim dağıtımını tetikler. Yeni ders verisinin yayınlanması için güncelleme komutundan sonra değişen JSON dosyaları da commit edilmelidir.

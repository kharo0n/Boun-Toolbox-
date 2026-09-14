# BUIS hızlı kayıt yardımcısı — 14 Eylül 2026 incelemesi

## Doğrulanmış akış

Kullanıcının açık BUIS oturumunda menüden **Course List Preparation** açıldı:

1. Dış sayfa: `/buis/manage/ObikasASPFrame.aspx?url=/scripts/loginst.asp`.
2. Kayıt çerçevesi: `iframe#ifCPL`, kaynak `/scripts/loginst.asp`.
3. 14 Eylül 2026'da oturum içindeki ekran `SERVICE IS CURRENTLY CLOSED!` gösteriyor.
   Aktif ders ekleme formu, form alanlarının gerçek adları ve POST hedefi bu nedenle
   henüz görülemedi. Hiçbir gerçek ders ekleme/çıkarma/onay isteği gönderilmedi.

[Resmî BUIS kullanım kılavuzu](https://registration.boun.edu.tr/ann/OBIKAS_User_Guide_09_2024.pdf),
sayfa 10: **Quick Add**, birden çok dersin kısaltma, numara ve şubesini topluca
kabul eder. Credit/Non-credit ve Repeat seçenekleri de vardır. Sayfa 11:
**Send to Approval**, danışman onayına gönderme için ayrı bir adımdır.
Kılavuz iş akışını doğrular; 2026 canlı formunun HTML/API yapısını doğrulamaz.

Girişteki WebForms alanları, çerçeve içindeki eski ASP formunun WebForms olduğu
veya sistemde hiç JSON API olmadığı anlamına gelmez. Kayıt POST endpoint'i
uydurulmadı. Yardımcı, açık formun kendi Quick Add düğmesini kullanır; oturum
çerezlerini ve gizli form alanlarını tarayıcı normal şekilde işler.

## İTÜ projesi nasıl çalışıyor?

İncelenen [AtaTrkgl/itu-ders-secici](https://github.com/AtaTrkgl/itu-ders-secici)
sürümü: `d8f5955fcfc7cd1890998dbc03d24013021df5fd`.

- [`src/run.py`](https://github.com/AtaTrkgl/itu-ders-secici/blob/d8f5955fcfc7cd1890998dbc03d24013021df5fd/src/run.py)
  ve [`src/token_fetcher.py`](https://github.com/AtaTrkgl/itu-ders-secici/blob/d8f5955fcfc7cd1890998dbc03d24013021df5fd/src/token_fetcher.py):
  Tarayıcıda oturum açar, takvim isteğinden Authorization başlığını elde edip
  arka planda yeniler. Yerel saat yaklaştığında kayıt zamanı API'sini kontrol eder.
- [`src/request_manager.py`](https://github.com/AtaTrkgl/itu-ders-secici/blob/d8f5955fcfc7cd1890998dbc03d24013021df5fd/src/request_manager.py):
  `/api/ders-kayit/v21/` adresine `{ECRN: [...], SCRN: [...]}` JSON gövdesi yollar.
  CRN başına sonuç kodunu yorumlar, başarıları sonraki listeden çıkarır; bazı
  hatalarda yeniden dener ve yedek CRN kullanır.
- Kayıt açılış kontrolü `/api/ogrenci/Takvim/KayitZamaniKontrolu` üzerinden.
  Bu yollar ve sonuç kodları **İTÜ'ye özeldir**, BUIS'e taşınamaz.
- Kaynakta her başarısız dersin listeden çıkarılması başarı demek değildir;
  dış döngünün boş listeyi tüm dersler başarılı diye yorumlaması yanıltıcı olabilir.
  BUIS yardımcısı kendi düğmesine basmayı kayıt başarısı olarak bildirmez.
- İTÜ'nin ders kayıt URL'sine oturumsuz web erişimi giriş sistemine yönlendi ve
  çerez hatası verdi. Canlı İTÜ ders formu/API davranışı doğrulanmadı. Proje
  çalıştırılmadı; herhangi bir İTÜ hesabı veya oturum bilgisi kullanılmadı.

## Yardımcı 1.2.0

1. Toolbox **Kayıt Asistanı → Planı kopyala**.
2. Userscript'i güncelleyip BUIS **Course List Preparation** aç. Yardımcı iç
   çerçevede çalışır; dış sayfada ikinci panel açmaz. Kapalı servis otomatik
   gönderime hazırlanamaz.
3. Planı yapıştır, **Formu tanı**. Alanlara yazmadan listeyi ve form kapasitesini
   doğrular. Desenler tutmazsa **Alanları tanıt**, tek satırın üç alanını eşler;
   gerçek form açılınca çok satırlı alan desenlerinin uyarlanması gerekebilir.
4. Doğru **Quick Add** düğmesini seç. Dönemi, ders listesini ve BUIS'in kredi/
   tekrar seçimlerini gözden geçirip kontrol kutusunu işaretle. Bu yardımcı
   kredi/tekrar seçeneklerini senin yerine seçmez.
5. **Doldur ve gönder** bütün ders alanlarını aynı işlemde yazar ve seçilen
   düğmeye bir kez basar. Harf harf yazma beklemesi ve otomatik yeniden deneme yok.
6. Alternatif olarak **Saatli gönderim** ile Türkiye saatini (UTC+3) seçip başlat.
   Bu mod **önceden açılmış, tanınmış form** gerektirir; kapalı ekranı açıp form
   arayan bir bot değildir. Formu kayıt başlamadan göremiyorsan, açıldığında
   tek tık modunu kullanmak gerekir.
7. Sonucu BUIS'ten kontrol et; danışman onayına gönderme ayrı işlemdir.

Saatli mod önümüzdeki 24 saatle sınırlıdır. Yerel saat kullanılır; bir sunucu
saati eşitleme iddiası yoktur. Sekme gizlenirse, sayfa yenilenirse, form/plan/
düğme değişirse veya saat kayması/gecikme 1,5 saniyeyi aşarsa iptal edilir.
Yenilemeden sonra otomatik yeniden kurulmaz. Açılışta tekrar tekrar istek
atılmaz. Sekmeyi görünür ve bilgisayarı uyanık tutmak gerekir.

## Deneme ve doğrulama

`/buis-helper-demo.html` gerçek yardımcı dosyasını sentetik üç satırlı formda
çalıştırır. Form gönderimi yerel olarak durdurulur; BUIS kaydı veya kontenjan
isteği yapılmaz. Bu sayfa gerçek BUIS formunun kopyası değildir.

14 Eylül tarayıcı denemesinde üç dersin alanlarını yazma ve gönderim öncesi
kontrol süresi **2,0 ms** ölçüldü; tek Quick Add gönderimi görüldü. Saatli
gönderim tarayıcı denemesi de seçilen anda tek gönderim yaptı (yerel kontrol
ve doldurma: 2,1 ms). Bu sayı ağ,
sunucu kuyruğu, doğrulamalar veya kayıt kabulünü kapsamaz. Bir saniyede dersin
kesin alınacağı garanti edilemez.

75 otomatik test; bozuk plan, eksik satır, dolu alan, yanlış düğme, kredi/tekrar
seçeneği değişikliği, çift gönderim, zamanlama, iptal, saat kayması, kapalı servis
ve çerçeve kabuğunu kapsar. Lint ve üretim derlemesi başarılı.

## Yardımcı 1.3.0 ve consent (14 Eylül 2026 akşamı)

### Kaynaklar

- [Akademik takvim](https://akademiktakvim.bogazici.edu.tr/): kayıt sistemi
  **15 Eylül 10:00**'da açılır; consent öğrenciye **17 Eylül 14:00**'te,
  öğretim elemanına 21:00'de, kayıt öğrenciye 23:59'da kapanır.
- Resmî kılavuz, consent: Course List Preparation altındaki **Consent Requests**
  ekranında önce ders kısaltması, sonra ders seçilir, "Comments/Message to
  Instructor" yazılıp gönderilir. En fazla 10 ders, aynı şubeye dönem başına en
  fazla 2 istek. Öğretim elemanı istekleri numara, bölüm, statü, GPA, dönem ve
  istek tarihiyle görür; Approve/Reject/Shortlist yapar. Onay 24 saat geçerlidir,
  dersi listeye otomatik eklemez. Bir şube eklenince aynı dersin diğer istekleri
  düşer.
- [enescakir/registration-bot](https://github.com/enescakir/registration-bot)
  (2019, eski sistem): Quick Add için `POST /scripts/studentaction.asp` ve
  `abbr1`, `code1`, `section1`, `rnc1` (`N`/`NC`), `rcourse1`, `B1=Quick Add`;
  hata metni "course couldn't be added to your list". 14 Eylül'de oturumsuz
  `studentaction.asp` ve `secchaact.asp` hâlâ oturum süresi doldu sayfasına
  yönleniyor; BUIS çerçevesi de aynı `/scripts/loginst.asp` sistemini açıyor.
  Canlı formun hâlâ bu adları kullandığı doğrulanmadı. Botun README'si hesabın
  askıya alınabileceği uyarısını taşır; bu yardımcı istek üretmez, sayfadaki
  düğmeyi kullanıcı adına yalnız bir kez ve seçildiğinde tetikler.
- `quotasearch.asp` oturumsuz yanıt verir ve CORS başlığı yoktur; Toolbox sitesi
  sorgulayamaz, BUIS sekmesindeki yardımcı sorgular. 14 Eylül'de 2026/2027-1 için
  bütün "Current" değerleri 0'dı. Örnek yanıtlar `tests/fixtures/` altındadır;
  bölüm adları `courseMetadata.json` bölüm listesiyle eşleşir. Öğrenci tarafı
  consent ekranının adresi ve alanları açık kaynakta bulunamadı.

### Consent adımı nasıl çalışır

1. Planda mesajı olan her ders için panelde **Consent doldur** düğmesi çıkar.
2. Sayfada "consent" yazısı yoksa, Quick Add alanları veya parola alanı varsa,
   ya da "not open / currently closed" yazıyorsa hiçbir seçim yapılmaz.
3. Kısaltma listesi: rakam içermeyen, ilk kelimesi, parantez içi veya değeri
   kısaltmaya eşit tek seçenek. Ders listesi: `CMPE 150.01` biçimini içeren tek
   liste ve tam şube. Şubeler listeleniyor ama istenen yoksa durur.
4. Seçimden sonra sayfa yenilenirse iş `sessionStorage`'da 20 saniye bekler; dört
   seçimden sonra durur. Mesaj alanı doluysa üzerine yazmaz; düğmeye basmaz.
5. **Form raporu** açılır listeler için seçenek sayısını ve ilk üç etiketin
   biçimini (harf → A, rakam → 9) ekler; ders veya not metni koymaz.

`/buis-consent-demo.html`, kılavuzdaki akışa göre hazırlanmış sentetik bir
consent formunda aynı yardımcıyı çalıştırır. Otomatik testler 94'e çıktı:
gerçek kontenjan HTML'leriyle karar, satır taşması ve listede görünen dersleri
atlama, numaralı ve tablo düzenli alan eşleme, consent seçimi, sayfa yenilemesi,
eskimiş/sahte iş, belirsiz şube, dolu mesaj alanı ve kapalı ekran.

## Açık kalan doğrulama

Kayıt formu ve Consent Requests ekranı açıldığında alan adları, Quick Add satır
sayısı, consent listelerinin yenilenme davranışı ve form hedefi **Form raporu** ile
incelenmeli. İşlem sonucunun nasıl gösterildiği ve varsa ders başına hata kodları
henüz bilinmiyor; otomatik başarı yorumlama veya hataya göre tekrar deneme
uygulanmadı. Oturumun açık olması, kayıt servisinin açık olduğu anlamına gelmez.

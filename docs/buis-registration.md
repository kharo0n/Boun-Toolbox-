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

## Açık kalan doğrulama

Kayıt formu açıldığında alan adları, çok satırlı Quick Add yapısı ve form hedefi
incelenmeli. İşlem sonucunun nasıl gösterildiği ve varsa ders başına hata kodları
henüz bilinmiyor; otomatik başarı yorumlama veya hataya göre tekrar deneme
uygulanmadı. Oturumun açık olması, kayıt servisinin açık olduğu anlamına gelmez.

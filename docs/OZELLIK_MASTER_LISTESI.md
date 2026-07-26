# EmlakSoft — Master Özellik Listesi ve Tam Sistem Denetimi

**Tarih:** 2026-07-26
**Kaynak:** 10 ajanlı tam kod taraması (97 ekran denetimi) + vizyon dokümanı değerlendirmesi + pazar araştırması (Follow Up Boss, kvCORE/BoldTrail, Lofty, Rechat, Propertybase, Emlapp, EndeksA…) + 2025-26 premium UI trend araştırması (Linear, Stripe, Vercel, Raycast, Attio).

**Üç garanti hedefi:** Hiçbir müşteri unutulmayacak · Hiçbir portföy kontrolsüz kalmayacak · Şirket sahibi ofisi tek ekrandan yönetecek.

---

# BÖLÜM 1 — TIKLANABİLİRLİK MASTER PLANI (P0)

## 1.1 Kök nedenler (önce bunlar çözülmeli)

1. **`src/components/app/stat-card.tsx` düz `div`** — `href`/`onClick` prop'u yok ve projede **hiçbir yerde import edilmiyor (ölü kod)**. Bu yüzden ~15 ekran KPI kartını elle düz div olarak yazmış. → StatCard'a opsiyonel `href` + hover ok ikonu + focus-ring eklenip TÜM KPI grid'leri buna geçirilmeli.
2. **Liste sayfalarında filtre query parametresi yok** — KPI'dan filtreli listeye drill-down'un ön koşulu. Eklenecekler: `/admin/tenants?durum=&plan=`, `/admin/tickets?durum=&oncelik=`, `/app/musteriler?tip=&kaynak=&danisman=`, `/app/portfoyler?saglik=`, `/app/komisyon?durum=`, `/app/gorevler?filter=`, `/app/talepler?aciliyet=` …
3. **Admin listeleri elle `divide-y` div'lerle kurulmuş** — `data-table.tsx`'in ROW_HREF (absolute-inset link) deseni ve `table.tsx`'in `interactive` TR'si admin tarafında hiç kullanılmıyor.
4. **Kural: "Sıfır çıkmaz metrik" (zero dead-end)** — ekranda görünen her sayı, her isim, her rozet ya bir listeye ya bir detaya gider. İyi örnekler zaten kodda var: `support-home.tsx` ticket satırları, `/app/musteriler` tablo satırları, `/app/portfoyler` kartları, `danisman-kpi` tablosu.

## 1.2 Ana dashboard `/app` (en kritik ekran)

| Öğe | Şu an | Olması gereken hedef |
|---|---|---|
| 6 KPI kartı (page.tsx:528-574) | düz div | Toplam müşteri → `/app/musteriler` · Bugünkü arama → `/app/arama` · Aktif portföy → `/app/portfoyler` · Teyitsiz ilan → `/app/portallar?durum=teyitsiz` · Bekleyen komisyon → `/app/komisyon?durum=bekleyen` · Tahmini kayıp → `/app/kayip-kacak` |
| Ofis skoru kutusu | tıklanamaz | `/app/raporlar` + "skoru nasıl yükseltirim" açıklaması |
| TAHSİL / BEKLEYEN mini statlar | tıklanamaz | `/app/komisyon` (durum filtreli) |
| Komisyon grafiği ayları | statik SVG | aya tıkla → o ayın komisyon listesi |
| Satış hunisi aşamaları | düz div | `/app/talepler?status=new\|active\|matched`, Kazanılan → `/app/anlasmalar` |
| Kazanma oranı / Açık anlaşma | tıklanamaz | `/app/anlasmalar` |
| Bugünkü görevler satırları | düz li | ilgili modüle (portallar/kayıp-kaçak/anlaşmalar); başlık → `/app/gorevler` |
| Kayıp-kaçak kapanış kartları | tıklanamaz | `/app/kayip-kacak` / ilgili portföy |
| Portal sağlığı satırları | tıklanamaz | `/app/portallar` (portal filtreli) |
| Ekip performansı satırları | hover VAR, link YOK | `/app/ekip/{member.id}` |
| Son 24s canlı akış öğeleri | düz metin (id'ler feed key'lerinde zaten var!) | müşteri → `/app/musteriler/{id}`, portföy → `/app/portfoyler/{id}`, arama → `/app/arama`, randevu → `/app/randevular` |

## 1.3 Admin dashboard `/admin` + rol varyantları

- 4 KPI kartı → `/admin/tenants`, `/admin/billing`, `/admin/tenants?durum=trial`, `/admin/tickets`
- **"Son ofisler" satırları düz div (t.id elde var!)** → `/admin/tenants/{id}` — en kritik eksik
- Aktivite akışı satırları → `/admin/tenants/{tenant_id}` veya `/admin/aktivite`; entity tipine göre derin link (ticket → `/admin/tickets/{id}`)
- Gelir motoru MRR/ARR → `/admin/billing` · Toplam kullanıcı → `/admin/members`
- Kazanım hunisi segmentleri, plan karışımı barları, sağlık halkası lejantı → `/admin/tenants` (filtreli)
- **BillingHome:** 4 KPI + son fatura satırları tıklanamaz (sorguya `tenant_id` de eklenmeli) → `/admin/tenants/{id}`
- **SupportHome:** 4 KPI + öncelik barları → `/admin/tickets` (durum/öncelik filtreli)

## 1.4 Tüm diğer ekranların tıklanabilirlik eksikleri (özet harita)

**App tarafı:**
- `/app/musteriler` — hero KPI'ları tip filtresine bağlanmalı; telefon `tel:` + WhatsApp, e-posta `mailto:` olmalı
- `/app/musteriler/[id]` — anlaşma satırları → `/app/anlasmalar/[id]`; hero statları sekmeleri açmalı; "Görüşme kaydet"/"Randevu ver" `?customer={id}` taşımalı; İYS izinleri → `/app/uyum`
- `/app/portfoyler` — KPI + fiyat sağlığı segmentleri → sağlık filtreli liste (filtre parametresi eklenerek)
- `/app/portfoyler/[id]` — kapanış kayıtları → kayıp-kaçak; "Portal bağla" → `?property={id}`; "Pipeline" → bu portföyün anlaşması; danışman adı → `/app/ekip/[id]`
- `/app/talepler` — kart müşteriye değil talebe gitmeli (`?tab=talepler` çapası); "Acil" KPI → aciliyet filtresi
- `/app/eslestirme` — KPI'lar + skor dağılım çubukları → kademe/skor filtresi
- `/app/randevular` — takvim günü öğeleri listeye kaydırmalı; portföy adına ayrı link; randevu detay görünümü yok
- `/app/gorevler` — hero sayaçları `?filter=` linki; atanan kişi → `/app/ekip/[id]`; bağlantısız görev kartı düzenleme diyaloğunu açmalı
- `/app/anlasmalar` — KPI'lar filtre; kartta danışman avatarı + link (assigned_to render edilmiyor); sütun başlıkları → aşama listesi
- `/app/anlasmalar/[id]` — danışman adı, bağlı görevler, komisyon satırları linksiz
- `/app/teklifler` — portföy/müşteri hücreleri linksiz (id'ler satır verisine taşınmıyor); KPI'lar durum filtresi
- `/app/sozlesmeler` + `[id]` — taraf/portföy hücreleri linksiz; **[id]'de müşteri linki yalnız Array dalında çalışıyor (bug)**; imzalayan satırında link kopyala/yeniden gönder aksiyonu
- `/app/komisyon` — KPI durum filtresi; portföysüz kayıtlar anlaşmaya gitmeli (deal id sorguya eklenmeli); split rozetlerindeki danışman → `/app/ekip/[id]`
- `/app/raporlar` — 4 KPI + hacim barları + kaynak dağılımı + gelir/gider kartları hiçbiri gitmiyor (tam çıkmaz sokak)
- `/admin/raporlar` — **sayfada tek bir Link importu bile yok**; "En değerli ofisler" satırları → `/admin/tenants/{id}`
- `/app/danisman-kpi` — grafik barları + tablo hücreleri drill-down (`/app/arama?danisman=id` vb.); koç önerileri ilgili ekrana link
- `/app/hedefler` — "X/Y anlaşma" → `/app/anlasmalar` (danışman filtreli); ofis kartı → `/app/raporlar`
- `/app/bolge-analizi` — satır linki `?q=<ilçe adı>` yerine `?district=<id>` kesin filtre; grafik çubukları tıklanabilir
- `/app/giderler` — donut segmentleri kategori filtresi; satır → düzenleme diyaloğu
- `/app/aidat`, `/app/kayip-kacak`, `/app/kayip-satis`, `/app/franchise`, `/app/degerleme`, `/app/portallar` (**portföy başlığı linksiz — en kritik**), `/app/kampanyalar`, `/app/otomasyonlar`, `/app/destek`, `/app/denetim` (entity_id → ilgili kayıt), `/app/uyum`, `/app/acik-ev` — hepsinde aynı desen: KPI → filtre, satır → detay, grafik → drill-down
- Topbar "Ofis skoru" rozeti → `/app/raporlar`

**Admin tarafı:** `/admin/aktivite` (satır → diff detayı; "Ofis" linki mobilde gizli!), `/admin/bildirimler` (href'siz bildirim en azından okundu işaretlemeli), `/admin/billing` (fatura → fatura detayı/PDF), `/admin/danisman` (KPI'lar + AI yanıtındaki ofis adlarına derin link), `/admin/geo` (il/ilçe ADI tıklanabilir olmalı, sadece sağdaki buton değil), `/admin/hatalar` (kiracı adı → tenant; kart → stack detayı), `/admin/members` (ROW_HREF set edilmemiş!), `/admin/personel` (personel → aktivite aktör filtresi), `/admin/satis` (KPI'lar mevcut `?durum=` filtresine bağlanmalı — **en kolay kazanç**), `/admin/tenants` (üye sayısı → members; slug → public site), `/admin/tenants/[id]` (4 KPI → ilgili modüller), `/admin/tickets` (ofis adı → tenant; sayaçlar/halka/barlar → filtre)

**Public taraf:** vitrin ilan detayında küçük görseller lightbox açmalı (11+ fotoğraf şu an hiç görülemiyor); konum → harita linki; `paylas` küçük görselleri aynı şekilde; malik portalında teklif satırları + danışman Ara/WhatsApp butonları; müşteri portalında **eşleşen portföy kartları tıklanamaz (en kritik)** ve tel: linki yanlışlıkla müşterinin kendi numarasına gidiyor (bug); landing'de persona/özellik/entegrasyon kartları ve footer sosyal ikonları ölü.

---

# BÖLÜM 2 — YATAY (TÜM EKRANLARI KESEN) EKSİK ÖZELLİKLER

Her liste ekranında tekrar eden 12 standart eksik. **"Liste Standardı"** olarak tek seferde tanımlanıp tüm ekranlara uygulanmalı:

1. **Filtre çipleri** (durum/tür/danışman/kaynak) — çoğu ekranda yalnız serbest arama var veya hiçbiri yok
2. **Sayfalama** — neredeyse her ekran sabit limitli (100/150/200/300/500) ve ötesi sessizce görünmez; birçoğunda kesme uyarısı bile yok
3. **Sütun sıralama** — DataTable kullanan 5-6 ekran dışında yok
4. **Tarih aralığı seçici** — hiçbir rapor/liste ekranında yok (her şey sabit pencere)
5. **Dönem karşılaştırması** — "geçen aya göre %X" trend oku hiçbir KPI'da yok
6. **CSV/Excel/PDF dışa aktarma** — tutarsız: müşteriler/komisyon/denetimde var, portföy/gider/rapor/randevu/teklif/portalda yok
7. **Toplu işlem** — checkbox seçim + toplu atama/etiket/tahsil/teyit hiçbir listede yok (tek istisna: portföy toplu durum)
8. **Onay diyaloğu standardı** — tanım silme ONAYSIZ, gider silme onaysız, oturum silme onaysız; bazıları native `confirm()` — tasarım sistemine uygun tek ConfirmDialog
9. **Kaydedilmiş görünümler** — filtre kombinasyonunu kaydetme hiçbir ekranda yok
10. **Gerçek grafik tooltip'i + drill-down** — SVG grafiklerin tamamı statik (yalnız Recharts'lı 2 ekranda tooltip var)
11. **Sunucu tarafı filtreleme/agregasyon** — müşteri filtreleri 500 kayıtlık dilim üzerinde bellek-içi; eşleştirme 80×120 bellek-içi; admin KPI'ları 2000/5000 limitli — ölçek büyüyünce **sessizce yanlış** sonuç üretir
12. **Gerçek zamanlı güncelleme** — bildirimler/destek/dashboard'da yeni veri sayfa yenilenmeden düşmüyor (RealtimeRefresh altyapısı kısmen var, yaygınlaştırılmalı)

## Hemen düzeltilmesi gereken buglar / kırık akışlar (denetimde bulundu)

- **`/giris`'te "Şifremi unuttum" yok** — şifre sıfırlama akışı hiç yok (kritik)
- 2FA yok, "beni hatırla" yok
- `:focus-visible { border-radius: 4px }` globals.css:251 — yuvarlak avatarlar/pill'ler klavye odağında 4px köşeli görünüyor (görsel bug)
- Kampanyalar "Netgsm'i Ayarlar'dan tanımlayın" diyor ama **`/app/ayarlar`'da entegrasyon formu yok** (kırık yönlendirme)
- **Roller matrisi 18 modülle sınırlı** — campaigns, contracts, expenses, offers, targets, open_house izinleri UI'dan yönetilemiyor
- AI danışman TXT indirme dosya adında Kiril karakter: "danisман"
- `offers`/`contracts` tablolarında `deal_id` yok — anlaşma detayı "yaklaşık eşleşme" ile yanlış pozitif üretebilir (şema işi)
- Vitrin + paylaş + malik/müşteri portalı + ödeme linkinde **OG/SEO metadata yok** — ana dağıtım kanalı WhatsApp olduğu halde link önizleme kartı çıkmıyor; token'lı sayfalarda `robots noindex` de eksik
- Vitrin ilan detayında **ilan açıklaması hiç gösterilmiyor** (sorguda seçilmiyor)
- Müşteri portalında tel:/mailto: linkleri danışman yerine müşterinin kendi numarasına gidiyor
- Açık ev boş durumu "randevu sayfasından ekleyin" diyor — bu ekrandan oluşturma yok (kopuk akış)
- Arama konsolunda süre 180 sn ön dolu (veri kirliliği); müşteri listesi limitsiz çekiliyor
- Lead formunda KVKK açık rıza checkbox'ı yok (ürünün uyum iddiasıyla çelişki), honeypot/captcha yok, PhoneInput kullanılmamış
- `/app/askida`'da ödemeye giden hiçbir eylem yok — "ödemeyi tamamla" akışı eklenmeli

---

# BÖLÜM 3 — VİZYON DOKÜMANI DEĞERLENDİRMESİ (35 başlık)

Durum: ✅ büyük ölçüde var · 🟡 kısmen var · ❌ yok. Öncelik: **P0** (hemen) → **P3** (uzun vade).

| # | Vizyon başlığı | Durum | Değerlendirme ve öneri | Öncelik |
|---|---|---|---|---|
| 1 | Çoklu ofis / SaaS altyapısı | 🟡 | Multi-tenant, plan/modül kapısı, 8 rollü izin matrisi, şube rollup'ı (franchise) var. **Mantıklı eklemeler:** şube bazlı kota/yetki, kullanıcı bazlı izin istisnası, rol kopyalama, geçici yetki süresi, kritik işlemde çift onay. IP/cihaz sınırı → P3. 18 kullanıcı türü yerine mevcut rollere **uzmanlık/etiket** eklemek daha doğru (fotoğrafçı/drone ayrı rol olmak zorunda değil). | P1 |
| 2 | Ana yönetim paneli | 🟡 | Günlük operasyon özetinin çoğu var (randevu widget'ı YOK — eklenmeli). **Mantıklı:** bugünkü randevular karti, aranacaklar, süresi dolacak yetkiler (var), cevapsız talepler, tahsil edilecek komisyonlar. Özelleştirilebilir panel (kart ekle/çıkar + rol bazlı varsayılan) → P2; sürükle-bırak → P3. | P0-P1 |
| 3 | Portföy yönetimi | 🟡 | Çekirdek + medya + durum geçmişi + sağlık skoru var. **Mantıklı eklemeler:** tapu alanları (ada/parsel/bağımsız bölüm), imar alanları (KAKS/TAKS/gabari — arsa için), anahtar takibi, gizli notlar, portal bazlı farklı açıklama, kapak fotoğrafının liste kartında gösterimi (media var, listede ikon gösteriliyor!), filigran, toplu fotoğraf sıralama, 360/Matterport alanı (dış link var, gömme yok). Kategori/durum genişletmeleri `tanımlar` üzerinden — 35 kategori tek listede boğar, hiyerarşik (Konut>Daire) yapılmalı. AI sanal dekorasyon → P3. | P1 |
| 4 | Malik yönetimi + Malik portalı | 🟡 | Portal token'lı sayfa VAR ama asıl değeri eksik: **fotoğraf yok, görüntülenme/arama istatistiği yok, teklif onay/ret butonu yok, danışman iletişimi yok, haftalık rapor yok.** Bu ekran "tek yetki kazandıran" satış silahı — P1'de derinleştirilmeli. Malik kartı ayrı varlık değil müşteri tipi; IBAN/vekâlet/hisse alanları eklenebilir. | **P1** |
| 5 | Müşteri & talep yönetimi | ✅/🟡 | 360 görünüm, lead skoru, İYS izinleri, dosyalar, çift kayıt tespiti var. **Mantıklı eklemeler:** birleşik zaman tüneli (çağrı+randevu+teklif+iletişim tek kronoloji), güvenli birleştirme sihirbazı, kayıt anında canlı mükerrer uyarısı, haritada bölge çizme (talepte), zorunlu/istenmeyen özellik listeleri, kaybetme nedeni alanı. | P1 |
| 6 | Akıllı eşleştirme | 🟡 | Kural tabanlı skor + gerekçe rozetleri var. **Mantıklı:** eşleşme yaşam döngüsü (önerildi→gönderildi→gezdirildi→teklif), "uygun değil" geri bildirimi ve öğrenme, eşleşme sonrası aksiyon (WhatsApp gönder/randevu), yeni portföyde otomatik talep bildirimi (otomasyon şablonu var, derinleştir). Davranış öğrenmeli öneri (tıklama verisi) → müşteri portalı beğen/geç ile birlikte P2. | P1 |
| 7 | Lead yönetimi | 🟡 | Web formu + webhook + round-robin + leak SLA cron var. **Mantıklı:** atama kuralı yapılandırması (bölge/uzmanlık/performans), 5-15-60 dk SLA panosu + müdüre eskalasyon, kaynak bazlı ROI raporu, Facebook/Instagram Lead Ads entegrasyonu, WhatsApp'tan lead yakalama, ilk temas süresi raporu. | **P1** |
| 8 | Telefon / çağrı merkezi | 🟡 | Manuel konsol + sonuç kodları + istatistik var. **Mantıklı:** Netgsm/Verimor CTI (gelen aramada müşteri kartı pop-up) P2; akıllı arama listeleri (bugün aranacaklar, 7 gün temassız, doğum günü — kayıp-satış zaten benzerini yapıyor, genelleştir) P1; tıkla-ara `tel:` linkleri P0. Ses kaydı + AI özet/duygu analizi → P3 (maliyetli, sonra). | P1-P2 |
| 9 | Birleşik gelen kutusu / WhatsApp | 🟡 | SMS/WA kampanyaları + iletişim zaman tüneli var. **En değerli eksiklerden biri:** WhatsApp Business API ile mesajların müşteri kartına düşmesi, ekip gelen kutusu, şablon yönetimi, mesajı görev/müşteriye çevirme. Türkiye'de fiili kanal WhatsApp — pazar araştırmasında da "kritik". E-posta (Gmail/Outlook) senkronu → P3. | **P2 (büyük iş, ama stratejik)** |
| 10 | Randevu & yer gösterim | 🟡 | Takvim + ICS + tipler var. **Mantıklı:** çakışma kontrolü (dokümanda da planlı!), otomatik SMS/WhatsApp hatırlatma, **dijital yer gösterme tutanağı + telefonda imza** (Türkiye'ye özgü, komisyon ihtilafında kanıt — pazar araştırmasında "kritik"), gezi sonrası zorunlu sonuç formu (beğendi/teklif → huniye akar), rota optimizasyonu P2, QR/NFC tabela → P3. Google/Outlook takvim senkronu P2. | **P1** |
| 11 | Teklif & pazarlık & işlem dosyası | 🟡 | Teklif + karşı teklif (tek alan) + anlaşma 360 var. **Mantıklı:** tur tur pazarlık geçmişi (offer_rounds), teklif→anlaşma→sözleşme tek tık dönüşüm zinciri, kapora takibi, işlem masraf kalemi listesi, teklif PDF'i, geçerlilik sayacı + otomatik hatırlatma. Pazarlık ekranı (malik alt limiti / alıcı üst limiti / AI önerisi) → P2. | P1 |
| 12 | Belge & e-imza | 🟡 | Şablonlu sözleşme + risk taraması + token imza var. **Mantıklı:** SMS OTP doğrulamalı imza (şu an linke sahip herkes imzalayabiliyor — güvenlik açığı), imzalı PDF indirme + zaman damgası sertifikası, değişken (___) doldurma sihirbazı, şablon galerisi (yer gösterme, kapora, KVKK metinleri), sürüm geçmişi. AI belge okuma (tapu/yetki OCR) → P2-P3 (dokümanda C8 olarak zaten planlı). 5070 e-imza entegrasyonu → P3. | **P1** |
| 13 | Komisyon | ✅/🟡 | Defter + split editörü + simülatör + ödeme linki var. **Mantıklı:** danışman cüzdanı ekranı (hakediş/bekleyen/ödenen/kesinti), dönem kapanış bordrosu PDF, tahsilat yaşlandırma (30/60/90), esnek split şablonları (takım lideri/referans payı), her hesaplamada denetim izi (audit var, komisyona bağla). | P1 |
| 14 | Finans & ön muhasebe | 🟡 | Gider + aidat + kira artış var. **Mantıklı:** tekrarlayan gider, fiş/fatura eki + OCR, kategori bütçesi, gelir-gider nakit akışı raporu. Kasa/banka/cari/çek-senet → **dikkat: tam ön muhasebe yazılımı olmaya çalışmak odak kaybı; Paraşüt/Logo entegrasyonu (dışa aktarım) daha doğru** → P2. E-fatura/e-arşiv → P2 (altyapı `efatura.ts`'te başlamış). | P2 |
| 15 | Portal yönetimi | 🟡 | Manuel eşleme + teyit + kapanış takibi (Leak Shield) var — bu Türkiye'de benzersiz. **Mantıklı:** portal başına performans (görüntülenme/lead maliyeti), toplu teyit, teyit görev kuyruğu, XML feed üretimi (portallara beslenebilir çıktı). Resmî API'ler kapalıyken "tek tık yayın" vaadi verilmemeli — **yalnızca resmî API/izinli iş ortaklığı** notu doğru ve korunmalı. | P1-P2 |
| 16 | MLS / ofisler arası ağ | ❌ | Dokümanda bilinçli bekletiliyor (kiracılar-arası veri mimarisi + sözleşme modeli kararı). **Değerlendirme: doğru karar.** Önce güven altyapısı (doğrulanmış ofis/danışman, işlem geçmişi) tasarlanmalı. Kontrollü pilot (aynı franchise'ın şubeleri arası talep/portföy havuzu) ile başlanabilir → P3. | P3 |
| 17 | Web sitesi / mikro site | 🟡 | Vitrin + ilan detay + lead formu var. **Önce mevcut vitrini bitir (P1):** SEO metadata + sitemap + JSON-LD RealEstateListing, arama/filtre/sıralama/sayfalama, harita, ofis iletişim bilgileri, WhatsApp butonu, OG görsel üretimi. Sonra: tema seçimi, özel alan adı (white-label), danışman sayfaları → P2. Tek portföy mikro sitesi → P2 (BoldTrail ListingMachine deseni). Blog/çoklu dil → P3. | **P1 (SEO) / P2** |
| 18 | Sosyal medya & pazarlama stüdyosu | 🟡 | AI içerik üretimi (ilan metni/WhatsApp/sosyal/e-posta) `ai-content` ile var. **Mantıklı:** portföyden otomatik görsel üretimi (fiyat + foto + logo şablonları — OG image altyapısıyla başlanabilir), "satıldı/fiyat düştü" post üretimi, A4 ilan föyü + QR kodlu afiş PDF. Tam Canva-benzeri stüdyo/video üretimi → P3. | P2 |
| 19 | AI asistan (Copilot) | 🟡 | Admin tarafında AI danışman var; **tenant tarafında yok** (dokümanda C8 planlı). **Mantıklı sıra:** (1) doğal dil arama komut paletine ("Kadıköy'de 5M altı 3+1"), (2) günlük brifing ("bugün kimi ara"), (3) müşteri görüşme özeti + sonraki adım, (4) AI müşteri/portföy skorları (lead-score + property-health zaten var — AI katmanı üstüne). AI danışman koçu → P2 (advisor-coach.ts temeli var!). | **P2** |
| 20 | Değerleme & pazar analizi | ✅/🟡 | Çok kaynaklı değerleme (ofis emsali+Endeksa+Tapusor) + rapor + fiyat sağlığı var — güçlü. **Mantıklı:** fiyat değişikliği uyarı motoru ("çok görüntülenme-sıfır talep" kuralları — veriler mevcut), aynı mülkün değer trendi, emsal döküm tablosu, paylaşılabilir markalı rapor linki, "Evim ne kadar eder?" satıcı lead'i toplayan public değerleme sayfası (araştırmada en yüksek dönüşümlü satıcı kanalı!). | P1-P2 |
| 21 | Harita & bölge uzmanlığı | 🟡 | lat/lng + portföy detayında OSM + bölge analizi (tablo) var. **Mantıklı:** portföy listesinde harita+liste bölünmüş görünüm, ilçe ısı haritası, danışmana mahalle atama + bölge raporu. Deprem/imar katmanları → P3. | P2 |
| 22 | Pazar istihbaratı (rakip ilan takibi) | ❌ | **Dikkat: izinsiz scraping üzerine ana mimari kurulamaz — dokümandaki bu not doğru.** Yayından kalkma tahmini "muhtemel neden" diliyle (kesin "satıldı" değil) tasarlanmalı. Manuel rakip kaydı + Leak Shield genişletmesi P2; otomatik izleme yalnızca izinli veri kaynağı bulunursa. Malik kazanma araması KVKK/İYS süzgeciyle. | P2-P3 |
| 23 | İnşaat projesi modülü | ❌ | Blok/kat/daire stok + ödeme planı + rezervasyon. **Mantıklı ama ayrı persona** — çekirdek CRM oturduktan sonra ayrı paket ("EmlakSoft Proje") olarak. Landing'de persona zaten var. | P3 |
| 24 | Kiralama & mülk yönetimi | 🟡 | Aidat + kira artış hesaplayıcı var. **Mantıklı ilk adım:** kira sözleşmesi yenileme radarı (bitişe 30 gün kala görev — sözleşmelerde expires_at var), kiracı kartı + otomatik tahakkuk + gecikme takibi → P2-P3 ayrı modül. Bakım/arıza + usta ağı (HGDekor köprüsü) → P3. | P2-P3 |
| 25 | Danışman & ekip yönetimi | ✅/🟡 | Ekip + KPI + hedefler + koç paneli var. **Mantıklı:** hedef oluşturma UI'ı (şu an salt okunur!), tempo/pace göstergesi, danışman karnesi PDF, işe alım kontrol listesi. Eğitim akademisi (video+sınav) → P3; AI rol-yapma simülatörü → P3. | P1 |
| 26 | Görev & otomasyon motoru | 🟡 | Görevler + 6 şablonlu otomasyon var. **Mantıklı:** sıfırdan kural sihirbazı (tetikleyici→koşul→aksiyon seçimli — görsel flow editörü şart değil, form yeterli), çalışma geçmişi (run log), tekrarlayan görev, otomasyon başına dönüşüm metriği. Vizyondaki 13 otomasyon örneğinin çoğu mevcut motorla şablon olarak eklenebilir (ucuz kazanç). | **P1** |
| 27 | Raporlama & iş zekası | 🟡 | Rapor merkezi + KPI ekranları var. **Mantıklı:** tarih aralığı + dönem karşılaştırma (her yerde), kaynak ROI raporu (hangi kanal satışa dönüşüyor), kayıp nedeni analizi (veri toplanıyor, raporu yok!), zamanlanmış haftalık PDF yönetici e-postası, danışman karnesi. Pivot/BI stüdyosu → P3. | P1 |
| 28 | Mobil uygulama | 🟡 | PWA + push var; offline yalnız shell. **Değerlendirme:** önce PWA'yı saha aracına dönüştür (hızlı portföy çekimi, sesli not, belge tarama kamera ile) → P2; React Native → P3 (dokümanda da uzun vade). | P2-P3 |
| 29 | Müşteri portalı/uygulaması | 🟡 | Token'lı portal var ama zayıf: **kartlar tıklanamaz, fotoğraf yok, beğen/geç yok, randevu onayı yok.** Beğen/ilgilenmiyorum geri bildirimi eşleştirme motorunu besler — çift değer. Kayıtlı arama + yeni eşleşme bildirimi → P2. Doğal dilde arama → P3. | **P1** |
| 30 | Güvenlik & KVKK & denetim | 🟡 | Audit + uyum merkezi + KVKK anonimleştirme + denetim dosyası var — güçlü. **Kritik eksikler:** şifre sıfırlama (P0!), 2FA (P1), oturum/cihaz yönetimi (P2), toplu silme koruması + geri alma (P2), dışa aktarma denetim kaydı (kısmen var). Hash zincirli bütünlük kanıtı → P3. | **P0-P1** |
| 31 | Entegrasyon merkezi & açık API | 🟡 | iyzico, Endeksa, Tapusor, Netgsm, TCMB kur, VAPID push var; **Ayarlar'da entegrasyon UI'ı yok (kırık akış — P0)**. Açık REST API + webhook + API anahtarı yönetimi → P2 (platform stratejisi). Zapier/Make → P3. | P1-P2 |
| 32 | Platform admin paneli | ✅/🟡 | Tenants/billing/tickets/satış/hatalar/geo/duyuru — kapsamlı. **Mantıklı:** tenant arama (kritik!), sağlık/churn skoru kolonu, dunning otomasyonu, duyuru geçmişi + hedef kitle sayısı önizleme, cron son çalışma durumu, entegrasyon "bağlantıyı test et". Paket-özellik matrisi (kod değişmeden modül bağlama) zaten `requireModulePage` ile var — UI'ı eklenebilir. | P1 |
| 33 | Fark yaratan 10 özellik | 🟡 | **Çoğunun temeli zaten kodda var — bu büyük avantaj:** Portföy Sağlık Skoru ✅ (derinleştir: "neden satmıyor" açıklaması) · Malik Güven Paneli 🟡 (bkz. #4 — P1) · Dijital parmak izi ❌ (P3, veri kaynağı sorunu) · Kayıp Satış Dedektörü ✅ (aksiyon eksik: arandı/ertele + görev) · Next Best Action 🟡 (koç paneli var — müşteri kartına tek öneri olarak taşı, P2) · Ofis Dijital İkizi 🟡 (dashboard + canlı akış — TV modu ekle) · Güven Ağı ❌ (MLS ile, P3) · Hizmet pazaryeri ❌ (P3, HGDekor köprüsü) · Finansman pazaryeri ❌ (P3, kredi hesaplayıcıyla başla) · AI ofis yöneticisi 🟡 (admin danışman var; tenant'a taşı, P2). | — |
| 34 | Paketler | ✅ | 4 plan + modül kapısı mevcut. Proje/Mülk Yönetimi paketleri modüller yazılınca eklenir. Paket-özellik matrisi admin UI'ı → P2. | P2 |
| 35 | Geliştirme önceliği | — | Vizyondaki 3 aşama mantıklı; aşağıdaki yol haritası buna kod gerçekliğini ekliyor. | — |

---

# BÖLÜM 4 — PAZAR ARAŞTIRMASINDAN EKLENMESİ ÖNERİLEN ÖZELLİKLER

Araştırılan ürünler: Follow Up Boss, kvCORE/BoldTrail, Lofty (Chime), Rechat, Propertybase, Sierra, Wise Agent, dotloop, Matterport; Türkiye: Emlapp, EmlakCRMx, Arveya, sahibinden Pro, EndeksA, Endeksper.

**Kritik (Türkiye pazarında fark yaratır):**
1. WhatsApp Business API — mesajlar müşteri kartına, şablonlar, ekip kutusu (Türkiye'nin fiili kanalı)
2. Dijital yer gösterme tutanağı + mobil imza (Emlapp'in öne çıkardığı, komisyon ihtilafı kanıtı)
3. "Evim ne kadar eder?" değerleme hunisi — satıcı lead'i toplayan markalı sayfa
4. AI ilan metni üretici ✅ (mevcut `ai-content` — portal formatı varyantlarıyla derinleştir)
5. Speed-to-lead: 5 dk SLA + otomatik karşılama + eskalasyon (leak-sla cron temeli var)
6. Drip kampanya / aksiyon planları — yeni lead'e otomatik dizi (otomasyon motoru genişletmesi)
7. Akıllı listeler (smart lists) — kendini güncelleyen segmentler ("7 gündür aranmayan sıcaklar")
8. Broker dashboard + kaynak ROI (hangi portala para harcanmalı)
9. Mobil saha paritesi (PWA derinleştirme)
10. Tek tık portal senkronu — **yalnızca resmî API/izinli ortaklıkla**

**Yüksek:**
11. AI lead skorlama (mevcut lead-score'a davranış sinyalleri) · 12. Satıcı niyeti tespiti (Lofty Homeowner AI) · 13. Dinamik CMA raporu (değerleme+emsal → markalı sunum) · 14. Davranış tabanlı kampanyalar · 15. Otomatik lead dağıtım kuralları · 16. FB/IG Lead Ads · 17. Komisyon→muhasebe aktarımı (Logo/Paraşüt) · 18. Randevu hatırlatma + malik bilgilendirme · 19. Matterport/360 gömme + tur izleme sinyali · 20. Pazarlama görsel stüdyosu · 21. Sosyal post otomasyonu ("satıldı" postu) · 22. Ofis/danışman web siteleri (vitrin genişletmesi) · 23. E-imzalı işlem dosyası (dotloop deseni)

**Orta:** Gamification liderlik tablosu · Power dialer/santral · Video mesaj · Açık ev QR check-in (temeli var!) · Bölge analizi raporu (EndeksA Atlas benzeri) · Açık API ekosistemi · ListingMachine (portföy başına otomatik pazarlama paketi)

---

# BÖLÜM 5 — ULTRA PREMIUM TEMA: KAPSAMLI LİSTE

## 5.1 Temel mimari (önce bunlar — diğer her şey bunun üstüne oturur)

1. **Semantik token katmanı** — ham palet (`--brand-600`) → semantik alias (`--accent`, `--accent-subtle`, `--success-bg/fg`, `--danger-bg/fg`, `--focus-ring-color`) → komponent. Beyaz etiket şu an yarım: marka rengi değişince `--brand-50` zeminler ve focus ring eski mavide kalıyor. `--focus-ring`'i `color-mix(in srgb, var(--accent) 35%, transparent)` yap.
2. **Radius skalası** — kodda 13 farklı köşe değeri var (9→30px). Tailwind v4 `--radius-*` token'ları zaten utility üretiyor: `rounded-control(10) / chip(8) / card(14) / panel(20) / hero(24)` — beş değere indir.
3. **Tek gölge sistemi** — eski `--shadow-card/lg` ile yeni `--elev-1..5` bir arada; dropdown/tooltip/toast/dialog farklı ailelerden besleniyor. Standart: popover→elev-3, toast→elev-4, dialog→elev-5, hepsi `--inner-top` ile.
4. **Merkezi Button komponenti** — şu an her ekran kendi butonunu inline yazıyor (radius 9/10/11/12px karışık, primary bazen düz bazen gradient). `variant=primary|secondary|ghost|danger`, press + focus + loading dahili. Gradient yalnız landing hero'da.
5. **Form alanı sistemi + hata durumu** — 3 farklı input reçetesi var ve **hiçbir input'ta error stili yok**. `input.tsx` + `FormField` (label 12px/600, hint, error text-danger-600 + halka). Stripe'ın form cilası ürün imzasıdır.

## 5.2 Somut düzeltmeler (kod denetiminden)

6. `:focus-visible`'daki `border-radius:4px` satırını sil (görsel bug); global outline'ı çift katman box-shadow'a (`--focus-gap` + `--focus-ring`) taşı, `.focus-ring` sınıfını kaldır
7. Palet ihlalleri: landing'deki `violet-500` (DESIGN.md "mor yok" der!) ve Tailwind varsayılan amber'ları temizle; `--amber-600/700` tanımla, metinde yalnız 600+; `@theme`'de `--color-*: initial` ile varsayılan paleti kapat
8. Sidebar bilgi mimarisi: 32 öğelik düz liste → 5 grup (Satış/Portföy/Finans/Analiz/Yönetim); 9px mikro etiketleri 11px'e, pasif link `text-white/70` (şu an %52 — AA altı); favoriler bölümü
9. `.theme-dark` !important'larını token override'ına çevir (landing'in koyu bölümleri için daha esnek kaskad)
10. Dört ayrı hover-lift (-2/-4/-6/-8px) → tek `.lift` (-2px + elev adımı, 0.2s); -8px sıçramalar oyuncaksı
11. Gradient enflasyonu: `--grad-brand` 8 yerde → 3'e indir (logo, hero CTA, tek showcase); panel içinde düz brand-600 + inner-top
12. Tipografi ölçeği: text-[9px]/[10px] yasak → 11px taban; uppercase etiket tek reçete `text-[11px] font-semibold tracking-[0.08em]`; hero H1 tracking -0.035em
13. CountUp'a `tabular-nums` (sayı titremesi) + `prefers-reduced-motion` kontrolü; büyük paralarda `min-width: Xch`
14. Toast cilası: giriş spring (translateY+scale+fade 0.32s), çıkış 160ms, ton ikonları, hover'da timer durur, `role=status aria-live`, sol kenar 3px ton çizgisi — **sonner** kalite referansı
15. Dialog/popover çıkışına 120-140ms animasyon (şu an anlık kapanıyor — "kesik" his)
16. Scrollbar: koyu sidebar'da açık gri thumb sırıtıyor; `scrollbar-color` (Firefox dahil) + koyu kapsam varyantı + `::selection` rengi
17. EmptyState ve CountUp duplikasyonlarını tekle (iki farklı versiyon yaşıyor)
18. PWA ikonları: manifest hâlâ Next şablonu `window.svg`; `icon.svg` (grad-brand "E" tile) + `apple-icon` + maskable 192/512
19. OG image'a Manrope 800 göm (şu an sistem sans-serif); twitter-image türet
20. Reveal'a opacity geçişi ekle (şu an yalnız kayıyor, solmuyor)
21. Panel padding `lg:p-8` + dikey ritim `space-y-6` sabit

## 5.3 Premium his katmanı (2025-26 araştırmasından)

22. **100ms kuralı** — her etkileşimin ilk görsel yanıtı 100ms içinde: buton `scale(0.97)` press, hover 150ms geçiş; tepki tıklanan öğenin kendisinde
23. **Optimistic UI** — toggle/görev tamamlama/durum değişiminde sunucuyu bekleme; hata olursa geri al + "tekrar dene" toast'ı (Linear'ın "anında" hissinin sırrı; roller matrisi zaten böyle — genelleştir)
24. **Toast + geri al deseni** — yıkıcı aksiyonlarda onay dialogu yerine anında uygula + 5-7 sn "Geri al" (Gmail modeli); silme onayları sorununu da premium çözer
25. **Skeleton disiplini** — yalnız 500ms+ yüklemede, gerçek yerleşimi birebir taklit (layout shift 0), shimmer 1.5-2s
26. **Sayı animasyonları** — odometre tarzı dikey kaydırma (fintech standardı); KPI formülü: büyük tabular sayı + % değişim rozeti + eksensiz sparkline (son nokta vurgulu) — mevcut sparkline'lar buna yakın, tooltip ekle
27. **Grafik dili** — gradyan dolgulu alan grafiği (üstte %20-25 → alta %0), grid çizgileri %4-6 opaklık, hover crosshair + tooltip, çizgi "çizilme" animasyonu (chart-draw zaten var — yaygınlaştır)
28. **Spring animasyon sistemi** — tüm projede 2-3 sabit konfigürasyon ('snappy', 'gentle'); yalnız transform+opacity anime et
29. **Stagger disiplini** — liste öğeleri 20-40ms arayla, maks ~15 öğe, yalnız ilk yüklemede
30. **Komut paleti 2.0** — mevcut Ctrl+K'ya eylemler ("yeni müşteri"), boş durumda son kullanılanlar, sonuç yanında kısayol rozetleri, kapsam genişletme (anlaşma/görev/randevu) + AI doğal dil sorgusu
31. **Klavye-öncelikli** — menü/tooltip'lerde kısayol rozetleri (monospace mini kutu), tek harf kısayollar (C=oluştur); mevcut g-chord sistemi iyi temel
32. **Bento hiyerarşisi** — dashboard'da eşit grid yerine ağırlıklı yerleşim: en kritik metrik 2×2, ikincil 1×1
33. **Progressive disclosure** — dashboard 5-9 çekirdek öğe; satır aksiyonları hover'da görünür; detay etkileşimle açılır
34. **Boş durum = onboarding yüzeyi** — soluk örnek + tek cümle insan sesi + TEK aksiyon; veya örnek veriyle doldur + "örneği temizle"
35. **Onboarding checklist** — 3-5 madde, ilki baştan tamamlanmış ("Hesabını oluşturdun ✓"), kutlama mikro-animasyonu; Ayarlar'daki kurulum %'si buna dönüştürülebilir (+%40 aktivasyon verisi)
36. **AI-native UI** — "AI" rozeti değil bağlam içi öneri; AI çıktısı düzenlenebilir taslak (kabul/düzenle/reddet); AI yanıtları streaming + 5 durum (loading/streaming/complete/error/confidence)
37. **Kutlama anları** — anlaşma "Kazanıldı"nda 600ms tek seferlik konfeti; checkbox SVG stroke çizimi; progress bar spring overshoot
38. **Renk perhizi** — UI iskeletinin %90'ı gri skaladan; vurgu yalnız birincil aksiyon + seçili durum + marka anı (mevcut Command Center dili buna uygun, sürdür)
39. **Mesh gradyan + grain** — hero/boş durumlarda 2-3 marka tonlu mesh + %3-5 feTurbulence grain (banding kırar); dashboard içinde yalnız tek vurgulu kartta
40. **Progressive blur** — sticky header/overlay'lerde 8-12px ince cam + mask-image kademeli blur; ağır buzlu cam dönemi bitti
41. **Rol bazlı dashboard** — danışman pipeline'ını, yönetici analitiği görür; kullanılmayan modüller sidebar'da aşağı iner

---

# BÖLÜM 6 — ÖNCELİKLİ YOL HARİTASI

## Faz 0 — Hemen (1-2 hafta, düşük çaba / yüksek etki)
1. StatCard'a `href` + tüm KPI grid'lerinin geçişi; liste sayfalarına filtre query parametreleri; **BÖLÜM 1'deki tüm tıklanabilirlik haritası**
2. Şifre sıfırlama akışı + "Şifremi unuttum" linki
3. Kırık akışlar: Ayarlar'a entegrasyon (Netgsm/WhatsApp) formu; roller matrisine eksik 6 modül; açık ev oluşturma butonu; askıda ekranına ödeme aksiyonu
4. `focus-visible` bug'ı, Kiril dosya adı, silme onayları (ConfirmDialog), tel:/mailto: linkleri
5. Vitrin/paylaş SEO+OG metadata + noindex + ilan açıklaması gösterimi (WhatsApp önizleme kartı = ücretsiz pazarlama)
6. Admin tenant arama kutusu

## Faz 1 — Çekirdek cila (2-6 hafta)
7. **Liste Standardı** her ekranda: filtre çipleri + sayfalama + sıralama + dışa aktarma + tarih aralığı + limit uyarısı
8. KPI'larda dönem karşılaştırması ("geçen aya göre %X"); grafiklere tooltip + drill-down
9. Dashboard: bugünkü randevular widget'ı, gerçek görev listesi, danışman/yönetici görünüm ayrımı
10. Malik portalı v2 (fotoğraf + istatistik + teklif onayı + danışman iletişim + haftalık rapor) ve Müşteri portalı v2 (tıklanabilir kartlar + beğen/geç + randevu onayı)
11. Yer gösterme tutanağı + telefonda imza; randevu çakışma kontrolü + otomatik hatırlatma
12. Sözleşme imzasına SMS OTP; imzalı PDF indirme
13. Otomasyon: kural sihirbazı + run log + vizyondaki 13 örneğin şablonlaştırılması
14. Hedef oluşturma UI'ı + tempo göstergesi; kayıp nedeni raporu; kaynak ROI raporu
15. Tema 5.1-5.2: semantik tokenlar, Button/Input sistemi, sidebar grupları, toast/dialog cilası, radius/gölge tekleştirme

## Faz 2 — Fark yaratanlar (1-3 ay)
16. Komut paleti 2.0 + optimistic UI yaygınlaştırma + onboarding checklist
17. WhatsApp Business API (mesaj → müşteri kartı, ekip kutusu, şablonlar)
18. Speed-to-lead SLA panosu + atama kuralları + FB/IG Lead Ads
19. Tenant AI asistanı (doğal dil arama + günlük brifing + görüşme özeti) — mevcut AI altyapısının tenant'a açılması
20. "Evim ne kadar eder?" değerleme hunisi + dinamik CMA raporu + fiyat uyarı motoru
21. Portföy listesinde harita görünümü + ilçe ısı haritası
22. Danışman cüzdanı + bordro PDF; e-fatura entegrasyonu; Logo/Paraşüt aktarımı
23. Vitrin: tema/alan adı/danışman sayfaları; tek portföy mikro sitesi; pazarlama görsel üretimi
24. CTI santral entegrasyonu (gelen aramada müşteri pop-up); PWA saha modu (kamera + sesli not)
25. Açık API v1 + webhook + API anahtarı yönetimi

## Faz 3 — Platformlaşma (3-12 ay)
26. MLS pilotu (franchise içi havuz → güven ağı) · Mülk yönetimi paketi (kiracı/tahakkuk/bakım) · Proje satış modülü · Belge OCR · AI koç + Next Best Action · Hizmet & finansman pazaryerleri · React Native · Çoklu dil · Rakip istihbaratı (yalnızca izinli veri)

---

---

# DURUM GÜNCELLEMESİ — 2026-07-26 (4 uygulama dalgası sonrası)

**TAMAMLANDI:** Bölüm 1 tıklanabilirlik master planının tamamı (~90 ekran) · Faz 0'ın tamamı (şifre sıfırlama, kırık akışlar, SEO/OG, tenant arama, roller matrisi, sidebar NAV_MODULES bug'ı) · Bölüm 5 temanın dark mode hariç tamamı · filtre kontratları çift taraflı · ConfirmDialog/Button/Input/StatCard-href altyapısı · malik portalı v2 (teklif onay/ret + fiyat geçmişi) · müşteri portalı v2 (beğen/geç + danışman iletişim + fotoğraflar) · hedef CRUD · kayıp nedeni + kaynak ROI raporları · dashboard gerçek dönem karşılaştırması + günaydın brifingi (AI opsiyonlu) + bugünkü randevular · CSV exportlar (portföy/gider/teklif/portal) · otomasyon motoru (cron + 6 olay tetikleyici + 11 şablon) · SMS OTP'li e-imza · "Evim ne kadar eder?" hunisi · danışman cüzdanı · portföy harita görünümü · fiyat düşüş bildirimi (V3) · pazarlık geçmişi (offer_rounds) · müşteri 360 birleşik zaman tüneli · Netgsm tenant entegrasyon formu. Migration'lar (060-063) dev DB'ye uygulandı. Deploy YAPILMADI (bilinçli — canlıya alma en son).

Kalan işlerin tam listesi sohbet kaydında ve aşağıdaki Faz 2-3 bölümlerinde; dış bağımlılıklılar (WhatsApp API, CTI, İYS, EİDS, portal API'leri) anlaşma/hesap gerektirir.

**EK GÜNCELLEME (aynı gün, dalga A+B — 22 ajan):** Liste standardı her ekranda (sunucu filtreleri, gerçek sayfalama, tarih aralıkları, toplu işlemler, sıralama) · SMS 2FA + giriş geçmişi + çöp kutusu · kullanıcı bazlı izin istisnaları + geçici yetki + admin kullanıcı detayı · performans (sorgu önbelleği, dynamic import, CVE kapanışı) · Playwright E2E (7 smoke) · 3D ultra premium dashboard (tilt kartlar, odometre, aurora hero, TV modu, widget gizleme, hover hızlı aksiyonlar) · tenant AI asistanı (/app/asistan) · belge OCR · bölge trendi + kira çarpanı + satış süresi tahmini · çift kayıt birleştirme sihirbazı · teklif→anlaşma + işlem dosyası (kapora/masraf) · sözleşme şablon galerisi + değişken sihirbazı + sürüm geçmişi · vitrin analitik + kayıtlı arama + QR + paylaş istihbaratı · PDF karne/bordro + değerleme paylaşım linki · admin dunning + ticket SLA/atama/makro + churn rozeti + cron sağlık panosu · **Mülk Yönetimi v1 (/app/kiralama)** · **Proje Satış v1 (/app/projeler)**. Migration 060-076 dev DB'de, 13 cron vercel.json'da. Kalan: yalnız dış hesap/anlaşma gerektirenler (B grubu) ve MLS mimari kararı.

**EK GÜNCELLEME (dalga C–L — toplam ~99 ajan):** Gerçek zamanlı bildirim/pano (Supabase Realtime) · AI asistan akışlı + onaylı aksiyon kartları · View Transitions + PWA offline · DnD kanban · birleşik gelen kutusu (/app/gelen-kutusu) · Ofisler Arası Ağ MLS v1 (/app/ag, maskeli DTO) · CSV içe aktarma sihirbazı · emsal motoru + fiyat sağlığı · atomik müşteri birleştirme RPC · anlaşma notları · AI aksiyon kalıcılığı · rezervasyon vadesi · **Dalga L:** talep detay sayfası (/app/talepler/[id], skorlu eşleşmeler) · açık ev QR self check-in (/acik-ev-kayit/[token], migration 098) · eşleştirme ağırlıkları tüm skor tüketicilerinde (fetchTenantMatchingWeights tek kaynak) · tenant bildirim arşivi (/app/bildirimler) + kayıp satışta çağrı kaydı · mobil saha çekimi (kamera + EXIF-korumalı küçültme + ilk foto=kapak fix). Migration 060–098 dev DB'de, 15 cron, 113 rota, 170 birim + 28 E2E test — tümü yeşil. Kalan: dış hesap gerektirenler (WhatsApp/CTI/İYS/portallar) + deploy (en son, docs/DEPLOY_CHECKLIST.md).

**EK GÜNCELLEME (dalga M — 5 ajan + kanıtlama):** Talep-Arz Haritası raporu (/app/raporlar/talep-arz: il denge haritası + ilçe boşluk analizi "Fırsat: portföy topla / Talep üret") · ICS takvim aboneliği (/api/takvim/[token], Google Takvim linki, "Linki yenile") + randevu çakışma freni ("Yine de kaydet" akışı, create+update) · portföy sunum dosyası (/app/portfoyler/sunumlar + /sunum/[token] markalı public sunum, yazdır=A4 PDF, görüntülenme sayacı) · müşteri sıcaklık segmentasyonu (0-100 skor, Sıcak/İlgili/Soğuk/Uykuda rozetleri + ?segment= filtre + toplu "Yeniden ısıt" görevi, tek RPC ile N+1'siz) · vitrin ISR invalidation düzeltmesi (publish→revalidatePath) · geo tutarlılık cron'u (16. cron, çeyreklik) · TCMB kur backfill scripti (npm run kur:backfill). Migration 099–102 dev DB'de. Durum: 116 rota, 180 birim + 33 E2E test, build/lint/tsc/link kontratı yeşil.

**EK GÜNCELLEME — 2026-07-27 (dalga N — 5 ajan + kanıtlama):** Anlaşma evrak kontrol listesi (satılık/kiralık şablonları, ilerleme çubuğu, kanban "3/7" rozeti, migration 103) · NPS müşteri memnuniyet anketi (/anket/[token] public 0-10 + /app/raporlar/memnuniyet NPS raporu, düşük puanda anında uyarı, migration 104) · Günün rotası (/app/randevular?gorunum=rota: durak listesi + numaralı harita + "Sıkışık geçiş" uyarısı + Google Maps yol tarifi) · Vitrin v2 (benzer ilanlar ±%30, favoriler localStorage + /vitrin/[slug]/favoriler, "Fiyat düşünce haber ver" alarmı + vitrin-alarm cron'u, migration 105) · Ofis duyuru panosu (/app/ayarlar/duyurular + dashboard bandı + okundu takibi, migration 106). Durum: 120 rota, 103–106 migration'lar dev DB'de, 17 cron, 188 birim + 38 E2E test (32 passed / 3 retry-yeşil / 3 bilinçli skip), build/lint/tsc/link kontratı yeşil.

---

## Ek — Dokümantasyondan doğrulanan açık işler (docs/ROADMAP_V2 vd.)
Playwright E2E sıfır (Q1b) · sharp/postcss CVE kapanışı (F3) · CRON_SECRET zorunlu işaretleme (F4) · sır rotasyonu (F5) · randevu dedupe (Wave 2-3) · JWT impersonation (Wave 2-3) · TCMB backfill scripti (V1) · fiyat düşüş bildirimi (V3) · kira çarpanı/yield (D4) · talep-arz haritası (D6) · use cache/ISR yaygınlaştırma (P4/P5) · çeyreklik geo-sync cron'u · yedekleme provası (Q5).

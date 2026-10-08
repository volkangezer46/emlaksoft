# Uzman Konseyi — Dalga 1 bulgu özeti (2026-10-08)

## UI/UX (statik)
- P1 Admin geneli ham düğme/girdi/filtre (geo, billing, tufe, aktivite, merkez): Button/Input/FilterBar dışı, 28-36px, kimi focus-ring'siz.
- P1 `_home/ust-bolum.tsx:67` bileşende `new Date()` (clock kuralı) + sabit red-600/amber-700 (koyu tema).
- P1 /admin/tickets tablo min-w 1120px mobil; yetkilendirme/roller/talep-arz geniş sabit tablolar.
- P2 dokunma hedefi karışık (32/36/40/44): ekip-performans:34, profil-tamamla:66, portfoy-sagligi:78, ornek-veri-yenile:42.
- P2 üç tablo dili (pm-tbl, adm-tbl, Table); `confirm()`/`prompt()` (logo-upload-form:40, survey-actions:20).
- P2 admin çip düğmeleri ~26px; billing grid min-w-0; aktivite min-w-420; tenant-table truncate yok; admin boş durumlarda CTA yok.

## Türkiye pazarı (kaynaklı; Sahibinden/Hepsiemlak fiyatları DOĞRULANMADI)
- Yasal: EİDS (tüm online ilanlarda yetki doğrulaması, 30.09.2026 entegre liste), TTBS yetki belgesi sorgu, İYS onayı, KVKK md.10.
- Rakip şikayetleri (Emlakjet): izinsiz otomatik yenileme, beklenmedik ücret, sahte ilan, e-Devlet doğrulama sorunları.
- Öneriler (Y): portföyde EİDS/yetki durumu + yetkisiz ilan uyarısı; ofis yetki belgesi son tarih hatırlatma; yetki bekleyen portföy kuyruğu (mal sahibine e-Devlet hatırlatma); İYS onay kapısı (toplu SMS/e-posta öncesi); KVKK rıza/talep/saklama; portal abonelik/maliyet takibi (ilan başına maliyet). (O): çoklu portal senkron + sil-ekle tespiti; doğrulanmış ilan rozeti; şeffaf iptal/yenileme bildirimi.
- NOT: repo'da mevcut olanlar (KVKK talepleri, İYS, mevzuat uyum, portal teyit) önce doğrulanmalı — mükerrer yapılmamalı.

## Dünya pazarı (üçüncü taraf kaynaklı)
- Rakip zaafı: AI eklenti duvarı + opak fiyat (FUB, BoldTrail, Lofty) → EmlakSoft: AI kotası pakete dahil, fiyat açık.
- (Y) davranış tabanlı "bugün ara" sırası (insights kuralı, kanıtlı); AI ilk temas/takip taslağı (insan onaylı, varsayılan kapalı); sahada sesli not → AI özet (KVKK rızası); müşteri portalında tapu süreci ilerleme çubuğu (ekspertiz, TKGM randevu, DASK, harç).
- (O) AI eylem denetim ekranı; randevu öncesi hazırlık kartı; emsal CMA paylaşılabilir rapor; lead routing (ilçe/uzmanlık/SLA yeniden atama); AI kota göstergesi; çağrı+WhatsApp tek zaman çizelgesi.
- (D) ofis ligi (P12 gizlilik kararına bağlı); no-code otomasyon şablon galerisi.

## Ürün sorgulayıcı (menü + ana ekran)
- (Y) Ana ekranda ilan sağlığı 4 yerde (PortfoySagligi page.tsx:400 rol süzgeçsiz, KayipKacak, PortalSagligi, Dikkat teyitsiz) → tek "İlan sağlığı" bloğu.
- (Y) Portal ilanları (/app/portallar) → İlan Kontrol sekmesi (aynı modül).
- (Y) Ofis başlığı 11 öğe → çekirdek (Ekip, Abonelik, Yardım) + "Yönetim" grubu; Ofis Merkezi/Ekip Merkezi/Ayarlar çakışması.
- (Y) Danışman "kimi arayayım" 3 kaynak (Bugün ara, Sıradaki eylem, Akıllı Listeler) → tek kaynak; Teklifler → Anlaşmalar sekmesi (danışman çekirdeğine girer).
- (Y) Ana ekran 5 bant + profil kartı + kurulum şeridi + BosOfisKapisi → tek "Başlangıç" kartı; menü/blok tıklama ölçümü ekle.
- (O) Raporlar 8 sekme; Kâr-zarar Giderler'le mükerrer; Ekip karnesi Özet/Kıyas örtüşme; Gelen Kutusu → Müşteriler; Ayarlar Roller+Yetkilendirme → "Erişim"; mobil alt sekmede Gelen Kutusu yok.
- (D) hizli bloğu çıkar; menüden Bildirimler çıkar (zil var); niş modüller varsayılan kapalı; Değerleme+Hesaplayıcılar+Kira artışı birleşimi.

## Test + hız
- Canlı TTFB 0.34-0.56 sn (ağ dahil), health DB 57 ms. Yapısal bulgu: `/vitrin/[slug]` CDN'de önbelleklenmiyor (private,no-store) → ISR/tag revalidate (neden dynamic olduğu incelenmeli). Ana sayfa HTML 743 KB (sıkıştırmasız; RSC payload incelenmeli).
- Test boşlukları: profile-completion-data, insights/lifecycle-facts, kural başına testler (price-action, deal-risk), parsePlanForm/public-pricing.
- Statik: Date.now render adayları (dues-client.tsx:189,286 öncelikli; notification-bell*, communication-timeline); network.ts:597,695 ipucusuz properties gömmesi (FK sayısı doğrula); geo/appointments-suggest/confirm auth doğrula; admin-ticket-ops.ts:85 hata mesajı istemciye mi.

## Persona akış testi (canlı, salt-okunur)
- KRİTİK: vitrin ilan detayında iletişim yolu yok ("Talep formu şu anda kapalı", tel/WhatsApp yok) — `vitrin/[slug]/[id]/page.tsx:711-720` (leadOpen && lead_capture_token). Form kapalıysa telefon/WhatsApp yedeği şart.
- (O) harita boş gri blok + yinelenen iki bağlantı; fotoğrafsız ilan yer tutucusu; mobilde filtre paneli ilk ekranı kaplıyor (katlanır yap); vitrinde etiketsiz 1 girdi + ~20 küçük hedef; PhoneInput ülke listesi DOM'a gömülü (yalnız açılınca render).
- (O) /kayit adım 1'de güven satırı (kart gerekmez, N gün) yok.
- (D) 404 sayfasına bağlantılar; favoriler boş durum; /fiyatlar mobil sabit CTA.
- Genel olumlu: 200, tek H1, taşma yok, kırık görsel yok.

## Güvenlik (DÜZELTİLDİ 2026-10-08, migration'lar uygulanmadan önce)
- 000800 fiyat kapısı: NULL ara adımı + kümülatif küçük düşüşler → referans = son 30 gün en yüksek liste fiyatı, NULL'a çekmek düşüş sayılır (+2 pglite testi).
- 000900 proxy_gate_snapshot: p_user_id yalnız auth.uid() (service_role hariç).
- plan-change-paid-cap: 0 TL dönemde kredi tavanı 0.
- AÇIK (karar/sonraki dalga): kayıtta e-posta doğrulaması yok (email_confirm:true) — sahip kararı; kayıtta kimliksiz ekip daveti (kayıt anında gönderme, sonra gönder); kayıt hız sınırı yalnız IP (e-posta+global+captcha); duraklatma salt-okunurluğu yalnız uygulama katmanı; schedule_downgrade RPC gizli plan kontrolü; plan_upgrade çift fatura idempotency; hesap kredisi tutar tavanı/ikinci onay; platform MFA yayın öncesi.

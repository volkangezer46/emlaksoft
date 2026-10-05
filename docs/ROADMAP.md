# EmlakSoft — Yol Haritası (tek güncel kaynak)

> Bu dosya TEK yol haritasıdır. Eski planlar `docs/arsiv/` altındadır (ROADMAP_V2, MASTER_PLAN,
> sprint belgeleri) ve yalnız tarihsel referanstır. Bugünün sayıları: `docs/DURUM.md`.
> Deploy sırası: `docs/DEPLOY.md`. Ürün/özellik envanteri (tıklanabilirlik, faz 0–3 kırılımı):
> `docs/OZELLIK_MASTER_LISTESI.md`.
>
> Durum işaretleri: `[x]` bitti · `[~]` kısmen/sürüyor · `[ ]` açık.
> Öncelik: **P0** yayın/güvenlik kritik · **P1** yakın dönem · **P2** sonra · **DIŞ** dış hesap/anlaşma bekliyor.

## Hedef ve değişmez kurallar

Ticari beta (güvenilir "Ofis paketi") → tam vizyon. Uygulama canlıda: https://emlaksoft.vercel.app.

- Portal scrape yok (ilan no/URL + periyodik teyit + kapanış formu); TAKBİS/tapu kazıma yok.
- Kendi foundation model yok: API + RAG + insan onayı.
- Tamamen Türkçe arayüz; her ekran premium standart; sıfır çıkmaz metrik (her sayı tıklanabilir).
- Multi-tenant: cache/realtime'da `tenant_id` izolasyonu zorunlu.
- Migration'lar forward-only; uygulanmış dosya değiştirilmez.

## 1. Tamamlananlar

| Durum | İş | Kaynak/kanıt |
|---|---|---|
| [x] | Omurga: müşteri/talep/portföy/randevu/anlaşma/komisyon + kayıp-kaçak kalkanı | eski S0–S6 (arşiv) |
| [x] | Değerleme emsal motoru, bölge trendi, TCMB kur, fiyat düşüş bildirimi | arşiv ROADMAP_V2 D1/D2/V1/V3 |
| [x] | Otomasyon motoru, AI asistan (onaylı aksiyon), vitrin, token'lı portallar, Kiralama, Projeler | OZELLIK_MASTER_LISTESI |
| [x] | Sözleşmeyle doğrulanan cron envanteri (`vercel.json`, `npm run check:cron`) | git log, vercel.json |
| [x] | Release-hardening: kimlik/oturum, webhook/public akış, atomik faturalama, ticket SLA, migration ledger | git log (667c1bd, a334104) |
| [x] | Next 16.3.8 + sharp 0.35.5 (critical advisory'ler kapandı) | `package.json`, c2fa218 |
| [x] | Tasarım sistemi v3 (token sözleşmesi, ortak bileşenler, koyu tema dosyası `theme-dark.css`) | 4f79cb7; sözleşme testi `design-tokens-contract.test.ts` |
| [x] | Menü 55 linkten 9 iş başlığına indirildi (sekme çubuğu + açılır alt sayfalar) | 0b5c59f |
| [x] | Paket kilidi (26 sayfa), yükseltme sayfası, menüde kilit simgesi, sidebar'da paket/kullanım girişi | a72df60, a195713 |
| [x] | RLS performans düzeltmesi: `(select ...)` InitPlan sarmalama + geri alma SQL'i | 9cacb89, 56d3373 |
| [x] | PostgREST PGRST201: 113 gömülü sorguya FK kısıtlama adı | 175aa01, 980d95e |
| [x] | Dışa aktarma: 2000 satır kesintisi bildirimi + audit_logs kaydı | 5c71df8 |
| [x] | Production demo girişi için açık opt-in bayrakları (varsayılan kapalı) | bc0f170 |
| [x] | Migration zinciri canlıda: `20260826000800`a kadar uygulandı (2026-10-05); yeni 000900/001000/001100 bekliyor | `docs/HAFIZA.md` §2; `npm run check:migrations -- --database` |
| [x] | Faturalama genişlemesi (canlı): EF kontör cüzdanı + paketleri, TL hesap kredisi + kredi ile fatura ödemesi, referans programı (müşteri-getir-müşteri; ortak/nakit KAPALI), kayıtlı kart (otomatik yenileme KAPALI), admin muhasebe merkezi, ortak API v1 kodu | `docs/HAFIZA.md` §2/§6/§10/§11 |
| [x] | Modül sistemi (ofis bazlı aç/kapat), SEO merkezi + robotu, plan okuyucu, kupon, K5 hesap/abonelik/ekip/şube/uyum, bakım modu, TV modu, telefon tek merkez | `docs/DURUM.md` "2026-10-03/04 turu"; `docs/MIMARI.md` |
| [x] | Dalga 1 tutarlılık: örnek veri KPI eşiği tek yardımcı, TR ay sınırları, rol etiketi tek kaynak, terim sözlüğü, "kayıp" üç kavram | `sample-scope.ts`, `clock.ts`, `role-labels.ts`, `terminology.ts` + sözleşme testleri |

## 2. Açık işler

### P0 — Güvenlik ve yayın güveni
- [ ] **Secret döndürme (eski F5):** public Git geçmişinde yer alan legacy `service_role` için yeni
  `SUPABASE_SECRET_KEY`; Vercel/yerel ortam güncelle; legacy anahtar + DB parolasını döndür; eski anahtarın
  reddedildiğini doğrula; ardından koordineli geçmiş temizliği. (Sahip kararı, aşağıya bakın.)
- [ ] **Yedek/PITR doğrulaması ve restore provası** (eski Q5): `docs/runbooks/RESTORE.md` adımlarıyla prova.
- [~] **Tenant izolasyonu:** RLS audit (`npm run db:rls-audit`) ve ilişki denetimi var; cache/realtime/ortak
  admin-client yollarında sürekli doğrulama ve canlı DB üzerinde yeniden koşum açık.
- [ ] CI'da `npm ci` + audit kapılarının yeşil olduğunun Actions'tan teyidi (doğrulanmadı).
- [ ] **Ödeme operasyonu (2026-10-05):** `IYZICO_BASE_URL` canlı değeri, `PLATFORM_MFA_ENFORCEMENT=on`, `ADVISOR_PII_KEY` (DEPLOY.md zorunlu env tablosu); iyzico iadesi elle (`docs/runbooks/IYZICO_IADE.md`); günlük `manual_review`/`refund_required` kontrolü; dış uptime izleyici.
- [ ] **Yeni migration'lar:** `20260826000900`, `001000` (büyüme paneli owner/gm rol kapısı), `001100`: `docs/runbooks/YAYIN_PENCERESI_2.md` §8.
- [ ] **Admin "Hesap kredisi yükle/geri al" ekranı:** service_role allowlist kararı bekliyor (HAFIZA §3).

### P1 — Ürün
- [ ] **Türkiye uyum paketi:** EİDS tamamlama (iskelet var), İYS entegrasyonu, GİB BTRANS raporlama
  (Taşınmaz Ticareti Yönetmeliği), KVKK akışlarının sağlamlaştırılması. `[~]` iskeletler mevcut, resmi entegrasyon yok.
- [~] **Wizard'lar:** (kuruluş sihirbazı `/app/baslangic` yapıldı)  kuruluş/ilk kurulum, portföy ekleme, talep→eşleşme→randevu→anlaşma akışları için
  adım adım sihirbazlar (CSV içe aktarma sihirbazı mevcut — `[x]`).
- [~] **AI katmanı:** asistan + onaylı aksiyon kartları + belge OCR mevcut; çok dilli ilan çevirisi,
  portföy sağlık skoru, AI kalite/maliyet gözlemi açık.
- [~] **Tasarım sistemi v3 yayılımı:** token katmanı var; sayfa şablonları (liste/detay), yazdırma/PDF görünümü,
  kalan sayfaların bileşenlere bağlanması sürüyor.
- [~] **Performans:** index kapsamı, streaming/Suspense, RSC payload küçültme, CWV kapısı (arşiv P3/P4/P9/P10).

### P2 — Sonra
- [ ] Ofis web sitesi builder (tema, alan adı, SEO, 360° tur, WhatsApp widget).
- [ ] MLS / Ofisler arası havuz — komisyon paylaşım, çapraz eşleştirme (v1 `/app/ag` var; tam model karar bekliyor).
- [ ] Ofis kıyaslama (X11) ve referans ağı (R9): kiracılar-arası anonim veri → mimari + sözleşme kararı.
- [ ] Telefon CRM (arayan tanıma), PWA push/offline derinleştirme, uluslararası portal yayını.
- [ ] Randevu dedupe, JWT impersonation sertleştirmesi (arşiv "Wave 2-3").

### DIŞ — Dış hesap/anlaşma bekleyenler
- [ ] **WhatsApp Business** (Meta hesabı) — kod iskeleti hazır, aktivasyon hesap gerektirir.
- [ ] **Portal API'leri** (Sahibinden/Hepsiemlak/…): yalnız kurumsal sözleşme + doğrulanmış base URL ile.
- [ ] E-posta gönderim sağlayıcısı seçimi, CTI, e-fatura, İYS/EİDS resmi erişim.

## 3. Kullanıcı kararları

- **Ertelenen güvenlik işleri sahibin sorumluluğundadır:** secret/anahtar döndürme, DB parolası, Git geçmişi
  temizliği, canlı ortam/Vercel env değişiklikleri ve yedek doğrulaması proje sahibi tarafından yürütülür.
  Ajanlar/otomasyon bunlara dokunmaz; bu belgede `[ ]` olarak açık tutulur.
- Deploy sırası: önce veritabanı migration'ı, sonra kod (`docs/DEPLOY.md`).
- Demo bayrakları (`PRODUCTION_DEMO_LOGIN_OPT_IN`, `PRODUCTION_PLATFORM_DEMO_OPT_IN`) yalnız geliştirme aşamasında açık.
- Portal scrape yapılmaz; AI yalnız insan onayıyla aksiyon alır.

## 4. Çelişkiler / doğrulanması gerekenler

- ÇÖZÜLDÜ: `CLAUDE.md` artık koyu temayı tanımlar (yalnız /app ve /admin, `html[data-theme="dark"]`, `src/app/theme-dark.css`, tercih sistem/açık/koyu; vitrin ve portallar hep açık). Eski "dark mode YOK" notu geçersizdir.
- ÇÖZÜLDÜ: cron sayısı `CLAUDE.md`, `vercel.json` ve `src/app/api/cron` altında 33'tür (güncel; 28. cron `seo-robot` idi); `npm run check:cron` doğrular.
- AÇIK: `tenant_reporting_aggregates` ve `tenant_commission_aggregates` RPC'leri `is_sample` süzmez (örnek veri KPI eşiği bunlara uygulanamıyor, yalnız etiketlenir); süzgeç için migration gerekir. Ayrıntı: `docs/DURUM.md` "Açık riskler".
- AÇIK: musteriler paketindeki "Lead skoru" metinleri ve modül kayıt defterindeki "Kayıp nedenleri" etiketi (`src/lib/modules/registry.ts`, `lost_sales`) yeni adlara ("Aday skoru", "Risk altındaki müşteriler") sahiplerinin birleşiminde çekilmeli.
- Eski devir belgeleri "secret rotasyonu bitmeden deploy yok" der; uygulama bu arada canlıya alınmış. Rotasyon açık (P0).

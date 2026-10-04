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
| [x] | Migration zinciri canlıda (kullanıcı bildirimi: 176; depoda 177 dosya — fark için `docs/DURUM.md`) | `npm run check:migrations -- --database` ile doğrulanmalı |

## 2. Açık işler

### P0 — Güvenlik ve yayın güveni
- [ ] **Secret döndürme (eski F5):** public Git geçmişinde yer alan legacy `service_role` için yeni
  `SUPABASE_SECRET_KEY`; Vercel/yerel ortam güncelle; legacy anahtar + DB parolasını döndür; eski anahtarın
  reddedildiğini doğrula; ardından koordineli geçmiş temizliği. (Sahip kararı, aşağıya bakın.)
- [ ] **Yedek/PITR doğrulaması ve restore provası** (eski Q5): `docs/runbooks/RESTORE.md` adımlarıyla prova.
- [~] **Tenant izolasyonu:** RLS audit (`npm run db:rls-audit`) ve ilişki denetimi var; cache/realtime/ortak
  admin-client yollarında sürekli doğrulama ve canlı DB üzerinde yeniden koşum açık.
- [ ] CI'da `npm ci` + audit kapılarının yeşil olduğunun Actions'tan teyidi (doğrulanmadı).

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

- Proje talimatları (`CLAUDE.md`) "dark mode YOK" der; tasarım sistemi v3 çalışması "koyu tema" olarak anıldı ve
  `src/app/theme-dark.css` mevcut. Kod incelendiğinde `.theme-dark` bölüm sınıfı olarak kullanılıyor görünüyor
  (sayfa geneli tema anahtarı olup olmadığı doğrulanmadı). Karar sahibe aittir.
- `CLAUDE.md` "13 cron route" yazar; `vercel.json` 28 zamanlama ve `src/app/api/cron` altında 28 route içerir.
- Eski devir belgeleri "secret rotasyonu bitmeden deploy yok" der; uygulama bu arada canlıya alınmış. Rotasyon açık (P0).

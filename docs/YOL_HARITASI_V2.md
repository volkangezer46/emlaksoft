# Yol Haritası v2 (360° inceleme, 2026-10-02)

Kaynak: 6 salt-okunur gözlemci (durum envanteri, mükerrer işlevler, UI/UX, hız, kalite ağı, ürün/satış).
Bulgular kod ve dosya adı okumasına dayanır; render/ekran görüntüsü yoktur. "Doğrulanmadı" ibaresi olanlar uygulamadan önce kontrol edilmelidir.

## 1. Şu ana kadar yapılanlar (özet)

- Omurga: müşteri, talep, portföy, randevu, anlaşma, komisyon, kayıp-kaçak kalkanı, değerleme, otomasyon, AI asistan, vitrin, portallar, kiralama, projeler.
- Platform: 27 cron (`vercel.json` ile birebir), migration ledger (178 dosya), atomik faturalama, outbox, WhatsApp Cloud sağlama.
- Güvenlik: admin client kabul listesi, tenant envanteri, CSV enjeksiyonu ve yükleme düzeltmeleri, OpenAI tek istemci + kişisel veri maskeleme.
- UI: tasarım sistemi v3, koyu tema (/app, /admin), menü 55 → 9 başlık, sayfa bazlı paket kilidi (26 sayfa), yeni ana ekran, PageHeader'lı 5 liste, kurulum sihirbazı.
- Hız: RLS InitPlan sarmalama (251 politika), RLS yardımcıları plpgsql (27 ms → 2,6 ms), paralel sorgular, istek içi cache, grafik ayrıştırma.

## 2. Gözlemci bulguları

### UI/UX (tahmini puan)
| Alan | Puan | Ana bulgu |
|---|---|---|
| Sistem-kullanım kopukluğu | 4/10 | PageHeader 7 dosyada, /app altında 87 ham `<h1>`; yasak `rounded-[6px]` 64 yerde, `text-[13px]`, `text-zinc-*` 19 yerde |
| Token disiplini | 6/10 | İki paralel gölge ölçeği; globals.css 1.794 satır |
| Erişilebilirlik | 6,5/10 | amber-600 ve mint-500 metin AA altı; ikon düğmelerinde aria-label az |
| Yükleniyor/boş durum | 7,5/10 | ~90 loading.tsx iyi; EmptyStateV3 yalnız 31 sayfada |
| Komut paleti/geçişler | 5/10 | CommandSearch yalnız arama; admin'de ayrı palet; view transitions kapalı |

### Mükerrerlik
- WhatsApp bağlantı üreticisi 3 yerde (`lib/phone.ts`, `lib/whatsapp-link.ts`, elle `wa.me`); `_home/canli-akis.tsx` ülke kodu normalizasyonu yapmıyor (hata riski).
- İki skeleton kütüphanesi (`components/app/skeleton.tsx` 24 kullanım, `components/ui/skeleton.tsx` 3).
- Ölü bileşenler: `StatRow`, `EmptyStateV3` (kullanım 0), `AnnouncementsBanner`.
- Örtüşen sayfalar (menü 54 öğe): danisman-kpi + lig, kayip-kacak + kayip-satis, bolge-analizi + raporlar, anlasmalar + komisyon + cuzdan + onaylar, kira-artis + kiralama, hesaplayici + yatirim, brifing + ana ekran.

### Hız
Büyük kısmı zaten yapıldı. Kalan: liste sayfalarında Suspense yok (54 sayfa), raporlar tek RPC'ye bağlı, indeks önerileri ölçüm bekliyor, `paket` için loading.tsx yok, `CHART_COLORS` recharts'lı dosyada.

### Kalite ağı
CI geniş (gitleaks, linkler, migration, cron, action denetimi, tsc, eslint, vitest, audit, public e2e, build). Eksik: zamanlanmış koşu, canlı RLS çapraz-tenant testi, webhook davranış testleri, oturumlu e2e, a11y/görsel regresyon, bundle bütçesi, coverage.

### Ürün/satış
En çok beklenen ve eksik: ilan portalı içe/dışa aktarma (XML/CSV), WhatsApp Business çift yönlü gelen kutusu, "ilk 10 dakika" içe aktarma sihirbazı, hız-to-lead (5 dk kuralı), PWA, e-fatura. Riskler: Sahibinden resmi API yok, WhatsApp onay süreci haftalar sürer, KVKK (tapu OCR, TC), resmi e-Devlet API'si yok (vaat edilmemeli).

## 3. Yapılacak iş listesi

### Faz 1 — Bu tur (düşük risk, otomatik doğrulanabilir)
- [x] `/app/baslangic` menüye bağlandı
- [x] Komisyon tavan uyarısı simülatöre eklendi
- [ ] Tasarım disiplini: yasak sınıf sözleşme testi + temizlik, ham h1 → PageHeader
- [ ] Gölge ölçeğini tekle, amber/mint metin tonlarını AA'ya çek
- [ ] WhatsApp tek kaynak; skeleton tekleme; ölü bileşen temizliği
- [ ] Komut paleti birleştir ve genişlet; view transitions doğrula
- [ ] Talepler ve kayıp-kaçak Suspense bölünmesi; `paket/loading.tsx`; `CHART_COLORS` taşıma
- [ ] Nightly CI, webhook davranış testleri, komisyon özellik testi, bundle bütçesi, `_tmp-*` temizliği
- [ ] DURUM.md / ROADMAP.md güncel

### Faz 2 — Onay bekleyen (izin/paket/cache etkisi var)
- [ ] Ekip performansı sekmeleri (danisman-kpi + lig), kayıp birleşimi, bölge + raporlar
- [ ] Finans sekmeleri (komisyon + cüzdan + onaylar), kira-artis → kiralama
- [ ] hesaplayici + yatirim sekmeleri, brifing → ana ekran kartı
- [ ] Yol: eski adresler için yönlendirme, `page-gates.ts` ve izin modülü uyumu

### Faz 3 — Ürün
- [ ] İçe aktarma sihirbazı (Excel/CSV) + ilk komisyon hedefi
- [ ] Hız-to-lead (5 dk kuralı, round-robin)
- [ ] İlan XML/CSV dışa aktarma (portal)
- [ ] WhatsApp çift yönlü gelen kutusu (Meta onayı sonrası)
- [ ] Yoğunluk anahtarı + mobil kart tablo, tenant vurgu rengi

### Güvenlik / operasyon (kullanıcı tarafından ertelenmiş)
- [ ] Sızan gizli anahtarların döndürülmesi, Git geçmişi temizliği
- [ ] Canlı RLS çapraz-tenant testi (izole test DB)
- [ ] Tapu OCR görselinin OpenAI'a gitmesi için açık rıza/KVKK
- [ ] Yedek/PITR kanıtı, demo personel hesaplarının kaldırılması
- [ ] İndeks önerileri (`supabase/proposed/`) büyük tenant'ta `EXPLAIN` ile doğrulanınca

## 4. Otomatik kontrol (sürekli)
Her birleşmeden sonra: `type-check`, `lint`, `vitest`, `check:links`, `check:cron`, `audit:actions`, `check:migrations`, `audit:deps`, `build`. Bu turda nightly iş akışı ve bundle bütçesi eklenir.

## 5. Tanım yönetimi (taranan bulgular ve kararlar, 2026-10-02)

Tarama: ofis düzeyi sabit listeler, mevcut ayarlar paneli, platform düzeyi parametreler.

**Mevcut iskelet:** `definitions` tablosu (global + ofise özel, ofis satırı global değeri ezer), `getDefinitions`, `/app/ayarlar/tanimlar`. 9 kategori: müşteri tipi/kaynağı, portföy tipi, işlem tipi, sözleşme tipi, gider kategorisi, randevu tipi, talep aciliyeti, destek kategorisi.

**Tespit edilen sorunlar:** `lookup_values` ile çift şema (daire/Daire); sabit kopyalar (`lead-sources.ts`, `expense-categories.ts`, ekleme diyaloğu varsayılanları); sıralama/renk düzenleme/denetim kaydı yok; kullanımdaki değer silinebiliyor; global kayıt ofiste gizlenemiyor; kategori listesi 3 yerde. Platform tarafı: `plans.ts` ile `plan_entitlements`, `permissions.ts` ile `permission_defaults` çift kopya; fiyat, kilit, mevzuat parametreleri kodda; ortak `platform_audit_log` yok.

**Kararlar (kullanıcı):**
- Bu tur: yalnız "çift kaynağı bitir" (kod) + gider kategorisi enum → text ve randevu tipi CHECK kaldırma migration'ı (yazılır, dry-run; canlıya yalnız backup/PITR doğrulanınca ve ayrı onayla).
- Mevzuat parametreleri: süper admin + ofis sahibi override (uyarılı). Tasarım ayrı turda.
- Özel pipeline aşamaları ve özel alan/etiket: ayrı tur, önce tasarım belgesi, onay sonrası.

**Sonraki tur adayları (onaya bağlı):** kayıp/iptal nedeni dropdown, ofis eşik ve komisyon varsayılanları (`tenant_settings`), `platform_audit_log`, `plans`/`page_gates` tabloları (yürürlük tarihli, sürümlü), özellik bayrakları, sistem anahtarı kilidi (`is_system`).

# /admin genişleme planı (2026-10)

Sahip isteği: "adminde çok fazla menü ve işlevsellik olacak buna göre planla ve uygula. her gözle gör düzenle geliştir
yapılandır ve herşeyi tamamla" · "admin herşeye hakim olmalı" · "iç içe bindirmeye gerek yok" (alt menüler satır içi
açılır; üst üste binen açılır pencere yok).

Bu belge (1) dünya standardı çok kiracılı SaaS operatör konsolunun kapsamını EmlakSoft'la karşılaştırır, (2) eksik ya
da kısmi alanlardan bu turda yapılanları ve veri kaynaklarını, (3) kalan işleri sıralar.

Kıyas alınan konsollar: Stripe Dashboard (gelir, tahsilat, iade, denetim), Intercom / Zendesk admin (talep, makro, SLA,
CSAT), Vercel ve Supabase (kuyruk, cron, günlük, yedek, ortam), Shopify admin (mağaza 360, uygulama/entegrasyon,
bayrak), HubSpot (müşteri sağlığı, yaşam döngüsü, görev).

Durum: **var** = gerçek veriyle çalışan ekran · **kısmi** = veri/ekran var ama platform geneli görünüm ya da eylem eksik
· **yok** = ekran yok.

## 1. Kapsam denetimi

### Ofis yaşam döngüsü

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Ofis envanteri, süzgeç, kayıtlı görünüm | var | Ofisler (`/admin/tenants`) |
| Ofis 360 (zaman çizelgesi, ilişki notları, görev) | var | `/admin/tenants/[id]` sekmeleri: Zaman çizelgesi, İlişki, Yönetim… |
| Kurulum / aktivasyon hunisi | var | Kurulum ve aktivasyon (`/admin/tenants/kurulum`) |
| Sağlık skoru | var | Gece işi `tenant_health_daily`, Ofisler `skor=` süzgeci |
| Kayıp riski görünümü (düşenler, neden) | **kısmi → yapıldı** | YENİ Sağlık ve risk (`/admin/ofis-sagligi`) |
| Kimliğe bürünme (önizleme) + denetim | var | Ofisler > Ofise gir (gerekçe), Personel > Güvenlik politikası > Destek erişimi geçmişi |
| Ofis notları / müşteri başarısı kuralları | var | Ofis 360 İlişki, Görevler |

### Kullanıcılar ve oturumlar

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Personel oturumları, oturum kapatma, TOTP | var | Personel > Güvenlik politikası |
| Üye ayrıntısı: giriş günlüğü, 2FA sıfırlama, oturum kapatma | var | Üyeler > üye; oturum kapatma artık doğrulayıcı kodu ister |
| Platform geneli başarısız giriş, şüpheli IP, hedeflenen hesap | **yok → yapıldı** | YENİ Giriş güvenliği (`/admin/giris-guvenligi`) |
| Platform geneli açık ofis kullanıcısı oturumları | **yok → yapıldı** | YENİ Ofis oturumları (`/admin/ofis-oturumlari`; DEFINER RPC, maskeli IP, tek / tüm oturumu kapat) |
| Ofis kullanıcılarında 2FA benimseme | **yok → yapıldı** | Giriş güvenliği > 2FA açmayan ofisler |

### Gelir ve abonelik

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Planlar, kuponlar, fatura defteri, fatura ayrıntısı | var | Abonelikler sekmeleri |
| Tahsilat (dunning), yaşlandırma, hatırlatma | var | Tahsilat (`/admin/billing/tahsilat`) |
| İade / kredi (dört göz onayı) | var | Onaylar, fatura işlemleri |
| Gelir analizi, birim ekonomisi, kohort/elde tutma | var | Raporlar, `revenue-retention-sections` |
| Muhasebe, KDV, kanal ROI | var | Muhasebe ve ROI |
| Kullanım ve kredi (AI, analiz) | var | Kullanım ve krediler, AI kullanımı |
| Paket limitine yaklaşan ofisler | **kısmi → yapıldı** | YENİ Paket limitleri (`/admin/paket-limitleri`): koltuk, portföy, müşteri, şube, AI kredisi, değerleme; satır Ofis 360 > Kullanım |

### Destek ve pazarlama

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Talepler, hazır yanıt (makro), SLA, CSAT raporu | var | Talepler sekmeleri |
| Yardım merkezi, öneri panosu | var | Destek grubu |
| Toplu duyuru, uygulama içi banner, Yenilikler, NPS | var | Toplu duyuru (`/admin/duyuru`; ofis tarafı çizim noktası mevcut) |
| E-posta şablonları, gönderim günlüğü, engel listesi | var | Ayarlar > E-posta şablonları |

### İçerik ve SEO

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Site içeriği, menü, marka, medya, rehber (blog) | var | Site ve içerik |
| SEO merkezi: sitemap, robots, JSON-LD, meta, 404, vitrin | var | SEO ve hız (`/admin/site/seo`) |
| Otomatik SEO denetimi ve öneri kuyruğu (Otopilot) | var | Site notu + `site-issues` + `seo-robot` cron |
| Hız (saha + laboratuvar) | var | SEO ve hız > Hız |
| Reklam, Search Console, Google Ads | var | Reklam ve Google |

### Entegrasyonlar ve AI

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Ödeme, SMS, e-posta, WhatsApp, Google, OpenAI, EmlakFiyatı, EİDS, webhook günlüğü | var | Entegrasyonlar (durum, test, parmak izi; sır basılmaz) |
| Portal kuralları (eklenti) | var | Entegrasyonlar > portal kuralları |
| Ofis portal hesapları (sahibinden / Hepsiemlak / Emlakjet), ilan doğrulama | **yok → yapıldı** | YENİ Portal hesapları (`/admin/portal-hesaplari`) |
| İYS / ileti izni uyumu (platform geneli) | **yok → yapıldı** | YENİ İleti izinleri (`/admin/ileti-izni`) |
| AI kullanımı, maliyet tablosu | var | AI kullanımı |
| AI model ayarları, istem şablonları | yok | Gelecek iş (AI katmanı başka çalışmada; aşağıda) |

### Veri, sistem ve güvenlik

| Alan | Durum | Nerede / not |
| --- | --- | --- |
| Dışa aktarma | var | Rapor merkezi (sayfa içi indirme yok kuralı) |
| KVKK başvuruları, veri paketi, silme | var | KVKK başvuruları (artık Güvenlik & veri grubunda) |
| Saklama süreleri ve imha işinin sonucu | **yok → yapıldı** | YENİ Veri saklama (`/admin/veri-saklama`) |
| Yedek durumu | kısmi → yapıldı | Sağlık kartı vardı; Veri saklama'da son 14 koşu, şifreli/uzak kopya, seviye |
| Cron: nabız, geçmiş, şimdi çalıştır, duraklat | var | Sistem durumu > Sağlık |
| İş kuyrukları (outbox, webhook, duyuru, doğrulama, coğrafya) | **yok → yapıldı** | YENİ Kuyruklar (`/admin/kuyruklar`), kalıcı hatada yeniden deneme |
| Hata kayıtları, uyarılar, durum sayfası, kaynaklar, DB boyutu | var | Sistem durumu sekmeleri |
| Denetim izi araması (platform + ofis) | var | Aktivite (`kaynak=platform|tenant`, kişi, ofis, tarih) |
| Personel rolleri, özel roller, dört göz, IP izin listesi, kritik işlem doğrulaması | var | Personel ve roller, Onaylar |
| Özellik bayrakları + hedefleme | var | Ayarlar > Özellik bayrakları |
| Ofis bazında bayrak görünümü | **kısmi → yapıldı** | Ofis 360 > Yönetim > Özellik bayrakları (neden + listeye ekle/çıkar) |
| Hız sınırı panosu | yok | Anahtarlar opak (sha256); anlamlı pano için ayrı sayaç gerekir (gelecek) |
| Sır rotasyon yaşı | **kısmi → yapıldı** | Entegrasyonlar > Anahtar yaşı: ad + tanımlı mı + son döndürme (değer okunmaz), 180 gün uyarısı |
| Coğrafya verisi | var | Coğrafya (7 sekme) |
| Raporlar | var | Raporlar + Rapor merkezi |

## 2. Bu turda yapılanlar

Seçim ölçütü: eksik/kısmi, GERÇEK veri kaynağı olan, "admin herşeye hakim" hissini en çok artıran ve gerçek eylemi
olan alanlar. Her sayfa: `requirePlatformModule` kapısı + `proxy-gates` satırı + rol bazlı menü; v4 dili (Kontrol paneli
ile aynı `_home/kurumsal` KpiCard / `kh-card`; ortak `src/app/admin/_components/ops-kit.tsx`), yanında `loading.tsx` ve
`error.tsx`, sunucu bileşeni; istemci kodu yalnız küçük eylem adaları.

| # | Özellik | Yol (modül) | Veri kaynağı | Eylem |
| --- | --- | --- | --- | --- |
| 1 | Sağlık ve risk | `/admin/ofis-sagligi` (tenants) | `tenant_health_daily` son gün, 7 gün öncesi, 8 haftalık ortalama; gerekçeler `inputs.reasons` | Ofis 360 İlişki'ye, `skor=` süzgeçli listeye, ilgili iş kuyruğuna bağlantı |
| 2 | Giriş güvenliği | `/admin/giris-guvenligi` (members) | `login_events` (7 gün; IP maskeli), `profiles.two_factor_sms` | Hesabın tüm oturumlarını kapat: süper admin + operasyon, doğrulayıcı kodu, denetim, hız sınırı |
| 3 | İleti izinleri (İYS) | `/admin/ileti-izni` (members) | `iys_consents` (kanal × durum sayımı), `iys_consent_events` (30 gün) | Ofis 360 Yasal sekmesine bağlantı |
| 4 | Veri saklama | `/admin/veri-saklama` (sistem) | Saklama kataloğu (`retention-catalog.ts`, gece işi adımlarıyla birebir), `cron_runs`, `backup_runs`, silme kuyruğu, KVKK sayıları (üye yetkisi varsa) | İmha işini şimdi çalıştır (süper admin, mevcut cron eylemi) |
| 5 | Kuyruklar | `/admin/kuyruklar` (sistem) | `public_mutation_outbox`, `storage_deletion_outbox`, `webhook_deliveries`, `platform_announcement_deliveries`, `listing_verification_jobs`, `geo_sync_jobs`, `cron_job_state` | Kalıcı hatalı işi yeniden kuyruğa al (tekil / toplu ≤100; yalnız idempotent işçi), denetim + hız sınırı |
| 6 | Portal hesapları | `/admin/portal-hesaplari` (sistem) | `tenant_portal_accounts`, `portal_listing_health` | Ofis 360'a bağlantı, portal kurallarına geçiş |
| 7 | Ofis bazında bayrak | Ofis 360 > Yönetim | `getFeatureFlagStates` + `feature_flag_rules`; karar `evaluateTargeted` ile birebir | Ofisi seçili listeye ekle/çıkar: süper admin, gerekçe, doğrulayıcı kodu, platform + ofis denetimi, hız sınırı |
| 8 | Oturum kapatma sertleştirme | Üyeler > üye + Giriş güvenliği | `platform_revoke_user_sessions` | Artık kritik işlem doğrulaması (`session_revoke`) + gerekçe notu |
| 9 | Menü yeniden yapılanması | `src/lib/admin/nav.ts` | — | 9. grup "Güvenlik & veri"; KVKK oraya taşındı; Menü yönetimi listesi otomatik |

Dört göz onayı: ilk turda eklenmedi; ikinci turda (aşağıda §4.1) isteğe bağlı "izin" türleri olarak eklendi.

Migration gerekmedi: tüm okumalar mevcut tablolardan, yazımlar mevcut sütunlara.

## 3. Yeni menü ağacı

```
Genel bakış      Kontrol paneli · Raporlar · Onaylar · Bildirimler
Ofisler          Ofisler · Sağlık ve risk* · Paket limitleri** · Kurulum ve aktivasyon · Üyeler · Görevler
Gelir & abonelik Abonelikler · Tahsilat · Muhasebe ve ROI · Kullanım ve krediler · Ortaklık ve davet
Destek           Talepler · Yardım merkezi · Öneri panosu · Toplu duyuru
İçerik & SEO     Site ve içerik · SEO ve hız · Reklam ve Google
Güvenlik & veri* Giriş güvenliği* · Ofis oturumları** · KVKK başvuruları (taşındı) · İleti izinleri (İYS)* · Veri saklama*
Sistem           Sistem durumu · Kuyruklar* · Aktivite · Coğrafya
AI & entegrasyon AI danışmanı · AI kullanımı · Entegrasyonlar · Portal hesapları*
Yönetim          Personel ve roller · Menü yönetimi        (alt sabit: Ayarlar)
```

`*` = yeni (ilk tur), `**` = yeni (ikinci tur, §4.1). Grup bütçesi 8 → 9 (bilinçli; `nav-budget-contract`), grup başına ≤6 satır aynen. Rol görünürlüğü:
muhasebe Güvenlik & veri grubunu görmez; destek Giriş güvenliği / KVKK / İleti izinleri'ni görür, Veri saklama'yı
görmez; operasyon hepsini görür.

## 4. Kalan işler (gelecek)

### 4.1 İkinci tur (2026-10-25, migration 20261025010000, pencere AG1 / sıra 2360)

- **Hassas işlemlerde dört göz onayı** (Ayar merkezi > Güvenlik, işlem başına, varsayılan KAPALI): oturum kapatma
  (`session_revoke`), ofis bazında bayrak (`flag_change`), kuyruk yeniden deneme (`queue_requeue`), demo verisi zorla
  temizleme / yeniden yükleme / sıfırlama (`demo_data`), ofise destek erişimi (`impersonation`). Model "izin": açıkken işlem
  `platform_approval_requests`'e bekleyen talep açar; talep edenden FARKLI bir süper admin Onaylar'dan onaylar; talep eden
  aynı işlemi aynı bilgilerle yeniden başlatınca `platform_consume_approval` izni TEK SEFER tüketir (approved → executed; yük
  birebir eşleşmeli, onaylayan aktif süper admin olmalı). Adımlar denetim izinde: `platform.approval.requested / approved /
  rejected / cancelled / consumed` + asıl işlemin kaydında `four_eyes_approval_id`. Açıkken toplu oturum kapatma kapalı.
- **Ofis oturumları** (`/admin/ofis-oturumlari`, Güvenlik & veri, modül `members`): `platform_list_office_sessions`
  (DEFINER, members görüntüleme), `platform_revoke_office_session` / `_user_sessions` (members yazma + süper admin /
  operasyon). Belirteç / HMAC / tam IP dönmez. Eylemler gerekçe + doğrulayıcı kodu + hız sınırı + denetim.
- **Anahtar yaşı** (Sistem > Entegrasyonlar): panel anahtarları için `settings_history` (parmak izli son yazım) /
  EmlakFiyatı damgası; ortam anahtarları için yalnız "tanımlı mı" + isteğe bağlı `<AD>_ROTATED_AT=YYYY-AA-GG`.
- **Paket limitleri** (`/admin/paket-limitleri`, Ofisler, modül `tenants`): `platform_tenant_limit_usage` + AI kredi
  defteri; SMS'in paket sınırı yok (ekranda açıklanır).

Kalanlar:

1. **AI model ayarları ve istem şablonları**: özellik başına model/sıcaklık ve sürümlü istem; AI katmanı (src/lib/ai/zeka)
   başka çalışmada olduğundan bu turda dokunulmadı.
3. **Hız sınırı panosu**: opak anahtarlar yerine "kova türü" sayaçları (giriş, OTP, public form) ve kilit açma.
4. **Paket önerisi**: Paket limitleri ekranında ölçüye göre bir üst paket önerisi (fiyat farkıyla).
7. **İYS eşitleme durumu**: İYS API entegrasyonu kurulduğunda gönderim/hata sayaçları İleti izinleri'ne eklenir.
8. **Kuyruk: webhook ve duyuru yeniden deneme**: ofis ucuna dış istek ve kullanıcı bildirimi olduğu için bilinçli olarak
   salt okunur bırakıldı; ofis onayıyla yeniden gönderim akışı tasarlanmalı.

## 5. Doğrulama

- Saf mantık birim testleri: `src/lib/admin/ops/ops-pure.test.ts` (sağlık radarı, giriş deseni + IP maskesi, İYS
  kapsaması, kuyruk durumu + yeniden deneme yaması, saklama notu ayrıştırma + yedek seviyesi, portal sorunları, ofis bayrak
  açıklamasının `evaluateTargeted` ile eşdeğerliği).
- Menü kapsamı / bütçe / kapı sözleşmeleri: `nav*.test.ts`, `nav-coverage.test.ts`, `nav-budget-contract.test.ts`,
  `middleware-gates.test.ts`.

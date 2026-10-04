# Yayın Penceresi Kılavuzu (migration + kod, adım adım)

> **BU KILAVUZU YALNIZ SAHİP (VERİTABANI YETKİLİSİ) UYGULAR. AJANLAR HİÇBİR KOMUTU CANLI VERİTABANINDA ÇALIŞTIRMAZ.**
> Ajanlar bu dosyayı yazdı ve komutları yalnız belgeledi; canlı DB'ye bağlanılmadı, hiçbir SQL çalıştırılmadı,
> hiçbir migration uygulanmadı. Aşağıdaki SQL'ler **salt-okunurdur** (yalnız `select`), istisna olarak işaretlenenler
> hariç. Her şey Türkçe oturumda sahibin kendi terminalinde / Supabase SQL editöründe yapılır.

Kaynaklar: `docs/HAFIZA.md` §2 (durum) · `docs/design/BIRLESIK_YOL_HARITASI.md` §4 (sıra ve gruplar) ·
`docs/design/GUVENLIK_DENETIMI_3.md` · `docs/runbooks/RESTORE.md` · `docs/runbooks/ROLLBACK.md`.
Bu kılavuzun makine karşılığı: `npm run check:migration-pairs` (veri: `scripts/migration-pairs-data.ts`).

Durum özeti (2026-10-05): canlıda uygulanan son migration `20260813000300`; sonrası **39 dosya** uygulanmamış
(`supabase/migrations`), ayrıca `supabase/proposed/` altında terfi etmemiş taslaklar var (bu kılavuzun kapsamı DIŞI, bkz. §10).

---

## 0. Altın kurallar

1. **Düz `npm run db:migrate` ÇALIŞTIRMAYIN.** Bekleyen TÜM dosyaları numara sırasıyla uygular; bu, "ayrı pencere" ve
   "grup grup" planını bozar (özellikle kazanç gizliliği `20260816000500`). Her dosyayı tek tek uygulayın:
   `npm run db:migrate -- --only <dosya_adı.sql>` (her dosya kendi transaction'ında koşar, advisory lock alır, checksum yazar).
2. Uygulanmış dosya asla değiştirilmez (forward-only). Hata olursa yeni düzeltici dosya yazılır.
3. **Güvenlik düzeltici (`..._sec3_...`) migration'lar ana migration'larıyla AYNI pencerede uygulanır** (bkz. §3 tablosu).
   Ana dosya uygulanıp düzeltici bekletilirse RLS deliği açık kalır.
4. Her pencere: önkoşul kontrolü → uygula → salt-okunur doğrulama → rol smoke → gözlem → `npm run db:rls-audit` → sonraki pencere.
   Bir pencerede doğrulama kırmızıysa **durun**, sonrakine geçmeyin.
5. Kod yayını ile sıra (§7): kod önce, migration sonra; tek istisna K4 `is_document` (migration önce).
6. Geri alma dosyaları son çaredir ve **bazılarında yoktur** (§8). Rollback ledger satırını silmez.

---

## 1. Önkoşullar (hiçbir pencere bunlar olmadan başlamaz)

1. **Restore edilebilir yedek / PITR doğrulaması.** Supabase panelinde PITR/yedek etkin ve restore noktası görünür olmalı;
   restore noktasının UTC zaman damgasını not edin. Mümkünse `docs/runbooks/RESTORE.md` "Rehearse in isolation"
   adımıyla ayrı projede prova edin. Doğrulanmadıkça G0 (P1) dahil hiçbir pencere uygulanmaz.
2. **Yerel temiz ağaç:** `main` doğrulanmış sürümde, `npm ci`, `npm run type-check`, `npm run test` yeşil.
3. **Ledger / checksum (salt-okunur):**
   ```bash
   npm run check:migrations                    # statik: ad, sıra, checksum
   npm run check:migrations -- --database      # canlı ledger ile karşılaştırır; drift varsa DUR
   npm run check:migration-pairs               # çift/grup/pencere denetimi (bu kılavuzun verisi)
   ```
   `check:migration-pairs` bugün **2 bilinen hata** verir (exit 1): `proposed/` ile `migrations/` arasında iki numara
   çakışması (§10). Bunlar uygulanacak 39 dosyayı etkilemez; ama bunlar dışında YENİ hata görürseniz durun.
4. **Dry-run (salt-okunur önizleme):**
   ```bash
   npm run db:migrate -- --dry-run
   ```
   Çıktıdaki bekleyen liste bu kılavuzdaki 39 dosyayla birebir aynı olmalı. Başka dosya varsa ya da ledger/şema ayrışması
   uyarısı gelirse (`reconciliation`) DURUN.
5. **Ledger'ın canlı görünümü (SQL, salt-okunur):**
   ```sql
   select version, applied_at from public.schema_migrations order by applied_at desc limit 10;
   -- beklenen son satır: 20260813000300_expense_text_appointment_loose_definitions_system.sql
   ```
6. **Bakım penceresi:** trafiğin düşük olduğu saat; migration'lar kısa kilit alır ama `profiles`, `campaigns`, `customers`,
   `calls` üzerinde ALTER vardır (P1, P3, P4). Cron'lar (`/admin/sistem`) bir pencere boyunca "başarısız" görürse normaldir; sonunda yeşil olmalı.
7. **Gizli/anahtar işleri** (pencere öncesi, sahibin): `ADVISOR_PII_KEY` üretilmiş mi (P7'den önce; kaybedilirse TC/IBAN geri gelmez),
   `PLATFORM_MFA_ENFORCEMENT` kararı. Ajanlar bunlara dokunmaz.

Her pencerenin başında §1.3–1.5'i tekrarlayın; her pencerenin sonunda `npm run check:migrations -- --database` ledger'ın ilerlediğini göstermeli.

---

## 2. Etki sınıfları (her migration için `check:migration-pairs` çıktısında)

| Sınıf | Anlamı | Örnek |
|---|---|---|
| **ek** | Yalnız yeni tablo/sütun/fonksiyon/seed; mevcut davranış değişmez | komisyon payı, kuponlar, mahalle notları |
| **davranis** | Mevcut davranışı ya da veriyi değiştirir | telefon CHECK + public randevu RPC, kampanya claim (bozuk kampanyalar `failed`), deneme günü fonksiyonları, **kazanç gizliliği** |
| **siki** | RLS / kısıt sıkılaşır (eski gevşek yol kapanır) | tüm `20260823…` sec3 dosyaları |

---

## 3. Uygulama sırası (pencere pencere)

Sıra = `check:migration-pairs` penceresi sırası. Pencere içi dosya sırası **aynen** korunur. Aynı satırdaki `ana + düzeltici`
çiftleri BİRLİKTE uygulanır.

| # | Pencere | Dosyalar (sırayla) | Çift (ana + düzeltici) | Etki | Rollback |
|---|---|---|---|---|---|
| P1 | Davranış düzeltmesi | `20260814000100` telefon CHECK · `20260816001100` kampanya claim | — | davranis | var |
| P2 | Seed | `20260815000100` kayıp nedeni · `20260816000100` earnings_all izin seed | — | ek | var |
| P3 | Komisyon/talep/atama temeli | `…000200` splits · `…000300` plans · `…000400` payouts · `…000600` talep sütunları · `…000700` talep RPC · `…000800` hedefler · `…000900` atama kuralları · `…001000` profil kapsamı | — | ek | var |
| P4 | Altyapı | `…001600` örnek veri kapsamı · `…001700` tenant_modules · `…001790` SEO 404 · `…010100` deneme günü · `…010200` oturum kapatma · `20260817000210` Business planı · `…000220` fiyat kilidi | — | ek (+010100 davranis) | var |
| P5 | Kuponlar | `20260817000230` coupons · `20260823000600` sec3 kupon | coupons + max_per_tenant | ek + siki | var |
| P6 | K5 hesap + KVKK | `20260819010500` abonelik/şube · `…010600` kvkk_requests · `20260823000300` sec3 kvkk rol | kvkk_requests + rol kapısı | ek + siki | var |
| P7 | Danışman profili | `20260816001300` advisor_profiles/private · `…001400` uzmanlık/bölge · `20260823000500` sec3 PII biçim | advisor_private + PII CHECK | ek + siki | var (kişisel veri silinir) |
| P8 | İlan havuzu | `20260816001200` atama kuralı ilan hedefi · `…001500` listing_pool · `20260819020200` havuz profil bayrakları · `20260823000200` sec3 havuz insert/claim | listing_pool + insert/claim koruması | ek + siki | var |
| P9 | İlan sahibi bilgisi | `20260819020100` property_owner_info · `20260823000400` sec3 güncelleme kapsamı | property_owner_info + update kapsamı | ek + siki | var |
| P10 | Ofis kontrol + onay kapısı | `20260820000100` oversight_center · `20260823000100` sec3 approval_requests RLS | oversight + approval_requests RLS | ek + siki | **oversight için YOK**, sec3 için var |
| P11 | F-modülleri | `20260821000100` mahalle notları · `…000200` yasal kayıt defteri · `…000300` evrak linkleri | — | ek | **YOK (3 dosya)** |
| P12 | **AYRI PENCERE** | `20260816000500` kazanç gizliliği RLS | önkoşul: P2 (earnings_all seed) + P3 (commission_splits) | **davranis** | var |
| K4 | K4 `is_document` (dal main'e girerse) | `20260818000400_property_media_is_document` | — | ek | dalda |

Bağımlılık gerekçeleri (denetimle doğrulanır): P3 `faz2_touch_updated_at()` ve `commission_splits` tanımını P3 ilk dosyasından alır;
P7/P8/P9 aynı fonksiyonu kullanır (P3 şart); `listing_pool` P3 (`assignment_rules`) + P8 ilk dosyası (`assignment_rules_listing_target`)
ister; sec3 dosyaları kendi ana tablolarını ister.

**Not (`approval_requests`):** tablo `20260728000123` ile zaten canlıda; sec3 dosyası onu sıkılaştırır ve `consumed_at` ekler. Kod
(`src/lib/oversight/approval-*`) sütun yokken geri uyumludur. Yine de oversight ile aynı pencerede uygulanır (onay kapısı kodu
ikisine birlikte güvenir).

Komut kalıbı (her dosya için; ÖNCE `--dry-run`):
```bash
npm run db:migrate -- --dry-run
npm run db:migrate -- --only 20260814000100_international_phone_constraints.sql
npm run check:migrations -- --database     # ledger bir ilerledi mi
```

---

## 4. Pencere pencere: doğrulama SQL'i, smoke, gözlem

Ortak doğrulama kalıpları (hepsi salt-okunur). `public` şeması varsayılır.

```sql
-- tablo var mı
select to_regclass('public.<tablo>') is not null as var;
-- sütun var mı
select column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema='public' and table_name='<tablo>' order by ordinal_position;
-- RLS açık mı + politikalar
select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.<tablo>'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' and tablename='<tablo>' order by policyname;
-- trigger var mı (internal olmayanlar)
select tgname, tgrelid::regclass, tgenabled from pg_trigger where not tgisinternal and tgrelid = 'public.<tablo>'::regclass;
-- fonksiyon var mı / SECURITY DEFINER mı
select proname, prosecdef, proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('<fonksiyon>');
-- constraint var mı / doğrulandı mı (NOT VALID ise convalidated=false)
select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint where conname in ('<ad>');
```

### P1 Davranış düzeltmesi (telefon + kampanya)

```sql
select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint
where conname in ('customers_phone_tr_format','calls_phone_tr_format');   -- tanımda E.164 (+) ve 0XXXXXXXXXX kabul edilmeli
select proname from pg_proc where pronamespace='public'::regnamespace
  and proname in ('create_public_booking_atomic','create_public_booking_atomic_state_v1','claim_campaign_delivery');  -- 3 satır
select conname, pg_get_constraintdef(oid) from pg_constraint where conname='campaigns_whatsapp_template_contract';
select count(*) as bozuk_whatsapp_kampanyasi_failed from public.campaigns
where status='failed' and last_error='whatsapp_template_invalid';        -- 0 olmak zorunda değil; bilgi
```
Önce (isteğe bağlı) canlı gövde farkı: `create_public_booking_atomic*` gövdeleri migration dosyasına canlıdan dökülmüş görünüyor;
uygulamadan önce `select pg_get_functiondef('public.create_public_booking_atomic'::regproc)` çıktısını dosyayla gözle karşılaştırın.

Smoke: izole/test hesapta yabancı numara (`+49…`) ve sabit hat (`0212…`) ile müşteri kaydı; public randevu alma; `/admin/sistem`
cron özetinde `campaign-delivery` sağlıklı. **Gözlem:** kampanya cron'unun 23514 (`CHECK_VIOLATION`) atlama davranışı
(`src/lib/campaign-delivery.ts`) artık tetiklenmemeli; bozuk eski WhatsApp kampanyaları `failed` görünür.

### P2 Seed

```sql
select category, count(*) from public.definitions where tenant_id is null and category in ('loss_reason','deal_stage_label') group by 1;
-- beklenen: loss_reason >= 7, deal_stage_label >= 3
select role, module, action from public.permission_defaults where module='earnings_all' order by role, action;
-- beklenen: owner (4 eylem), gm view, accounting view
```
Smoke: Anlaşma "kaybet" diyaloğunda kayıp nedeni listesi; Ayarlar > Tanımlar.

### P3 Komisyon/talep/atama temeli

```sql
select t, to_regclass('public.'||t) is not null as var from unnest(array['commission_splits','advisor_commission_plans','commission_payouts','assignment_rules','assignment_rule_members']) t;
select tablename, count(*) as politika from pg_policies where schemaname='public'
  and tablename in ('commission_splits','advisor_commission_plans','commission_payouts','assignment_rules','assignment_rule_members') group by 1;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal
  and tgname in ('trg_commission_payouts_guard','trg_commission_payouts_audit','trg_guard_profile_visibility_scope');   -- 3 satır
select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('title','visibility_scope');  -- 2
select column_name from information_schema.columns where table_schema='public' and table_name='targets' and column_name in ('target_appointments','target_listings','target_demands');  -- 3
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('create_customer_with_demand','faz2_touch_updated_at');  -- 2
```
Smoke: `npm run test -- faz2-migrations-contract`; `/app/cuzdan`, `/app/komisyon`, `/app/danisman-kpi` eskisi gibi; profil güncelleme
(ad/telefon) çalışır (profil kapsamı guard'ı yalnız `visibility_scope` sütununu kısıtlar).
**Gözlem:** henüz kod bu tablolara yazmıyor/okumuyor; görünür değişiklik beklenmez. Bu pencere "sessiz" olmalı.

### P4 Altyapı

```sql
select to_regclass('public.tenant_modules') is not null, to_regclass('public.seo_404_hits') is not null;
select policyname, cmd from pg_policies where schemaname='public' and tablename='tenant_modules';   -- select/insert/update
select proname from pg_proc where pronamespace='public'::regnamespace
  and proname in ('platform_default_trial_days','platform_revoke_user_sessions','seo_log_404','seo_prune_404','plan_entitlements_writable'); -- 5
select platform_default_trial_days();                        -- 14 (ya da platform_settings'teki default_trial_days)
select column_name from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('price_lock_try','price_lock_campaign'); -- 2
select column_name from information_schema.columns where table_schema='public' and table_name in ('commissions','offers','contracts','rentals','calls','expenses','notifications','profiles') and column_name='is_sample'; -- 8
select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('tenants_plan_check','subscriptions_plan_check','plan_entitlements_plan_check'); -- 'business' içermeli
```
Smoke: **owner** ile Ayarlar > Modüller aç/kapa; kapalı modül menüde yok; **danışman** kendi ofisinin modül satırını okur, başka ofisinki görünmez
(platform kilidi `locked_by_platform` ofiste değişmez). Yeni test kaydı (demo → ofis dönüşümü) deneme günü sabiti.
**Gözlem (etkin değil → etkin):** Ayarlar > Modüller ekranındaki "tablo yok / unavailable" notu kalkar; `/admin/seo` 404 listesi dolmaya başlar;
`/admin/billing/planlar` Business ve fiyat kilidi alanları. **Dikkat (fiyat kararı bekliyor):** `update_tenant_plan_subscription` hâlâ eski sabit
tutarları yazar (`docs/HAFIZA.md` §3); Business "satılmaz" kalmalı.

### P5 Kuponlar (`coupons` + sec3)

```sql
select to_regclass('public.coupons') is not null, to_regclass('public.coupon_redemptions') is not null;
select column_name, column_default from information_schema.columns where table_schema='public' and table_name='coupons' and column_name='max_per_tenant'; -- default 1
select conname, convalidated from pg_constraint where conname='coupons_max_per_tenant_check';
select proname, prosecdef from pg_proc where pronamespace='public'::regnamespace and proname='redeem_coupon';       -- prosecdef=true
select to_regclass('public.idx_coupon_redemptions_coupon_tenant') is not null;
-- UYGULAMADAN SONRA bilgi: tekrar kullanılması istenen kupon var mı (mevcutlar max_per_tenant=1 alır)
select code, max_redemptions, max_per_tenant from public.coupons order by code;
```
Smoke: `/admin/billing/kuponlar` listesi; test ofisinde aynı kuponla ikinci ödeme `Kupon uygulanamadı` (beklenen). Tekrarlı kupon
gerekiyorsa platform ekibi `max_per_tenant`'ı elle `null`/istenen değere çeker (sahip kararı).

### P6 K5 hesap + KVKK (`kvkk_requests` + sec3)

```sql
select column_name from information_schema.columns where table_schema='public'
  and ((table_name='subscriptions' and column_name in ('cancel_at_period_end','cancel_requested_at','cancel_reason'))
    or (table_name='branches' and column_name='phone'));                                     -- 4
select policyname, cmd from pg_policies where schemaname='public' and tablename='kvkk_requests' order by 1;
  -- kvkk_requests_staff, _tenant_select, _tenant_insert, _tenant_update
select tgname, tgenabled from pg_trigger where tgname='trg_kvkk_requests_guard' and not tgisinternal;   -- 1 satır
select proname from pg_proc where pronamespace='public'::regnamespace and proname='guard_kvkk_request_update';
select policyname, with_check from pg_policies where tablename='kvkk_requests' and policyname='kvkk_requests_tenant_insert';  -- created_by/status/compliance:create ifadeleri
```
Rol smoke (aşağıda §5): ofis düzeyi talep (hesap kapatma / veri indirme) yalnız owner/gm.
**Gözlem:** `/app/uyum/talepler` ve `/app/hesabim` abonelik iptal akışı; "etkin değil" boş durumları kalkar.

### P7 Danışman profili (`advisor_private` + sec3)

Önkoşul: `ADVISOR_PII_KEY` hazır. **sec3 dosyasından ÖNCE** mevcut satır kontrolü (salt-okunur; tablo yeni olduğundan genellikle 0):
```sql
select count(*) from public.advisor_private
where (national_id_enc is not null and national_id_enc !~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$')
   or (iban_enc is not null and iban_enc !~ '^v[0-9]{1,3}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{1,256}$')
   or ((national_id_enc is null) <> (national_id_last4 is null))
   or ((iban_enc is null) <> (iban_last4 is null));      -- 0 olmalı
```
Doğrulama:
```sql
select t, to_regclass('public.'||t) is not null from unnest(array['advisor_profiles','advisor_private','advisor_specialties','advisor_regions']) t;
select policyname, cmd from pg_policies where schemaname='public' and tablename='advisor_private' order by 1;  -- select/insert/update/delete
select conname, convalidated from pg_constraint where conrelid='public.advisor_private'::regclass and conname like 'advisor_private_%chk';
  -- 4 kısıt: ..._national_id_enc_format_chk, _iban_enc_format_chk, _national_id_pair_chk, _iban_pair_chk (NOT VALID olabilir: convalidated=false)
select tgname from pg_trigger where tgname='trg_advisor_private_audit' and not tgisinternal;
```
`NOT VALID` bilinçlidir (tablo taranmaz). İsterseniz ayrı bir günde `alter table public.advisor_private validate constraint <ad>;` çalıştırılır (sahip kararı).
Smoke: **danışman** kendi profilini kaydeder (TC/IBAN formu → şifreli yazılır, ekranda yalnız son 4 hane); **danışman** başkasının satırını göremez/yazamaz;
**owner/gm** görür. Açık TC (11 hane) `national_id_enc`'e doğrudan yazılamaz (CHECK).

### P8 İlan havuzu (`listing_pool` + sec3)

```sql
select column_name from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='listing_pool_enabled'; -- 1
select column_name from information_schema.columns where table_schema='public' and table_name='assignment_rules' and column_name in ('target_kind','assign_mode','min_score'); -- 3
select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('accepts_pool','pool_paused_until','max_active_listings'); -- 3
select policyname, cmd from pg_policies where schemaname='public' and tablename in ('listing_pool_entries','listing_pool_events') order by 1;
select proname, prosecdef, proconfig from pg_proc where pronamespace='public'::regnamespace
  and proname in ('assign_pool_entry','listing_pool_entry_insert_allowed');                  -- ikisi de prosecdef=true, search_path boş
select grantee, privilege_type from information_schema.routine_privileges
where routine_schema='public' and routine_name='assign_pool_entry';                          -- anon'a EXECUTE olmamalı
select count(*) from public.listing_pool_entries where status='pending' and claim_open_until > now() + interval '7 days 5 minutes'; -- 0
select count(*) filter (where listing_pool_enabled) from public.tenants;                    -- 0 (havuz varsayılan kapalı)
```
Smoke: **owner/gm** ofiste havuzu aç, ilan ekle → kayıt `pending`; **danışman** (properties:create) başkasına atanmış ilan için havuz kaydı açamaz,
sahipsiz kendi ilanı için açar; sahiplenme penceresi 7 gün + 5 dk'dan uzun olamaz; atanmış ilan sahiplenilemez.
**Gözlem:** `/app/ilan-havuzu`; havuz `listing_pool_enabled` kapalıyken görünmez (kod `isPoolEnabled` kapalı sayar).
Not: içe aktarma/portal/ağ kaynakları havuza bağlı değil (yalnız elle ilan), HAFIZA §3.

### P9 İlan sahibi (`property_owner_info` + sec3)

```sql
select policyname, cmd, with_check from pg_policies where schemaname='public' and tablename='property_owner_info' order by 1;
  -- _update'in with_check'i artık kapsam ifadesi taşımalı (yalnız tenant değil)
select tgname, tgenabled from pg_trigger where tgname='trg_property_owner_info_guard' and not tgisinternal;
select conname from pg_constraint where conname='property_owner_info_one_per_property';
```
Smoke: **danışman** kendi ilanının sahip kaydını günceller; kaydın `property_id`'sini başka ilana ya da `customer_id`'yi göremediği
müşteriye çevirme denemesi reddedilir; **owner/gm/şube müdürü** kapsamındakini günceller.
**Gözlem:** portföy detay "ilan sahibi" bölümü; yayın kapısı (`publishBlockReason`) artık tablo varken eksik zorunlu alanları denetler.

### P10 Ofis kontrol + onay kapısı (`oversight_center` + sec3)

```sql
select t, to_regclass('public.'||t) is not null from unnest(array['oversight_settings','oversight_alert_reviews']) t;
select policyname, cmd from pg_policies where schemaname='public' and tablename in ('oversight_settings','oversight_alert_reviews','approval_requests') order by 1,2;
  -- approval_requests: yalnız _select, _insert, _update (eski 'approval_requests_tenant' for-all YOK, DELETE politikası YOK)
select count(*) from pg_policies where schemaname='public' and tablename='approval_requests' and policyname='approval_requests_tenant'; -- 0
select column_name from information_schema.columns where table_schema='public' and table_name='approval_requests' and column_name='consumed_at'; -- 1
select proname, prosecdef from pg_proc where pronamespace='public'::regnamespace and proname in ('approval_actor_can_decide','guard_approval_request_update');
select tgname, tgenabled from pg_trigger where tgname='trg_approval_requests_guard' and not tgisinternal;
```
Smoke (§5): onay talebi akışı owner/gm/danışman ile.
**Gözlem:** `/app/ofis-kontrol` alt sayfaları (uyarılar, kurallar, karne, benim): "incelendi tablosu yok" notu (`reviewsAvailable=false`) kalkar;
`/app/onaylar` listesi aynen çalışır; onay kuralı varsayılan kapalı kalır (`src/lib/oversight/approval-gate.ts`), kural açılınca danışmanın hassas işlemi 48 saatlik tek kullanımlık onay ister.

### P11 F-modülleri (mahalle notları, yasal kayıt defteri, evrak linkleri)

```sql
select t, to_regclass('public.'||t) is not null from unnest(array['neighborhood_notes','compliance_ledger_settings','compliance_ledger_entries','document_requests','document_request_files']) t;
select tablename, count(*) from pg_policies where schemaname='public'
  and tablename in ('neighborhood_notes','compliance_ledger_settings','compliance_ledger_entries','document_requests','document_request_files') group by 1;
select tgname from pg_trigger where tgname='compliance_ledger_no_update' and not tgisinternal;   -- yasal kayıt defteri değiştirilemez
```
Smoke: `/app/mahalle-notlari` not ekle/listele; `/app/uyum/kayit-defteri` kayıt ekle, düzenleme denemesi reddedilir (immutable, düzeltme = yeni kayıt);
evrak toplama linki oluştur, **oturumsuz** tarayıcıda link açılır (önceden "geçersiz" dönerdi), yükleme belge merkezine düşer.
**Gözlem:** üç ekranda "etkin değil/tablo yok" boş durumu kalkar. **GERİ ALMA DOSYASI YOK** (§8): uygulamadan önce ekstra dikkat.

### P12 AYRI PENCERE: kazanç gizliliği RLS (`20260816000500`)

**Bu pencere diğerlerinden ayrı bir günde, en son yapılır.** `commissions_select` politikasını ve `advisor_kpis` ciro maskesini değiştirir:
şube müdürü / takım lideri / danışman artık yalnız KENDİ komisyonunu görür.
Önkoşullar:
1. P2 (earnings_all seed) ve P3 (`commission_splits`) uygulanmış (denetim bunu doğrular).
2. Etki taramasını bitirin (`docs/design/BIRLESIK_YOL_HARITASI.md` G3 satırı): `komisyon/page.tsx`, `_home/data.ts`, `anlasmalar/[id]/*`, `payment-links.ts`,
   `commissions.ts`, `workflow.ts`, `audit-dossier.ts`, export'lar, `ai-tenant-advisor.ts` için rol bazlı beklenen sonuç yazılı.
3. Mümkünse önce izole test DB'sinde deneyin.
4. Kod bu davranışla yayında olmalı (kod önce).

Doğrulama:
```sql
select proname, prosecdef, proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('can_view_commission_earnings','advisor_kpis');
select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='commissions' and policyname='commissions_select';
  -- qual içinde can_view_commission_earnings görünmeli
select policyname, cmd from pg_policies where schemaname='public' and tablename='commissions' order by 1;  -- insert/update/delete politikaları DEĞİŞMEMİŞ olmalı
```
Rol smoke'u §6'da.

### K4 `is_document` (yalnız K4 dalı main'e girerse)

```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema='public' and table_name='property_media' and column_name='is_document';   -- 1 satır
```
Smoke: belge işaretli görsel vitrin/paylaşım/portal/OG/`/api/property-media`'da servis EDİLMEZ. **Sıra: migration ÖNCE, kod SONRA** (§7).

---

## 5. Sec3 smoke senaryoları (P5, P6, P7, P8, P9, P10 sonrası)

Hepsi **izole/test ofisinde**, gerçek müşteri verisine dokunmadan. Roller: **owner**, **gm**, **danışman** (advisor). Anketör rol değildir
(atanabilir görev; anket modülü `supabase/proposed/` altında, henüz uygulanmadı) — anketör smoke'u anket migration'ı terfi edince yapılır.

| Grup | owner | gm | danışman | Beklenen |
|---|---|---|---|---|
| onay (P10) | Danışmanın talebini onaylar/reddeder | Aynı | Kendi talebini açar (`bekliyor`), iptal eder; **kendi talebini onaylayamaz**; başkasının talebini onaylayamaz | Onaylanan talep `decided_by/decided_at` DB'den yazılır; `onaylandi` satırı doğrudan INSERT edilemez; talep içeriği (tutar, `description`) UPDATE ile değişmez; satır silinemez |
| kvkk (P6) | Hesap kapatma + veri indirme talebi açar/günceller | Aynı | Müşteri veri talebi (compliance izni varsa) ; **ofis düzeyi talep açamaz** | `created_by=kendisi`, `status='open'` zorunlu; tür/tenant sonradan değişmez |
| havuz (P8) | Havuzu açar, kural ekler, atar | Aynı | Kendi sahipsiz ilanı için kayıt açar; **başkasına atanmış ilan için kayıt açamaz**; süresi 7 gün+5 dk'yı aşan sahiplenme açamaz | Atanmış ilan `claim` ile devralınamaz |
| ilan sahibi (P9) | Tüm ilanların sahip kaydı | Aynı | Yalnız kendi ilanı; **başka ilana/görmediği müşteriye taşıyamaz** | Taşıma denemesi RLS/trigger hatası |
| danışman özel (P7) | Başkasının profilini (iş alanları) görür/düzenler | Aynı | Yalnız kendisi; açık (şifresiz) TC/IBAN yazamaz | CHECK ihlali; ekranda yalnız son 4 hane |
| kupon (P5) | — | — | — (platform) | Aynı ofis aynı kuponu ikinci kez kullanamaz (max_per_tenant=1) |

Uygulamayı atlayan, doğrudan PostgREST/SQL denemesi (isteğe bağlı, **yalnız izole test DB'sinde**, her zaman ROLLBACK ile biter;
`scripts/rls-audit.ts` aynı kalıbı kullanır). Şablon (yer tutucuları doldurun; canlıda ÇALIŞTIRMAYIN):
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"<DANISMAN_PROFIL_UUID>","app_metadata":{"tenant_id":"<TENANT_UUID>","role":"advisor"}}', true);
-- BEKLENEN: hata (RLS/trigger). Başarılı olursa pencere KIRMIZI.
insert into public.approval_requests (tenant_id, status, requested_by, kind, title)
values ('<TENANT_UUID>','onaylandi','<DANISMAN_PROFIL_UUID>','<kind>','<baslik>');
rollback;
```
(Alan adları `approval_requests` şemasına göre uyarlanır; amaç `status='onaylandi'` INSERT'ün reddedilmesidir.)

---

## 6. Kazanç gizliliği RLS smoke senaryoları (P12 sonrası)

Test ofisinde bir anlaşma + komisyon + pay (split) olsun: komisyon sahibi danışman A, başka danışman B, şube müdürü, takım lideri, owner, gm, muhasebe.

| Rol | `/app/komisyon` toplamı | `/app/cuzdan` | `/app/danisman-kpi` ciro | Ana ekran komisyon özeti | Anlaşma detayı |
|---|---|---|---|---|---|
| **owner** | tüm ofis | kendi payı | tüm danışmanların cirosu | tüm ofis | hepsi |
| **gm** | tüm ofis (`earnings_all:view`) | kendi payı | tüm cirolar | tüm ofis | hepsi |
| **danışman A** | yalnız kendi komisyonları/payları | çalışır | yalnız kendi cirosu; **başkalarında 0** | yalnız kendi | yalnız kendi anlaşması |
| **danışman B** | A'nın komisyonu **görünmez** | kendi payı | kendi | kendi | A'nın anlaşmasında komisyon yok |
| **şube müdürü / takım lideri** | yalnız kendi komisyon/payı (artık ofis toplamı DEĞİL) | kendi payı | kendi cirosu; diğerleri 0 | kendi | anlaşma görünür, başkasının komisyon tutarı görünmez |
| **muhasebe** (`earnings_all:view`) | tüm ofis | — | tüm ciro | tüm ofis | hepsi |

Ek kontroller: PostgREST ile `commissions` select (danışman JWT'siyle) yalnız kendi/kendi payı olan satırları döner; admin/service_role
okumaları (rapor, export, AI) etkilenmez — bu sayfalar rol bazlı DARALMIŞ görünüyorsa beklenen mi değil mi etki taramasındaki listeyle karşılaştırın.
**Kırmızı bayrak:** şube müdürünün toplamı boşa düşmesi bir hata değil sonuçtur; ama owner/gm'de herhangi bir daralma hatadır: hemen §8 rollback.

SQL doğrulaması (salt-okunur, DB sahibi rolüyle; RLS atlanır, bu yüzden yalnız tanım kontrolü):
```sql
select pg_get_functiondef('public.can_view_commission_earnings(uuid,uuid,uuid)'::regprocedure);
```

---

## 7. Kod yayını ile migration sırası

- **Varsayılan: önce kod, sonra migration.** Kodun tamamı şema yokken "etkin değil" ile zarifçe çalışır (tablo/sütun yoksa özellik gizli
  ya da boş durum; uydurma veri yok). Kod yayını = doğrulanmış `main`'in sahip tarafından push'lanması (Vercel deploy'u push tetikler;
  `docs/DEPLOY.md`). Deploy yeşil (`/api/health`) olmadan migration penceresine girmeyin.
- Migration uygulandıktan sonra özellik kendiliğinden "etkin" olur (kod probe'ları şemayı görür); ayrıca deploy gerekmez.
- **İSTİSNA 1 — K4 `is_document`: migration ÖNCE, kod SONRA.** Public medya sorguları `is_document` sütununa bağlıdır; sütun yokken kod yayınlanırsa
  public vitrinde görseller kaybolur. K4 dalı `main`'e alınmadan migration'ı uygulayın.
- **İSTİSNA 2 — P12 kazanç gizliliği:** kodun rol bazlı davranışı (etki taraması) ÖNCE yayında olmalı, sonra migration (zaten "kod önce"); fakat
  ayrı gün ve geri alma hazır.
- sec3 düzeltici dosyaları kod uyumlu yazılmıştır (header'larındaki "KOD UYUMU (okundu)" notları): kod önce yayınlanmış olmalı ki RLS
  sıkılaşınca hiçbir akış kırılmasın; yayınlanmadan sec3 uygulanırsa eski kodun (örn. `consumed_at` olmadan) davranışı kontrol edilmelidir.

---

## 8. Geri alma

Geri alma dosyaları `supabase/rollbacks/<ad>.rollback.sql` altındadır; **runner'a bağlı DEĞİLDİR**, elle ve **ters sırada** çalıştırılır. Dosyalar
`schema_migrations` ledger satırına DOKUNMAZ: geri aldıktan sonra ledger "uygulandı" demeye devam eder; yeniden uygulamak için ledger satırının
silinmesi ve yeni forward migration kararı sahibe aittir. `docs/runbooks/ROLLBACK.md` ilkeleri geçerlidir: önce uygulama geri alma / özelliği kapatma;
veri bozulduysa yazmaları durdurun ve `RESTORE.md`.

| Pencere | Rollback dosyası | Not |
|---|---|---|
| P1 | var (`…000100`, `…001100`) | kampanya `failed` yapılan satırlar geri açılmaz |
| P2 | var | seed silinir |
| P3 | var (8 dosya) | tablolar düşer; kod bu tablolara yazmıyorsa risksiz |
| P4 | var (7 dosya) | `tenant_modules` düşünce tüm modüller açık döner; `010100` fonksiyonları eski haline |
| P5 | var | sec3 geri alınca kupon kullanımı ofis başına sınırsız olur |
| P6 | var | `kvkk_requests` rol kapısı kalkar |
| P7 | var | **`20260816001300` geri alma danışmanların kişisel/kimlik verisini KALICI siler** (önce dışa alın) |
| P8 | var | sec3 geri alma #6 güvenlik açığını yeniden açar; `properties.assigned_to` kalır |
| P9 | var | sec3 geri alma update kapsamı açığını yeniden açar |
| P10 | **oversight (`20260820000100`) için YOK**; sec3 (`20260823000100`) için var | sec3 geri alma eski geniş `for all` politikasını geri getirir (#1 açığı yeniden açılır) ve `consumed_at` düşer: önce kodu geri alın |
| P11 | **YOK (3 dosya: mahalle notları, yasal kayıt defteri `F1`, evrak linkleri `F4`)** | geri alma gerekirse yeni forward-fix yazılır; `compliance_ledger_entries` değiştirilemez tasarlandı. Bu pencereden önce yedeğin taze olduğundan emin olun |
| P12 | var (`…000500`) | eski politika + eski `advisor_kpis` gövdesi geri yazılır, veri değişmez: **en hızlı ve güvenli geri alma** |
| K4 | dalda | — |

Hangi dosyada rollback yok, her zaman güncel olarak `npm run check:migration-pairs` çıktısının sonundaki "Rollback dosyası OLMAYAN" satırında görünür.

---

## 9. Pencere sonrası: RLS denetimi ve kapanış

Her pencere sonunda, tüm pencereler bitince mutlaka:
```bash
npm run db:rls-audit                          # yeni tablolar RLS'li mi, çapraz-tenant sızıntı var mı (tek transaction, ROLLBACK ile biter)
npm run check:migrations -- --database        # ledger ilerledi, checksum sağlam, drift yok
npm run test:e2e:public                       # salt-okunur public smoke (canlıya karşı: bkz. docs/DEPLOY.md)
```
Ardından: `/admin/sistem` cron özeti yeşil, `/api/health` migration hazırlığı; `docs/HAFIZA.md` §2 "Canlıda uygulanan son" satırını güncelleyin.

Bitiş kontrol listesi:
- [ ] Yedek/PITR doğrulandı ve restore zaman damgası not edildi
- [ ] P1 → P11 sırayla uygulandı, her birinde doğrulama SQL'i + smoke yeşil
- [ ] P12 AYRI günde, etki taraması + rol smoke'u yapıldı
- [ ] `db:rls-audit` temiz, ledger güncel
- [ ] K4 dalı varsa migration'ı koddan önce uygulandı

---

## 10. Bu kılavuzun kapsamı DIŞINDA kalanlar (taslaklar ve bilinen çakışmalar)

`supabase/proposed/` altındaki dosyalar migration değildir ve **uygulanmaz**. Terfi edilirken yeni numara almaları ŞARTTIR; bugün
`check:migration-pairs` şu çakışmaları raporlar (yeniden numaralama sahibe/ayrı göreve aittir, bu çalışmada `supabase/` değiştirilmedi):

| Çakışma | migrations/ | proposed/ |
|---|---|---|
| `20260819020100` | `property_owner_info` (P9) | `ownership_transfers` (sahiplik devri taslağı) |
| `20260820000100` | `oversight_center` (P10) | `billing_pause_proration_business_seats` (faturalama taslağı) |

Ek bilgi: `proposed/` içindeki 8 taslak (14 haneli numaralı olanların 8'i) `migrations/`'taki en büyük sürümün (`20260823000600`) gerisinde numaralıdır; terfide numara bunun
ÜSTÜNDE olmalı. `20260814_perf_indexes*.sql` adları 14 haneli desene uymaz (terfide yeniden adlandırılmalı; `CREATE INDEX CONCURRENTLY`
runner'ın transaction'ında çalışmaz). Anket modülü, AI kredi ölçümü, vitrin ayarları, büyüme/referral, sahiplik devri, faturalama duraklatma
ve malik bağlantısı taslakları ayrı pencere(ler)dir; her biri terfi edildiğinde bu kılavuza ve `scripts/migration-pairs-data.ts`'e eklenir.
Terfi bekleyen taslak numaraları: `20260816060100`, `20260819000100`, `20260819010700`, `20260820000300`, `20260820010000`, `20260822000100`, `20261005000100` (+ iki çakışan: bkz. tablo).

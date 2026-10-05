# Yayın Penceresi 2 — terfi eden 13 migration + kazanç gizliliği (EN SON) + EmlakFiyati kontör (§7, PB9)

> **BU KILAVUZU YALNIZ SAHİP UYGULAR.** Ajan bu dosyayı ve migration'ları yalnız HAZIRLADI: canlı DB'ye bağlanılmadı,
> hiçbir migration uygulanmadı. Aşağıdaki SQL'lerin TAMAMI salt-okunurdur (`select`; `begin read only … rollback`).
> Yazan tek komut `npm run db:migrate -- --only <dosya>`'dır ve **restore edilebilir backup/PITR doğrulandıktan sonra
> sahip** tarafından çalıştırılır.

Kaynak: `docs/runbooks/YAYIN_PENCERESI.md` (P1–P11b uygulandı; altın kurallar, §4 doğrulama kalıpları, §6 P12 rol smoke'u
ve §8 geri alma ilkeleri burada da geçerli) · makine karşılığı `npm run check:migration-pairs` (veri `scripts/migration-pairs-data.ts`,
pencereler `PB1`…`PB8` + `P12`).

---

## 0. Runner davranışı (okunarak doğrulandı: `scripts/apply-migrations.ts`)

- Her dosya **tek transaction'da** koşar: `begin` → dosyanın tamamı tek `client.query(sql)` → `schema_migrations` satırı
  (checksum) AYNI transaction'da → `commit`. Herhangi bir deyim hata verirse `rollback` çalışır: **dosyanın tamamı ve ledger
  satırı birlikte geri alınır** (yarım uygulanmış migration kalmaz), komut `<dosya> uygulanamadı (geri alındı)` ile durur.
- Bu yüzden: `CREATE INDEX CONCURRENTLY` runner'da çalışamaz (perf indeks önerileri bu nedenle terfi ETMEDİ). Terfi eden
  13 dosyada `begin/commit`, `CONCURRENTLY`, `ALTER TYPE … ADD VALUE` YOK (tarandı). `notify pgrst` commit'te teslim edilir.
- Ön koşul DO blokları (000300, 000600) dosyanın ilk deyimidir; eksik bağımlılıkta HİÇBİR şey yazılmadan durur.
- Yazmadan önce: advisory lock (aynı anda ikinci çalıştırma yok), uygulanmış dosyaların checksum'ı, ledger/şema kanıt sondaları.
  Bilinmeyen bayrak/argüman (`--help` hariç) çıkış 2 ile **hiçbir şey uygulamadan** durur.
- **DÜZ `npm run db:migrate` YASAK:** bekleyenleri AD sırasıyla uygular; `20260816000500` (P12) en küçük numara olduğundan
  İLK sıraya girer. Her dosya `--only` ile, aşağıdaki sırayla tek tek uygulanır.

---

## 1. Önkoşullar (her oturum başında)

1. Restore edilebilir backup/PITR doğrulandı; restore noktasının UTC zaman damgası not edildi.
2. Kod önce: canlı deploy bu migration'ları bekleyen kodu içermeli (`/api/health` yeşil). Kod, şema yokken her özellikte
   "etkin değil" ile çalışır; migration sonrası kendiliğinden etkinleşir.
3. Statik + ledger (salt-okunur):
   ```bash
   npm run check:migrations                 # "Migration kontratı sağlıklı: 234 dosya · son 20260825001300_ownership_transfers.sql"
   npm run check:migration-pairs            # "0 hata" (uyarılar: perf indeks adları, K4 dalı)
   npm run check:migrations -- --database   # BEKLENEN: yalnız aşağıdaki 14 dosya "veritabanında bekleyen migration";
                                            # "checksum drift" ya da "ledger kaydı diskte yok" görülürse DUR
   npm run db:migrate -- --dry-run          # "14 migration uygulanacak" (AD sırasıyla listeler; uygulama sırası §3'tür)
   ```
4. **Prova (önerilir, yazmaz):** `npm run db:rehearse -- --yes-i-understand-locks [--with-earnings]`
   (`scripts/migration-rehearsal.ts`). 13 dosyayı (bayrakla P12'yi de) GERÇEK şemada TEK transaction'da çalıştırır,
   md5/varlık/yardımcı/işlevsel fatura/RLS kontrollerini PASS/FAIL/ATLANDI tablosuyla basar ve HER KOŞULDA ROLLBACK eder;
   ledger'a yazmaz, `apply-migrations` ile aynı advisory anahtarını xact düzeyinde alır. ROLLBACK'e kadar `tenants`,
   `properties`, `subscriptions`, `demo_requests`, `geo_*` tablolarında ACCESS EXCLUSIVE kilit tutar (statement 20 sn /
   lock 10 sn / toplam 180 sn sınırı): düşük trafikte çalıştırın. FAIL varsa çıkış 1 → uygulamaya geçmeyin.
5. Ledger'da bunların hiçbiri olmamalı:
   ```sql
   select version from public.schema_migrations
   where version like '20260825%' or version = '20260816000500_commission_earnings_privacy.sql';   -- 0 satır
   ```

## 2. Eski ad → yeni ad (terfi 2026-10-05)

| # | Eski (supabase/proposed) | Yeni (supabase/migrations) | Rollback (supabase/rollbacks) | Etki |
|---|---|---|---|---|
| 1 | `20261005000100_properties_owner_customer_link` | `20260825000100_properties_owner_customer_link` | var | ek |
| 2 | `20261005000600_geo_central_management` | `20260825000200_geo_central_management` | var (YENİ yazıldı) | ek |
| 3 | `20261005000500_billing_plan_amount_integrity` | `20260825000300_billing_plan_amount_integrity` | var | davranış |
| 4 | `20261005000400_subscription_seat_price_lock` | `20260825000400_subscription_seat_price_lock` | var (YENİ yazıldı) | ek |
| 5 | `20261005000800_billing_pause_proration_business_seats` (D çıkarıldı) | `20260825000500_billing_pause_proration_business_seats` | var (YENİ yazıldı) | ek |
| 6 | `20261005000900_seat_purchase_fulfillment` | `20260825000600_seat_purchase_fulfillment` | var | davranış |
| 7 | `20260820010000_survey_module` | `20260825000700_survey_module` | var | ek |
| 8 | `20260819000100_growth_referral_partner_attribution` | `20260825000800_growth_referral_partner_attribution` | var | ek |
| 9 | `20260822000100_growth_click_counters` | `20260825000900_growth_click_counters` | var | ek |
| 10 | `20260820000300_ai_credit_metering` | `20260825001000_ai_credit_metering` | var | ek |
| 11 | `20260816060100_tenant_vitrin_settings` | `20260825001100_tenant_vitrin_settings` | var | ek |
| 12 | `20260819010700_tenant_vitrin_sections_seo_optin` | `20260825001200_tenant_vitrin_sections_seo_optin` | var | **davranış** (sitemap kaynağı) |
| 13 | `20261005000700_ownership_transfers` | `20260825001300_ownership_transfers` | var | ek |
| 14 | (zaten migrations'ta) | `20260816000500_commission_earnings_privacy` | var | **davranış** — EN SON, AYRI gün |

Terfi ETMEYEN: `20260814_perf_indexes.sql`, `20260814b_perf_indexes_measured.sql` (CONCURRENTLY + ölçülmemiş; YAYIN_PENCERESI §10).

## 3. Uygulama sırası (`--only`, aynen bu sırayla; her birinden sonra §4 doğrulaması)

```bash
npm run db:migrate -- --only 20260825000100_properties_owner_customer_link.sql        # PB1
npm run db:migrate -- --only 20260825000200_geo_central_management.sql                # PB2
npm run db:migrate -- --only 20260825000300_billing_plan_amount_integrity.sql         # PB3 (önce §4.3 ÖNCE sorgusu)
npm run db:migrate -- --only 20260825000400_subscription_seat_price_lock.sql          # PB3
npm run db:migrate -- --only 20260825000500_billing_pause_proration_business_seats.sql # PB3
npm run db:migrate -- --only 20260825000600_seat_purchase_fulfillment.sql             # PB3 (önce §4.6 ÖNCE sorgusu)
npm run db:migrate -- --only 20260825000700_survey_module.sql                         # PB4
npm run db:migrate -- --only 20260825000800_growth_referral_partner_attribution.sql   # PB5
npm run db:migrate -- --only 20260825000900_growth_click_counters.sql                 # PB5
npm run db:migrate -- --only 20260825001000_ai_credit_metering.sql                    # PB6
npm run db:migrate -- --only 20260825001100_tenant_vitrin_settings.sql                # PB7
npm run db:migrate -- --only 20260825001200_tenant_vitrin_sections_seo_optin.sql      # PB7 (önce §4.12 ÖNCE sorgusu)
npm run db:migrate -- --only 20260825001300_ownership_transfers.sql                   # PB8
# --- AYRI GÜN, YAYIN_PENCERESI.md §P12 önkoşulları + §6 rol smoke'u ile ---
npm run db:migrate -- --only 20260816000500_commission_earnings_privacy.sql           # P12 (EN SON)
```
Her komuttan önce isteğe bağlı `npm run db:migrate -- --only <dosya> --dry-run` (salt-okunur). Her komuttan sonra
`npm run check:migrations -- --database` bekleyen listenin bir azaldığını göstermeli. Bir doğrulama kırmızıysa DUR.
Tümü bitince: `npm run db:rls-audit`, `npm run check:migrations -- --database` ("sağlıklı"), gerekirse
`npm run check:migrations -- --release` çıktısıyla `RELEASE_MIGRATION`/`_CHECKSUM` (docs/DEPLOY.md).

## 4. Dosya başına salt-okunur doğrulama (uygulama SONRASI; tek satır sorgu → beklenen)

### 4.1 `20260825000100_properties_owner_customer_link`
```sql
select (select count(*) from information_schema.columns where table_schema='public' and table_name='properties' and column_name='owner_customer_id') as col, (select count(*) from pg_constraint where conname='properties_owner_customer_id_fkey') as fk, (select count(*) from pg_trigger where tgname='trg_properties_owner_same_tenant' and not tgisinternal) as trg, to_regclass('public.idx_properties_owner_customer') is not null as idx, (select count(*) from public.properties where owner_customer_id is not null) as dolu;
```
Beklenen: `1 | 1 | 1 | t | 0`. Gözlem: PostgREST'te `properties` ↔ `customers` artık iki yönlü tek FK ilişkisi; koddaki gömmeler FK ipuçlu
(`postgrest-embed-hint-contract` yeşil). Portföy detayında malik bağlantısı "etkin değil" notu kalkar.

### 4.2 `20260825000200_geo_central_management`
Önce (salt-okunur; rollback güvenliği için bu sütunlar migration ÖNCESİ yok olmalı):
```sql
select count(*) from information_schema.columns where table_schema='public' and table_name in ('geo_provinces','geo_districts','geo_neighborhoods','demo_requests') and column_name in ('description','deactivated_at','source','version_id','province_id','district_id');   -- 0
```
Sonra:
```sql
select to_regclass('public.geo_data_versions') is not null as v, to_regclass('public.geo_aliases') is not null as a, to_regclass('public.geo_change_requests') is not null as r, (select relrowsecurity from pg_class where oid='public.geo_change_requests'::regclass) as rls, (select count(*) from pg_policies where schemaname='public' and tablename='geo_change_requests') as pol, (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('geo_usage_counts','geo_usage_totals','geo_usage_rows','geo_merge','geo_merge_undo','geo_move')) as fn, (select count(*) from information_schema.columns where table_schema='public' and table_name in ('geo_provinces','geo_districts','geo_neighborhoods') and column_name in ('description','deactivated_at','source','version_id')) as cols, has_function_privilege('authenticated','public.geo_merge(text,uuid,uuid,uuid,text)','execute') as auth_exec;
```
Beklenen: `t | t | t | t | 2 | 6 | 12 | f`. (`geo_change_requests_insert` with_check içinde `status = 'pending'` görünmeli:
`select with_check from pg_policies where policyname='geo_change_requests_insert';`)

### 4.3 `20260825000300_billing_plan_amount_integrity` (fiyat bütünlüğü)
Önce (salt-okunur): dosya başlığındaki "SALT-OKUNUR CANLI GÖVDE DOĞRULAMA" sorgusu → başlıktaki BEKLENEN (ÖNCE) tablosu
(update_tenant_plan_subscription / fulfill 10+9 arg / provision / convert'te `old_990=t`, `has_business=f`, provision/convert'te `k1_trial=t`).
Sapma = DUR. Katalog ayarı var mı (beklenen fiyatları belirler):
```sql
select key, value is not null and btrim(value) <> '' as ayar_var from public.platform_settings where key = 'billing.plan_definitions';   -- satır yoksa ya da f: onaylı katalog geçerli
```
Sonra:
```sql
select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('plan_catalog_document','plan_monthly_amount','plan_yearly_paid_months','plan_period_amount','plan_campaign_lock_amount');   -- 5
```
Aynı başlık sorgusunu tekrar çalıştırın → BEKLENEN (SONRA): 4 hedef satırda `old_*`/`fixed_14_days` = f, `has_business` = t
(convert hariç), `uses_helper` = t; 9 argümanlı ESKİ overload değişmez (`old_*` = t kalır — bilinen açık, ayrı temizlik migration'ı).
**İşlev doğrulaması (salt-okunur; ayar YOKSA ya da ayar bu değerleri taşıyorsa beklenen):**
```sql
select public.plan_monthly_amount('advisor') as advisor, public.plan_monthly_amount('office') as office, public.plan_monthly_amount('professional') as professional, public.plan_monthly_amount('business') as business, public.plan_monthly_amount('enterprise') as enterprise, public.plan_monthly_amount('free') as bilinmeyen;
```
Beklenen: `749 | 2490 | 4990 | 8990 | 12900 | NULL` (ayar varsa plan başına `plans.<plan>.monthlyTry`; ayarda o plan yoksa plans.ts tabanı = aynı değerler).
```sql
select public.plan_period_amount('professional','monthly') as aylik, public.plan_period_amount('professional','yearly') as yillik, public.plan_yearly_paid_months('professional') as odenen_ay, public.plan_period_amount('professional','weekly') as gecersiz, public.plan_catalog_document() is null as ayar_yok, public.plan_campaign_lock_amount('professional') as kampanya;
```
Beklenen (ayar yoksa): `4990 | 49900 | 10 | NULL | t | NULL`. (Ayar varsa `ayar_yok=f`; `kampanya` yalnız katalogda
`campaignMonthlyTry` < liste fiyatı ve `campaign.lockPrice` false değilse dolu.)
Gözlem: admin plan/durum değişimi kayıtlı `amount_try`'ı artık EZMEZ; Business kabul edilir. Mevcut abonelik tutarları DÜZELTİLMEZ.

### 4.4 `20260825000400_subscription_seat_price_lock`
```sql
select count(*) from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('seat_price_lock_base_try','seat_price_lock_tiers');   -- 2
```

### 4.5 `20260825000500_billing_pause_proration_business_seats` (D bölümü yok)
```sql
select (select count(*) from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('paused_at','pause_resume_at','pause_remaining','extra_seats')) as cols, (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('pause_subscription','resume_subscription','quote_upgrade_proration','effective_seat_limit')) as fn, (select count(*) from public.subscriptions where extra_seats <> 0) as ek_koltuk, has_function_privilege('authenticated','public.effective_seat_limit(uuid)','execute') as auth_exec;
```
Beklenen: `4 | 4 | 0 | f`. D çıkarıldığı için bu dosya fiyat fonksiyonlarına DOKUNMAZ: §4.3 başlık sorgusunun `body_md5` değerleri bu adımdan önce ve sonra AYNI olmalı.
**İşlev doğrulaması:**
```sql
select t.id, pe.seat_limit, public.effective_seat_limit(t.id) as etkin from public.tenants t join public.plan_entitlements pe on pe.plan = t.plan order by t.created_at desc limit 5;   -- her satırda etkin = seat_limit (extra_seats 0)
```

### 4.6 `20260825000600_seat_purchase_fulfillment` (koltuk satışı)
Önce: dosya başlığındaki iki salt-okunur sorgu → BEKLENEN (ÖNCE): `fulfill_billing_payment` (10 arg) md5 `a69a76095ddeafb4524bdcc634b25507`,
`fulfill_billing_payment_v2` `58632405633c6b701b7b330460e88f69`, `enforce_plan_capacity` `15a0a848fde39a1cb8271b0ff4a53f2a`,
`enforce_tenant_plan_capacity` `55e3e409a53ba3140aa749e4a974ec37`, `extra_seats_col = t`. Sapma = DUR (dosyanın ön koşulu da durur).
Ayrıca 4.5'in tekrar kontrolü (`ek_koltuk = 0`) ve bilgi: `select count(*) from public.billing_payment_captures where status in ('captured_pending','retry_pending');`
Sonra (aynı başlık sorgusu, tek satır özet):
```sql
select p.proname, p.pronargs, md5(replace(p.prosrc, E'\r', '')) as body_md5 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('enforce_plan_capacity','enforce_tenant_plan_capacity','fulfill_billing_payment','fulfill_billing_payment_v2','seat_purchase_ready') and not (p.proname = 'fulfill_billing_payment' and p.pronargs = 9) order by 1;
```
(9 argümanlı ESKİ `fulfill_billing_payment` overload'u süzülür; o değişmez.) Beklenen md5'ler (SONRA):
`enforce_plan_capacity e7cdf30c88c0ff4ef67077e5c3f1cdd7` · `enforce_tenant_plan_capacity bf75fbeb7e4336a8dcf42babd77d0917` ·
`fulfill_billing_payment (10 arg) 0f5b4589c3608509d3c7390e08c7834d` · `fulfill_billing_payment_v2 5fc1c6552b2fe6f963fb72ea3264e03e` ·
`seat_purchase_ready d578f76b757ba88b64966be93d6b88b4`. (Değerler ajan tarafından dosya gövdelerinden yeniden hesaplandı ve başlıkla eşleşti.)
**İşlev doğrulaması (salt-okunur transaction, yazma yok):**
```sql
begin read only; select set_config('request.jwt.claims', '{"role":"service_role"}', true); select public.seat_purchase_ready() as hazir; rollback;
```
Beklenen: `hazir = t`. Claim ayarlanmadan doğrudan `select public.seat_purchase_ready();` → `f` (SQL editöründe beklenen, hata değil).
Gözlem: koltuk satışı kodda en geç 60 sn içinde açılır; ilk satışı TEST ofisinde deneyin. Bilinen açıklar (dosya başlığı): yenilemede ek koltuk
ücretlenmez, koltuk fiyat kilidi yazılmaz, dahil koltuk iki kaynaktan (kod 15 / DB 20 Profesyonel).

### 4.7 `20260825000700_survey_module`
Önce (rollback için kayıt): `select count(*) from public.permission_defaults where module='surveys';`
Sonra:
```sql
select (select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relname in ('survey_settings','survey_assignees','survey_templates','survey_questions','survey_triggers','survey_tasks','survey_answers','survey_attempts')) as rls_tablo, (select count(*) from pg_policies where schemaname='public' and tablename in ('survey_settings','survey_assignees','survey_templates','survey_questions','survey_triggers','survey_tasks','survey_answers','survey_attempts')) as pol, (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('survey_is_manager','survey_can_work_task','guard_survey_task_update')) as fn, (select count(*) from pg_trigger where tgname='trg_survey_tasks_guard' and not tgisinternal) as trg, (select count(*) from public.permission_defaults where module='surveys') as izin;
```
Beklenen: `8 | 27 | 3 | 1 | 16` (izin: önceden satır varsa ≥16). Smoke: anketör (atanmış kullanıcı) yalnız arama/cevap alanlarını günceller.

### 4.8 `20260825000800_growth_referral_partner_attribution`
```sql
select (select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relname in ('growth_reward_rules','growth_partners','growth_referral_codes','signup_attributions','growth_reward_claims','account_credit_ledger','growth_partner_payouts','success_stories')) as rls_tablo, to_regclass('public.account_credit_balances') is not null as view, (select count(*) from pg_policies where schemaname='public' and policyname in ('growth_referral_codes_own','credit_ledger_own_select')) as pol, (select count(*) from pg_trigger where tgname='trg_credit_ledger_immutable' and not tgisinternal) as trg;
```
Beklenen: `8 | t | 2 | 1`. Program varsayılan kapalı kalır (`src/lib/growth/settings.ts`).

### 4.9 `20260825000900_growth_click_counters`
```sql
select to_regclass('public.growth_click_counters') is not null as tablo, (select relrowsecurity from pg_class where oid='public.growth_click_counters'::regclass) as rls, (select prosecdef from pg_proc where oid='public.growth_count_click(text,text)'::regprocedure) as definer, has_function_privilege('anon','public.growth_count_click(text,text)','execute') as anon_exec;
```
Beklenen: `t | t | t | f`.

### 4.10 `20260825001000_ai_credit_metering`
```sql
select (select count(*) from information_schema.columns where table_schema='public' and table_name='account_credit_ledger' and column_name in ('feature','model','tokens_in','tokens_out')) as cols, (select pg_get_constraintdef(oid) like '%valuation%' from pg_constraint where conname='account_credit_ledger_unit_check') as unit_ok, (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('ai_credit_charge','ai_credit_metering_ready')) as fn, to_regclass('public.idx_credit_ledger_usage') is not null as idx, has_table_privilege('authenticated','public.account_credit_ledger','insert') as auth_insert, has_table_privilege('authenticated','public.account_credit_ledger','select') as auth_select;
```
Beklenen: `4 | t | 2 | t | f | t`. `/admin/ai-kullanim` "ölçüm yazılmaz" notu kalkar.

### 4.11 `20260825001100_tenant_vitrin_settings`
```sql
select (select count(*) from information_schema.columns where table_schema='public' and table_name='tenants' and column_name in ('vitrin_intro','vitrin_enabled','vitrin_show_phone')) as cols, (select count(*) from pg_constraint where conname='tenants_vitrin_intro_len') as chk, (select count(*) from public.tenants where not vitrin_enabled or not vitrin_show_phone) as kapali;
```
Beklenen: `3 | 1 | 0` (varsayılanlar bugünkü davranış: vitrin açık, telefon görünür).

### 4.12 `20260825001200_tenant_vitrin_sections_seo_optin` — DAVRANIŞ
Önce (salt-okunur; sütun oluşunca sitemap ELLE listeyi yok sayar ve yalnız `vitrin_seo_optin=true` ofisleri alır, hepsi false doğar):
```sql
select value::jsonb -> 'onlyOptIn' as yalniz_optin, value::jsonb -> 'optInTenantSlugs' as elle_liste from public.platform_settings where key = 'seo.sitemap';
```
`yalniz_optin` true/boş ve `elle_liste` doluysa bu ofislerin vitrinleri migration sonrası sitemap'ten DÜŞER. Ofis sahibinin açık onayı
ilkesi gereği migration otomatik doldurmaz; sahibin kararı: (a) ofislerin `/app/ayarlar/vitrin`'den onay vermesi ya da (b) bilinçli bir
yazma kararı (bu kılavuzun kapsamı dışı, ayrı onay). Sonra:
```sql
select (select count(*) from information_schema.columns where table_schema='public' and table_name='tenants' and column_name in ('vitrin_seo_optin','vitrin_show_lead_form','vitrin_show_valuation')) as cols, (select count(*) from public.tenants where vitrin_seo_optin) as optin;
```
Beklenen: `3 | 0`. Gözlem: `/sitemap.xml` ofis vitrinleri yalnız opt-in edenler.

### 4.13 `20260825001300_ownership_transfers`
```sql
select to_regclass('public.ownership_transfers') is not null as tablo, (select relrowsecurity from pg_class where oid='public.ownership_transfers'::regclass) as rls, (select count(*) from pg_policies where schemaname='public' and tablename='ownership_transfers') as pol, (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in ('request_ownership_transfer','accept_ownership_transfer','resolve_ownership_transfer')) as fn, to_regclass('public.uq_ownership_transfers_one_pending') is not null as tek_bekleyen, has_function_privilege('authenticated','public.accept_ownership_transfer(uuid,uuid,uuid)','execute') as auth_exec;
```
Beklenen: `t | t | 2 | 3 | t | f`. Kod (server action) henüz YOK; görünür değişiklik beklenmez.

### 4.14 `20260816000500_commission_earnings_privacy` (EN SON, AYRI gün)
`YAYIN_PENCERESI.md` §P12 önkoşulları + doğrulama SQL'i + §6 rol smoke'u aynen. Tek satır:
```sql
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='can_view_commission_earnings') as fn, (select position('can_view_commission_earnings' in qual) > 0 from pg_policies where schemaname='public' and tablename='commissions' and policyname='commissions_select') as pol;
```
Beklenen: `1 | t`.

## 5. Geri alma (son çare; elle, TERS sırada; ledger satırına dokunmaz)

`20260825001300` → `001200` → `001100` → `001000` (AI kredi; defter kalır) → `000900` → `000800` (defteri SİLER) → `000700` →
`000600` (önce koltuk tahsilatı kalmadığını doğrula) → `000500` (extra_seats/duraklatma verisi silinir) → `000400` → `000300` → `000200` → `000100`.
P12'nin geri alması YAYIN_PENCERESI §8. Ayrıntılı uyarılar her rollback dosyasının başlığındadır.

## 6. Terfide yapılan düzeltmeler (uygulanmamış dosyalar)

| Dosya | Değişiklik | Neden |
|---|---|---|
| 20260825000500 | D bölümü (DO bloğu: `pg_get_functiondef` + `replace` ile fulfill/update_tenant_plan/provision yaması) çıkarıldı; başlık, E notu ve TODO güncellendi | 000300'den sonra desen bulamayıp tüm dosyayı durdururdu; yerini tam gövdeli 000300 aldı |
| 20260825000300 | `plan_monthly_amount` yedek tabanı 990/5990 → 749/4990 (yalnız bu yardımcı); başlıktaki `* 12 * 0.8` metinleri yeniden yazıldı; ön koşul mesaj numaraları | plans.ts tabanı güncellenmişti (TS/SQL ayrışırdı); sabit sözleşme testi yorum metnini de tarar. `fulfill_billing_payment` gövdesi DEĞİŞMEDİ (md5 a69a7609… doğrulandı) |
| 20260825000600 | Yalnız başlık ve ön koşul DO bloğu mesajları/yorumları; fonksiyon gövdeleri (gövde içi yorumlar dahil) değişmedi | Gövde md5'leri başlıktaki BEKLENEN SONRA tablosuna bağlı; yeniden hesaplandı ve eşleşti |
| 20260825000200 | `geo_change_requests_insert` WITH CHECK: `status='pending'`, çözüm alanları boş, `requested_by` boş ya da `auth.uid()` | Ofis üyesi "onaylandı" durumunda ya da başkası adına bildirim yazabiliyordu; kod bu alanları göndermez |
| 20260825001000 | `revoke all … from public, anon` → `from public, anon, authenticated` (+ SELECT yeniden verilir) | Supabase varsayılan ayrıcalıkları authenticated'a yazma + TRUNCATE verir; RLS TRUNCATE'i durdurmaz |
| 000400 / 000500 / 000200 rollback | Yeni rollback dosyaları yazıldı | Taslaklarda yoktu |
| Tüm başlıklar | Yeni numara, eski taslak adı, `--only` komutu, rollback yolu | Terfi |

---

## 7. Pencere PB9 — EmlakFiyati kontör (20260826000100..000300; HİÇBİRİ UYGULANMADI)

> Sahip bildirimi: §3'teki 13 dosya ve P12 CANLIDA UYGULANDI. Bu pencere yalnız aşağıdaki üç YENİ dosyadır. Ajan yalnız
> HAZIRLADI (canlı DB'ye bağlanılmadı, prova/dry-run koşulmadı). Uygulama: restore edilebilir backup/PITR doğrulandıktan
> sonra SAHİP, `--only` ile, aşağıdaki sırayla. Kod (TS kontör akışı) henüz YOK; şema uygulanınca hiçbir ekran değişmez.

| # | Dosya | Rollback | Etki |
|---|---|---|---|
| 1 | `20260826000100_ef_credit_wallet` | var (veri varsa yapısal kısmı atlar) | ek: defter CHECK genişler (`ef` + kaynaklar), `meta` sütunu, `ef_credit_reservations`, 7 service_role RPC |
| 2 | `20260826000200_ef_reports` | var (satır varsa `emlaksoft.rollback_force` ister) | ek: `ef_reports` (yazma yalnız service_role) |
| 3 | `20260826000300_ef_credit_pack_fulfillment` | var (000600 gövdelerine birebir döner) | **davranış**: fulfill + v2 `credit_pack` faturasını işler (taban gövde bayt bayt korunur) |

### 7.0 Önkoşul (salt-okunur)
```bash
npm run check:migrations                 # "sağlıklı: 237 dosya · son 20260826000300_ef_credit_pack_fulfillment.sql"
npm run check:migration-pairs            # "0 hata" (PB9-ef-kontor penceresi, ef-kontor grubu)
npm run check:migrations -- --database   # BEKLENEN: yalnız bu 3 dosya bekliyor; drift/checksum görülürse DUR
npm run db:migrate -- --dry-run          # "3 migration uygulanacak" (ad sırası = uygulama sırası)
npm run db:rehearse -- --yes-i-understand-locks --ef   # önerilir: tek transaction + HER KOŞULDA ROLLBACK, FAIL varsa DUR
```
Prova (`--ef`) kontrolleri: (1) fatura gövdeleri ÖNCE = 20260825000600/000300, SONRA = yalnız fulfill/v2 değişir; (2) dosya başına
varlık (§7.1–7.3 sorguları); (3) `seat_purchase_ready` ve `ef_credit_ready` service_role ile true, claim'siz false; (4) plan yenileme
+ ek koltuk + plan değişimi smoke'u YENİ gövdelerle (korunuyor mu); (6) cüzdan: grant 100 → reserve 5 (95/5) → aynı idem duplicate →
kesinleştir (95, harcanan 5) → tekrar already → reserve 200 insufficient → reserve 3 + release (95) → 1 saatlik rezerv süpürülür →
aynı idem grant already → 0 kontör kaydı → 22023/42501 retleri; (8) `credit_pack` faturası +25 kontör, tekrar etkisiz, net uyuşmazlığı
22023, dönem/plan/tutar değişmez, bilinmeyen tür reddi korunur; (9) RLS: danışman başka ofisi ve sahibin raporunu görmez,
authenticated `ef_credit_*` çağıramaz (42501), `ef_reports`'a yazamaz; sahip ofisin tüm raporlarını görür. Kilit: `account_credit_ledger`
(ACCESS EXCLUSIVE, ROLLBACK'e kadar) — AI ölçüm yazımları bekler; düşük trafikte.

Ledger'da hiçbiri olmamalı:
```sql
select version from public.schema_migrations where version like '20260826%';   -- 0 satır
```

### 7.1 `20260826000100_ef_credit_wallet`
Önce (salt-okunur; rollback güvenliği):
```sql
select to_regclass('public.ef_credit_reservations') is null as tablo_yok, (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'ef\_credit\_%') as fn, (select count(*) from information_schema.columns where table_schema='public' and table_name='account_credit_ledger' and column_name='meta') as meta;
```
Beklenen: `t | 0 | 0`.
```bash
npm run db:migrate -- --only 20260826000100_ef_credit_wallet.sql
```
Sonra:
```sql
select (select pg_get_constraintdef(oid) like '%''ef''%' from pg_constraint where conname='account_credit_ledger_unit_check' and conrelid='public.account_credit_ledger'::regclass) as unit_ef, (select count(*) from pg_constraint where conrelid='public.account_credit_ledger'::regclass and conname in ('account_credit_ledger_ef_entry_check','account_credit_ledger_meta_check')) as chk, to_regclass('public.ef_credit_reservations') is not null as tablo, (select relrowsecurity from pg_class where oid='public.ef_credit_reservations'::regclass) as rls, (select count(*) from pg_policies where schemaname='public' and tablename='ef_credit_reservations') as pol, (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in ('ef_credit_balance','ef_credit_reserve','ef_credit_commit','ef_credit_release','ef_credit_grant','ef_credit_sweep','ef_credit_ready')) as fn, has_function_privilege('authenticated','public.ef_credit_reserve(uuid,uuid,integer,text,text)','execute') as auth_exec, (select count(*) from public.account_credit_ledger where unit='ef') as ef_satir;
```
Beklenen: `t | 2 | t | t | 1 | 7 | f | 0`. AI kredi davranışı değişmez (§4.10 sorgusu aynı sonucu verir). `ef_credit_ready()` bu adımdan sonra
service_role ile bile **false** (000300 henüz yok) — beklenen.

### 7.2 `20260826000200_ef_reports`
```bash
npm run db:migrate -- --only 20260826000200_ef_reports.sql
```
```sql
select to_regclass('public.ef_reports') is not null as tablo, (select relrowsecurity from pg_class where oid='public.ef_reports'::regclass) as rls, (select count(*) from pg_policies where schemaname='public' and tablename='ef_reports') as pol, (select count(*) from pg_constraint where conrelid='public.ef_reports'::regclass and contype='f' and conname in ('ef_reports_tenant_id_fkey','ef_reports_user_id_fkey','ef_reports_reservation_id_fkey','ef_reports_pdf_reservation_id_fkey')) as fk, has_table_privilege('authenticated','public.ef_reports','insert') as auth_insert, has_table_privilege('authenticated','public.ef_reports','select') as auth_select;
```
Beklenen: `t | t | 1 | 4 | f | t`.

### 7.3 `20260826000300_ef_credit_pack_fulfillment` (davranış)
Önce (salt-okunur; sapma = DUR, dosyanın ön koşulu da durur):
```sql
select p.proname, p.pronargs, md5(replace(p.prosrc, E'\r', '')) as body_md5, position('credit-pack:v1' in p.prosrc) > 0 as credit_pack_v1, position('seat-fulfillment:v1' in p.prosrc) > 0 as seat_v1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('fulfill_billing_payment','fulfill_billing_payment_v2') and not (p.proname = 'fulfill_billing_payment' and p.pronargs = 9) order by 1;
```
Beklenen (ÖNCE): `fulfill_billing_payment | 10 | 0f5b4589c3608509d3c7390e08c7834d | f | t` ·
`fulfill_billing_payment_v2 | 10 | 5fc1c6552b2fe6f963fb72ea3264e03e | f | t`. Bilgi: bekleyen tahsilat
`select status, count(*) from public.billing_payment_captures where status in ('captured_pending','retry_pending') group by 1;`
```bash
npm run db:migrate -- --only 20260826000300_ef_credit_pack_fulfillment.sql
```
Sonra (aynı sorgu): `fulfill_billing_payment | 10 | 48be5cd7f2f755c860d326209f52c9a3 | t | t` ·
`fulfill_billing_payment_v2 | 10 | 47f246dea3152903ef17edd8cd08f95d | t | t` (9 argümanlı ESKİ overload süzülür, değişmez).
**Hazırlık (salt-okunur transaction):**
```sql
begin read only; select set_config('request.jwt.claims', '{"role":"service_role"}', true); select public.ef_credit_ready() as ef_hazir, public.seat_purchase_ready() as koltuk_hazir; rollback;
```
Beklenen: `t | t`. Claim ayarlanmadan doğrudan `select public.ef_credit_ready();` → `f` (SQL editöründe beklenen, hata değil).
Gözlem: plan yenileme ve ek koltuk satışı aynen çalışır (gövde tabanı bayt bayt aynı; `ef-wallet-sql-contract.test.ts` kanıtlar).
Kontör paketi satışı KOD gelene dek açılmaz (paket kataloğu varsayılan boş, TS akışı yok).

### 7.4 Geri alma (son çare; elle, TERS sırada; ledger satırına dokunmaz)
`20260826000300` (fulfill/v2 → 000600 gövdeleri; `ef_credit_ready` false olur; eklenmiş kontör defterde KALIR) →
`20260826000200` (`ef_reports` silinir: satır varsa `set local emlaksoft.rollback_force = 'on'` gerekir) →
`20260826000100` (7 RPC her zaman kaldırılır; defterde `ef` satırı varsa CHECK/meta geri alınmaz ve rezerv tablosu satır içeriyorsa
korunur — append-only defter, NOTICE ile atlar). Ayrıntılar rollback dosya başlıklarında.

### 7.5 Bilinen sınırlar / sahip kararları
- Kontör SÜRESİZ (v1); paket süresi/FIFO yok. Plan içi aylık kontör (`plan_monthly`) için RPC hazır, zamanlayıcı/kod yok.
- 15 dk'dan uzun süren bir EmlakFiyati çağrısının rezervi süpürülürse sonradan kesinleştirme `released` alır (müşteri lehine; aylık
  mutabakat `GET /kullanim` ile yakalanır). Süpürme cron'u henüz yok (`ef_credit_sweep` çağıran rota yazılmadı).
- `account_credit_balances` görünümü `ef` için açık rezervleri düşmez; kullanılabilir bakiye yalnız `ef_credit_balance`.
- `ef_credit_reservations` silinemez (guard tetikleyici) ve defter append-only: tenant'ın fiziksel silinmesi zaten engelliydi (ofis kapatma = arşiv).

## 8. Pencereler PB10-PB15 — TL kredi, referans motoru, kart, program seed, büyüme paneli rol kapısı (2026-10-05)

**Durum:** `20260826000400 … 000800` CANLIDA UYGULANDI (bu bölüm onların kayıt/doğrulama/geri alma referansıdır; yeniden uygulanmaz).
`000900` (hotfix), `001000`, `001100` HENÜZ UYGULANMADI: aşağıdaki sıra ve ön koşullarla, tek tek `--only` ile.
Genel kurallar §0/§1 aynen geçerli: önce restore edilebilir backup/PITR teyidi, `npm run check:migrations -- --database` (drift yok), `npm run db:migrate -- --dry-run` (yalnız beklenen dosya),
sonra `npm run db:migrate -- --only <dosya>` (ASLA `--help`/keşif bayrağıyla yazan komut deneme), her dosyadan sonra salt-okunur doğrulama, sonunda `npm run db:rls-audit` ve release çiftini DB'deki son migration'a çekme (DEPLOY.md §2).

### 8.1 Sıra
| # | Dosya | Pencere | Durum | Etki |
|---|---|---|---|---|
| 1 | `20260826000400_try_credit_wallet` | PB10 | UYGULANDI | ek (try defter CHECK + rezerv tablosu + RPC) |
| 2 | `20260826000500_try_credit_invoice_payment` | PB10 | UYGULANDI | ek (yeni fonksiyonlar; fulfill gövdelerine dokunmaz) |
| 3 | `20260826000600_growth_referral_engine` | PB11 | UYGULANDI | ek (bayraklar KAPALI doğar) |
| 4 | `20260826000700_payment_cards` | PB12 | UYGULANDI | ek (2 tablo + RPC) |
| 5 | `20260826000800_default_program_settings` | PB13 | UYGULANDI | davranış (VERİ seed: referans bayrağı açılır, hoş geldin 300 TL, katalog kaydı) |
| 6 | `20260826000900_*` (hotfix, başka ajan) | PB14 | BEKLİYOR | dosya başlığındaki doğrulamayı izle (bu belge yazılırken dosya depoda yoktu) |
| 7 | `20260826001000_growth_dashboard_roles` | PB15 | BEKLİYOR | davranış (yalnız owner/gm için `growth_my_dashboard`/`growth_my_partner_dashboard` veri döner) |
| 8 | `20260826001100_*` (başka ajan) | ayrı | BEKLİYOR | dosya başlığını izle |

Bağımlılık: 000400/000500 → 000600 → 000800 (seed) → 001000. 001000, 000600'ün iki fonksiyonunu `CREATE OR REPLACE` eder; 000600 yoksa ön koşul bloğu durur.

### 8.2 Dosya başına salt-okunur doğrulama (uygulama SONRASI)
**000400:** dosya başlığındaki sorgu (try CHECK, rezerv tablosu RLS/politika, 8 RPC, `authenticated` rezerv yetkisi YOK):
```sql
select (select count(*) from pg_constraint where conname='account_credit_ledger_try_entry_check') as try_chk, to_regclass('public.try_credit_reservations') is not null as tablo, (select relrowsecurity from pg_class where oid='public.try_credit_reservations'::regclass) as rls, (select count(*) from pg_policies where schemaname='public' and tablename='try_credit_reservations') as pol, (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in ('try_credit_balance','try_credit_grant','try_credit_reserve','try_credit_commit','try_credit_release','try_credit_reverse','try_credit_my_overview','try_credit_ready')) as fn, has_function_privilege('authenticated','public.try_credit_reserve(uuid,uuid,numeric,text,uuid,numeric)','execute') as auth_exec, has_function_privilege('authenticated','public.try_credit_my_overview()','execute') as my_exec, (select count(*) from public.account_credit_ledger where unit='try') as try_satir;
```
Beklenen: `1 | t | t | 1 | 8 | f | t | <mevcut try satırı, genelde 0>`.

**000500:** altı fonksiyon var, `try_credit_ready` `authenticated`'a açık değil; fulfill gövdeleri değişmedi (000300 sonrası md5'ler §7.3):
```sql
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('try_credit_invoice_hold','try_credit_fulfill_invoice','try_credit_release_invoice','try_credit_release_dead','try_credit_refund_invoice','try_credit_ready')) as fn, has_function_privilege('authenticated','public.try_credit_ready()','execute') as auth_ready;
```
Beklenen: `6 | f`. Ofiste "Hesap kredimi kullan" 000400+000500 + `try_credit_ready()` (service_role) hazır olunca görünür.

**000600:** dosya başlığındaki sorgu:
```sql
select to_regclass('public.growth_referral_settings') is not null as settings, to_regclass('public.growth_claim_events') is not null as events, (select count(*) from public.growth_referral_settings) as ayar_satiri, (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname like 'growth\_%') as fn, has_function_privilege('authenticated','public.growth_claims_process(integer)','execute') as auth_process, has_function_privilege('authenticated','public.growth_my_dashboard()','execute') as auth_dash, (select count(*) from public.growth_reward_claims) as talep;
```
Beklenen: `t | t | 1 | 20 | f | t | 0` (`talep` kullanım sonrası artabilir; sayılar dosya başlığıyla birlikte okunur).

**000700:** tablolar + RLS, ham kart sütunu YOK:
```sql
select to_regclass('public.payment_cards') is not null as kart, to_regclass('public.tenant_payment_profiles') is not null as profil, (select count(*) from information_schema.columns where table_schema='public' and table_name='payment_cards' and column_name in ('card_number','pan','cvc','cvv','expiry','expire_month','expire_year')) as ham_alan, (select bool_and(relrowsecurity) from pg_class where oid in ('public.payment_cards'::regclass,'public.tenant_payment_profiles'::regclass)) as rls;
```
Beklenen: `t | t | 0 | t`. `ham_alan` 0'dan farklıysa DUR (PCI).

**000800 (veri seed):** idempotent; ikinci çalıştırma satır değiştirmez:
```sql
select (select count(*) from public.growth_reward_rules where kind='referral' and is_active) as kural, (select welcome_credit_try from public.growth_referral_settings where singleton) as hos_geldin, (select value from public.platform_settings where key='growth_referral_enabled') as ref_bayrak, (select count(*) from public.platform_settings where key in ('growth_partner_enabled','growth_cash_payout_enabled','billing.auto_renew_enabled') and value in ('on','true')) as kapali_olmasi_gerekenler_acik;
```
Beklenen: `>=1 | 300 (panelden değişmediyse) | on | 0`. Ortak/nakit/otomatik yenileme bayrakları KAPALI kalmalıdır.

**001000 (büyüme paneli rol kapısı):** yalnız iki fonksiyon gövdesi değişir:
```sql
select pg_get_functiondef('public.growth_my_dashboard()'::regprocedure) like '%current_profile_role()%' as dash_rol, pg_get_functiondef('public.growth_my_partner_dashboard()'::regprocedure) like '%current_profile_role()%' as partner_rol, has_function_privilege('authenticated','public.growth_my_dashboard()','execute') as auth_dash;
```
Beklenen: `t | t | t`. Duman testi (rol): owner/gm ile `/app/buyume` dolu; danışman ile sayfa `/app?yetki=yok`'a döner (kod kapısı) ve RPC `null` döner (SQL kapısı).

**000900 / 001100:** dosya başlığındaki "SALT-OKUNUR DOGRULAMA" bloğu esastır; bu belge o dosyalar depoya girince güncellenmelidir.

### 8.3 Geri alma (son çare; elle, TERS sırada; ledger satırına dokunmaz; ÖNCE bayrakları kapat)
Sıra: `001100` → `001000` → `000900` → `000800` → `000700` → `000600` → `000500` → `000400` (her biri `supabase/rollbacks/<ad>.rollback.sql`).
- **001000:** iki fonksiyonu 000600'ün orijinal gövdesine döndürür (rol kapısı kalkar). Veri kaybı yok.
- **000800:** seed'in yazdığı satırları geri alır; panelin sonradan değiştirdiği değerler (`updated_by` dolu) KORUNUR. Önce referans bayrağını `off` yap.
- **000700:** kayıtlı kart satırları silinir; iyzico'daki saklanan kartlar KALIR (panelden/API'den ayrıca silinir).
- **000600:** bayrakları KAPAT; `growth_reward_claims` doluysa denetim izi kaybolur (`set local emlaksoft.rollback_force = 'on'` gerekir). Verilmiş TL krediler KALIR.
- **000500:** önce `select count(*) from public.try_credit_reservations where state='reserved'` boşalt. Harcanmış kredi ve committed rezervler KALIR.
- **000400:** try RPC'leri kalkar, kredi akışı "etkin değil"e düşer; defter append-only, try satırları KALIR; rezerv tablosu yalnız boşsa düşer.
Kod rollback'i veri restore'u değildir (`docs/runbooks/ROLLBACK.md`).

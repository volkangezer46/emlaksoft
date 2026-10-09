# DB performans raporu 3 (2026-10-09, salt-okunur ölçüm)

Yöntem: canlı DB'ye yalnız `begin read only` (+ `rollback`); pg_stat_statements OKUNDU, sıfırlanmadı. EXPLAIN (ANALYZE, BUFFERS)
`set local role authenticated` + demo-ofis **owner** JWT claim'i altında (RLS gerçek), her sorgu 3 kez. Geçici betikler silindi.
Migration: `supabase/migrations/20261009000200_db_perf_rls_initplan_kpi.sql` (+ `supabase/rollbacks/`). UYGULANMADI (db:migrate yok).

## 0. Ana sonuç (dürüst)

Veri hâlâ küçük (en büyük tenant 42 müşteri / 19 ilan / 46 talep; en büyük tablo `geo_neighborhoods` 13 MB). Sıcak bağlantıda
tüm liste/sayım sorguları **0,3-1,8 ms**, kabuk RPC'leri 2-6 ms. pg_stat_statements'taki 100-300 ms ortalamalar ve 7-8 sn max'ler
`stats_reset = 2026-07-21`'den beri birikimli (RLS plpgsql düzeltmesinden ÖNCE dahil); bugünkü yavaşlığı açıklamaz. Yani yavaş
hissin kaynağı sorgu planı değil: (a) soğuk arka uç (ilk çağrıda 20-100 ms: relcache + plpgsql derleme), (b) istek başına PostgREST tur sayısı
(bkz. §3), (c) satır başına çağrılan RLS fonksiyonları (veri büyüdükçe doğrusal; §2-A).

## 1. pg_stat_statements özeti (stats_reset 2026-07-21; tüm DB, `list_changes` poller hariç)

| # | Sorgu | Çağrı | Ort. ms | Toplam sn | Not |
|---|---|---|---|---|---|
| 1 | customers `deleted_at is null` sayfa+count | 6 742 | 176 | 1 187 | max 7,9 sn; ESKİ dönem (RLS düzeltmesi öncesi) |
| 2 | customer_demands status=any sayfa+count | 8 465 | 111 | 941 | aynı |
| 3 | properties sayfa+count | 6 218 | 144 | 892 | aynı |
| 4 | `select name from pg_timezone_names` | 955 | 583 | 557 | uygulama dışı (Studio/dashboard) |
| 5 | appointments `scheduled_at >=` | 5 792 | 73 | 421 | |
| 6 | `check_rate_limit` RPC | 20 084 | 18,5 | 371 | yazan fonksiyon (upsert); cron/public yol |
| 7 | tenants.status (proxy, eski yol) | 104 686 | 2,3 | 241 | `proxy_gate_snapshot` ile tek tura inmiş (1 647 çağrı, 7,8 ms) |
| 8 | profiles gate (eski yol) | 78 454 | 1,6 | 129 | aynı |
| 9 | cron_heartbeats upsert | 41 695 | 3,3 | 139 | |
| 10 | `app_shell_bootstrap` | 788 | 40 | 32 | max 1,3 sn (soğuk); sıcak 4-6 ms |
| 11 | rentals status sayfa+count (kiralama) | 1 083 | 62 | 68 | `rental_kpi_snapshot` ile 5 sorgu -> 1 |
| 12 | `tenant_reporting_aggregates` | 55 | 118 | 6,5 | sıcak 4,3 ms |
| - | lig/`rent_payments`/aidat RPC | az çağrı | 11-45 | <1 | yeni modüller, trafik düşük |

Yeni modüller (lig, rent_payments, bina/aidat, ilan analizi, platform_dashboard_rollups) toplam süreye anlamlı pay vermiyor.

## 2. Uygulananlar (migration)

### A) RLS initplan sarması (57 politika)

Denetim: `pg_policies` içinde `(select fn())` ile SARILMAMIŞ `has_effective_permission`, `current_(active_)tenant_id`,
`current_profile_role`, `auth.uid()` çağrısı olan 57 politika (league_*, deal_process_steps, listing_analyses, profiles,
tenants, platform_staff, notifications, tenant_settings, user_scopes, scope_overrides, settings_history, oversight_*, compliance_*,
saved_views, advisor_*, vb.). Hepsi `ALTER POLICY` ile yalnız ifade metni değişir; ifade metinleri canlı `pg_policies`'ten üretildi.

Ölçüm (80 satırlık customers x 300 = 24 000 satır, owner JWT):

| Sorgu | Önce ms | Sonra ms |
|---|---|---|
| `where has_effective_permission(...)` satır başına (çıplak) | 17,1 | 4,6 (`(select ...)` sarılı) |
| fonksiyon başına maliyet | has_effective_permission 0,28 ms/çağrı; current_profile_role 0,10 ms/çağrı | sorgu başına 1 çağrı |

Etki doğrusal: 1 000 satırlık okumada çıplak yazım ~280 ms, sarılı ~0,3 ms. Bugünkü veride fark ms mertebesi; ölçekte belirleyici.

### B) 11 kopya indeks düşürüldü
Birebir aynı (tablo + anahtar + predicate) çiftlerden biri kalır: portal_listings, calls, appointments, tasks, valuations,
demo_requests, campaigns, expenses, communications, property_status_history, property_price_history. Kısıt sahibi/benzersiz
olanlara dokunulmadı (`rent_charges`, token indeksleri vb. atlandı). Kazanç: yazma amplifikasyonu, planlayıcı gürültüsü (ölçülemez, tahmin).

### C) `rental_kpi_snapshot(p_period date)` (security invoker, STABLE)
`/app/kiralama` şimdi 3 satır-çekme (CHARGE_LIMIT ile kesilebilen) + 2 sayım sorgusu yapıyor. RPC aynı toplamları (ödenen/bekleyen/geciken
tutar, geciken adedi, geciken kira sayısı, aktif kira) tek turda ve kesilmeden döndürür; gövde canlıda SELECT olarak doğrulandı (1,3-1,7 ms).
**TS tarafında BAĞLANMADI** (sayfa yükleyicisi başka ajanın alanı); bağlama önerisi: RPC varsa kullan, yoksa mevcut yola düş (rpc-probe deseni).

## 3. Eklenmeyenler ve nedenleri

* **Yeni indeks YOK:** `pg_indexes` doğrulandı; lig/kiralama/aidat/ilan analizi/rapor sorgu kalıplarının hepsi için bileşik/kısmi indeks mevcut
  (ör. `idx_appointments_tenant_status_sched`, `idx_surveys_answered`, `idx_deals_tenant_stage`, `idx_portal_listings_confirm_due`,
  `idx_rent_charges_*`, `idx_building_charges_open`). Kanıtlı eksik yok. Trigram GIN (müşteri/ilan `ilike`) önceki rapordaki gibi
  gerçek ofis ~2-5k müşteriyi geçince eklenmeli (`supabase/proposed/20260814b_*`); bugün seq scan 80 satır.
  Not: `demands` tablosu yok, `customer_demands` indeksleri tam.
* **Lig puan RPC'si YAZILMADI:** `loadLeagueActivity` 10 paralel `paged()` (order id + OFFSET aralığı) okuması + `ref` tekilleştirme + yetki türü/randevu
  türü ağırlıkları TS'te; birebir davranışlı SQL eşleniği ancak TS puan modelinin SQL'e taşınmasıyla mümkün (sözleşme + test yeniden yazımı) — bu görevin
  kapsamı dışı. Öneri: önce `paged()` OFFSET yerine keyset (`id > son_id`), sonra dönem sayımı RPC'si.
* **Rapor merkezi önizleme sayımı RPC'si YAZILMADI:** katalog başına sayım sorgusu farklı; ortak RPC çok fazla yüzey ve sözleşme testi riski.
* **`has_effective_permission` (STABLE plpgsql, SECURITY INVOKER):** sıcak 0,28 ms/çağrı (içinde `current_active_tenant_id` x2 +
  `current_profile_role` + 3 arama). SECURITY DEFINER'a çevirme KARARI beklediği için DOKUNULMADI. Ölçülen: sarılı kullanımda sorgu başına 1 kez
  (§2-A ile fiilen çözülür); soğuk ilk çağrı 100-140 ms (arka uç başına bir kez).

## 4. Bağlantı ve tur sayısı

* Vercel `fra1` (vercel.json) ↔ Supabase `eu-central-1` (Frankfurt): aynı bölge, ağ turu tek haneli ms beklenir. Yerel makineden bölge RTT'si ölçülemez
  (anlamsız); canlıda `Server-Timing` aracı (`perf-tmp.mjs`) ile ölçülmeli.
* Uygulama DB'ye **PostgREST (HTTP)** ile konuşur; `pg` bağlantı havuzu yalnız betiklerde/migration prova kodunda (`src/lib/migration-rehearsal`). Dolayısıyla
  pooler (transaction mode) uygulama gecikmesini etkilemez; `DATABASE_POOLER_URL` portu 5432 (session mod) yalnız araçlar içindir.
* İstek başına tur (kodda okundu): proxy = `auth.getUser()` (Auth HTTP) || `proxy_gate_snapshot` RPC || `getClaims()` (yerel) -> sayfa katmanı
  `getClaims()` (ikinci ağ turu yok); `/app` layout = `app_shell_bootstrap` (tek RPC) + paralel `user_module_prefs` (ayrı PostgREST turu). Gereksiz tur adayı:
  `getUserHiddenModules` sonucunu `app_shell_bootstrap` içine katmak (-1 tur/istek, kabuk RPC'sinin son tanımı baz alınarak ayrı migration).
* `check_rate_limit` (18,5 ms ortalama, yazan upsert): sayfa isteği yolunda ÇAĞRILMIYOR (proxy'de yok); yalnız public/cron/action yollarında.

# DB performans raporu 2 (ölçüm + index doğrulaması)

Tarih: 2026-10-03. Araç: `scripts/perf-measure2.ts` (yalnız okuma: `default_transaction_read_only=on`, `begin read only`,
ROLLBACK; DDL/yazma yok; bağlantı dizesi yazdırılmaz). Önceki rapor: `DB_PERF_RAPORU.md`.
Öneri dosyası: `supabase/proposed/20260814b_perf_indexes_measured.sql` (UYGULANMAMIŞ).

```
npx tsx scripts/perf-measure2.ts --stats                       # pg_stat_statements, tenant boyutları, politikalar
npx tsx scripts/perf-measure2.ts --explain --tenant=demo       # RLS altında EXPLAIN ANALYZE (biggest | demo | <uuid>)
npx tsx scripts/perf-measure2.ts --explain=seqoff --tenant=demo
npx tsx scripts/perf-measure2.ts --indexes
```

## 0. Veri küçük: index kazancı ölçülemez (önce oku)

Canlı DB'de 4 tenant var; en büyüğü `e2e-test` (42 müşteri, 7 ilan, 2 talep, 12 randevu, 48 görev, 0 iletişim),
sonra `demo-ofis` (25 müşteri sayımı bu sorguda, 15 ilan, 37 talep, 5 randevu, 32 görev, 10 komisyon, 18 anlaşma). Tablolar
< 0,5 MB (tek anlamlı tablo `geo_neighborhoods`, 13 MB). Gerçek müşteri verisi yok. Bu boyutta planlayıcı seq scan seçer
ve her sorgu RLS'in sabit ~2 ms'sinde kalır. Bu görevde DDL (rolled-back dahil) yasaktı ve `hypopg` kurulu değil:
hiçbir index denenmedi. Aşağıdaki "SONRA" sütunları TAHMİNDİR; yalnız "ÖNCE" sütunları ölçümdür.

## 1. Ölçülenler

### 1.1 En önemli yeni bulgu: RLS sabit maliyeti düştü (27 ms -> ~2 ms)

Önceki rapordaki ana neden (her tablo sorgusu başına ~25 ms `has_effective_permission`) artık geçerli değil:
commit `317ef64` (migration `20260813000200_rls_helper_functions_plpgsql.sql`) canlıda etkin. Şimdi demo-ofis ve
e2e-test için her satır dönen liste sorgusu **2,0-2,5 ms**, 38-41 buffer, plan 0,1-0,3 ms (satır dönmeyen/ucuz: 0,6-0,8 ms).
Önceki rapordaki "Bulgu 1" öneri bölümü uygulanmış sayılmalı; rapor 1 güncellenmeli.

### 1.2 EXPLAIN ANALYZE, RLS altında (varsayılan planlayıcı; demo-ofis | e2e-test, exec ms)

| Sorgu | demo | e2e | Plan / sorun |
|---|---|---|---|
| customers liste (tenant, deleted_at null, created_at desc, 25) | 2,4 | 4,3 | Seq Scan, filtre ile 43/26 satır elenir (küçük tablo: normal) |
| customers ilike (ad/tel/e-posta) | 2,4 | 2,4 | Seq Scan, 67/68 satır elenir; hiçbir mevcut index ilike'ı çözmez |
| customers count | 2,5 | 2,2 | Seq Scan; ölçekte O(n) |
| properties liste | 2,1 | 2,4 | demo: Seq Scan; e2e: idx_properties_tenant_active |
| properties ilike (kod/başlık/adres) | 2,2 | 2,3 | demo Seq Scan (22 elenen); e2e index + filtre |
| customer_demands liste / active | 2,1 / 2,1 | 2,1 / 2,1 | Seq Scan (küçük) |
| appointments yaklaşan / benim | 2,1 / 2,1 | 2,1 / 2,3 | Seq Scan; seqscan=off: idx_appointments_tenant_scheduled / _assignee_sched, 0,6 ms |
| tasks benim açık | 2,3 | 2,1 | demo: idx_tasks_assigned_to (tek kolon); e2e: Seq Scan 60 elenen |
| tasks gecikmiş sayaç | 5,1 | 2,0 | idx_tasks_tenant_status_due (demo, ilk çalışma soğuk); e2e Seq Scan 80 elenen |
| communications gelen kutusu | 0,6 | 0,7 | idx_communications_tenant, iyi (0 satır) |
| communications müşteri | 4,0 | 2,5 | idx_communications_cust_created kullanılıyor; müşteri alt sorgusu Seq Scan, 10 InitPlan |
| commissions liste / pending | 2,1 / 2,3 | 2,1 / 2,1 | Seq Scan (10 satır) |
| deals liste | 2,1 | 2,1 | Seq Scan (18 satır) |
| notifications okunmamış sayacı | 0,7 | 0,8 | idx_notifications_unread, iyi |
| support_tickets liste | 4,3 | 0,04 | demo: 95 buffer / 5 satır (satır başı security definer çağrısı) |

`seqscan=off` (demo-ofis) ile tüm listeler için uygun bileşik index mevcut ve seçiliyor (customers/properties/demands/
appointments/tasks/communications/commissions/deals): "index iskeleti tam" bulgusu doğrulandı. Eksik olan tek şey `ilike '%x%'`.

### 1.3 pg_stat_statements (birikimli, tüm DB; sıfırlanmadı)

| # | Sorgu | Çağrı | Ort. ms | Toplam sn | Yorum |
|---|---|---|---|---|---|
| 1 | Realtime `list_changes` poller | 272 876 | 6,9 | 1 890 | Altyapı; 6 tablo realtime'da (karar 4) |
| 2 | PostgREST `customers` (deleted_at null, count) | 3 612 | 304 | 1 097 | max 8 sn |
| 3 | PostgREST `customer_demands` (status = any) | 4 641 | 184 | 854 | |
| 4 | PostgREST `properties` (deleted_at null) | 3 237 | 249 | 807 | |
| 5 | PostgREST `appointments` (scheduled_at >=) | 3 881 | 98 | 379 | |
| 6 | `select name from pg_timezone_names` | 589 | 582 | 343 | Uygulama kodunda YOK (grep); Supabase Studio/dashboard kaynaklı |
| 7 | rate-limit RPC (`p_limit`, 20260724000037) | 18 135 | 17,5 | 318 | Her istekte çağrılıyor; yazma yapan fonksiyon |
| 8-20 | customers/demands/tasks/deals/portal_listings PostgREST varyantları | 200-2 500 | 55-570 | 87-286 | aynı örüntü |

ÖNEMLİ YORUM: 100-580 ms ortalamalar ve 7-8 sn max değerleri, ölçtüğüm ~2 ms ile uyuşmuyor. Sayaçlar birikimli ve
RLS düzeltmesinden (1.1) ve InitPlan sarmasından ÖNCEKİ dönemi kapsıyor. Hangisi eski hangisi güncel, stats sıfırlanmadan
ayırt edilemez (karar 1). `blks_read` ~0: yavaşlık I/O değil CPU/plan (RLS fonksiyon çağrıları), uyumlu.

### 1.4 RLS / politika bulguları

* `notifications_tenant_select/update`: `tenant_id` zaten `(select current_tenant_id())` ile sarılı; yalnız `auth.uid()` çıplak
  (ucuz yerleşik fonksiyon; ölçüm: 0,7 ms, 2 InitPlan). Sorun yok, önceki rapordaki "sarılmamış" uyarısı zararsız.
* `profiles.identity_profiles_self_select` ve `tenants.identity_tenants_select`: `auth.uid()/auth.jwt()` çıplak ve `EXISTS (platform_staff|profiles)`
  alt sorguları içeriyor. `profiles` 1,96 M seq_scan / 10,8 M satır okuması, `tenants` 1,0 M, `platform_staff` 288 k seq scan:
  8/4/3 satırlık tablolar, yani CPU etkisi ihmal edilebilir (profiles.liste ölçümü 0,6-0,7 ms, 6 InitPlan). Düzeltmek için
  `(select auth.uid())` sarması yeterli, ama ölçülebilir kazanç beklenmez (tahmin).
* `support_tickets` 321 k seq scan (5 satırlık tablo, idx_scan yalnız 209): `support_tickets_tenant_select_v2` politikası
  `support_is_ticket_staff()` çıplak, `support_tenant_can_read_ticket(tenant_id, created_by)` satır başına çağrılır (security definer,
  içinde `profiles` + `has_effective_permission`). Seq scan'lerin asıl kaynağı muhtemelen `support_ticket_messages` realtime aboneliği
  (poller 272 k çağrı; `support_ticket_events/messages/attachments` politikaları `support_tickets`'a `exists` ile bakar). HİPOTEZ:
  ölçümle doğrulanmadı. Düzeltme: `support_is_ticket_staff()` -> `(select support_is_ticket_staff())` (InitPlan; ölçülebilir kazanç beklenmez,
  tablo 5 satır).
* Tek ölçülebilir demo bulgusu: support_tickets.liste demo-ofis 4,3 ms / 95 buffer (5 satır): satır başına security definer çağrısı.

## 2. Index önerileri: doğrulama durumu

| Öneri (eski dosya) | Karar | Ölçülen ÖNCE | Kazanç (SONRA) | Durum |
|---|---|---|---|---|
| customers full/phone/email trigram GIN | ÖNER (full_name partial DEĞİL: gelen-kutusu join'i `deleted_at` eklemiyor) | Seq Scan, 67 satır elenir, 2,4 ms | TAHMİN: BitmapOr; ancak >~5-10k müşteri/tenant | kullanılabilirlik ilike için mantıksal; ÖLÇÜLMEDİ |
| properties title/code/address trigram GIN | ÖNER | Seq Scan, 22 elenen, 2,2 ms | TAHMİN (aynı) | ÖLÇÜLMEDİ |
| tasks (tenant, assigned_to, due_at) WHERE status<>'done' | ÖNER (düşük öncelik) | idx_tasks_assigned_to + sort; e2e Seq 60 elenen; 2,1-2,3 ms | TAHMİN: sort+filtre yok | ÖLÇÜLMEDİ |
| tasks (tenant, due_at) WHERE status<>'done' | ELE | idx_tasks_tenant_status_due zaten kullanılıyor | marjinal | gerekçe yok |
| communications (tenant, customer, created desc) | ELE | idx_communications_cust_created zaten kullanılıyor, 2,5-4,0 ms | yok | yalnız kopya silinir |
| Kopya index silme (6 adet) | ÖNER (düşük risk) | pg_indexes birebir aynı tanım | TAHMİN: yazma maliyeti/planlayıcı gürültüsü azalır | tanım doğrulandı |

Yeni öneri yok: kısmi indeksler (deleted_at is null, açık görev) listede zaten var; talepler/randevu/komisyon/anlaşma/bildirim için mevcut
index'ler seqscan=off ile doğru seçiliyor. pg_trgm yalnız kodda gerçekten `ilike '%x%'` kullanan yerlere (musteriler, portfoyler,
gelen-kutusu) eklendi; belgeler/tavsiyeler/destek/admin aramaları küçük tablolar, eklenmedi. GIN yazma maliyeti: müşteri/ilan yazımı seyrek.

## 3. Ölçülen vs tahmin

* ÖLÇÜLEN: RLS maliyeti ~2 ms (düzeltme etkin); tüm liste planları ve süreleri; seq scan/rows-removed sayıları; index iskeleti tam;
  index tanımları ve kopyalar; tenant boyutları; pg_stat_statements sıralaması; politika metinleri.
* TAHMİN: her yeni index'in süre kazancı; support_tickets seq scan kaynağı; realtime yükü azalması; `auth.uid()` sarmasının etkisi.

## 4. Ek gözlemler

* PostgREST count sorguları (customers/demands/properties `LIMIT/OFFSET` + count) en çok toplam süreyi harcıyor: sayfa başına birden çok
  `count: exact` yerine tek RPC/tahmini sayaç düşünülebilir (uygulama kodu; bu görevde değiştirilmedi).
* rate-limit RPC (18 k çağrı, 17,5 ms): her istekte yazma; sıcak yol, gözden geçirilmeli.

## 5. Bana sorulması gereken kararlar

1. `select pg_stat_statements_reset();` çalıştırılsın mı? (YAZMA benzeri, ben yapmadım.) Reset sonrası 1-2 gün trafik toplanıp
   1.3'teki 100-580 ms ortalamaların güncel mi eski mi olduğu netleşir. Bence evet.
2. Trigram GIN indexleri (A+B) şimdi mi eklensin, yoksa gerçek müşteri verisi büyüyene kadar beklensin mi? Küçük veride etkisi sıfır,
   yazma maliyeti ihmal edilebilir; kararım: ilk gerçek ofis ~2-5k müşteriyi geçmeden ekle (CONCURRENTLY, runner dışında).
3. Ölçekli doğrulama için izole staging DB'ye sentetik veri (50k müşteri, 20k ilan, 100k görev) yüklenip `EXPLAIN` tekrarı onaylanır mı?
   Onay yoksa tüm kazançlar tahmin olarak kalır.
4. Realtime'daki 6 tablo (özellikle `customers`, `support_ticket_messages`) gerçekten gerekli mi? Poller toplam DB süresinin en büyüğü.
5. Kopya index silmeleri (E bölümü) yeni forward-only migration olarak yazılsın mı?
6. `support_is_ticket_staff()` / `auth.uid()` sarma migration'ı (kazanç tahmini ~0) yazılsın mı, yoksa kozmetik olarak mı bırakılsın?
7. Önceki rapor (`DB_PERF_RAPORU.md`) Bulgu 1 bölümü "uygulandı, 27 -> 2,6 ms" olarak güncellensin mi?

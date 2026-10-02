# DB performans raporu (RLS altında ölçüm)

Tarih: 2026-10-02. Ölçüm aracı: `scripts/perf-explain.ts` (salt-okunur; `authenticated` rolü + gerçek
claim'ler, demo-ofis `sahip@demo.emlaksoft.test`, `EXPLAIN (ANALYZE, BUFFERS)`, her sorgu iki kez, ikincisi raporlanır).
Öneri index'leri: `supabase/proposed/20260814_perf_indexes.sql`.

## Veri boyutu uyarısı (önce oku)

Demo tenant küçük: ~68 müşteri, 23 ilan, 17 randevu, 18 anlaşma, 40 talep, 79 görev (tüm tablolar < 0,5 MB).
Planlayıcı bu boyutta zaten seq scan seçer; "seq scan var" bulgusu bu veride bir sorun DEĞİLDİR.
Index'lerin ölçekli etkisi sentetik veri yazılmadığı için DOĞRULANMADI; aşağıda mantıksal çıkarım olarak işaretlidir.
Buna karşılık RLS fonksiyon maliyeti veri boyutundan bağımsızdır ve gerçek ölçümdür.

## Bulgu 1 (ANA NEDEN): RLS izin kontrolü her sorguda ~25 ms sabit maliyet

Her RLS'li tabloya gelen sorgu (satır dönüyorsa) `has_effective_permission(...)` InitPlan'ını bir kez çalıştırır.

| Ölçüm | Süre |
|---|---|
| customers/properties/deals/tasks/... herhangi bir liste (satır dönen) | 26-45 ms, ~240-300 buffer; veri erişimi < 1 ms |
| Aynı tablo, 0 satır dönen (InitPlan hiç çalışmaz) | 1,5 ms |
| join (deals + commissions) | 52-57 ms (iki tablo = iki kez ödenir) |
| calls.musteri / demands.musteri (customers alt sorgusu + hedef tablo) | 54-75 ms |
| dashboard.sayaclar (6 tablo tek sorguda) | 133-238 ms, 1445 buffer |
| `select has_effective_permission('customers','view')` tek başına | 24-26 ms |
| aynı sorguda iki kez farklı modül | 48-49 ms (doğrusal toplanır) |

Çağrı-noktası mikro ölçümü (aynı deyimde):

| İfade | Süre |
|---|---|
| `current_active_tenant_id()` 1 çağrı noktası | ~1,5 ms |
| 4 çağrı noktası | ~5,2 ms |
| `current_profile_role()` 1 / 3 çağrı noktası | 3,0 / 8,4 ms |
| 100 satırda `current_active_tenant_id()` döngüsü | 0,45 ms/çağrı (plan ilk çağrıda 1 kez hazırlanır) |
| Aynı tenant çözümünün düz SQL karşılığı (fonksiyonsuz) | ~0,04 ms/çağrı |

Yorum: maliyet veri değil, her fonksiyon ÇAĞRI NOKTASININ ilk çalışmasında SQL gövdesinin yeniden
planlanması. `has_effective_permission` SQL fonksiyonu satır-içine alınıyor; gövdesinde
`current_profile_role()` ~4 kez, `current_active_tenant_id()` ~4 kez geçiyor; `current_profile_role`
da içinde `current_active_tenant_id()`'yi iki kez çağırıyor. Toplam ~15-20 ayrı çağrı noktası x 1,3-3 ms = ~25 ms.
(InitPlan sarması 20260813000100 ile doğru yapıldı: fonksiyon sorgu başına BİR kez çalışıyor; kalan maliyet
tek çalışmanın kendi içindeki iç içe çağrılar.)

### Öneri (migration sahibine; bu görevde DDL denemesi izin sınıflandırıcısı tarafından engellendi, bu yüzden DOĞRULANMADI)

Fonksiyonları çağrı noktası sayısını azaltacak şekilde yeniden yaz (semantik aynı kalmalı):

1. `has_effective_permission`'ı plpgsql yap (plan önbelleği backend başına kalır, pooler bağlantıları uzun yaşar)
   ve tenant/rolü yerel değişkene bir kez al: `v_t := current_active_tenant_id(); v_r := role_for(v_t);`.
2. `current_profile_role()` içindeki iki `current_active_tenant_id()` çağrısını tek değişkene indir;
   `role_for(p_tenant uuid)` dahili yardımcısı ile `has_effective_permission` yeniden hesaplamasın.
3. `current_active_tenant_id()` içinde impersonation dalını (platform_staff + impersonation_sessions join'i)
   JWT'de `impersonating='true'` değilse hiç çalıştırma (ucuz ön-kontrol; coalesce zaten ilk dal doluysa atlar, ama
   ilk dal NULL ise bile impersonation yoksa ikinci dalı çalıştırmaya gerek yok).
4. Hedef (tahmin, ölçülmedi): ~25 ms -> ~3-5 ms; dashboard ~130-240 ms -> ~30-50 ms.
   Doğrulama: rolled-back transaction içinde `perf_proto` şemasında prototip kurup `--try-index` benzeri ölçüm.
   Not: ölçüm betiğinin `--try-index` modu yazılabilir bir transaction açıp ROLLBACK eder; bu mod canlıya yazar gibi
   davranır ve yalnız proje sahibi tarafından, bilinçli çalıştırılmalıdır (bu oturumda çalıştırılmadı).

Uygulama tarafı (aynı kök neden): bir sayfa N tablo sorgusu yaparsa N x ~25 ms öder. Sayfa başına tek bir
RPC/birleşik sorgu ya da sorguların paralel (`Promise.all`) çalıştırılması süreyi doğrudan düşürür.
Dashboard sayaçlarını tek `security definer` fonksiyonda (izin bir kez kontrol edilip) toplamak en büyük kazanç.

## Bulgu 2: Sorgu planları (seqscan açık/kapalı)

`npx tsx scripts/perf-explain.ts` ve `--seqscan-off` çıktısı özeti:
- Küçük tablolarda seq scan seçiliyor (customers, properties, demands, appointments, deals, commissions): normal.
- `--seqscan-off` ile her sorgu için uygun index mevcut ve kullanılıyor: customers (tenant_active, tenant_source_active),
  properties (tenant_active, tenant_status_created, txtype_created), demands (tenant_status_created),
  appointments (tenant_scheduled, tenant_assignee_sched, tenant_status_sched), deals (tenant_updated),
  commissions (tenant_created), calls/communications akışı (tenant_started / tenant), audit_logs (tenant_created),
  notifications (user, unread). Yani listeler için tenant önekli bileşik index iskeleti TAM.
- Gerçek eksikler: (a) `ilike '%x%'` aramaları (customers, properties) btree kullanamaz: ölçekte seq/filtre taraması
  (mantıksal çıkarım, doğrulanmadı) -> trigram GIN önerildi. (b) `tasks.benim_acik`: planlayıcı tek kolonlu
  `idx_tasks_assigned_to` seçiyor + sıralıyor; `due_at` sıralı partial index önerildi.
- `customers.sayac` (count(*) where tenant+deleted_at is null) ölçekte tüm tenant müşterilerini sayar
  (index-only olsa bile O(n)); "sıfır çıkmaz metrik" gereği sayaç gerekiyorsa tahmini/önbellekli sayaç düşünülmeli (doğrulanmadı).

## Bulgu 3: Çift / kapsanan index'ler

`--audit` çıktısından kesin kopyalar (aynı kolonlar): appointments `idx_appointments_tenant` = `idx_appointments_tenant_scheduled`;
calls `idx_calls_tenant` = `idx_calls_tenant_started`; tasks `idx_tasks_tenant_status` = `idx_tasks_tenant_status_due`;
communications `idx_communications_customer` = `idx_communications_cust_created`; audit_logs `idx_audit_tenant` ⊂ partial muadili.
Önek-kapsanan: customers `idx_customers_tenant`, customer_demands `idx_demands_tenant_status`, valuations `idx_valuations_tenant_created`, vb.
Ayrıca appointments/customers/properties üzerinde 5-9 tek kolonlu FK index'i var ve idx_scan=0 (kayıt başı yazma maliyeti).
Silme komutları yorum olarak öneri dosyasındadır. idx_scan=0 tek başına gerekçe değildir (veri küçük).

Not: `pg_stat_user_tables` en yüksek seq_scan: `profiles` (1,87 M), `tenants` (0,97 M), `support_tickets` (0,32 M),
`platform_staff` (0,29 M). 8 / 4 / 5 / 3 satırlık tablolar, yani zararsız ama sayılar RLS'in her sorguda profiles+tenants'a
gittiğini kanıtlıyor (Bulgu 1'in yan etkisi). `support_tickets` 320k seq scan'in kaynağı (muhtemelen bir politika/sayaç
ya da destek paneli yoklaması) araştırılmalı.

## Bulgu 4: pg_stat_statements (tüm DB, birikimli)

En çok DB zamanı: Supabase Realtime `list_changes` poller'ı (263 bin çağrı, ort. 6,9 ms, toplam ~1 800 sn).
Uygulama 6 tabloyu realtime'a açmış (notifications, deals, commissions, portal_listings, customers, support_ticket_messages;
migration 20260726000078). Realtime her değişiklik için abone başına RLS değerlendirir; Bulgu 1'deki ~25 ms burada da ödenir.
Gereksiz abonelikleri azaltmak (ör. `customers` için tablo bazlı değil filtreli kanal) ve Bulgu 1 düzeltmesi bu yükü düşürür.
PostgREST sorguları arasında `p_limit` parametreli bir RPC (18 bin çağrı, ort. 17,5 ms) öne çıkıyor; ad doğrulanmadı.

## Bulgu 5: Politikalarda hâlâ sarılmamış çağrılar

285 politika tarandı (kaba regex; elle doğrulanmalı). Tenant-içi iş tablolarında (customers, properties, deals, commissions,
communications, ...) sarılmamış çağrı YOK. Kalanlar (çoğu platform/yardımcı tablo, düşük sıklık):
advisor_messages/sessions (platform_staff_own_*), announcement_reads (insert/update/delete), deal_notes (insert/delete, 1 çağrı kaldı),
notifications_tenant_select/update (1-2 çağrı sarılmamış), platform_* tabloları, platform_staff_self_select, profiles
(`identity_profiles_self_select` 3 çağrı hiç sarılmamış, `self_update`, `platform_select`), saved_views_own, tenant_advisor_*,
tenants (`identity_tenants_select` 4/6 sarılmamış, `update` 2/8), support_ticket_attachments_select.
En önemlisi `profiles` ve `tenants`: Bulgu 3'teki devasa seq scan sayılarının kaynağı büyük olasılıkla bunlar
(her satır için `auth.uid()`/fonksiyon yeniden değerlendirme). `notifications_tenant_select` zil/sayaç için sık çalışır.
Bunlar aynı `( select ... )` sarma deseniyle düzeltilmeli (yeni migration; mevcut dosya değişmez).

## Yeniden üretme

```
npx tsx scripts/perf-explain.ts                  # RLS altında varsayılan plan
npx tsx scripts/perf-explain.ts --seqscan-off    # index kullanılabilirliği
npx tsx scripts/perf-explain.ts --audit          # kullanılmayan/çift index, sarılmamış politika çağrıları
npx tsx scripts/perf-explain.ts --full --only=customers
```

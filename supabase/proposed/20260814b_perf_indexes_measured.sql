-- ÖNERİ DOSYASI — UYGULANMAMIŞ. supabase/migrations'a girmez; numara/uygulama kararı proje sahibinde.
-- Forward-only: yalnız yeni index ekler; hiçbir uygulanmış migration değişmez.
-- Ölçüm ve gerekçe: docs/perf/DB_PERF_RAPORU_2.md  (araç: scripts/perf-measure2.ts, salt-okunur)
-- Bu dosya 20260814_perf_indexes.sql'in ölçüme göre DARALTILMIŞ halidir (onun yerine geçer; ikisini birlikte uygulama).
--
-- UYGULAMA NOTU (CONCURRENTLY):
--   CREATE INDEX CONCURRENTLY transaction bloğu içinde ÇALIŞMAZ. Migration runner dosyayı tek transaction'da
--   koşturuyorsa bu dosya runner dışında (psql, deyim deyim) uygulanmalı; ya da CONCURRENTLY kaldırılmalı
--   (tablolar < 1 MB, kilit süresi ms mertebesi). Başarısız CONCURRENTLY "INVALID" index bırakır:
--   select indexrelid::regclass from pg_index where not indisvalid;  -> varsa drop edip yeniden dene.
--   pg_trgm canlıda kurulu (doğrulandı: pg_extension).
--
-- DÜRÜSTLÜK NOTU (rapor ile aynı):
--   Canlıda en büyük tenant ~42 müşteri / 15-23 ilan / 80 görev. Bu boyutta planlayıcı seq scan seçer ve
--   index kazancı ÖLÇÜLEMEZ. Bu oturumda DDL (rolled-back dahil) yasak olduğundan, hiçbir index
--   "önce/sonra" olarak denenmedi; hypopg kurulu değil. "ÖNCE" planları ölçüldü, "SONRA" kısımları
--   planlayıcı kuralından çıkarılmış TAHMİNDİR ve açıkça öyle etiketlidir. Ölçekli doğrulama için
--   kontrollü staging + sentetik veri gerekir (rapor, Karar 3).

-- ---------------------------------------------------------------------------
-- A) MÜŞTERİ ARAMASI  (src/app/app/musteriler/page.tsx:260-274)
--    Kod: .or(full_name.ilike.%q%, phone.ilike.%q%, email.ilike.%q%[, phone.ilike.%digits%]) + deleted_at is null.
--    ÖNCE (ÖLÇÜLDÜ, demo-ofis, RLS altında):
--      Seq Scan on customers, Rows Removed by Filter: 67, exec 2.4 ms, 41 buffer (customers.ilike)
--      seqscan=off iken bile yalnız idx_customers_tenant ile Filter: 24 satır elenir -> hiçbir mevcut index ilike'ı çözmez.
--    SONRA (TAHMİN, ölçülmedi): OR'un 3-4 kolonunun HEPSİ trigram indexlenirse BitmapOr(3 GIN) AND tenant index;
--      OR'un tek bir kolonu bile indexsizse planlayıcı tüm OR'u seq scan'e düşürür -> üçü birlikte gerekli.
--    ESKİ ÖNERİDEN FARK: full_name index'i PARTIAL DEĞİL. gelen-kutusu (src/app/app/gelen-kutusu/page.tsx:166,181)
--      embedded `customer.full_name ilike` aramasında sorguya `deleted_at is null` eklenmez; partial index
--      orada kullanılamazdı. Silinmiş müşteri oranı düşük olduğundan şişme maliyeti ihmal edilebilir.
--    phone: kod ayrıca rakam-only desen (%5551234%) arıyor; aynı GIN karşılar (telefon normalleştirmesi
--      "05xx xxx" biçimlerini barındırıyorsa trigram yine çalışır). >= 3 karakter altı desenlerde trigram etkisizdir.
--    Maliyet: her INSERT/UPDATE'te GIN güncellemesi (müşteri yazımı seyrek: 78 insert / 3 update ömür boyu).
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_customers_full_name_trgm
  on public.customers using gin (full_name gin_trgm_ops);
create index concurrently if not exists idx_customers_phone_trgm
  on public.customers using gin (phone gin_trgm_ops) where deleted_at is null and phone is not null;
create index concurrently if not exists idx_customers_email_trgm
  on public.customers using gin (email gin_trgm_ops) where deleted_at is null and email is not null;

-- ---------------------------------------------------------------------------
-- B) İLAN ARAMASI  (src/app/app/portfoyler/page.tsx:216, orIlike(property_code,title,address_line))
--    ÖNCE (ÖLÇÜLDÜ): demo-ofis properties.ilike -> Seq Scan, Rows Removed 22, 2.2 ms;
--      "biggest" (e2e-test) idx_properties_tenant_active + filtre, Rows Removed 7.
--    SONRA (TAHMİN): üç GIN BitmapOr. Not: or() koşuluna province/district/portal id eşleşmeleri de eklenir
--      (id IN (...), province_id IN (...)) — bu dallar mevcut btree'lerle (pkey, idx_properties_province_id/district_id)
--      karşılanır; planlayıcı tüm OR dallarını BitmapOr ile birleştirebilir.
--    Geo adları için trigram zaten var (idx_geo_districts_name); geo_provinces 81 satır, gereksiz.
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_properties_title_trgm
  on public.properties using gin (title gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_properties_code_trgm
  on public.properties using gin (property_code gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_properties_address_trgm
  on public.properties using gin (address_line gin_trgm_ops) where deleted_at is null and address_line is not null;

-- ---------------------------------------------------------------------------
-- C) GÖREVLERİM  (tasks: tenant + assigned_to + status<>'done' order by due_at)
--    ÖNCE (ÖLÇÜLDÜ): demo-ofis seqscan=off -> Index Scan idx_tasks_assigned_to (tek kolon, tenant önekli değil)
--      + sort, 2.1 ms (RLS sabit maliyeti baskın); varsayılan planda "biggest" tenant Seq Scan, Rows Removed 60.
--    SONRA (TAHMİN): partial (tenant_id, assigned_to, due_at) sıralı okur, sort ve filtre yok, limit 50'de erken durur.
--    Kazanç yalnız tenant başına >~5k görevde beklenir (şimdi 80 satır).
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_tasks_open_assignee_due
  on public.tasks (tenant_id, assigned_to, due_at) where status <> 'done';

-- ---------------------------------------------------------------------------
-- D) ELENEN ESKİ ÖNERİLER (neden):
--   * idx_tasks_open_due (gecikmiş sayaç): ÖLÇÜM idx_tasks_tenant_status_due kullanıldığını gösterdi
--     (Index Scan, 0 satır elendi, 5.1 ms ilk çalışma sıcak değil); partial muadili ancak ölçekte anlamlı. TAHMİN-ONLY, ELENDİ.
--   * idx_communications_tenant_customer_created: communications.musteri sorgusu zaten
--     idx_communications_cust_created (customer_id, created_at desc) kullanıyor; customer_id yüksek seçicilikli,
--     tenant önekinin ek kazancı yok. ELENDİ. Yalnız kopya index silinmesi kalır (aşağıda E).
--
-- E) KOPYA INDEX SİLME (forward-only yeni migration; veri erişim kaybı yok, yazma maliyeti düşer).
--    Aynı kolon listesi — idx_scan'e DEĞİL tanıma dayanır (ölçüldü: pg_indexes çıktısı birebir aynı):
--      appointments  idx_appointments_tenant         == idx_appointments_tenant_scheduled   (tenant_id, scheduled_at)
--      calls         idx_calls_tenant                == idx_calls_tenant_started            (tenant_id, started_at desc)
--      tasks         idx_tasks_tenant_status         == idx_tasks_tenant_status_due         (tenant_id, status, due_at)
--      communications idx_communications_customer    == idx_communications_cust_created     (customer_id, created_at desc)
--      properties    idx_properties_tenant_status    ⊂  idx_properties_tenant_status_created (partial aynı koşul)
--      customers     idx_customers_tenant            ⊂  idx_customers_live_tenant / uq_customers_tenant_id_id
--      portal_listings idx_portal_listings_tenant    == idx_portal_listings_tenant_status   (tenant_id, status)
--    Ek: tek kolonlu FK indexleri (idx_appointments_customer_id vs idx_appointments_customer(tenant,customer)) kısmen
--    örtüşür; FK cascade/kontrol için gerekebileceğinden dokunulmadı.
--
-- drop index concurrently if exists public.idx_appointments_tenant;
-- drop index concurrently if exists public.idx_calls_tenant;
-- drop index concurrently if exists public.idx_tasks_tenant_status;
-- drop index concurrently if exists public.idx_communications_customer;
-- drop index concurrently if exists public.idx_portal_listings_tenant;
-- drop index concurrently if exists public.idx_properties_tenant_status;

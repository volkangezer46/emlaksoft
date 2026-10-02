-- ÖNERİ DOSYASI — supabase/migrations'a GİRMEZ, numara/uygulama kararı proje sahibinde.
-- Ölçüm ve gerekçe: docs/perf/DB_PERF_RAPORU.md
--
-- ÖNEMLİ DÜRÜSTLÜK NOTU
--  * Demo tenant ~70 müşteri / 23 ilan / 17 randevu; planlayıcı bu boyutta zaten seq scan seçer.
--    Aşağıdaki index'lerin etkisi ölçekli veride (tenant başına >5-10k satır) beklenir ve
--    DOĞRULANMADI. Bugünkü 1-2.5 sn sayfa süresinin ANA nedeni index eksikliği DEĞİL,
--    RLS fonksiyon çağrı noktası maliyetidir (rapor, Bulgu 1).
--  * Kullanılan tüm tablolar küçük (<1 MB): CONCURRENTLY şart değil, ama canlıda yine de
--    `create index concurrently` tercih edilir (yazmayı kilitlemez). CONCURRENTLY transaction
--    bloğu içinde ÇALIŞMAZ; migration runner dosyayı tek transaction'da koşturuyorsa bu
--    dosya runner dışında (psql, tek tek) uygulanmalı ya da CONCURRENTLY kaldırılmalı
--    (tablolar küçük olduğundan kilit süresi ms mertebesindedir).
--  * pg_trgm uzantısı canlıda ZATEN kurulu (pg_extension kontrol edildi).

-- ---------------------------------------------------------------------------
-- 1) Müşteri arama: full_name / phone / email ilike '%x%'
--    Neden: '%x%' önek aramasıdır, btree kullanamaz; bugün her arama tenant'ın tüm
--    müşterilerini tarar (EXPLAIN: Seq Scan on customers, filtre ile). Trigram GIN,
--    partial (deleted_at is null) olduğundan silinmiş kayıtlar index'i şişirmez.
--    Tenant filtresi btree/RLS ile bitmap AND olarak uygulanır.
--    Maliyet: yazma amplifikasyonu; müşteri sayısı küçük tenant'larda fayda yok.
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_customers_name_trgm
  on public.customers using gin (full_name gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_customers_phone_trgm
  on public.customers using gin (phone gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_customers_email_trgm
  on public.customers using gin (email gin_trgm_ops) where deleted_at is null and email is not null;

-- ---------------------------------------------------------------------------
-- 2) İlan arama: title / property_code / address_line ilike '%x%'
--    Neden: aynı (liste sayfasındaki arama kutusu 3 kolonu OR ile arıyor).
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_properties_title_trgm
  on public.properties using gin (title gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_properties_code_trgm
  on public.properties using gin (property_code gin_trgm_ops) where deleted_at is null;
create index concurrently if not exists idx_properties_address_trgm
  on public.properties using gin (address_line gin_trgm_ops) where deleted_at is null and address_line is not null;

-- ---------------------------------------------------------------------------
-- 3) Görevlerim (Bugün ekranı, görev listesi): tenant + atanan + açık, due_at sıralı
--    Neden: mevcut idx_tasks_assignee (tenant_id, assigned_to, status) due_at sırasını
--    veremez; planlayıcı bugün tek kolonlu idx_tasks_assigned_to'yu seçip sıralıyor.
--    Partial (status <> 'done') yalnız açık işleri tutar -> küçük ve sıcak.
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_tasks_open_assignee_due
  on public.tasks (tenant_id, assigned_to, due_at) where status <> 'done';

-- ---------------------------------------------------------------------------
-- 4) Gecikmiş görev sayacı (dashboard): tenant + açık + due_at < now()
--    Neden: (tenant_id, due_at) partial; sayaç index-only taranır.
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_tasks_open_due
  on public.tasks (tenant_id, due_at) where status <> 'done';

-- ---------------------------------------------------------------------------
-- 5) Müşteri akışı (communications): tenant önekli
--    Neden: mevcut (customer_id, created_at desc) index'leri tenant önekli değil ve
--    İKİ KOPYA var (idx_communications_customer == idx_communications_cust_created).
--    Tek tenant önekli index ikisinin yerini alır (aşağıdaki DROP bölümüne bkz.).
-- ---------------------------------------------------------------------------
create index concurrently if not exists idx_communications_tenant_customer_created
  on public.communications (tenant_id, customer_id, created_at desc) where customer_id is not null;

-- ===========================================================================
-- ÇİFT / KAPSANAN INDEX'LER — SİLME ÖNERİSİ (KOMUT OLARAK YORUMDA)
-- Neden: her index her INSERT/UPDATE'te güncellenir ve planlayıcıya gürültü ekler.
-- Politika: uygulanmış migration değiştirilmez; DROP yeni, ileri yönlü bir migration olur.
-- Hepsi aynı kolon listesi (veya başka bir index'in öneki) olup veri erişim kaybı yoktur:
--   appointments  idx_appointments_tenant           == idx_appointments_tenant_scheduled
--   calls         idx_calls_tenant                  == idx_calls_tenant_started
--   tasks         idx_tasks_tenant_status           == idx_tasks_tenant_status_due
--   audit_logs    idx_audit_tenant                  ⊂  idx_audit_logs_tenant_created (tenant_id null değil)
--   communications idx_communications_customer      == idx_communications_cust_created
--                 (yukarıdaki #5 sonrası ikisi de gider)
--   customers     idx_customers_tenant              ⊂  uq_customers_tenant_id_id / idx_customers_phone
--   customer_demands idx_demands_tenant_status      ⊂  idx_demands_tenant_status_created
--   valuations    idx_valuations_tenant_created     ⊂  idx_valuations_tenant
--   (keşfedilen diğer çiftler: rapor + `npx tsx scripts/perf-explain.ts --audit`)
-- NOT: idx_scan=0 TEK BAŞINA silme gerekçesi DEĞİL — veri küçük, planlayıcı seq scan seçiyor.
--
-- drop index concurrently if exists public.idx_appointments_tenant;
-- drop index concurrently if exists public.idx_calls_tenant;
-- drop index concurrently if exists public.idx_tasks_tenant_status;
-- drop index concurrently if exists public.idx_audit_tenant;
-- drop index concurrently if exists public.idx_communications_customer;
-- drop index concurrently if exists public.idx_communications_cust_created;  -- #5 sonrası
-- drop index concurrently if exists public.idx_customers_tenant;
-- drop index concurrently if exists public.idx_demands_tenant_status;

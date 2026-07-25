-- RLS: `tasks` ve `property_media` politikalarını `current_tenant_id()`e hizala
--
-- ============================================================================
-- BULUNAN HATA
-- ============================================================================
-- Bu iki tablonun politikası kiracıyı şu ifadeyle çözüyordu:
--
--     tenant_id = ((select auth.jwt() ->> 'tenant_id'))::uuid
--
-- Yani YALNIZCA üst düzey JWT claim'ine bakıyor. Ama uygulama tenant_id'yi
-- üst düzeye HİÇ yazmıyor — `app_metadata` içine yazıyor:
--
--     src/app/actions/auth.ts:140     app_metadata: { tenant_id, role: "owner" }
--     src/app/actions/team.ts:67      app_metadata: { tenant_id, role }
--     src/app/actions/platform-sales.ts:204
--
-- Projede özel bir access-token hook'u da yok, yani bu değer üst düzeye
-- terfi etmiyor. Sonuç: ifade NULL'a düşüyor, `tenant_id = NULL` hiçbir
-- zaman TRUE olmuyor ve bu iki tablo NORMAL KULLANICIYA TAMAMEN GÖRÜNMEZ.
--
-- `tasks` ve `property_media` kullanıcı istemcisiyle okunuyor
-- (`gorevler/page.tsx`, `actions/tasks.ts`, `actions/property-media.ts` —
-- hiçbiri service_role kullanmıyor), yani Görevler modülü ve portföy
-- medyası RLS katmanında boş dönüyordu.
--
-- ============================================================================
-- KÖK NEDEN: sürüklenme (drift)
-- ============================================================================
--   20260721000000_init.sql        current_tenant_id() = yalnızca üst düzey
--   20260721000002_jwt_claims.sql  DÜZELTİLDİ  → app_metadata yedeği eklendi
--   20260722000021_property_media  düzeltmeden SONRA yazıldı, ESKİ ifadeyi kopyaladı
--   20260722000022_tasks           aynı
--
-- Yani yardımcı fonksiyon düzeltilmiş ama iki tablo yardımcıyı çağırmak
-- yerine ifadeyi satır içi kopyalamış — ve kopyaladıkları sürüm eskiydi.
--
-- ============================================================================
-- BU DEĞİŞİKLİK YETKİYİ GENİŞLETİYOR MU?
-- ============================================================================
-- Kapsam açısından: evet, artık satırlar görünüyor (önce hiç görünmüyordu).
-- Güvenlik açısından: hayır. `current_tenant_id()` yine YALNIZCA çağıranın
-- kendi kiracı kimliğini çözüyor; başka bir kiracının kimliğini döndürebileceği
-- bir yol yok. Kalan 37 kiracı tablosu zaten bu fonksiyonu kullanıyor —
-- bu iki tablo istisnaydı, kural değil.

-- --- tasks ---
drop policy if exists tasks_tenant on public.tasks;

create policy tasks_tenant on public.tasks
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- --- property_media ---
drop policy if exists property_media_tenant on public.property_media;

create policy property_media_tenant on public.property_media
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- WITH CHECK açıkça yazıldı. PostgreSQL, ALL/UPDATE politikalarında WITH CHECK
-- verilmemişse USING ifadesini yazma denetimi olarak da kullanır — yani
-- davranış aynı olurdu. Yine de açık yazmak, ilerideki bir düzenlemede
-- USING değişip WITH CHECK'in geride kalmasını engelliyor.

comment on policy tasks_tenant on public.tasks is
  'Kiracı izolasyonu. current_tenant_id() kullanır — JWT claim ifadesini satır içi kopyalamayın (bkz. 20260725000054).';

comment on policy property_media_tenant on public.property_media is
  'Kiracı izolasyonu. current_tenant_id() kullanır — JWT claim ifadesini satır içi kopyalamayın (bkz. 20260725000054).';

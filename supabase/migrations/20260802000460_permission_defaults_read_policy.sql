-- KRİTİK DÜZELTME: `permission_defaults` üzerinde RLS açık ama HİÇ policy yoktu.
-- Postgres'te RLS açık + policy yok = o komut için TÜM roller için "deny all"
-- (GRANT var olsa bile) — table owner hariç. 20260802000300_identity_session_
-- authorization_hardening.sql, has_effective_permission()'ı SECURITY INVOKER
-- yaptı ve `permission_defaults`'a `grant select ... to authenticated` ekledi
-- ("has_effective_permission is SECURITY INVOKER and therefore needs explicit
-- read access to the immutable permission matrix" yorumu) AMA bir SELECT
-- policy'si eklemeyi unuttu. Sonuç: has_effective_permission() içindeki
-- `exists(select 1 from permission_defaults ...)` alt sorgusu invoker-rights
-- ile çalıştığından RLS'e tabi kalıyor, policy olmadığı için HER ZAMAN boş
-- döndü — yani tenant_role_permissions'ta override'ı olmayan HER rol/modül/
-- aksiyon kombinasyonu için has_effective_permission() sessizce `false` döndü.
-- Bu, komisyon hariç (tenant_role_permissions'ta override'ı olan modüller
-- etkilenmedi) hemen hemen TÜM modüllerde varsayılan-matris'e dayanan
-- erişimi kırdı (örn. gider/expenses sayfası "Henüz gider kaydı yok" gösterdi
-- çünkü RLS altında listExpenses() sıfır satır döndürdü).
--
-- Düzeltme: permission_defaults tenant-scope'suz, herkese açık/immutable bir
-- referans tablosu (aynı satırlar her tenant için geçerli) — tenant_role_
-- permissions/user_permission_overrides'ın aksine `tenant_id` kolonu bile yok.
-- Bu yüzden SELECT policy'si koşulsuz `using (true)` olmalı; yazma zaten
-- hiçbir yerden app tarafından yapılmıyor (yalnız migration/seed insert eder).

drop policy if exists permission_defaults_read on public.permission_defaults;
create policy permission_defaults_read
on public.permission_defaults for select
to authenticated, service_role
using (true);

notify pgrst, 'reload schema';

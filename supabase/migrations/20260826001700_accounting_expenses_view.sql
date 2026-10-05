-- MIGRATION 20260826001700_accounting_expenses_view.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001700_accounting_expenses_view.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001700_accounting_expenses_view.rollback.sql
-- BAGIMLILIK: public.permission_defaults (role, module, action) tablosu. On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC: src/lib/permissions.ts DEFAULT_MATRIX'te muhasebe (accounting) rolune `expenses` modulu icin YALNIZ `view`
-- eklendi (gider ve aidat sayfalari ayni `expenses` modulunu kullanir; ayri `dues` modulu YOK). DB kopyasi ayni olmali.
-- Muhasebe icin gider/aidat create/edit/delete YOKTUR.
-- Idempotent: on conflict do nothing. Kullanici istisnalarina (user_permission_overrides) ve tenant
-- ozellestirmelerine DOKUNMAZ; mevcut satirlar ezilmez. Forward-only.
--
-- SALT-OKUNUR DOGRULAMA (uygulamadan sonra):
-- select action from public.permission_defaults where role='accounting' and module='expenses';
-- BEKLENEN: yalniz 'view'

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.permission_defaults') is null then
    raise exception 'permission_defaults yok; once temel permission migrationlari uygulanmali.';
  end if;
end $$;

insert into public.permission_defaults (role, module, action)
values ('accounting', 'expenses', 'view')
on conflict do nothing;

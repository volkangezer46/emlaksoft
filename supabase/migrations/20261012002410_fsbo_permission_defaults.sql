-- MIGRATION 20261012002410_fsbo_permission_defaults.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261012002410_fsbo_permission_defaults.rollback.sql
-- BAGIMLILIK: 20260722000014_permission_matrix (permission_defaults), 20261012002400_fsbo_leads (RLS has_effective_permission('prospecting', ...)).
--
-- Sahibinden ilanlar (prospecting) modulu: permission_defaults seed'i (4. kayit noktasi).
-- MATRIS (src/lib/permissions.ts ile BIREBIR): owner/gm/branch_manager/team_lead ALL; advisor view+create+edit;
--   call_center view+create+edit (sahip karari: arama/not/sonuc kaydeder, silme/donusturme yok); readonly view; accounting YOK.
-- Sema degisikligi YOK; yalniz seed. Idempotent (on conflict do nothing). Kullanici istisnalari etkilenmez.
-- RISK: dusuk.

do $$
begin
  if pg_catalog.to_regclass('public.permission_defaults') is null then
    raise exception 'permission_defaults yok; once 20260722000014_permission_matrix uygulanmali.';
  end if;
end $$;

insert into public.permission_defaults (role, module, action)
select r, 'prospecting', a
from (values ('owner'), ('gm'), ('branch_manager'), ('team_lead')) as roles(r)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select r, 'prospecting', a
from (values ('advisor'), ('call_center')) as roles(r)
cross join (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('readonly', 'prospecting', 'view')
on conflict do nothing;

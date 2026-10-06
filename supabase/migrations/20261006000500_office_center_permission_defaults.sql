-- Ofis Merkezi (office_center) modulu: permission_defaults seed'i (4. kayit noktasi).
--
-- NEDEN: src/lib/permissions.ts DEFAULT_MATRIX'te `office_center` var; DB kopyasinda (permission_defaults) yok.
-- has_effective_permission('office_center', ...) RLS'te (pool_assignments, 20261006000510) kullanilir; seed olmadan
-- fonksiyon false doner ve ofis sahibi bile atama gecmisini goremez/yazamaz.
-- MATRIS (permissions.ts ile birebir): owner ALL, gm ALL, branch_manager view+edit, team_lead view; diger roller YOK.
-- Sema degisikligi YOK; yalniz seed. Idempotent (on conflict do nothing). Kullanici istisnalari etkilenmez.
-- GERI ALMA: rollbacks/20261006000500_office_center_permission_defaults.rollback.sql
-- RISK: dusuk.

do $$
begin
  if pg_catalog.to_regclass('public.permission_defaults') is null then
    raise exception 'permission_defaults yok; once 20260722000014_permission_matrix uygulanmali.';
  end if;
end $$;

insert into public.permission_defaults (role, module, action)
select r, 'office_center', a
from (values ('owner'), ('gm')) as roles(r)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('branch_manager', 'office_center', 'view'),
       ('branch_manager', 'office_center', 'edit'),
       ('team_lead', 'office_center', 'view')
on conflict do nothing;

-- DG1 Personel ozel rolleri (modul x eylem matrisi) ve dort goz onay kuyrugu (platform personeli; ofis kullanicilari HICBIR satiri goremez).
--
-- Nesneler:
--   platform_custom_roles        : ozel rol (ad, taban rol, izin matrisi jsonb {"modul": ["view","write","approve"]}).
--                                  Okuma: aktif platform personeli (kendi rolunu kimlik kapisinda gomulu okur); yazma yalniz service_role.
--   platform_staff.custom_role_id: personele atanan ozel rol (bos = sabit rol). Super admin ozel rol TASIYAMAZ (CHECK).
--                                  Kullanimdaki rol silinemez (FK on delete restrict).
--   platform_approval_requests   : dort goz kuyrugu (iade/kredi/ofis kapatma/rol degisikligi). Talep eden ONAYLAYAMAZ (CHECK
--                                  decided_by <> requested_by); ayni kayit icin tek bekleyen talep (kismi benzersiz indeks).
--                                  Yalniz service_role (RLS acik + FORCE, politika yok).
-- KOD DAVRANISI: sutun/tablo yokken kimlik kapisi eski sorguya duser (yetki sabit roldur), Roller ve Onaylar ekranlari
--   "veritabani guncellemesi bekliyor" der, dort goz esikleri acik olsa bile talep yazilamaz ve islem "kurulum bekliyor" hatasi verir
--   (sessizce tek imzayla yurumez). Dort goz ayarlari varsayilan KAPALI: mevcut personel davranisi degismez.
-- GERI ALMA: supabase/rollbacks/20261014001300_platform_custom_roles_four_eyes.rollback.sql
-- RISK: dusuk (yeni nesneler + platform_staff'a nullable sutun; mevcut satirlar custom_role_id = null kalir).

create table if not exists public.platform_custom_roles (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  base_role text not null default 'support' check (base_role in ('ops', 'support', 'billing')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  created_by uuid references public.platform_staff(id) on delete set null,
  updated_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists platform_custom_roles_label_uidx on public.platform_custom_roles (lower(btrim(label)));

alter table public.platform_staff add column if not exists custom_role_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_staff_custom_role_id_fkey') then
    alter table public.platform_staff
      add constraint platform_staff_custom_role_id_fkey foreign key (custom_role_id)
      references public.platform_custom_roles(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_staff_custom_role_not_super') then
    alter table public.platform_staff
      add constraint platform_staff_custom_role_not_super check (custom_role_id is null or role <> 'super_admin');
  end if;
end $$;
create index if not exists platform_staff_custom_role_idx on public.platform_staff (custom_role_id) where custom_role_id is not null;

create table if not exists public.platform_approval_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'credit_grant', 'office_close', 'staff_role')),
  module text not null check (module in ('billing', 'tenants', 'personel')),
  entity_type text not null check (char_length(entity_type) between 1 and 40),
  entity_id text not null check (char_length(entity_id) between 1 and 80),
  amount_try numeric(14, 2) check (amount_try is null or amount_try >= 0),
  summary text not null check (char_length(btrim(summary)) between 3 and 300),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'executed', 'failed')),
  requested_by uuid references public.platform_staff(id) on delete set null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by uuid references public.platform_staff(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  executed_at timestamptz,
  result_error text check (result_error is null or char_length(result_error) <= 500),
  constraint platform_approval_four_eyes check (decided_by is null or requested_by is null or decided_by <> requested_by),
  constraint platform_approval_decided check (status in ('pending', 'cancelled') or decided_by is not null)
);
-- Ayni kayit (fatura/ofis/personel) icin ayni turde tek bekleyen talep.
create unique index if not exists platform_approval_pending_uidx
  on public.platform_approval_requests (kind, entity_type, entity_id) where status = 'pending';
create index if not exists platform_approval_status_idx on public.platform_approval_requests (status, requested_at desc);
create index if not exists platform_approval_requester_idx on public.platform_approval_requests (requested_by, requested_at desc);

alter table public.platform_custom_roles enable row level security;
alter table public.platform_custom_roles force row level security;
alter table public.platform_approval_requests enable row level security;
alter table public.platform_approval_requests force row level security;

revoke all privileges on table public.platform_custom_roles, public.platform_approval_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_custom_roles, public.platform_approval_requests to service_role;
-- Kimlik kapisi (kullanici istemcisi) kendi satirindaki rolu gomulu okur: aktif personel yalniz OKUR.
grant select on table public.platform_custom_roles to authenticated;
drop policy if exists platform_custom_roles_staff_select on public.platform_custom_roles;
create policy platform_custom_roles_staff_select on public.platform_custom_roles
  for select to authenticated
  using ((select public.is_platform_staff()));

notify pgrst, 'reload schema';

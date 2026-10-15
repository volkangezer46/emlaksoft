-- MIGRATION 20261019080001_duty_shifts.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken Izinler > Nobet sekmesi "kurulum bekliyor" der ve
--   talep dagitimi nobet adimini atlar (eski dagitim aynen; "once nobetciye" ayari varsayilan KAPALI).
-- Geri alma: supabase/rollbacks/20261019080001_duty_shifts.rollback.sql (tablo duser; nobet cizelgesi silinir).
-- BAGIMLILIK: current_active_tenant_id / has_effective_permission son govdeleri, profiles.
--
-- NE (OA7, ofis nobet cizelgesi):
--   duty_shifts: gun + dilim (tam gun / sabah / ogleden sonra) + nobetci danisman (+ istege bagli not).
--   Okuma: ofis uyeleri (kim nobette herkes gorur). Yazma: team:edit (ekip yoneticisi); nobetci ayni ofisten olmali
--   (BEFORE trigger: profil ayni kiracida ve aktif). Ayni kisi ayni gun/dilimde tek kayit.
set local lock_timeout = '5s';

create table if not exists public.duty_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  duty_date date not null,
  slot text not null default 'tam' check (slot in ('tam', 'sabah', 'ogle')),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint duty_shifts_unique unique (tenant_id, duty_date, slot, profile_id)
);

create index if not exists idx_duty_shifts_tenant_date on public.duty_shifts (tenant_id, duty_date);
create index if not exists idx_duty_shifts_profile on public.duty_shifts (profile_id, duty_date);

alter table public.duty_shifts enable row level security;

drop policy if exists duty_shifts_select on public.duty_shifts;
create policy duty_shifts_select on public.duty_shifts
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()));

drop policy if exists duty_shifts_insert on public.duty_shifts;
create policy duty_shifts_insert on public.duty_shifts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
    and created_by = (select auth.uid())
  );

drop policy if exists duty_shifts_update on public.duty_shifts;
create policy duty_shifts_update on public.duty_shifts
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

drop policy if exists duty_shifts_delete on public.duty_shifts;
create policy duty_shifts_delete on public.duty_shifts
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('team'::text, 'edit'::text))
  );

-- Nobetci ayni ofisin aktif uyesi olmali (FK tek basina kiraci sinirini korumaz).
create or replace function public.guard_duty_shift_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = new.profile_id and p.tenant_id = new.tenant_id and p.is_active = true
  ) then
    raise exception 'Nobetci bu ofisin aktif uyesi olmali.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_duty_shift_profile() from public, anon, authenticated;

drop trigger if exists trg_duty_shifts_guard on public.duty_shifts;
create trigger trg_duty_shifts_guard
  before insert or update of profile_id, tenant_id on public.duty_shifts
  for each row execute function public.guard_duty_shift_profile();

revoke all privileges on table public.duty_shifts from public, anon;
grant select, insert, update, delete on table public.duty_shifts to authenticated, service_role;

comment on table public.duty_shifts is
  'OA7: ofis nobet cizelgesi (gun + dilim + nobetci). Okuma ofis uyeleri, yazma team:edit. Talep dagitimi "once nobetciye" acikken anlik nobetciyi tercih eder.';

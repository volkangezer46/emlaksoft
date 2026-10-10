-- 20261010000400 Rol duman testi (2026-10-10) guvenlik duzeltmeleri: B2 + B3 + B4 + B5
--
--  B2) profiles.calendar_token tenant icinde her role okunabiliyordu (ve kimlik dogrulamasiz ICS akisini acar).
--      Token ayri tabloya tasinir: user_calendar_tokens (RLS: yalniz kendi satiri SELECT; yazma yalniz
--      rotate_my_calendar_token() RPC'si ile). Mevcut degerler (aktif kullanicilar) tasinir, sutun kaldirilir.
--      Kullanici pasiflestirilince / ofisten cikarilinca token silinir (tetikleyici); ICS rotasi ayrica sahibin
--      aktifligini ve ofis durumunu dogrular.
--  B3) audit_logs: tenant ici okuma yonetici katmani (owner/gm/branch_manager), settings:view izni olan
--      (danisman/cagri merkezi/salt-okunur VARSAYILAN olarak haric), kendi kayitlari ve gorebildigi
--      musteri/portfoy/talep/anlasma kayitlarinin gecmisi ile sinirlanir (kayit zaman cizelgeleri bozulmaz).
--  B4) error_logs: tenant ici okuma yalniz owner/gm + kendi hatalari.
--  B5) anon/authenticated: public sema tablolarinda TRUNCATE/TRIGGER/REFERENCES geri alinir (SELECT/INSERT/UPDATE/
--      DELETE'e dokunulmaz); postgres'in gelecekteki public tablolari icin varsayilan yetkiler de ayni sekilde daralir.
--
-- Forward-only; geri alma ayri dosyada. RLS ifadeleri (select fn()) bicimindedir (initplan).
set local search_path = public;

-- ---------------------------------------------------------------------------
-- B2) Takvim token'i: ayri tablo
-- ---------------------------------------------------------------------------
create table if not exists public.user_calendar_tokens (
  user_id    uuid primary key,
  tenant_id  uuid not null,
  token      uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint user_calendar_tokens_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint user_calendar_tokens_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint user_calendar_tokens_token_key unique (token)
);

create index if not exists idx_user_calendar_tokens_tenant on public.user_calendar_tokens(tenant_id);

alter table public.user_calendar_tokens enable row level security;
alter table public.user_calendar_tokens force row level security;

drop policy if exists user_calendar_tokens_own_select on public.user_calendar_tokens;
create policy user_calendar_tokens_own_select on public.user_calendar_tokens
  for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()));

revoke all privileges on table public.user_calendar_tokens from public, anon, authenticated, service_role;
grant select on table public.user_calendar_tokens to authenticated;
grant select, insert, update, delete on table public.user_calendar_tokens to service_role;

-- Mevcut token'lari tasi (yalniz aktif, ofisi olan kullanicilar).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'calendar_token'
  ) then
    execute $q$
      insert into public.user_calendar_tokens (user_id, tenant_id, token)
      select p.id, p.tenant_id, p.calendar_token
      from public.profiles p
      where p.tenant_id is not null and p.is_active = true and p.calendar_token is not null
      on conflict (user_id) do nothing
    $q$;
  end if;
end $$;

-- Token uretme / yenileme: yalnizca cagiranin KENDI token'i (aktif kullanici, aktif ofis).
create or replace function public.rotate_my_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_tid   uuid;
  v_token uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  v_tid := public.current_active_tenant_id();
  if v_tid is null
     or not exists (
       select 1 from public.profiles p
       where p.id = v_uid and p.tenant_id = v_tid and p.is_active = true
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.user_calendar_tokens (user_id, tenant_id, token)
  values (v_uid, v_tid, v_token)
  on conflict (user_id) do update
    set token = excluded.token,
        tenant_id = excluded.tenant_id,
        rotated_at = now();
  return v_token;
end;
$$;

revoke all privileges on function public.rotate_my_calendar_token() from public, anon, authenticated, service_role;
grant execute on function public.rotate_my_calendar_token() to authenticated;

-- Pasiflestirme / ofisten cikarma: token silinir (ICS akisi aninda kapanir).
create or replace function public.drop_calendar_token_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active is not true or new.tenant_id is null or new.tenant_id is distinct from old.tenant_id then
    delete from public.user_calendar_tokens where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all privileges on function public.drop_calendar_token_on_deactivate() from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_drop_calendar_token on public.profiles;
create trigger trg_profiles_drop_calendar_token
  after update of is_active, tenant_id on public.profiles
  for each row execute function public.drop_calendar_token_on_deactivate();

-- Eski sutun (ve benzersiz indeksi) kaldirilir.
alter table public.profiles drop column if exists calendar_token;

-- ---------------------------------------------------------------------------
-- B3) audit_logs okuma siniri
-- ---------------------------------------------------------------------------
alter policy "audit_tenant" on public.audit_logs
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text, 'branch_manager'::text])
      or (
        (select public.current_profile_role()) <> all (array['advisor'::text, 'call_center'::text, 'readonly'::text])
        and (select public.has_effective_permission('settings'::text, 'view'::text))
      )
      or actor_id = (select auth.uid())
      -- Kayit zaman cizelgeleri: kullanicinin (kendi RLS'iyle) gorebildigi kaydin gecmisi.
      or (entity_type = 'customer' and exists (select 1 from public.customers c where c.id = audit_logs.entity_id))
      or (entity_type = 'property' and exists (select 1 from public.properties p where p.id = audit_logs.entity_id))
      or (entity_type = 'customer_demand' and exists (select 1 from public.customer_demands d where d.id = audit_logs.entity_id))
      or (entity_type = 'deal' and exists (select 1 from public.deals dl where dl.id = audit_logs.entity_id))
    )
  );

-- ---------------------------------------------------------------------------
-- B4) error_logs okuma siniri
-- ---------------------------------------------------------------------------
alter policy "error_logs_tenant_read" on public.error_logs
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_profile_role()) = any (array['owner'::text, 'gm'::text])
      or user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- B5) Gereksiz tablo yetkileri
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

notify pgrst, 'reload schema';

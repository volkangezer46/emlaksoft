-- MIGRATION 20260825001300 (2026-10-05 terfi; eski taslak adı proposed/20261005000700_ownership_transfers.sql).
-- UYGULANMADI: yalnız restore edilebilir backup/PITR doğrulandıktan sonra SAHİBİ
-- `npm run db:migrate -- --only 20260825001300_ownership_transfers.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825001300_ownership_transfers.rollback.sql (kabul edilmiş devirlerin rolleri geri ALINMAZ).
-- Ofis sahipliği devri: iki adımlı (başlat -> hedef kabul), atomik. Tasarım: docs/design/OFIS_SAHIPLIGI_DEVRI.md.
-- NOT: uygulama kodu (server action) HENÜZ YOK; bu migration yalnız tablo + 3 service_role RPC hazırlar.
-- Forward-only. Mevcut hiçbir tablo/fonksiyon değiştirilmez; yalnız yeni tablo + 3 yeni RPC.
--
-- NEDEN RPC: rol hem public.profiles.role'de hem auth.users.raw_app_meta_data'da (JWT claim) tutulur.
-- Uygulama katmanında iki ayrı çağrı (profil güncelle + admin API) arada hata verirse iki sahip ya da sahipsiz
-- ofis doğabilir. Bu RPC'ler ikisini TEK veritabanı işleminde yapar. Çağıran yalnız service_role (sunucu action'ı,
-- requirePermission + canManageRole sonrası); istemciden doğrudan çağrılamaz.

create table if not exists public.ownership_transfers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  from_user_id  uuid not null references public.profiles(id) on delete cascade,
  to_user_id    uuid not null references public.profiles(id) on delete cascade,
  -- Eski sahibin devir sonrası rolü (varsayılan genel müdür).
  demote_role   text not null default 'gm'
    check (demote_role in ('gm','branch_manager','team_lead','advisor','accounting','call_center','readonly')),
  status        text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled','expired')),
  expires_at    timestamptz not null default (now() + interval '72 hours'),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint ownership_transfers_distinct check (from_user_id <> to_user_id)
);

-- Ofis başına en fazla BİR bekleyen devir.
create unique index if not exists uq_ownership_transfers_one_pending
  on public.ownership_transfers (tenant_id) where status = 'pending';
create index if not exists idx_ownership_transfers_tenant
  on public.ownership_transfers (tenant_id, created_at desc);

alter table public.ownership_transfers enable row level security;

-- Okuma: yalnız devrin tarafları (eski sahip / hedef) kendi ofislerinde. Yazma politikası YOK (yalnız RPC).
drop policy if exists ownership_transfers_party_select on public.ownership_transfers;
create policy ownership_transfers_party_select on public.ownership_transfers
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
  );

drop policy if exists ownership_transfers_staff on public.ownership_transfers;
create policy ownership_transfers_staff on public.ownership_transfers
  for select to authenticated
  using (public.is_platform_staff());

grant select on public.ownership_transfers to authenticated;
grant all on public.ownership_transfers to service_role;

-- 1) Devri başlat (yalnız aktif ofis sahibi adına).
create or replace function public.request_ownership_transfer(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_to_user_id uuid,
  p_demote_role text default 'gm'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Ownership transfer requires the trusted server workflow.' using errcode = '42501';
  end if;
  if p_actor_id = p_to_user_id then
    raise exception 'Devir hedefi kendiniz olamaz.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and tenant_id = p_tenant_id and role = 'owner' and is_active
  ) then
    raise exception 'Yalnız aktif ofis sahibi devir başlatabilir.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_to_user_id and tenant_id = p_tenant_id and role <> 'owner' and is_active
  ) then
    raise exception 'Hedef bu ofiste aktif bir üye olmalı.' using errcode = '22023';
  end if;

  -- Süresi dolan bekleyen talep varsa kapat (kısmi benzersiz indeks yeni talebi engellemesin).
  update public.ownership_transfers
     set status = 'expired', resolved_at = now()
   where tenant_id = p_tenant_id and status = 'pending' and expires_at <= now();

  insert into public.ownership_transfers (tenant_id, from_user_id, to_user_id, demote_role)
  values (p_tenant_id, p_actor_id, p_to_user_id, coalesce(p_demote_role, 'gm'))
  returning id into v_id;  -- bekleyen başka talep varsa benzersiz indeks 23505 verir

  return v_id;
end;
$$;

-- 2) Devri kabul et (yalnız hedef kullanıcı adına): rol takası + JWT claim eşitleme TEK işlemde.
create or replace function public.accept_ownership_transfer(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_transfer_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.ownership_transfers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Ownership transfer requires the trusted server workflow.' using errcode = '42501';
  end if;

  select * into t from public.ownership_transfers
   where id = p_transfer_id and tenant_id = p_tenant_id
   for update;
  if not found or t.status <> 'pending' then
    raise exception 'Devir talebi bulunamadı veya artık geçerli değil.' using errcode = 'P0002';
  end if;
  if t.to_user_id <> p_actor_id then
    raise exception 'Devri yalnız hedef kullanıcı kabul edebilir.' using errcode = '42501';
  end if;
  if t.expires_at <= now() then
    update public.ownership_transfers set status = 'expired', resolved_at = now() where id = t.id;
    raise exception 'Devir talebinin süresi dolmuş.' using errcode = '22023';
  end if;

  -- Deadlock'u önlemek için iki profil satırı kimlik sırasıyla kilitlenir; durum yeniden doğrulanır.
  perform 1 from public.profiles
   where id in (t.from_user_id, t.to_user_id) and tenant_id = p_tenant_id
   order by id for update;
  if not exists (
    select 1 from public.profiles
    where id = t.from_user_id and tenant_id = p_tenant_id and role = 'owner' and is_active
  ) then
    raise exception 'Devri başlatan artık aktif ofis sahibi değil.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = t.to_user_id and tenant_id = p_tenant_id and is_active
  ) then
    raise exception 'Hedef kullanıcı artık aktif değil.' using errcode = '22023';
  end if;

  -- Önce eski sahip düşer, sonra yeni sahip atanır: hiçbir an iki sahip (ve sahipsiz kalma riski tek işlemde yok).
  update public.profiles set role = t.demote_role where id = t.from_user_id and tenant_id = p_tenant_id;
  update public.profiles set role = 'owner' where id = t.to_user_id and tenant_id = p_tenant_id;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', t.demote_role)
   where id = t.from_user_id;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'owner')
   where id = t.to_user_id;

  update public.ownership_transfers set status = 'accepted', resolved_at = now() where id = t.id;
end;
$$;

-- 3) Devri iptal et (başlatan) / reddet (hedef).
create or replace function public.resolve_ownership_transfer(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_transfer_id uuid,
  p_decision text -- 'cancelled' | 'declined'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.ownership_transfers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Ownership transfer requires the trusted server workflow.' using errcode = '42501';
  end if;
  if p_decision not in ('cancelled','declined') then
    raise exception 'Geçersiz karar.' using errcode = '22023';
  end if;

  select * into t from public.ownership_transfers
   where id = p_transfer_id and tenant_id = p_tenant_id and status = 'pending'
   for update;
  if not found then
    raise exception 'Devir talebi bulunamadı veya artık geçerli değil.' using errcode = 'P0002';
  end if;
  if p_decision = 'cancelled' and t.from_user_id <> p_actor_id then
    raise exception 'Devri yalnız başlatan iptal edebilir.' using errcode = '42501';
  end if;
  if p_decision = 'declined' and t.to_user_id <> p_actor_id then
    raise exception 'Devri yalnız hedef kullanıcı reddedebilir.' using errcode = '42501';
  end if;

  update public.ownership_transfers set status = p_decision, resolved_at = now() where id = t.id;
end;
$$;

revoke all privileges on function public.request_ownership_transfer(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all privileges on function public.accept_ownership_transfer(uuid, uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.resolve_ownership_transfer(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_ownership_transfer(uuid, uuid, uuid, text) to service_role;
grant execute on function public.accept_ownership_transfer(uuid, uuid, uuid) to service_role;
grant execute on function public.resolve_ownership_transfer(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

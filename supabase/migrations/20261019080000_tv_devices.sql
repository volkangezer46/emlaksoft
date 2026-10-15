-- MIGRATION 20261019080000_tv_devices.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken /tv eslestirme ekrani "bu ortamda etkin degil" der,
--   Pano TV'deki "TV ekranlari" paneli kurulum bekliyor gosterir; oturumlu Pano TV aynen calisir.
-- Geri alma: supabase/rollbacks/20261019080000_tv_devices.rollback.sql (tablolar ve RPC'ler duser; eslesmis TV'ler
--   bir sonraki yoklamada eslestirme ekranina doner, islem izi audit_logs'ta kalir).
-- BAGIMLILIK: current_active_tenant_id / current_profile_role / has_effective_permission son govdeleri, audit_logs.
--
-- NE (OA6, ofis TV'si oturumsuz yayin):
--   tv_pairing_codes: TV'nin /tv ekraninda gosterdigi 6 haneli kod + cihaz sirrinin SHA-256 ozeti (10 dk gecerli).
--     Platform tablosu: RLS acik, politika YOK, yalniz service_role (public /api/tv/pair ucu yazar/okur).
--   tv_devices: ofise baglanmis TV ekrani (ad, sir ozeti, son gorulme, iptal). Sir duz metin SAKLANMAZ.
--     Okuma: ayni ofis + ofis geneli yonetici rolu (owner/gm/branch_manager) + reports:view; token_hash kolonu
--     authenticated'a ACILMAZ (kolon duzeyi grant). Yazma yalniz asagidaki iki SECURITY DEFINER RPC ile.
--   tv_device_pair(code, name): kodu tuketir, cihaz kaydini acar, denetim kaydi yazar.
--   tv_device_revoke(id): cihazi iptal eder (geri alinamaz), denetim kaydi yazar.
set local lock_timeout = '5s';

create table if not exists public.tv_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_tv_devices_tenant on public.tv_devices (tenant_id, created_at desc);

alter table public.tv_devices enable row level security;

drop policy if exists tv_devices_manager_select on public.tv_devices;
create policy tv_devices_manager_select on public.tv_devices
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    and (select public.has_effective_permission('reports'::text, 'view'::text))
  );

revoke all privileges on table public.tv_devices from public, anon, authenticated, service_role;
grant select (id, tenant_id, name, created_by, created_at, last_seen_at, revoked_at, revoked_by)
  on table public.tv_devices to authenticated;
grant select, insert, update, delete on table public.tv_devices to service_role;

comment on table public.tv_devices is
  'OA6: ofis TV ekrani (oturumsuz pano yayini). Sir yalniz SHA-256 ozetiyle; yazma tv_device_pair/tv_device_revoke RPC; veri ucu service_role ile yalniz pano alanlarini dondurur.';

create table if not exists public.tv_pairing_codes (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz,
  device_id uuid references public.tv_devices(id) on delete cascade,
  constraint tv_pairing_codes_expiry_order check (expires_at > created_at)
);

create index if not exists idx_tv_pairing_codes_expiry on public.tv_pairing_codes (expires_at);

alter table public.tv_pairing_codes enable row level security;
revoke all privileges on table public.tv_pairing_codes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.tv_pairing_codes to service_role;

comment on table public.tv_pairing_codes is
  'OA6: TV eslestirme kodu (10 dk). Politika yok; yalniz service_role (/api/tv/pair) ve tv_device_pair RPC (SECURITY DEFINER).';

-- ---------------------------------------------------------------------------
-- Eslestir: yonetici, TV ekranindaki kodu girer.
-- ---------------------------------------------------------------------------
create or replace function public.tv_device_pair(p_code text, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_active_tenant_id();
  v_role text := public.current_profile_role();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_pair public.tv_pairing_codes%rowtype;
  v_device uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum bulunamadi.' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'gm', 'branch_manager') or not public.has_effective_permission('reports', 'view') then
    raise exception 'TV ekrani eslestirme yetkiniz yok.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'Kod 6 karakter olmali.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Ekran adi 1-60 karakter olmali.' using errcode = '22023';
  end if;
  if (select count(*) from public.tv_devices d where d.tenant_id = v_tenant and d.revoked_at is null) >= 20 then
    raise exception 'Bir ofiste en cok 20 etkin TV ekrani olabilir.' using errcode = '22023';
  end if;

  select * into v_pair from public.tv_pairing_codes c where c.code = v_code for update;
  if not found or v_pair.claimed_at is not null or v_pair.expires_at <= now() then
    raise exception 'Kod gecersiz ya da suresi dolmus.' using errcode = 'P0002';
  end if;

  insert into public.tv_devices (tenant_id, name, token_hash, created_by)
  values (v_tenant, v_name, v_pair.secret_hash, v_uid)
  returning id into v_device;

  update public.tv_pairing_codes set claimed_at = now(), device_id = v_device where code = v_code;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'tv_device.paired', 'tv_device', v_device, jsonb_build_object('name', v_name));

  return v_device;
end;
$$;

revoke all on function public.tv_device_pair(text, text) from public, anon;
grant execute on function public.tv_device_pair(text, text) to authenticated, service_role;

comment on function public.tv_device_pair(text, text) is
  'OA6: TV eslestirme kodunu tuketir ve ofise cihaz kaydi acar (owner/gm/branch_manager + reports:view; en cok 20 etkin ekran; denetim kaydi).';

-- ---------------------------------------------------------------------------
-- Iptal: cihaz bir sonraki yoklamada eslestirme ekranina doner.
-- ---------------------------------------------------------------------------
create or replace function public.tv_device_revoke(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_active_tenant_id();
  v_role text := public.current_profile_role();
  v_name text;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum bulunamadi.' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'gm', 'branch_manager') or not public.has_effective_permission('reports', 'view') then
    raise exception 'TV ekrani yonetme yetkiniz yok.' using errcode = '42501';
  end if;

  update public.tv_devices d
     set revoked_at = now(), revoked_by = v_uid
   where d.id = p_id and d.tenant_id = v_tenant and d.revoked_at is null
  returning d.name into v_name;
  if not found then
    return false;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'tv_device.revoked', 'tv_device', p_id, jsonb_build_object('name', v_name));
  return true;
end;
$$;

revoke all on function public.tv_device_revoke(uuid) from public, anon;
grant execute on function public.tv_device_revoke(uuid) to authenticated, service_role;

comment on function public.tv_device_revoke(uuid) is
  'OA6: TV ekranini iptal eder (geri alinamaz; ayni ofis, owner/gm/branch_manager + reports:view; denetim kaydi).';

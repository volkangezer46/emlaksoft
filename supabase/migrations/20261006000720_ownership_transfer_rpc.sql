-- MIGRATION 20261006000720_ownership_transfer_rpc.sql (PB45)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000720_ownership_transfer_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261006000720_ownership_transfer_rpc.rollback.sql (yalniz 3 yeni fonksiyon duser;
--   kabul edilmis devirlerin rolleri geri ALINMAZ). Tasarim: docs/design/OFIS_SAHIPLIGI_DEVRI.md.
--
-- NEDEN: 20260825001300 (CANLIDA) tabloyu + 3 service_role RPC'yi kurdu ama ofis sahibinin kendi baslattigi akis icin
--   kod yoktu. O RPC'ler kimligi parametreyle (p_actor_id) alir ve service_role ister; sunucu action'inin service_role
--   istemcisiyle cagirmasi gerekirdi (admin client kabul listesi genisler, kimlik uygulama hatasiyla karisabilir). Ayrica
--   accept_ownership_transfer suresi dolmus talebi 'expired' yapip AYNI islemde hata firlattigi icin guncelleme geri
--   alinir (talep 'pending' kalir). Bu dosya JWT KIMLIKLI uc RPC ekler:
--     ownership_transfer_request(p_to_user_id, p_demote_role)  -> yalniz aktif ofis sahibi (auth.uid()) baslatir
--     ownership_transfer_accept(p_transfer_id)                  -> yalniz hedef kullanici; rol takasi + JWT claim TEK islemde
--     ownership_transfer_resolve(p_transfer_id, p_decision)     -> 'cancelled' (baslatan) | 'declined' (hedef)
--   Kimlik auth.uid(), ofis public.current_tenant_id() (JWT) ile belirlenir; parametreyle kimlik VERILEMEZ. Destek oturumu
--   (app_metadata.impersonating) reddedilir. Her adim audit_logs'a AYNI islemde yazilir (denetim kaybolamaz).
--   Beklenen is sonuclari HATA DEGIL jsonb {ok:false, code} olarak doner (sure dolumu kalici yazilir).
--   Mevcut 3 service_role RPC'ye ve tabloya DOKUNULMAZ; RLS (taraflar okur, yazma politikasi yok) aynen kalir.
-- GUVENLIK: SECURITY DEFINER + bos search_path; EXECUTE yalniz authenticated (anon/public yok). Ofis basina tek bekleyen
--   talep kismi benzersiz indeksle (uq_ownership_transfers_one_pending) korunur. Parola yeniden dogrulamasi ve hiz siniri
--   sunucu action'indadir (src/app/actions/ownership-transfer.ts); dogrudan RPC cagrisi yine gecerli bir oturum ister.
-- BAGIMLILIK: 20260825001300_ownership_transfers (CANLIDA). On-kosul eksikse HICBIR sey yazmaz.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.ownership_transfers') is null then
    raise exception '20261006000720: public.ownership_transfers yok; once 20260825001300_ownership_transfers uygulanmali.';
  end if;
  if to_regprocedure('public.current_tenant_id()') is null then
    raise exception '20261006000720: public.current_tenant_id() yok.';
  end if;
end
$$;

-- 1) Baslat: cagiran aktif ofis sahibi olmali; hedef ayni ofiste aktif, sahip olmayan uye.
create or replace function public.ownership_transfer_request(
  p_to_user_id uuid,
  p_demote_role text default 'gm'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_role text := coalesce(nullif(btrim(p_demote_role), ''), 'gm');
  v_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda sahiplik devri yapilamaz.' using errcode = '42501';
  end if;
  if v_role not in ('gm', 'branch_manager', 'team_lead', 'advisor', 'accounting', 'call_center', 'readonly') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  if p_to_user_id is null or p_to_user_id = v_uid then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;

  -- Sahip satiri kilitlenir: ayni anda iki baslatma ve kabul ile yaris seri hale gelir.
  perform 1 from public.profiles p
   where p.id = v_uid and p.tenant_id = v_tenant and p.role = 'owner' and p.is_active
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_to_user_id and p.tenant_id = v_tenant and p.role <> 'owner' and p.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;

  -- Suresi dolan bekleyen talep kapanir (kismi benzersiz indeks yeni talebi engellemesin).
  update public.ownership_transfers
     set status = 'expired', resolved_at = now()
   where tenant_id = v_tenant and status = 'pending' and expires_at <= now();

  if exists (select 1 from public.ownership_transfers t where t.tenant_id = v_tenant and t.status = 'pending') then
    return jsonb_build_object('ok', false, 'code', 'pending_exists');
  end if;

  begin
    insert into public.ownership_transfers (tenant_id, from_user_id, to_user_id, demote_role)
    values (v_tenant, v_uid, p_to_user_id, v_role)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'pending_exists');
  end;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'team.owner_transfer_requested', 'ownership_transfer', v_id, null,
          jsonb_build_object('from_user_id', v_uid, 'to_user_id', p_to_user_id, 'demote_role', v_role));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 2) Kabul: yalniz hedef kullanici. Eski sahip dusurulur, hedef sahip olur, iki JWT claim'i esitlenir; tek islem.
create or replace function public.ownership_transfer_accept(p_transfer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  t public.ownership_transfers%rowtype;
  v_old_target_role text;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda sahiplik devri yapilamaz.' using errcode = '42501';
  end if;

  select * into t from public.ownership_transfers
   where id = p_transfer_id and tenant_id = v_tenant
   for update;
  if not found or t.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if t.to_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'not_target');
  end if;
  if t.expires_at <= now() then
    -- Hata FIRLATILMAZ: durum kalici olarak 'expired' yazilir.
    update public.ownership_transfers set status = 'expired', resolved_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  -- Kilitlenme olmasin diye iki profil satiri kimlik sirasiyla kilitlenir; durum yeniden dogrulanir.
  perform 1 from public.profiles p
   where p.id in (t.from_user_id, t.to_user_id) and p.tenant_id = v_tenant
   order by p.id
   for update;
  if not exists (
    select 1 from public.profiles p
    where p.id = t.from_user_id and p.tenant_id = v_tenant and p.role = 'owner' and p.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'owner_changed');
  end if;
  select p.role into v_old_target_role from public.profiles p
   where p.id = t.to_user_id and p.tenant_id = v_tenant and p.is_active;
  if v_old_target_role is null then
    return jsonb_build_object('ok', false, 'code', 'target_inactive');
  end if;

  -- Once eski sahip duser, sonra yeni sahip atanir (tek islemde; ara durum disaridan gorunmez).
  update public.profiles set role = t.demote_role where id = t.from_user_id and tenant_id = v_tenant;
  update public.profiles set role = 'owner' where id = t.to_user_id and tenant_id = v_tenant;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', t.demote_role, 'tenant_id', v_tenant::text)
   where id = t.from_user_id;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', 'owner', 'tenant_id', v_tenant::text)
   where id = t.to_user_id;

  update public.ownership_transfers set status = 'accepted', resolved_at = now() where id = t.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'team.owner_transfer_accepted', 'ownership_transfer', t.id,
          jsonb_build_object('owner_user_id', t.from_user_id, 'target_role', v_old_target_role),
          jsonb_build_object('owner_user_id', t.to_user_id, 'previous_owner_role', t.demote_role));

  return jsonb_build_object('ok', true, 'from_user_id', t.from_user_id, 'demote_role', t.demote_role);
end;
$$;

-- 3) Iptal (baslatan) / ret (hedef).
create or replace function public.ownership_transfer_resolve(p_transfer_id uuid, p_decision text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  t public.ownership_transfers%rowtype;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda sahiplik devri yapilamaz.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('cancelled', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;

  select * into t from public.ownership_transfers
   where id = p_transfer_id and tenant_id = v_tenant and status = 'pending'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if (p_decision = 'cancelled' and t.from_user_id <> v_uid)
     or (p_decision = 'declined' and t.to_user_id <> v_uid) then
    return jsonb_build_object('ok', false, 'code', 'not_party');
  end if;

  update public.ownership_transfers set status = p_decision, resolved_at = now() where id = t.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid,
          case p_decision when 'cancelled' then 'team.owner_transfer_cancelled' else 'team.owner_transfer_declined' end,
          'ownership_transfer', t.id, jsonb_build_object('status', 'pending'), jsonb_build_object('status', p_decision));

  return jsonb_build_object('ok', true, 'from_user_id', t.from_user_id, 'to_user_id', t.to_user_id);
end;
$$;

revoke all privileges on function public.ownership_transfer_request(uuid, text) from public, anon, authenticated, service_role;
revoke all privileges on function public.ownership_transfer_accept(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function public.ownership_transfer_resolve(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.ownership_transfer_request(uuid, text) to authenticated;
grant execute on function public.ownership_transfer_accept(uuid) to authenticated;
grant execute on function public.ownership_transfer_resolve(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon_exec
-- from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'ownership_transfer_%';
-- BEKLENEN: 3 satir, prosecdef = t, proconfig = {search_path=""}, anon_exec = f.

-- pgTAP: KQ2 20261015012000_identity_txn_cache
-- Calistirma (gölge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/kq2_identity_cache.test.sql
--   Cikti "not ok" satiri icermemeli. Tek islem, sonda ROLLBACK.
-- KABUL: (1) sonuc islem-yerel app.ctx_* ayarina yazilir ve sonraki cagri onu kullanir; (2) claim degisince eski deger
--   kullanilmaz (kimlik/kiraci sizmaz); (3) ayni islemde profil pasiflesir / 2FA acilir / kiraci askiya alinir / izin istisnasi
--   eklenirse (nesil sayaci) sonraki cagri yeniden hesaplar: 2FA ve kiraci dogrulama mantigi aynen gecerli; (4) NULL sonuc
--   onbellege yazilmaz; (5) fonksiyon imzasi/volatilite/DEFINER/ACL degismez.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

set local session_replication_role = replica;
insert into public.tenants(id, name, slug, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'KQ2 A', 'kq2-a', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'KQ2 B', 'kq2-b', 'active');
insert into public.profiles(id, tenant_id, full_name, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sahip A', 'owner'),
  ('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 1', 'advisor'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'Sahip B', 'owner');
set local session_replication_role = origin;

create function pg_temp.claims(p_uid uuid, p_tenant uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', 'kq2-session-' || p_uid,
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
end $$;

-- ---------- Sozlesme: imza ve nitelikler degismez ----------
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'public.current_active_tenant_id()'::regprocedure), 'strue',
  'current_active_tenant_id: STABLE + SECURITY DEFINER');
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'public.current_profile_role()'::regprocedure), 'strue',
  'current_profile_role: STABLE + SECURITY DEFINER');
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'public.has_effective_permission(text,text)'::regprocedure), 'sfalse',
  'has_effective_permission: STABLE + INVOKER');
select ok(not has_function_privilege('anon', 'public.current_active_tenant_id()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.current_active_tenant_id()', 'EXECUTE'),
  'current_active_tenant_id ACL ayni (anon yok, authenticated var)');
select ok(not has_function_privilege('authenticated', 'public.ident_ctx_bump()', 'EXECUTE'),
  'ident_ctx_bump RPC olarak cagrilamaz');

-- ---------- Onbellek yazimi ve okunmasi ----------
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');
select is(public.current_active_tenant_id(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'sahip A: kiraci A');
select ok(current_setting('app.ctx_tenant', true) like '%:aaaaaaaa-0000-4000-8000-000000000001', 'kiraci islem-yerel onbellege yazildi');
select is(public.current_profile_role(), 'owner', 'sahip A: rol owner');
select ok(current_setting('app.ctx_role', true) like '%:owner', 'rol onbellege yazildi');
select ok(public.has_effective_permission('commissions', 'view'), 'sahip: commissions:view');
select ok(current_setting('app.ctx_perm_commissions__view', true) like '%:t', 'izin onbellege yazildi');
-- Onbellek gercekten okunuyor: ayni anahtarla saklanan degeri dondurur (claim/nesil ayni).
do $$ begin perform set_config('app.ctx_role', split_part(current_setting('app.ctx_role'), ':', 1) || ':gm', true); end $$;
select is(public.current_profile_role(), 'gm', 'ayni anahtarda onbellek okunur (yapay deger)');
do $$ begin perform set_config('app.ctx_role', '', true); end $$;
select is(public.current_profile_role(), 'owner', 'onbellek bosaltilinca yeniden hesaplanir');

-- ---------- Claim degisimi: eski deger kullanilmaz ----------
select pg_temp.claims('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner');
select is(public.current_active_tenant_id(), 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'claim degisti: kiraci B (A sizmaz)');
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor');
select is(public.current_profile_role(), 'advisor', 'claim degisti: danisman rolu');
select ok(not public.has_effective_permission('earnings_all', 'view'), 'danisman: earnings_all yok');
-- JWT rolu profilden farkliysa (ayni kullanici, rol 'owner' iddiasi) kiraci NULL ve NULL onbellege yazilmaz.
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');
select is(public.current_active_tenant_id(), null::uuid, 'JWT rolu profille eslesmez: NULL');
select ok(current_setting('app.ctx_tenant', true) not like '%:' || 'aaaaaaaa-0000-4000-8000-000000000001' or
          split_part(current_setting('app.ctx_tenant', true), ':', 1) <> md5(
            coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
            coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
            coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
            coalesce(current_setting('app.ctx_gen', true), '')),
  'NULL sonuc gecerli anahtarla onbellege yazilmadi');

-- ---------- Ayni islemde kimlik verisi degisince yeniden hesap (nesil sayaci) ----------
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor');
select is(public.current_active_tenant_id(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'danisman: kiraci A (onbellekte)');
insert into public.user_permission_overrides(tenant_id, user_id, module, actions)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a2', 'earnings_all', array['view']);
select ok(public.has_effective_permission('earnings_all', 'view'), 'istisna eklendi: ayni islemde earnings_all:view true');

-- Kimlik alanlari yalniz guvenilir sunucu akisiyla degisir (guard_profile_identity_fields): degisiklik replica modunda yapilir,
-- ardindan ayni tablodaki 0 satirlik ifade AFTER STATEMENT nesil tetikleyicisini calistirir (canlida asil ifade calistirir).
-- 2FA: SMS 2FA acilir, dogrulanmis oturum yok -> kiraci NULL (2FA kapisi aynen gecerli).
set local session_replication_role = replica;
update public.profiles set two_factor_sms = true where id = 'a0000000-0000-4000-8000-0000000000a2';
set local session_replication_role = origin;
update public.profiles set full_name = full_name where false;
select is(public.current_active_tenant_id(), null::uuid, '2FA zorunlu + dogrulanmamis oturum: NULL (onbellek atlanmadi)');
select ok(not public.has_effective_permission('customers', 'view'), '2FA dogrulanmadan izin yok');
set local session_replication_role = replica; -- auth.users fixture yok (FK)
insert into public.two_factor_verified_sessions(session_id, user_id, profile_version, expires_at)
select 'kq2-session-a0000000-0000-4000-8000-0000000000a2', p.id, p.two_factor_version, now() + interval '1 hour'
from public.profiles p where p.id = 'a0000000-0000-4000-8000-0000000000a2';
set local session_replication_role = origin;
delete from public.two_factor_verified_sessions where false;
select is(public.current_active_tenant_id(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, '2FA dogrulandi: kiraci A');

-- Profil pasiflesir -> NULL.
set local session_replication_role = replica;
update public.profiles set is_active = false where id = 'a0000000-0000-4000-8000-0000000000a2';
set local session_replication_role = origin;
update public.profiles set full_name = full_name where false;
select is(public.current_active_tenant_id(), null::uuid, 'profil pasif: NULL');
select is(public.current_profile_role(), '', 'profil pasif: rol bos');

-- Kiraci askiya alinir -> NULL.
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');
select is(public.current_active_tenant_id(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'sahip A: kiraci A');
set local session_replication_role = replica;
update public.tenants set status = 'suspended' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local session_replication_role = origin;
update public.tenants set name = name where false;
select is(public.current_active_tenant_id(), null::uuid, 'kiraci askida: NULL');

select * from finish();
rollback;

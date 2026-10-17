-- MIGRATION 20261027040000_zeka_rpc_service_role_only.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261027040000_zeka_rpc_service_role_only.rollback.sql
-- BAGIMLILIK: 20261024010000_zeka_learning.sql (zeka_query_log, zeka_knowledge_vectors).
-- KOD ILE AYNI pencere: yeni kod RPC'leri service_role ile ve yeni imzayla cagirir. Migration kod yayinindan ONCE
--   uygulanirsa eski kodun gunluk/oy/vektor cagrilari sessizce atlanir (kod hata yutar; Zeka yanit vermeye devam eder).
--
-- NE (denetim SEC-3): zeka_log_query, zeka_query_feedback ve zeka_knowledge_vectors_read anon'a acikti; dogrudan
--   /rest/v1/rpc cagrisiyla maskeleme (redact.ts) ve hiz siniri atlanip herhangi bir ofis adina gunluk satiri yazilabiliyordu.
--   1) zeka_log_query: kimlik artik parametre (p_user_id + p_tenant_id; sunucu kapisindan). Uygulama yuzeyinde kullanici
--      o ofisin aktif profili ya da aktif platform personeli (salt okunur destek oturumu) olmali; yonetim yuzeyinde aktif
--      platform personeli. Eski 8 parametreli imza duser. EXECUTE yalniz service_role.
--   2) zeka_query_feedback: oy veren kimlik parametre (p_user_id; sunucu dogrulanmis oturumdan). Eski imza duser.
--      EXECUTE yalniz service_role.
--   3) zeka_knowledge_vectors_read: EXECUTE anon/authenticated'dan geri alinir (yalniz service_role).
-- RISK: dusuk (yalniz yetki daralir; tablo/veri degismez). /admin/zeka okumasi tablo SELECT politikasiyla devam eder.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.zeka_query_log') is null
     or pg_catalog.to_regclass('public.zeka_knowledge_vectors') is null then
    raise exception 'zeka_query_log / zeka_knowledge_vectors yok; once 20261024010000_zeka_learning uygulanmali.';
  end if;
end $$;

-- 1) Sorgu gunlugu yazicisi (yalniz service_role) ---------------------------------------------------------------
drop function if exists public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid);

create or replace function public.zeka_log_query(
  p_surface text,
  p_query text,
  p_intent text,
  p_engine text,
  p_confidence numeric,
  p_answered boolean,
  p_fallback text default null,
  p_tenant_id uuid default null,
  p_user_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_id uuid;
begin
  if p_surface not in ('app', 'public', 'vitrin', 'admin') then
    return null;
  end if;
  if p_surface = 'app' then
    if p_tenant_id is null or p_user_id is null then
      return null;
    end if;
    if not exists (
         select 1 from public.profiles p join public.tenants t on t.id = p.tenant_id
          where p.id = p_user_id and p.tenant_id = p_tenant_id and p.is_active = true
            and t.status not in ('suspended', 'cancelled'))
       and not exists (select 1 from public.platform_staff ps where ps.id = p_user_id and ps.is_active = true) then
      return null;
    end if;
    v_tenant := p_tenant_id;
    v_user := p_user_id;
  elsif p_surface = 'vitrin' then
    select t.id into v_tenant from public.tenants t where t.id = p_tenant_id and t.status not in ('suspended', 'cancelled');
    if v_tenant is null then
      return null;
    end if;
  elsif p_surface = 'admin' then
    if p_user_id is null or not exists (select 1 from public.platform_staff ps where ps.id = p_user_id and ps.is_active = true) then
      return null;
    end if;
    v_user := p_user_id;
  end if;

  insert into public.zeka_query_log (surface, tenant_id, user_id, query_redacted, intent, engine, confidence, answered, fallback_reason)
  values (
    p_surface,
    v_tenant,
    v_user,
    left(coalesce(nullif(btrim(p_query), ''), '-'), 300),
    case when p_intent in ('navigate', 'search', 'create', 'data', 'howto', 'report', 'unknown') then p_intent else 'unknown' end,
    case when p_engine = 'gpt' then 'gpt' else 'local' end,
    greatest(0, least(1, coalesce(p_confidence, 0)))::numeric(3,2),
    coalesce(p_answered, false),
    left(nullif(btrim(p_fallback), ''), 40)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid, uuid) to service_role;

-- 2) Olumlu/olumsuz oy (yalniz service_role) --------------------------------------------------------------------
drop function if exists public.zeka_query_feedback(uuid, integer);

create or replace function public.zeka_query_feedback(p_id uuid, p_vote integer, p_user_id uuid default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_vote not in (-1, 1) then
    return false;
  end if;
  update public.zeka_query_log l
     set feedback = p_vote::smallint, feedback_at = now()
   where l.id = p_id
     and l.feedback is null
     and l.created_at > now() - interval '24 hours'
     and (l.user_id is null or l.user_id = p_user_id);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.zeka_query_feedback(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.zeka_query_feedback(uuid, integer, uuid) to service_role;

-- 3) Gomme vektoru okuyucu: yalniz service_role ------------------------------------------------------------------
revoke all on function public.zeka_knowledge_vectors_read() from public, anon, authenticated;
grant execute on function public.zeka_knowledge_vectors_read() to service_role;

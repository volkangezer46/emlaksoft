-- 20261027040000 geri alma: 20261024010000'deki imzalar ve anon/authenticated EXECUTE yetkileri geri gelir
-- (kod geri alinmazsa yeni imzali cagrilar sessizce atlanir; Zeka yanit vermeye devam eder).
set local lock_timeout = '5s';

drop function if exists public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid, uuid);

create or replace function public.zeka_log_query(
  p_surface text,
  p_query text,
  p_intent text,
  p_engine text,
  p_confidence numeric,
  p_answered boolean,
  p_fallback text default null,
  p_tenant_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if p_surface not in ('app', 'public', 'vitrin', 'admin') then
    return null;
  end if;
  if p_surface = 'app' then
    v_tenant := public.current_active_tenant_id();
    if v_tenant is null then
      return null;
    end if;
  elsif p_surface = 'vitrin' then
    select t.id into v_tenant from public.tenants t where t.id = p_tenant_id;
    v_user := null;
  elsif p_surface = 'admin' then
    if not public.is_platform_staff() then
      return null;
    end if;
  else
    v_user := null;
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

revoke all on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid) to anon, authenticated, service_role;

drop function if exists public.zeka_query_feedback(uuid, integer, uuid);

create or replace function public.zeka_query_feedback(p_id uuid, p_vote integer)
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
     and (l.user_id is null or l.user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.zeka_query_feedback(uuid, integer) from public, anon, authenticated;
grant execute on function public.zeka_query_feedback(uuid, integer) to anon, authenticated, service_role;

revoke all on function public.zeka_knowledge_vectors_read() from public, anon, authenticated;
grant execute on function public.zeka_knowledge_vectors_read() to anon, authenticated, service_role;

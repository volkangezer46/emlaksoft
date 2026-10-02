-- A resolved incident starts a new lifecycle when it recurs. The former
-- all-row unique index prevented that insert and silently lost recurrence.
drop index if exists public.uq_error_logs_fingerprint;

create unique index uq_error_logs_fingerprint
  on public.error_logs (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    fingerprint
  )
  where resolved_at is null;

comment on index public.uq_error_logs_fingerprint is
  'One unresolved row per tenant/fingerprint; resolved incidents may recur as a new row.';

create or replace function public.record_error_occurrence(
  p_tenant_id uuid,
  p_user_id uuid,
  p_source text,
  p_digest text,
  p_message text,
  p_stack text,
  p_path text,
  p_user_agent text,
  p_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.error_logs (
    tenant_id,
    user_id,
    source,
    digest,
    message,
    stack,
    path,
    user_agent,
    fingerprint
  ) values (
    p_tenant_id,
    p_user_id,
    p_source,
    p_digest,
    p_message,
    p_stack,
    p_path,
    p_user_agent,
    p_fingerprint
  )
  on conflict (
    (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    fingerprint
  ) where resolved_at is null
  do update set
    occurrences = public.error_logs.occurrences + 1,
    last_seen = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';

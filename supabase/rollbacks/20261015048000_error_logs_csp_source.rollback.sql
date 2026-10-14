-- 20261015048000 geri alma: record_error_occurrence 20261013004900_ops_alerts.sql'deki gövdeye döner
-- ('csp' kaynaklı satırlar da dakikalık hata sayacına girer). Tablo/veri değişmez; idempotent.

set local lock_timeout = '5s';

create or replace function public.record_error_occurrence(
  p_tenant_id uuid,
  p_user_id uuid,
  p_source text,
  p_digest text,
  p_message text,
  p_stack text,
  p_path text,
  p_user_agent text,
  p_fingerprint text,
  p_release text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_release text := nullif(left(btrim(coalesce(p_release, '')), 64), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.error_logs (
    tenant_id, user_id, source, digest, message, stack, path, user_agent, fingerprint, release
  ) values (
    p_tenant_id, p_user_id, p_source, p_digest, p_message, p_stack, p_path, p_user_agent, p_fingerprint, v_release
  )
  on conflict (
    (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    fingerprint
  ) where resolved_at is null
  do update set
    occurrences = public.error_logs.occurrences + 1,
    last_seen = now(),
    release = coalesce(excluded.release, public.error_logs.release)
  returning id, status into v_id, v_status;

  -- Yok sayılan / ertelenen hata patlama sayacına girmez (triyaj kararı uyarıyı susturur).
  if v_status = 'open' then
    insert into public.error_rate_minutely (minute, n)
    values (date_trunc('minute', now()), 1)
    on conflict (minute) do update set n = public.error_rate_minutely.n + 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text)
  to service_role;

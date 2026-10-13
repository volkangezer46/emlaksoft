-- 20261013004900 geri alma: uyarı merkezi tabloları, DB konsolu RPC'leri ve hata triyajı sütunları kaldırılır.
-- UYARI: uyarı kanalları (şifreli), olay geçmişi, cron çalışma geçmişi/duraklatma ve sunucu ölçümleri SİLİNİR;
-- error_logs'taki durum/atanan/not/sürüm bilgisi kaybolur ("yok sayıldı"/"ertelendi" satırlar açık sayılır).
-- record_error_occurrence 9 argümanlı eski gövdesine (20260802000360) döner. Kod tablolar yokken "kurulum bekliyor" der.
set local lock_timeout = '5s';

drop function if exists public.ops_slow_queries(integer);
drop function if exists public.ops_db_overview();

drop function if exists public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text);
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
    tenant_id, user_id, source, digest, message, stack, path, user_agent, fingerprint
  ) values (
    p_tenant_id, p_user_id, p_source, p_digest, p_message, p_stack, p_path, p_user_agent, p_fingerprint
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

drop trigger if exists error_logs_sync_status on public.error_logs;
drop function if exists public.error_logs_sync_status();
drop index if exists public.error_logs_status_idx;
alter table public.error_logs
  drop constraint if exists error_logs_status_check,
  drop constraint if exists error_logs_note_len,
  drop constraint if exists error_logs_release_len,
  drop column if exists snoozed_until,
  drop column if exists release,
  drop column if exists note,
  drop column if exists assignee_id,
  drop column if exists status;

drop table if exists public.error_rate_minutely;
drop table if exists public.host_metrics;
drop table if exists public.alert_events;
drop table if exists public.alert_rules;
drop table if exists public.alert_channels;
drop table if exists public.cron_job_state;
drop table if exists public.cron_runs;

notify pgrst, 'reload schema';

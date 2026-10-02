-- Operasyonel veri saklama ve gizlilik temizliği

alter table public.webhook_events
  add column if not exists payload_purged_at timestamptz;

-- Çözülmemiş, halen güncel bir üretim hatası yalnız yaşı nedeniyle silinmez.
-- Çok eski (1 yıl) kayıtlar ise çözümlenmemiş olsa da veri minimizasyonu için
-- kaldırılır.
create or replace function public.purge_old_error_logs(p_days integer default 90)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.error_logs
    where (
      resolved_at is not null
      and last_seen < now() - make_interval(days => greatest(30, least(coalesce(p_days, 90), 365)))
    )
    or last_seen < now() - interval '365 days'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

create or replace function public.purge_operational_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_webhook_payloads integer := 0;
  v_webhook_rows integer := 0;
  v_rate_limits integer := 0;
  v_login_challenges integer := 0;
  v_error_logs integer := 0;
begin
  -- 30 günlük süre dolunca ham provider gövdesi ve olası hassas hata metni
  -- silinir; idempotency kimliği kısa süre daha korunur.
  update public.webhook_events
     set payload = '{}'::jsonb,
         error_message = null,
         payload_purged_at = now()
   where expires_at <= now()
     and payload_purged_at is null;
  get diagnostics v_webhook_payloads = row_count;

  -- Minimal idempotency zarfı 180 gün tutulur, sonra satır da kaldırılır.
  delete from public.webhook_events
   where received_at < now() - interval '180 days';
  get diagnostics v_webhook_rows = row_count;

  delete from public.rate_limits where window_end < now();
  get diagnostics v_rate_limits = row_count;

  delete from public.login_challenges
   where expires_at < now() - interval '1 day';
  get diagnostics v_login_challenges = row_count;

  select public.purge_old_error_logs(90) into v_error_logs;

  return jsonb_build_object(
    'webhook_payloads_purged', v_webhook_payloads,
    'webhook_rows_deleted', v_webhook_rows,
    'rate_limits_deleted', v_rate_limits,
    'login_challenges_deleted', v_login_challenges,
    'error_logs_deleted', v_error_logs
  );
end;
$$;

revoke all privileges on function public.purge_old_error_logs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_old_error_logs(integer) to service_role;

revoke all privileges on function public.purge_operational_data()
  from public, anon, authenticated, service_role;
grant execute on function public.purge_operational_data() to service_role;

comment on function public.purge_operational_data() is
  'Ham webhook payloadları, eski inbox zarfları, rate limit bucketları, 2FA challenge ve çözülmüş hata logları için günlük saklama temizliği.';


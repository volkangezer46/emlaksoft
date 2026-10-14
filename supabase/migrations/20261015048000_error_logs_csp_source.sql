-- MIGRATION 20261015048000_error_logs_csp_source.sql
-- YD8 (2026-10-15): CSP rapor modu ölçümü (src/app/api/csp-rapor → logError source 'csp') hata patlaması sayacına girmez.
-- Geri alma: supabase/rollbacks/20261015048000_error_logs_csp_source.rollback.sql
-- BAGIMLILIK: 20261013004900_ops_alerts.sql (record_error_occurrence 10 argümanlı imza, error_rate_minutely).
--
-- AMAC: /app ve /admin belgelerine eklenen Content-Security-Policy-Report-Only başlığının raporları error_logs'a yazılır
--   (kaynak 'csp'). Bunlar HATA değil ölçümdür: bir panel sayfası açılışında birkaç ihlal birden gelebilir. Dakikalık
--   sayaca (error_rate_minutely) girerlerse "hata patlaması" uyarı kuralı gerçek hatalar yokken tetiklenir.
--   Fonksiyonun tek farkı sayaç koşuluna `p_source <> 'csp'` eklenmesidir; satır yazımı/tekilleştirme aynıdır.
-- GUVENLIK: aynı (SECURITY DEFINER, search_path '', yalnız service_role çağırır; yetkiler yeniden verilir).
-- ETKI: davranış (yalnız 'csp' kaynaklı satırlar sayaca girmez). Tablo/veri değişmez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text)') is null then
    raise exception 'record_error_occurrence (10 argüman) yok: önce 20261013004900_ops_alerts.sql uygulanmalı.';
  end if;
  if pg_catalog.to_regclass('public.error_rate_minutely') is null then
    raise exception 'error_rate_minutely yok: önce 20261013004900_ops_alerts.sql uygulanmalı.';
  end if;
end $$;

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
  -- CSP rapor modu satırları ölçümdür, hata değil: sayaca girmez (YD8).
  if v_status = 'open' and coalesce(p_source, '') <> 'csp' then
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

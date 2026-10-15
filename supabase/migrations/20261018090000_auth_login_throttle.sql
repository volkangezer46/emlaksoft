-- MIGRATION 20261018090000_auth_login_throttle.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261018090000_auth_login_throttle.rollback.sql (tablo + 3 fonksiyon duser; kod RPC yoksa
--   eski sabit pencere sinirina duser, giris calismaya devam eder).
-- BAGIMLILIK: yok (yalniz auth.role()).
--
-- NE (arastirma 5, giris sertlestirme): parola girisinde HESAP ve IP icin ayri basarisizlik kovalari + ilerleyen bekleme.
--   - auth_login_throttle: kova (opak sha256 anahtar; e-posta / IP ham tutulmaz), basarisiz sayaci, son basarisizlik,
--     son kullanma (son basarisizliktan itibaren pencere; her yeni hata pencereyi uzatir).
--   - auth_login_throttle_peek(keys): canli kovalari okur (yazmaz).
--   - auth_login_throttle_fail(keys, windows): her kovayi atomik artirir; suresi dolan kova 1'den baslar.
--   - auth_login_throttle_clear(key): basarili giriste hesap kovasini siler (IP kovasi silinmez).
--   Bekleme suresi ve engel karari uygulamada (src/lib/auth/login-throttle.ts, saf ve testli): sunucu uyumaz, istemciye
--   "N saniye sonra" doner. Hesap kilitlenmez (yalniz bekleme artar): saldirgan kurbanin hesabini kalici kilitleyemez.
-- GUVENLIK: tum fonksiyonlar SECURITY DEFINER + search_path '' + yalniz service_role (auth.role() denetimi + GRANT).
set local lock_timeout = '5s';

create table if not exists public.auth_login_throttle (
  bucket text primary key,
  failures integer not null default 0 check (failures >= 0),
  last_failure_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint auth_login_throttle_bucket_len check (char_length(bucket) between 1 and 128)
);

create index if not exists idx_auth_login_throttle_expires on public.auth_login_throttle (expires_at);

alter table public.auth_login_throttle enable row level security;
revoke all privileges on table public.auth_login_throttle from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.auth_login_throttle to service_role;

create or replace function public.auth_login_throttle_peek(p_keys text[])
returns table (bucket text, failures integer, last_failure_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_keys, 1) > 4 then
    raise exception 'At most 4 throttle keys.' using errcode = '22023';
  end if;
  return query
    select t.bucket, t.failures, t.last_failure_at
    from public.auth_login_throttle t
    where t.bucket = any (p_keys)
      and t.expires_at > clock_timestamp();
end;
$$;

create or replace function public.auth_login_throttle_fail(p_keys text[], p_windows integer[])
returns table (bucket text, failures integer, last_failure_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  i integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_keys is null or p_windows is null
     or coalesce(array_length(p_keys, 1), 0) = 0
     or array_length(p_keys, 1) <> coalesce(array_length(p_windows, 1), 0)
     or array_length(p_keys, 1) > 4 then
    raise exception 'Throttle keys and windows must be 1..4 matching items.' using errcode = '22023';
  end if;

  for i in 1 .. array_length(p_keys, 1) loop
    if p_keys[i] is null or char_length(btrim(p_keys[i])) < 1 or char_length(p_keys[i]) > 128 then
      raise exception 'Throttle key length must be between 1 and 128.' using errcode = '22023';
    end if;
    if p_windows[i] is null or p_windows[i] < 60 or p_windows[i] > 86400 then
      raise exception 'Throttle window must be between 60 and 86400 seconds.' using errcode = '22023';
    end if;
    insert into public.auth_login_throttle as t (bucket, failures, last_failure_at, expires_at)
    values (p_keys[i], 1, v_now, v_now + make_interval(secs => p_windows[i]))
    on conflict on constraint auth_login_throttle_pkey do update
    set failures = case when t.expires_at <= v_now then 1 else least(t.failures + 1, 100000) end,
        last_failure_at = v_now,
        expires_at = v_now + make_interval(secs => p_windows[i]);
  end loop;

  -- Arada bir suresi bir gunden fazla gecmis kovalari temizle (tablo kucuk kalir; ayri cron gerekmez).
  if random() < 0.02 then
    delete from public.auth_login_throttle t where t.expires_at < v_now - interval '1 day';
  end if;

  return query
    select t.bucket, t.failures, t.last_failure_at
    from public.auth_login_throttle t
    where t.bucket = any (p_keys);
end;
$$;

create or replace function public.auth_login_throttle_clear(p_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_key is null or char_length(p_key) > 128 then
    raise exception 'Throttle key length must be between 1 and 128.' using errcode = '22023';
  end if;
  delete from public.auth_login_throttle t where t.bucket = p_key;
end;
$$;

revoke all privileges on function public.auth_login_throttle_peek(text[]) from public, anon, authenticated, service_role;
revoke all privileges on function public.auth_login_throttle_fail(text[], integer[]) from public, anon, authenticated, service_role;
revoke all privileges on function public.auth_login_throttle_clear(text) from public, anon, authenticated, service_role;
grant execute on function public.auth_login_throttle_peek(text[]) to service_role;
grant execute on function public.auth_login_throttle_fail(text[], integer[]) to service_role;
grant execute on function public.auth_login_throttle_clear(text) to service_role;

comment on table public.auth_login_throttle is
  'Arastirma 5: parola girisi basarisizlik kovalari (hesap + IP, opak anahtar). Bekleme karari src/lib/auth/login-throttle.ts.';

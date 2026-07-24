-- Basit, atomik, sabit-pencere hız sınırlayıcı (public/auth'suz uç noktalar için)
-- Serverless'ta bellek-içi limitleyici güvenilmez olduğundan DB-tabanlı.

create table if not exists public.rate_limits (
  bucket      text        primary key,
  hits        int         not null default 0,
  window_end  timestamptz not null
);

-- Süresi dolan kayıtları hızlı temizlemek için
create index if not exists idx_rate_limits_window_end
  on public.rate_limits(window_end);

-- Yalnız service_role erişir (public endpoint'ler admin client kullanır)
alter table public.rate_limits enable row level security;
grant all on public.rate_limits to service_role;

/**
 * check_rate_limit — anahtar için sabit pencerede isabet sayar.
 * Dönüş: true = izinli (limit aşılmadı), false = engellendi.
 * Pencere sona erince kayıt silinip sıfırdan başlar.
 */
create or replace function public.check_rate_limit(
  p_key        text,
  p_limit      int,
  p_window_sec int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now  timestamptz := now();
  v_hits int;
begin
  -- Süresi dolmuş pencereleri temizle (bu anahtar dahil sıfırlanır)
  delete from public.rate_limits where window_end < v_now;

  insert into public.rate_limits (bucket, hits, window_end)
    values (p_key, 1, v_now + make_interval(secs => p_window_sec))
  on conflict (bucket) do update
    set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

grant execute on function public.check_rate_limit(text, int, int) to service_role;

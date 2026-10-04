-- SEO merkezi: 404 kayıtları (en çok 404 alan yollar). Yalnız yol ve sayaç saklanır.
--
-- KVKK/gizlilik: IP, kullanıcı aracısı, sorgu dizesi (query) SAKLANMAZ; referrer yalnız ana makine adı (host) olarak
--   ve en çok 120 karakter. Token benzeri uzun yol parçaları uygulama katmanında atılır; tabloda ek kontrol vardır.
-- Tenant verisi DEĞİLDİR (public sitenin 404'leri): RLS açık, politika yok -> yalnız service_role (RPC) erişir.
-- seo_log_404 (SECURITY DEFINER, search_path boş): atomik upsert, sayaç artırır. Yalnız service_role çalıştırır.
-- seo_prune_404: eski ve düşük sayılı kayıtları siler (robot cron'u günlük çağırır).
-- KOD DAVRANIŞI: tablo yoksa 404 kaydı sessizce atlanır ve /admin/seo'da "404 kaydı henüz etkin değil" notu görünür.
-- GERİ ALMA: supabase/rollbacks/20260816001790_seo_404_hits.rollback.sql (yalnız 404 sayaçları silinir).
-- RİSK: düşük (yeni tablo + iki fonksiyon; mevcut tablolara dokunmaz).

create table if not exists public.seo_404_hits (
  path text primary key check (char_length(path) between 1 and 300 and path like '/%' and position('?' in path) = 0),
  hits bigint not null default 1 check (hits >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 120)
);

create index if not exists seo_404_hits_hits_idx on public.seo_404_hits (hits desc, last_seen_at desc);
create index if not exists seo_404_hits_last_seen_idx on public.seo_404_hits (last_seen_at);

alter table public.seo_404_hits enable row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all on public.seo_404_hits from anon, authenticated;
grant all on public.seo_404_hits to service_role;

create or replace function public.seo_log_404(p_path text, p_referrer_host text default null, p_inc integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is null or char_length(p_path) > 300 or left(p_path, 1) <> '/' or position('?' in p_path) > 0 then
    return;
  end if;
  insert into public.seo_404_hits (path, hits, referrer_host)
  values (p_path, greatest(1, least(coalesce(p_inc, 1), 1000)), nullif(left(p_referrer_host, 120), ''))
  on conflict (path) do update
    set hits = public.seo_404_hits.hits + greatest(1, least(coalesce(p_inc, 1), 1000)),
        last_seen_at = now(),
        referrer_host = coalesce(excluded.referrer_host, public.seo_404_hits.referrer_host);
end;
$$;

create or replace function public.seo_prune_404(p_keep_days integer default 90, p_max_rows integer default 2000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
  step integer := 0;
begin
  delete from public.seo_404_hits where last_seen_at < now() - make_interval(days => greatest(p_keep_days, 7));
  get diagnostics step = row_count;
  removed := removed + step;

  delete from public.seo_404_hits
   where path in (
     select path from public.seo_404_hits order by hits desc, last_seen_at desc offset greatest(p_max_rows, 100)
   );
  get diagnostics step = row_count;
  return removed + step;
end;
$$;

revoke all on function public.seo_log_404(text, text, integer) from public, anon, authenticated;
revoke all on function public.seo_prune_404(integer, integer) from public, anon, authenticated;
grant execute on function public.seo_log_404(text, text, integer) to service_role;
grant execute on function public.seo_prune_404(integer, integer) to service_role;

comment on table public.seo_404_hits is 'SEO merkezi: 404 alan yollar ve sayaçları (IP/sorgu dizesi yok).';

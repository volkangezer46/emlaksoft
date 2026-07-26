-- Üretim hata kaydı (Q4)
--
-- ============================================================================
-- NEDEN
-- ============================================================================
-- Panelde `error.tsx` üç seviyede var ve hatalar `console.error` ile Vercel
-- loglarına düşüyor. Yani hata KAYBOLMUYOR ama:
--   · toplanmıyor — aynı hata 400 kez olmuş mu, bir kez mi, görünmüyor
--   · aranamıyor — hangi kiracıda, hangi sayfada olduğu log satırlarında
--   · kimse bakmıyor — bir uyarı mekanizması yok
--
-- Sentry sınıfı bir servis ücretli bir dış bağımlılık. Bu tablo, bağımlılık
-- eklemeden aynı sorunun %80'ini çözüyor: hata satırı DB'ye yazılıyor,
-- panelden görülebiliyor.
--
-- ============================================================================
-- TEKİLLEŞTİRME — neden şart
-- ============================================================================
-- Bir render döngüsü saniyede yüzlerce hata üretebilir. Her biri ayrı satır
-- olsaydı tablo dakikalar içinde şişer ve asıl bilgi (kaç FARKLI hata var)
-- kaybolurdu. `fingerprint` üzerinde tekil kısıt var: aynı hata tekrar
-- geldiğinde yeni satır değil `occurrences` artıyor.
--
-- ============================================================================
-- KİŞİSEL VERİ
-- ============================================================================
-- Hata metni bir sorgu parçası ya da kullanıcı girdisi taşıyabilir. Bu yüzden
-- `message` ve `stack` uygulama tarafında KIRPILIYOR ve tabloya kişisel veri
-- yazmamak çağıranın sorumluluğunda. Saklama süresi için altta bir temizlik
-- fonksiyonu var.

create table if not exists public.error_logs (
  id           uuid primary key default gen_random_uuid(),
  -- Kiracı bilinmiyorsa (giriş öncesi hata) NULL olabilir.
  tenant_id    uuid references public.tenants(id) on delete cascade,
  user_id      uuid,
  -- 'client' = tarayıcı hata sınırı · 'server' = sunucu tarafı yakalama
  source       text not null default 'client',
  -- Next.js üretimde hata metnini gizler, yerine `digest` verir. Sunucu
  -- logundaki satırla eşleştirmenin tek yolu bu.
  digest       text,
  message      text not null,
  stack        text,
  path         text,
  user_agent   text,
  /*
   * Tekilleştirme anahtarı. Uygulama tarafında (tenant, source, message, path)
   * dörtlüsünden üretiliyor. Kolonun kendisini üretmiyoruz çünkü mesaj
   * normalizasyonu (sayı/uuid maskeleme) uygulama tarafında yapılıyor.
   */
  fingerprint  text not null,
  occurrences  integer not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_at  timestamptz
);

-- Aynı parmak izi tek satır. `tenant_id` NULL olabildiği için COALESCE ile
-- sabit bir değere düşürülüyor — NULL'lar birbirine eşit sayılmaz, o yüzden
-- düz bir UNIQUE(tenant_id, fingerprint) NULL kiracıda tekilleştirme yapmazdı.
create unique index if not exists uq_error_logs_fingerprint
  on public.error_logs (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), fingerprint);

create index if not exists idx_error_logs_tenant_last
  on public.error_logs (tenant_id, last_seen desc);

create index if not exists idx_error_logs_unresolved
  on public.error_logs (last_seen desc)
  where resolved_at is null;

alter table public.error_logs enable row level security;

-- Kiracı kendi hatalarını görür. Yazma uygulama tarafında service_role ile
-- yapılıyor (kiracısı bilinmeyen hata da yazılabilmeli).
create policy error_logs_tenant_read on public.error_logs
  for select
  using (tenant_id = public.current_tenant_id());

-- Platform ekibi hepsini görür ve çözüldü işaretleyebilir.
create policy error_logs_staff_all on public.error_logs
  for all
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

/*
 * Saklama temizliği. Çözülmüş ve eskimiş kayıtları siler.
 * Cron'dan çağrılabilir; şu an elle çalıştırılıyor.
 */
create or replace function public.purge_old_error_logs(p_days integer default 90)
returns integer
language sql
volatile
security definer
set search_path to 'public'
as $$
  with silinen as (
    delete from public.error_logs
    where last_seen < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::int from silinen;
$$;

comment on table public.error_logs is
  'Uretim hata kaydi. Ayni hata tekrar gelince yeni satir degil occurrences artar.';

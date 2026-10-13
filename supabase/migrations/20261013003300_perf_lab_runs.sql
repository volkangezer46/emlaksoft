-- SP4 Hiz merkezi: PageSpeed/CrUX/Lighthouse laboratuvar olcumleri (gunde yol x cihaz x kaynak basina tek satir).
--
-- Tenant verisi DEGILDIR (herkese acik sitenin hiz olcumu); kisisel veri saklanmaz.
-- RLS acik, politika yok -> anon/authenticated hicbir sey goremez; erisim yalniz service_role (seo_404_hits deseni).
-- Yazan: /api/cron/hiz-robotu (02:55 UTC) ve /admin/site/hiz/lab "Olc" eylemi (src/lib/perf/store.ts).
-- Budama: 400 gunden eski satirlar cron'da silinir (delete ... where day < cutoff).
-- platform_settings anahtarlari (tablo degisikligi YOK, kod yazar): statik.routes (JSON), statik.rev (sayac),
--   perf.psi.key (muhurlu; sealSecret).
-- KOD DAVRANISI: tablo yoksa okumalar bos + "migration bekliyor" notu, cron "atlandi" yazar.
-- GERI ALMA: supabase/rollbacks/20261013003300_perf_lab_runs.rollback.sql (yalniz olcum gecmisi silinir).
-- RISK: dusuk (yeni tablo; mevcut tablo/politika/yetkilere dokunmaz).

create table if not exists public.perf_lab_runs (
  id bigint generated always as identity primary key,
  day date not null,
  path text not null check (char_length(path) between 1 and 300 and left(path, 1) = '/' and position('?' in path) = 0),
  device text not null check (device in ('mobile', 'desktop')),
  source text not null check (source in ('psi', 'crux', 'lighthouse')),
  score smallint check (score is null or score between 0 and 100),
  lcp_ms integer check (lcp_ms is null or lcp_ms >= 0),
  inp_ms integer check (inp_ms is null or inp_ms >= 0),
  cls numeric(8, 4) check (cls is null or cls >= 0),
  tbt_ms integer check (tbt_ms is null or tbt_ms >= 0),
  ttfb_ms integer check (ttfb_ms is null or ttfb_ms >= 0),
  bytes bigint check (bytes is null or bytes >= 0),
  requests integer check (requests is null or requests >= 0),
  html_gz integer check (html_gz is null or html_gz >= 0),
  static_mode text check (static_mode is null or static_mode in ('statik', 'yedek', 'normal')),
  created_at timestamptz not null default now(),
  constraint perf_lab_runs_day_path_device_source_key unique (day, path, device, source)
);

create index if not exists perf_lab_runs_path_day_idx on public.perf_lab_runs (path, day desc);

alter table public.perf_lab_runs enable row level security;
-- Politika bilerek yok: anon/authenticated hicbir sey goremez; service_role RLS'i atlar.
revoke all on table public.perf_lab_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.perf_lab_runs to service_role;
-- Kimlik dizisi varsayilan yetkilerle anon/authenticated'a acilir; tabloya erisim olmasa da kapatilir.
revoke all on sequence public.perf_lab_runs_id_seq from public, anon, authenticated;

comment on table public.perf_lab_runs is 'Hiz merkezi: PageSpeed laboratuvar olcumleri (gun x yol x cihaz x kaynak tek satir; 400 gun saklanir).';

notify pgrst, 'reload schema';

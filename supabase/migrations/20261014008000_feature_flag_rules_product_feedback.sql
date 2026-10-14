-- DG8 (2026-10-14): Özellik bayrağı hedefleme, ürün içi NPS anketi ve özellik istek panosu.
--
-- NE:
--  (1) feature_flag_rules: bayrak başına TEK hedefleme kuralı (ofis listesi, plan, yüzde, zaman penceresi). Bayrak
--      envanteri kodda kalır (src/lib/feature-flags/registry.ts, tek kaynak); bu tablo yalnız "hedeflenebilir"
--      bayrakların kimde açık olduğunu daraltır. Genel anahtar kapalıysa kural etkisizdir (kill switch).
--      Yüzde, (bayrak anahtarı + ofis kimliği) üzerinden deterministik özetle hesaplanır (aynı ofis hep aynı sonuç).
--  (2) platform_nps_surveys + platform_nps_responses: AD8 segmentiyle hedeflenen ürün içi NPS (0-10) anketi.
--      Gösterim satırı platform_nps_mark_shown() ile yazılır: kullanıcı başına advisory kilit + "son N günde
--      gösterildi mi" denetimi tek işlemde (aynı kullanıcıya ayarlanan sıklıktan sık sorulmaz; N ayar defterinden).
--  (3) product_feature_requests + product_feature_request_votes: ofislerin öneri yazıp oy verdiği pano.
--      Oy anahtarı (request_id, tenant_id): bir ofis bir öneriye EN FAZLA bir oy verir. vote_count tetikleyiciyle tutulur.
-- ERİŞİM: tüm tablolar RLS + FORCE, politika yok; yalnız service_role (sunucu eylemleri kapılı: requirePermission /
--      requirePlatformModule). Ofis istemcisi doğrudan okuyamaz/yazamaz.
-- KOD: tablolar yokken bayraklar genel durumla çalışır (hedefleme yok), NPS gösterilmez, öneri panosu "kurulum bekliyor" der.
-- GERİ ALMA: rollbacks/20261014008000_feature_flag_rules_product_feedback.rollback.sql (yeni nesneler silinir).
-- RİSK: düşük; yalnız yeni tablo/fonksiyon/tetikleyici, mevcut nesne ve veri değişmez.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- (1) Özellik bayrağı hedefleme
-- ---------------------------------------------------------------------------
create table if not exists public.feature_flag_rules (
  flag_key    text primary key check (flag_key ~ '^[a-z0-9_]{2,64}$'),
  tenant_ids  uuid[] not null default '{}'::uuid[],
  plans       text[] not null default '{}'::text[],
  percentage  smallint not null default 0 check (percentage between 0 and 100),
  starts_at   timestamptz,
  ends_at     timestamptz,
  note        text check (note is null or char_length(note) <= 300),
  updated_by  uuid references public.platform_staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  check (cardinality(tenant_ids) <= 500),
  check (plans <@ array['advisor', 'office', 'professional', 'business', 'enterprise']::text[]),
  -- Boş hedef (ne ofis ne yüzde) bayrağı herkese kapatırdı: genel anahtar bunun için var.
  check (cardinality(tenant_ids) > 0 or percentage > 0)
);

alter table public.feature_flag_rules enable row level security;
alter table public.feature_flag_rules force row level security;
revoke all on public.feature_flag_rules from anon, authenticated;
grant all on public.feature_flag_rules to service_role;

-- ---------------------------------------------------------------------------
-- (2) NPS anketi
-- ---------------------------------------------------------------------------
create table if not exists public.platform_nps_surveys (
  id           uuid primary key default gen_random_uuid(),
  question     text not null check (char_length(question) between 10 and 200),
  -- AD8 segment tanımı (arşiv etiketi); hedef ofis listesi kayıt anında çözülür (NULL = tüm ofisler).
  segment_json jsonb not null default '{}'::jsonb,
  tenant_ids   uuid[],
  owners_only  boolean not null default false,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  is_active    boolean not null default true,
  created_by   uuid references public.platform_staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (tenant_ids is null or cardinality(tenant_ids) between 1 and 5000)
);

create index if not exists idx_platform_nps_surveys_live
  on public.platform_nps_surveys (starts_at desc)
  where is_active;

create table if not exists public.platform_nps_responses (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references public.platform_nps_surveys(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  shown_at     timestamptz not null default now(),
  score        smallint check (score between 0 and 10),
  comment      text check (comment is null or char_length(comment) <= 1000),
  responded_at timestamptz,
  dismissed_at timestamptz,
  -- Bir anket bir kullanıcıya bir kez gösterilir.
  unique (survey_id, user_id),
  check ((score is null) = (responded_at is null)),
  check (comment is null or score is not null)
);

create index if not exists idx_platform_nps_responses_user on public.platform_nps_responses (user_id, shown_at desc);
create index if not exists idx_platform_nps_responses_survey on public.platform_nps_responses (survey_id, responded_at desc);
create index if not exists idx_platform_nps_responses_tenant on public.platform_nps_responses (tenant_id);

alter table public.platform_nps_surveys enable row level security;
alter table public.platform_nps_surveys force row level security;
alter table public.platform_nps_responses enable row level security;
alter table public.platform_nps_responses force row level security;
revoke all on public.platform_nps_surveys from anon, authenticated;
revoke all on public.platform_nps_responses from anon, authenticated;
grant all on public.platform_nps_surveys to service_role;
grant all on public.platform_nps_responses to service_role;

-- Gösterim kaydı: kullanıcı son p_interval_days gün içinde HERHANGİ bir NPS gördüyse yazmaz (NULL döner).
-- Kullanıcı başına advisory kilit: aynı anda açılan iki sekme iki gösterim yazamaz.
create or replace function public.platform_nps_mark_shown(p_survey uuid, p_tenant uuid, p_user uuid, p_interval_days integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_survey is null or p_tenant is null or p_user is null then
    raise exception 'NPS gösterimi için anket, ofis ve kullanıcı gerekli' using errcode = 'P0001';
  end if;
  if p_interval_days is null or p_interval_days < 1 or p_interval_days > 3650 then
    raise exception 'Geçersiz NPS sıklığı' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_nps:' || p_user::text, 0));
  if exists (
    select 1 from public.platform_nps_responses r
    where r.user_id = p_user and r.shown_at > now() - make_interval(days => p_interval_days)
  ) then
    return null;
  end if;
  insert into public.platform_nps_responses (survey_id, tenant_id, user_id)
  values (p_survey, p_tenant, p_user)
  on conflict (survey_id, user_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_nps_mark_shown(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.platform_nps_mark_shown(uuid, uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- (3) Özellik istek panosu
-- ---------------------------------------------------------------------------
create table if not exists public.product_feature_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  created_by        uuid references auth.users(id) on delete set null,
  title             text not null check (char_length(title) between 5 and 120),
  body              text check (body is null or char_length(body) <= 2000),
  -- yeni: yalnız öneren ofis görür (moderasyon) · degerlendiriliyor/planlandi/yapiliyor/yayinda: tüm ofisler görür
  -- reddedildi: yalnız öneren ofis görür.
  status            text not null default 'yeni'
                      check (status in ('yeni', 'degerlendiriliyor', 'planlandi', 'yapiliyor', 'yayinda', 'reddedildi')),
  vote_count        integer not null default 0 check (vote_count >= 0),
  admin_note        text check (admin_note is null or char_length(admin_note) <= 600),
  status_changed_at timestamptz,
  status_changed_by uuid references public.platform_staff(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_product_feature_requests_board
  on public.product_feature_requests (status, vote_count desc, created_at desc);
create index if not exists idx_product_feature_requests_tenant on public.product_feature_requests (tenant_id);

create table if not exists public.product_feature_request_votes (
  request_id uuid not null references public.product_feature_requests(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Ofis başına tek oy.
  primary key (request_id, tenant_id)
);

create index if not exists idx_product_feature_request_votes_tenant on public.product_feature_request_votes (tenant_id);

create or replace function public.product_feature_request_vote_count()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.product_feature_requests set vote_count = vote_count + 1 where id = new.request_id;
    return new;
  end if;
  update public.product_feature_requests set vote_count = greatest(vote_count - 1, 0) where id = old.request_id;
  return old;
end;
$$;

revoke all on function public.product_feature_request_vote_count() from public, anon, authenticated;

drop trigger if exists trg_product_feature_request_vote_count on public.product_feature_request_votes;
create trigger trg_product_feature_request_vote_count
  after insert or delete on public.product_feature_request_votes
  for each row
  execute function public.product_feature_request_vote_count();

alter table public.product_feature_requests enable row level security;
alter table public.product_feature_requests force row level security;
alter table public.product_feature_request_votes enable row level security;
alter table public.product_feature_request_votes force row level security;
revoke all on public.product_feature_requests from anon, authenticated;
revoke all on public.product_feature_request_votes from anon, authenticated;
grant all on public.product_feature_requests to service_role;
grant all on public.product_feature_request_votes to service_role;

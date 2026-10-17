-- MIGRATION 20261024010000_zeka_learning.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod tablo/RPC yokken Zeka calisir (yerel zeka + kod bilgisi), yalniz
--   sorgu gunlugu, geri bildirim, onayli soru-cevap ve gomme dizini katmanlari sessizce atlanir.
-- Geri alma: supabase/rollbacks/20261024010000_zeka_learning.rollback.sql
-- BAGIMLILIK: public.current_active_tenant_id(), public.is_platform_staff(), public.platform_staff_can(text,text).
--
-- NE (EmlakSoft Zeka ogrenme dongusu):
--   zeka_query_log          : KISISEL VERISIZ sorgu gunlugu (metin uygulamada redact.ts ile maskelenir, 300 karakter).
--                             Satir: yuzey, niyet, motor, guven, yanitlandi mi, dusus nedeni, olumlu/olumsuz oy. Ofis kimligi ve kullanici
--                             oturumdan yazilir (istemci baska ofis adina yazamaz). OKUMA yalniz platform personeli
--                             (advisor:view); yazma yalniz zeka_log_query / zeka_query_feedback RPC'leri.
--   zeka_qa                 : yoneticinin onayladigi soru-cevap ciftleri (iki motor da bilgi parcasi olarak kullanir).
--                             Okuma: etkin ciftler (anon public/vitrin/all, oturumlu + app; admin yuzeyi yalniz personel);
--                             yazma platform personeli (sistem:write).
--   zeka_knowledge_vectors  : bilgi parcalarinin gomme vektorleri (real[]; pgvector GEREKMEZ, kosinus uygulamada).
--                             Okuma zeka_knowledge_vectors_read (DEFINER), yazma yalniz service_role (gece bakimi).
--   zeka_usage_stats        : yonetim ekrani icin niyet/motor/yuzey sayaclari (platform personeli).
-- RISK: dusuk (yeni tablolar + yeni RPC'ler; mevcut nesnelere dokunmaz).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.is_platform_staff()') is null
     or pg_catalog.to_regprocedure('public.platform_staff_can(text,text)') is null then
    raise exception 'current_active_tenant_id / is_platform_staff / platform_staff_can yok; once kimlik ve platform personeli migrationlari uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1) Sorgu gunlugu
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.zeka_query_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  surface          text not null check (surface in ('app', 'public', 'vitrin', 'admin')),
  tenant_id        uuid references public.tenants(id) on delete cascade,
  user_id          uuid,
  query_redacted   text not null check (char_length(query_redacted) between 1 and 300),
  intent           text not null check (intent in ('navigate', 'search', 'create', 'data', 'howto', 'report', 'unknown')),
  engine           text not null check (engine in ('local', 'gpt')),
  confidence       numeric(3,2) not null default 0 check (confidence between 0 and 1),
  answered         boolean not null default false,
  fallback_reason  text check (fallback_reason is null or char_length(fallback_reason) <= 40),
  feedback         smallint check (feedback is null or feedback in (-1, 1)),
  feedback_at      timestamptz
);

comment on table public.zeka_query_log is
  'EmlakSoft Zeka sorgu gunlugu (kisisel verisiz; metin redact.ts ile maskeli). Ogrenme dongusu: cevapsiz/dusuk guvenli sorgular, geri bildirim.';

create index if not exists idx_zeka_query_log_created on public.zeka_query_log (created_at desc);
create index if not exists idx_zeka_query_log_unanswered on public.zeka_query_log (created_at desc) where answered = false or confidence < 0.45 or feedback = -1;
create index if not exists idx_zeka_query_log_tenant on public.zeka_query_log (tenant_id, created_at desc) where tenant_id is not null;

alter table public.zeka_query_log enable row level security;

drop policy if exists zeka_query_log_staff_select on public.zeka_query_log;
create policy zeka_query_log_staff_select on public.zeka_query_log
  for select to authenticated
  using ((select public.platform_staff_can('advisor', 'view')));

revoke all on table public.zeka_query_log from anon, authenticated;
grant select on table public.zeka_query_log to authenticated;
grant all on table public.zeka_query_log to service_role;

-- Yazma TEK yol: kimlik oturumdan, ofis yalniz uygulama yuzeyinde current_active_tenant_id(); vitrin yuzeyinde sunucunun
-- slug'dan cozdugu ofis (gecerli ofis kimligi degilse null).
create or replace function public.zeka_log_query(
  p_surface text,
  p_query text,
  p_intent text,
  p_engine text,
  p_confidence numeric,
  p_answered boolean,
  p_fallback text default null,
  p_tenant_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if p_surface not in ('app', 'public', 'vitrin', 'admin') then
    return null;
  end if;
  if p_surface = 'app' then
    v_tenant := public.current_active_tenant_id();
    if v_tenant is null then
      return null;
    end if;
  elsif p_surface = 'vitrin' then
    select t.id into v_tenant from public.tenants t where t.id = p_tenant_id;
    v_user := null;
  elsif p_surface = 'admin' then
    if not public.is_platform_staff() then
      return null;
    end if;
  else
    v_user := null;
  end if;

  insert into public.zeka_query_log (surface, tenant_id, user_id, query_redacted, intent, engine, confidence, answered, fallback_reason)
  values (
    p_surface,
    v_tenant,
    v_user,
    left(coalesce(nullif(btrim(p_query), ''), '-'), 300),
    case when p_intent in ('navigate', 'search', 'create', 'data', 'howto', 'report', 'unknown') then p_intent else 'unknown' end,
    case when p_engine = 'gpt' then 'gpt' else 'local' end,
    greatest(0, least(1, coalesce(p_confidence, 0)))::numeric(3,2),
    coalesce(p_answered, false),
    left(nullif(btrim(p_fallback), ''), 40)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid) to anon, authenticated, service_role;

-- olumlu/olumsuz oy: satir basina bir kez, 24 saat icinde. Ofis/yonetim satirina yalniz soran kullanici; anonim satira kimligi bilen.
create or replace function public.zeka_query_feedback(p_id uuid, p_vote integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_vote not in (-1, 1) then
    return false;
  end if;
  update public.zeka_query_log l
     set feedback = p_vote::smallint, feedback_at = now()
   where l.id = p_id
     and l.feedback is null
     and l.created_at > now() - interval '24 hours'
     and (l.user_id is null or l.user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.zeka_query_feedback(uuid, integer) from public, anon, authenticated;
grant execute on function public.zeka_query_feedback(uuid, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2) Onayli soru-cevap ciftleri
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.zeka_qa (
  id          uuid primary key default gen_random_uuid(),
  surface     text not null default 'all' check (surface in ('all', 'app', 'public', 'vitrin', 'admin')),
  question    text not null check (char_length(question) between 3 and 300),
  answer      text not null check (char_length(answer) between 3 and 2000),
  href        text check (href is null or (char_length(href) <= 300 and href ~ '^/[^/\\]')),
  status      text not null default 'active' check (status in ('active', 'archived')),
  source_log_id uuid references public.zeka_query_log(id) on delete set null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.zeka_qa is
  'EmlakSoft Zeka onayli soru-cevap ciftleri (yonetici ekler; yerel ve GPT motoru bilgi parcasi olarak kullanir).';

create index if not exists idx_zeka_qa_surface on public.zeka_qa (surface, status);

alter table public.zeka_qa enable row level security;

drop policy if exists zeka_qa_read on public.zeka_qa;
create policy zeka_qa_read on public.zeka_qa
  for select to anon, authenticated
  using (
    status = 'active'
    and (surface in ('all', 'public', 'vitrin') or (surface = 'app' and (select auth.uid()) is not null))
  );

drop policy if exists zeka_qa_staff_select on public.zeka_qa;
create policy zeka_qa_staff_select on public.zeka_qa
  for select to authenticated
  using ((select public.platform_staff_can('advisor', 'view')));

drop policy if exists zeka_qa_staff_insert on public.zeka_qa;
create policy zeka_qa_staff_insert on public.zeka_qa
  for insert to authenticated
  with check ((select public.platform_staff_can('sistem', 'write')) and created_by = (select auth.uid()));

drop policy if exists zeka_qa_staff_update on public.zeka_qa;
create policy zeka_qa_staff_update on public.zeka_qa
  for update to authenticated
  using ((select public.platform_staff_can('sistem', 'write')))
  with check ((select public.platform_staff_can('sistem', 'write')));

drop policy if exists zeka_qa_staff_delete on public.zeka_qa;
create policy zeka_qa_staff_delete on public.zeka_qa
  for delete to authenticated
  using ((select public.platform_staff_can('sistem', 'write')));

revoke all on table public.zeka_qa from anon, authenticated;
grant select on table public.zeka_qa to anon, authenticated;
grant insert, update, delete on table public.zeka_qa to authenticated;
grant all on table public.zeka_qa to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3) Gomme vektorleri (pgvector olmadan; real[])
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.zeka_knowledge_vectors (
  chunk_id      text primary key check (char_length(chunk_id) between 1 and 200),
  content_hash  text not null check (char_length(content_hash) between 4 and 64),
  model         text not null check (char_length(model) between 1 and 60),
  embedding     real[] not null check (cardinality(embedding) between 8 and 4096),
  updated_at    timestamptz not null default now()
);

comment on table public.zeka_knowledge_vectors is
  'EmlakSoft Zeka bilgi parcalarinin gomme vektorleri (urun bilgisi; kiraci verisi YOK). Yazan: gece bakimi (service_role).';

alter table public.zeka_knowledge_vectors enable row level security;
revoke all on table public.zeka_knowledge_vectors from anon, authenticated;
grant all on table public.zeka_knowledge_vectors to service_role;

create or replace function public.zeka_knowledge_vectors_read()
returns table (chunk_id text, embedding real[])
language sql
stable
security definer
set search_path = ''
as $$
  select v.chunk_id, v.embedding from public.zeka_knowledge_vectors v order by v.chunk_id limit 5000;
$$;

revoke all on function public.zeka_knowledge_vectors_read() from public, anon, authenticated;
grant execute on function public.zeka_knowledge_vectors_read() to anon, authenticated, service_role;

-- Gece bakimi yazicisi (yalniz service_role): verilen satirlari yazar/gunceller, `p_keep` disindaki eski parcalari siler.
create or replace function public.zeka_knowledge_vectors_store(p_rows jsonb, p_keep text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows dizi olmali';
  end if;
  insert into public.zeka_knowledge_vectors (chunk_id, content_hash, model, embedding, updated_at)
  select r->>'chunk_id', r->>'content_hash', r->>'model',
         array(select (x)::real from jsonb_array_elements_text(r->'embedding') x), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (chunk_id) do update
    set content_hash = excluded.content_hash, model = excluded.model, embedding = excluded.embedding, updated_at = now();
  get diagnostics v_count = row_count;
  if p_keep is not null then
    delete from public.zeka_knowledge_vectors v where not (v.chunk_id = any (p_keep));
  end if;
  return v_count;
end;
$$;

revoke all on function public.zeka_knowledge_vectors_store(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.zeka_knowledge_vectors_store(jsonb, text[]) to service_role;

-- Dizin durumu (gece bakimi hangi parcalarin guncel oldugunu bilir; yalniz service_role).
create or replace function public.zeka_knowledge_vectors_state()
returns table (chunk_id text, content_hash text, model text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.chunk_id, v.content_hash, v.model from public.zeka_knowledge_vectors v;
$$;

revoke all on function public.zeka_knowledge_vectors_state() from public, anon, authenticated;
grant execute on function public.zeka_knowledge_vectors_state() to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4) Yonetim istatistigi
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.zeka_usage_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  if not public.platform_staff_can('advisor', 'view') then
    return null;
  end if;
  select jsonb_build_object(
    'total', count(*),
    'answered', count(*) filter (where answered),
    'low_confidence', count(*) filter (where confidence < 0.45),
    'helpful', count(*) filter (where feedback = 1),
    'unhelpful', count(*) filter (where feedback = -1),
    'by_intent', coalesce((select jsonb_object_agg(intent, n) from (select intent, count(*) n from public.zeka_query_log where created_at >= v_since group by intent) i), '{}'::jsonb),
    'by_engine', coalesce((select jsonb_object_agg(engine, n) from (select engine, count(*) n from public.zeka_query_log where created_at >= v_since group by engine) e), '{}'::jsonb),
    'by_surface', coalesce((select jsonb_object_agg(surface, n) from (select surface, count(*) n from public.zeka_query_log where created_at >= v_since group by surface) s), '{}'::jsonb)
  )
  into v_out
  from public.zeka_query_log
  where created_at >= v_since;
  return v_out;
end;
$$;

revoke all on function public.zeka_usage_stats(integer) from public, anon, authenticated;
grant execute on function public.zeka_usage_stats(integer) to authenticated, service_role;

-- MIGRATION 20260826002500_insights.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002500_insights.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002500_insights.rollback.sql
-- BAGIMLILIK: public.tenants, public.profiles, public.tasks, public.current_tenant_id(), public.current_profile_role(),
--   public.is_platform_staff().
--
-- AMAC (Zeka katmani P1 / Insight Engine): kullanici basina, kanitli, son gecerlilikli, ertelenebilir icgoru kuyrugu.
--   notifications ile BIRLESTIRILMEZ: yasam dongusu farkli (dedupe anahtari, oncelik, son gecerlilik, ertele/yoksay/uygulandi).
--   Yuksek siddetli icgoru zile mevcut notifyTenant ile TEK KEZ dusurulur (kod tarafi; notified_at ile isaretlenir).
--
-- KONTRATLAR (insights-contract.test.ts statik dogrular):
--   * href NOT NULL ve '/' ile baslar (sifir cikmaz metrik).
--   * unique (tenant_id, recipient_user_id, dedupe_key): ayni olay iki kez icgoru uretmez.
--   * sample_scope sutunu CHECK (sample_scope = false): ornek (demo) veri ofiste icgoru URETMEZ.
--   * RLS: alici yalniz KENDI satirlarini okur; owner/gm kendi ofisinin satirlarini okur. Yazma (insert/update/delete)
--     authenticated icin KAPALI; yalniz service_role (engine) yazar, durum degisimi insight_set_state RPC'siyle.
--
-- ETKI: yalniz yeni tablo + indeks + RPC (ek). Mevcut tablolara dokunmaz.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'public.tenants/profiles yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tasks') is null then
    raise exception 'public.tasks yok; once 20260722000022 uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception 'current_tenant_id()/current_profile_role() yok.';
  end if;
end $$;

create table if not exists public.insights (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- Alici: ofis geneli icgoru yonetim rolundeki her aktif kullanici icin AYRI satirdir (fan-out).
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  kind              text not null check (kind in (
    'call_priority', 'deal_risk', 'price_action', 'match_suggestion', 'anomaly', 'forecast', 'compliance', 'deadline', 'digest'
  )),
  -- Kural kimligi + surum, orn. 'deal_risk@1' (kalite olcumu ve sessize alma bunun uzerinden).
  rule_id           text not null check (char_length(rule_id) between 3 and 80),
  severity          text not null check (severity in ('bilgi', 'orta', 'yuksek')),
  priority          smallint not null default 0 check (priority between 0 and 100),
  title             text not null check (char_length(title) between 1 and 200),
  -- "Neden?" satiri: kanit ozeti (kural metni; LLM degil).
  why               text not null check (char_length(why) between 1 and 600),
  -- [{label, value, href?}]: yalniz etiket/sayi; telefon/e-posta/TC YOK.
  evidence          jsonb not null default '[]'::jsonb,
  -- Filtrelenmis hedef (sifir cikmaz metrik).
  href              text not null check (char_length(href) between 1 and 500 and href like '/%'),
  entity_type       text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id         uuid,
  is_forecast       boolean not null default false,
  confidence        text check (confidence is null or confidence in ('dusuk', 'orta', 'yuksek')),
  -- Deterministik anahtar: kural:kayit[:donem].
  dedupe_key        text not null check (char_length(dedupe_key) between 3 and 200),
  state             text not null default 'new' check (state in ('new', 'seen', 'snoozed', 'dismissed', 'accepted')),
  state_reason      text check (state_reason is null or state_reason in ('yanlis', 'zaten_yaptim', 'ilgisiz', 'sonra')),
  snoozed_until     timestamptz,
  valid_until       timestamptz not null,
  -- Ornek (demo) veri icgoru uretmez: bu sutun yalniz kontrat olarak vardir, true yazilamaz.
  sample_scope      boolean not null default false check (sample_scope = false),
  accepted_task_id  uuid references public.tasks(id) on delete set null,
  notified_at       timestamptz,
  -- Opsiyonel LLM anlatimi (yalniz 'digest'; varsayilan KAPALI, ofis ayari). Bos ise kural metni gosterilir.
  narrative         text check (narrative is null or char_length(narrative) <= 600),
  narrative_source  text not null default 'rule' check (narrative_source in ('rule', 'ai')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, recipient_user_id, dedupe_key)
);

-- Ana ekran okuyucusu: kullanicinin acik icgorulerini oncelik sirasiyla (kismi indeks).
create index if not exists idx_insights_recipient_open
  on public.insights (tenant_id, recipient_user_id, priority desc)
  where state in ('new', 'seen', 'snoozed');
-- Son gecerlilik temizligi.
create index if not exists idx_insights_valid_until
  on public.insights (tenant_id, valid_until);
-- Kural kalite olcumu (insight_rule_quality).
create index if not exists idx_insights_rule_quality
  on public.insights (tenant_id, rule_id, created_at desc);

alter table public.insights enable row level security;

-- Alici kendi satirini okur; owner/gm kendi ofisinin tum satirlarini okur.
drop policy if exists insights_select on public.insights;
create policy insights_select on public.insights
  for select using (
    tenant_id = (select public.current_tenant_id())
    and (
      recipient_user_id = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm')
    )
  );

-- Platform personeli (destek) salt-okunur.
drop policy if exists insights_staff_select on public.insights;
create policy insights_staff_select on public.insights
  for select using ((select public.is_platform_staff()));

-- Yazma politikasi YOK: authenticated insert/update/delete yapamaz. Engine = service_role.
revoke all on public.insights from anon, authenticated;
grant select on public.insights to authenticated;
grant all on public.insights to service_role;

comment on table public.insights is
  'Kullanici bazli icgoru kuyrugu (Insight Engine). Yazma yalniz service_role; durum degisimi insight_set_state RPC.';

-- Durum degisimi: YALNIZ alicinin kendi satiri (auth.uid()), kendi ofisi. Dogrudan update kapali oldugundan tek yol budur.
create or replace function public.insight_set_state(
  p_id uuid,
  p_state text,
  p_reason text default null,
  p_snooze_until timestamptz default null,
  p_task_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_until timestamptz;
  v_rows int;
begin
  if v_uid is null or v_tenant is null then
    return false;
  end if;
  if p_state not in ('seen', 'snoozed', 'dismissed', 'accepted') then
    raise exception 'gecersiz icgoru durumu: %', p_state using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('yanlis', 'zaten_yaptim', 'ilgisiz', 'sonra') then
    raise exception 'gecersiz yoksay nedeni: %', p_reason using errcode = '22023';
  end if;
  if p_task_id is not null and not exists (
    select 1 from public.tasks t where t.id = p_task_id and t.tenant_id = v_tenant
  ) then
    raise exception 'gorev bu ofiste bulunamadi' using errcode = '22023';
  end if;

  if p_state = 'snoozed' then
    -- Varsayilan 1 gun; en cok 30 gun, gecmis tarih kabul edilmez.
    v_until := coalesce(p_snooze_until, pg_catalog.now() + interval '1 day');
    if v_until <= pg_catalog.now() then
      v_until := pg_catalog.now() + interval '1 day';
    end if;
    if v_until > pg_catalog.now() + interval '30 days' then
      v_until := pg_catalog.now() + interval '30 days';
    end if;
  end if;

  update public.insights i
     set state = p_state,
         state_reason = case when p_state = 'dismissed' then p_reason else null end,
         snoozed_until = case when p_state = 'snoozed' then v_until else null end,
         accepted_task_id = case when p_state = 'accepted' then p_task_id else i.accepted_task_id end,
         updated_at = pg_catalog.now()
   where i.id = p_id
     and i.tenant_id = v_tenant
     and i.recipient_user_id = v_uid
     -- Kapanmis (yoksayilmis/uygulanmis) satir yeniden acilmaz; 'seen' yalniz 'new'den gelir.
     and i.state not in ('dismissed', 'accepted')
     and (p_state <> 'seen' or i.state = 'new');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.insight_set_state(uuid, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.insight_set_state(uuid, text, text, timestamptz, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select to_regclass('public.insights') is not null as tablo,
--        (select relrowsecurity from pg_class where oid = 'public.insights'::regclass) as rls,
--        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'insights') as politika,
--        has_function_privilege('anon', 'public.insight_set_state(uuid,text,text,timestamptz,uuid)', 'execute') as anon_rpc;
-- Beklenen: t | t | 2 | f

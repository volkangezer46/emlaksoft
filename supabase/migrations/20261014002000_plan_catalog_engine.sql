-- MIGRATION 20261014002000_plan_catalog_engine.sql (DG2 — plan katalog motoru: adminden yeni paket)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261014002000_plan_catalog_engine.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261014002000_plan_catalog_engine.rollback.sql
-- BAGIMLILIK: 20261008001000 (plan_monthly_amount son govdesi), 20261007001000 (pending_plan + subscription_schedule_downgrade),
--   20261007001010 (fulfill_billing_payment 10 arg), 20260825000300 (provision_registration / update_tenant_plan_subscription /
--   plan_catalog_document). On-kosul eksikse HICBIR sey yazmadan durur.
--
-- NE YAPAR
--   1) public.billing_plans: paket kimligi kayit defteri (FK hedefi). Taban 5 kimlik (is_base) seed edilir; adminden eklenen
--      paket buraya satir olarak girer (kimlik slug, `tier` = modul kademesi, `archived_at` = satisa kapali). Tanimin kendisi
--      (fiyat, limit, ozellik, gorunurluk) tek kaynakta kalir: platform_settings 'billing.plan_definitions' belgesi
--      `plans.<id>` (`custom: true`). SQL fiyat fonksiyonlari ayni alanlari okur (TS plan-overrides.ts ile tek kaynak).
--   2) tenants.plan / subscriptions.plan / subscriptions.pending_plan / plan_entitlements.plan uzerindeki SABIT CHECK
--      listesi -> billing_plans(id) FK'si (silme/guncelleme RESTRICT). Mevcut satirlarin hepsi taban kimlik (dogrulama sonrasi ayni).
--      support_sla_policies.plan CHECK'i DEGISMEZ (eklenen paket '*' SLA'sini kullanir).
--   3) plan_monthly_amount: taban paket davranisi BIREBIR ayni (ayni yedek tablo); eklenen paket yalniz billing_plans'ta
--      kayitliysa ve belgede `custom: true` + gecerli `monthlyTry` varsa fiyat dondurur (yedek fiyat YOK -> null -> satilamaz).
--      plan_period_amount / plan_campaign_lock_amount / plan_yearly_paid_months degismez (zaten plan_monthly_amount + belgeyi okur).
--   4) Sabit plan listesi kontrolu ("x not in ('advisor', 'office', 'professional', 'business', 'enterprise')") tasiyan
--      4 fonksiyon (fulfill_billing_payment 10 arg [2 yer], provision_registration, subscription_schedule_downgrade,
--      update_tenant_plan_subscription) CANLI govdeleri uzerinden YALNIZ o ifade `not public.billing_plan_known(x)` ile
--      degistirilerek yeniden tanimlanir (pg_get_functiondef; govdenin geri kalani, imza, SECURITY DEFINER, search_path ve
--      yetkiler aynen kalir). Beklenen eslesme sayisi tutmazsa (govde beklenenden farkli) HICBIR sey yazilmaz.
--      billing_plan_known(null) = null: eski `null not in (...)` anlamini korur.
--   4b) billing_plan_is_hidden: arsivli paket (belge `archived` ya da billing_plans.archived_at) de satisa kapali sayilir;
--      planli dusurme RPC'si arsivli pakete yazamaz (DB son hakem; yalniz TS kontrolune guvenilmez).
--   5) plan_catalog_engine_ready(): kod probu (yalniz true); kod bu yoklama true olmadan "yeni paket" eklemez.
--
-- BU DOSYA NE YAPMAZ: 'billing.plan_definitions' belgesine, abonelik/fatura tutarlarina ve price_lock_* alanlarina DOKUNMAZ.
--   Mevcut abonelerin tutari ve fiyat kilidi aynen kalir. Arsivli paket billing_plans'ta kalir (FK), yenileme surer.
-- RISK: dusuk-orta (4 fonksiyonun yeniden tanimi; yalniz plan dogrulama ifadesi degisir). Idempotent: ikinci calistirmada
--   eslesme 0 olur ve fonksiyonlar zaten donusturulmus sayilir (billing_plan_known iceriyorsa atlanir).
-- SALT-OKUNUR DOGRULAMA (once/sonra):
--   select plan, count(*) from public.tenants group by 1;                        -- degismez
--   select public.plan_period_amount(p, 'monthly') from unnest(array['advisor','office','professional','business','enterprise']) p;  -- degismez
--   select count(*) from pg_proc where prosrc like '%billing_plan_known%';          -- sonra 4 (+ helper)

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_settings') is null
     or pg_catalog.to_regclass('public.plan_entitlements') is null
     or pg_catalog.to_regclass('public.subscriptions') is null then
    raise exception '20261014002000: platform_settings / plan_entitlements / subscriptions yok.';
  end if;
  if pg_catalog.to_regprocedure('public.plan_catalog_document()') is null
     or pg_catalog.to_regprocedure('public.plan_monthly_amount(text)') is null
     or pg_catalog.to_regprocedure('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)') is null
     or pg_catalog.to_regprocedure('public.provision_registration(uuid,text,text,text,text,text,text,text,text,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.subscription_schedule_downgrade(text)') is null
     or pg_catalog.to_regprocedure('public.update_tenant_plan_subscription(uuid,uuid,text,text)') is null then
    raise exception '20261014002000: on-kosul fonksiyonlari yok; once 20260825000300, 20261007001000, 20261007001010 ve 20261008001000 uygulanmali.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.subscriptions'::regclass and attname = 'pending_plan' and not attisdropped
  ) then
    raise exception '20261014002000: subscriptions.pending_plan yok; once 20261007001000 uygulanmali.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Paket kimligi kayit defteri
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plans (
  id text primary key,
  tier text not null,
  is_base boolean not null default false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_id_format check (id ~ '^[a-z][a-z0-9_]{2,31}$'),
  constraint billing_plans_tier_check check (tier in ('advisor', 'office', 'professional', 'business', 'enterprise')),
  constraint billing_plans_base_shape check (not is_base or (tier = id and archived_at is null))
);

comment on table public.billing_plans is
  'Paket kimligi kayit defteri (DG2). Taban 5 kimlik + adminden eklenenler; tanim platform_settings billing.plan_definitions belgesinde. FK hedefi: tenants/subscriptions/plan_entitlements.';

alter table public.billing_plans enable row level security;
revoke all privileges on table public.billing_plans from public, anon, authenticated;
-- Silme yetkisi YOK: kimlik bir kez acilir; satistan kaldirma = archived_at.
grant select, insert, update on table public.billing_plans to service_role;

insert into public.billing_plans (id, tier, is_base)
values
  ('advisor', 'advisor', true),
  ('office', 'office', true),
  ('professional', 'professional', true),
  ('business', 'business', true),
  ('enterprise', 'enterprise', true)
on conflict (id) do nothing;

create or replace function public.billing_plan_known(p_plan text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_plan is null then null
    else exists (select 1 from public.billing_plans b where b.id = p_plan)
  end;
$$;

revoke all privileges on function public.billing_plan_known(text) from public, anon, authenticated;
grant execute on function public.billing_plan_known(text) to service_role;

comment on function public.billing_plan_known(text) is
  'Paket kimligi kayitli mi (arsivli dahil; yenileme surer). null girdi = null (eski "x not in (...)" anlami). DG2.';

create or replace function public.plan_catalog_engine_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.to_regclass('public.billing_plans') is not null;
$$;

revoke all privileges on function public.plan_catalog_engine_ready() from public, anon, authenticated;
grant execute on function public.plan_catalog_engine_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sabit CHECK listesi -> FK
-- ---------------------------------------------------------------------------
alter table public.tenants drop constraint if exists tenants_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_pending_plan_check;
alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_check;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tenants_plan_fkey' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_plan_fkey
      foreign key (plan) references public.billing_plans (id) on update restrict on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'subscriptions_plan_fkey' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions add constraint subscriptions_plan_fkey
      foreign key (plan) references public.billing_plans (id) on update restrict on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'subscriptions_pending_plan_fkey' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions add constraint subscriptions_pending_plan_fkey
      foreign key (pending_plan) references public.billing_plans (id) on update restrict on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'plan_entitlements_plan_fkey' and conrelid = 'public.plan_entitlements'::regclass) then
    alter table public.plan_entitlements add constraint plan_entitlements_plan_fkey
      foreign key (plan) references public.billing_plans (id) on update restrict on delete restrict not valid;
  end if;
end
$$;

alter table public.tenants validate constraint tenants_plan_fkey;
alter table public.subscriptions validate constraint subscriptions_plan_fkey;
alter table public.subscriptions validate constraint subscriptions_pending_plan_fkey;
alter table public.plan_entitlements validate constraint plan_entitlements_plan_fkey;

-- ---------------------------------------------------------------------------
-- 3. plan_monthly_amount: taban davranis ayni; eklenen paket belgeden (yedek yok)
-- ---------------------------------------------------------------------------
create or replace function public.plan_monthly_amount(p_plan text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_doc jsonb;
  v_val jsonb;
  v_num numeric;
begin
  if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise') then
    -- Adminden eklenen paket (DG2): kayit defterinde olmali ve belgede `custom: true` + gecerli fiyat tasimali.
    -- TS sanitizeCustomPlan ile ayni kural; gecersiz kayit = null (satilamaz, sessiz yedek fiyat YOK).
    if not exists (select 1 from public.billing_plans b where b.id = v_plan) then
      return null;
    end if;
    v_doc := public.plan_catalog_document();
    if v_doc is null or (v_doc -> 'plans' -> v_plan -> 'custom') is distinct from 'true'::jsonb then
      return null;
    end if;
    v_val := v_doc -> 'plans' -> v_plan -> 'monthlyTry';
    if jsonb_typeof(v_val) = 'number' then
      v_num := (v_val #>> '{}')::numeric;
      if v_num = trunc(v_num) and v_num between 1 and 1000000 then
        return v_num;
      end if;
    end if;
    return null;
  end if;

  v_doc := public.plan_catalog_document();

  if v_doc is null then
    -- Ayar yok: sahibin onayladigi katalog (plans.ts + RECOMMENDED_CATALOG_OVERRIDES, 2026-10-08).
    return case v_plan
      when 'advisor' then 749
      when 'office' then 2790
      when 'professional' then 5490
      when 'business' then 8990
      when 'enterprise' then 14900
    end;
  end if;

  v_val := v_doc -> 'plans' -> v_plan -> 'monthlyTry';
  if jsonb_typeof(v_val) = 'number' then
    v_num := (v_val #>> '{}')::numeric;
    if v_num = trunc(v_num) and v_num between 1 and 1000000 then
      return v_num;
    end if;
  end if;

  -- Ayar var ama bu plan icin gecerli fiyat yok: plans.ts tabani (PLANS + BUSINESS_PLAN_TEMPLATE).
  -- TS resolveCatalogSettings ayni davranir; burada farkli bir deger TS ile SQL'i ayristirir.
  return case v_plan
    when 'advisor' then 749
    when 'office' then 2790
    when 'professional' then 5490
    when 'business' then 8990
    when 'enterprise' then 14900
  end;
end;
$$;

revoke all privileges on function public.plan_monthly_amount(text) from public, anon, authenticated;
grant execute on function public.plan_monthly_amount(text) to service_role;

comment on function public.plan_monthly_amount(text) is
  'Aylik liste fiyati (KDV haric). Taban: TS resolveCatalogSettings ile ayni kural (ayar yoksa 749/2790/5490/8990/14900). Eklenen paket (DG2): billing_plans + belgede custom=true monthlyTry; yoksa null.';

-- ---------------------------------------------------------------------------
-- 3b. billing_plan_is_hidden: arsivli paket de satisa kapali (planli dusurme RPC'sinin son hakemi)
-- ---------------------------------------------------------------------------
-- subscription_schedule_downgrade (authenticated) plan kontrolunu billing_plan_known'a cevirir; o fonksiyon arsivli paketi
-- de kabul eder (yenileme surer). Satis kapisi billing_plan_is_hidden yalniz `hidden` alanina bakiyordu: arsiv yalniz TS
-- tarafinda engelleniyordu, RPC dogrudan cagrilinca arsivli pakete dusurme planlanabiliyordu. Arsiv = belgede
-- `archived: true` YA DA billing_plans.archived_at dolu. Gizli kurali ve 'business' yedegi 20261007001000 ile ayni.
-- Tek cagiran subscription_schedule_downgrade'dir (yenileme/fulfill bu fonksiyonu kullanmaz).
create or replace function public.billing_plan_is_hidden(p_plan text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_doc jsonb;
  v_val jsonb;
begin
  if exists (select 1 from public.billing_plans b where b.id = v_plan and b.archived_at is not null) then
    return true;
  end if;
  v_doc := public.plan_catalog_document();
  if v_doc is not null then
    if jsonb_typeof(v_doc -> 'plans' -> v_plan -> 'archived') = 'boolean'
       and (v_doc -> 'plans' -> v_plan ->> 'archived')::boolean then
      return true;
    end if;
    v_val := v_doc -> 'plans' -> v_plan -> 'hidden';
    if jsonb_typeof(v_val) = 'boolean' then
      return (v_val #>> '{}')::boolean;
    end if;
  end if;
  return v_plan = 'business';
end;
$$;

revoke all privileges on function public.billing_plan_is_hidden(text) from public, anon, authenticated;
grant execute on function public.billing_plan_is_hidden(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Sabit plan listesi kontrolu -> billing_plan_known (canli govde uzerinden, yalniz o ifade)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_new text;
  v_count integer;
  v_pattern constant text :=
    '(btrim\([a-z_]+\)|[a-z_][a-z0-9_]*) not in \(''advisor'', ''office'', ''professional'', ''business'', ''enterprise''\)';
begin
  for r in
    select t.sig, t.expected
    from (values
      ('public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric,text)', 2),
      ('public.provision_registration(uuid,text,text,text,text,text,text,text,text,text,text,text)', 1),
      ('public.subscription_schedule_downgrade(text)', 1),
      ('public.update_tenant_plan_subscription(uuid,uuid,text,text)', 1)
    ) as t(sig, expected)
  loop
    v_def := pg_catalog.pg_get_functiondef(r.sig::regprocedure);
    select count(*) into v_count from pg_catalog.regexp_matches(v_def, v_pattern, 'g');
    if v_count = 0 and pg_catalog.strpos(v_def, 'billing_plan_known(') > 0 then
      continue; -- ikinci calistirma: zaten donusturulmus
    end if;
    if v_count <> r.expected then
      raise exception '20261014002000: % govdesinde % sabit plan listesi bekleniyordu, % bulundu; govde beklenenden farkli, hicbir sey yazilmadi.',
        r.sig, r.expected, v_count;
    end if;
    v_new := pg_catalog.regexp_replace(v_def, v_pattern, 'not public.billing_plan_known(\1)', 'g');
    execute v_new;
  end loop;
end
$$;

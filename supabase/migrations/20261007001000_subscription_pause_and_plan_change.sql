-- MIGRATION 20261007001000_subscription_pause_and_plan_change.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007001000_subscription_pause_and_plan_change.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261007001000_subscription_pause_and_plan_change.rollback.sql
--   (20261007001010 rollback'inden SONRA). Rollback yalniz yeni RPC'leri ve sutunlari duser; duraklatma ile uzamis
--   donem sonlari ve uygulanmis plan degisiklikleri GERI ALINMAZ.
--
-- NE EKLER (hepsi VARSAYILAN KAPALI bayraklarin arkasinda; bayrak = platform_settings, Ayar Kayit Defteri)
--   A. subscriptions: pause_started_at / pause_ends_at / pause_last_started_at (duraklatma),
--      pending_plan / pending_plan_effective_at / pending_plan_requested_by (planli dusurme).
--      NOT: 20260825000500'un paused_at/pause_resume_at/pause_remaining sutunlari KULLANILMAZ ve status='paused'
--      (platform askisi anlami) DEGISTIRILMEZ; duraklatilmis abonelik status='active' kalir, yalniz pause_started_at doludur.
--   B. JWT kimlikli RPC'ler (authenticated; kimlik auth.uid(), ofis current_tenant_id(); parametreyle kimlik VERILEMEZ,
--      destek oturumu reddedilir, her adim audit_logs'a AYNI islemde yazilir):
--        subscription_pause(p_days)                 yalniz ofis sahibi; bayrak billing.pause_enabled='on'; en cok
--                                                   billing.pause_max_days (varsayilan 30, 1..90); 365 gunde 1 kez
--        subscription_resume()                      sahip/genel mudur; donem sonu = gercek duraklatma suresi kadar uzar
--        subscription_schedule_downgrade(p_plan)    sahip/genel mudur; bayrak billing.plan_change_proration_enabled='on';
--                                                   yalniz daha ucuz plana; donem sonunda uygulanir, iade YOK
--        subscription_cancel_scheduled_downgrade()  planli dusurmeyi geri alir
--   C. service_role RPC'ler (mevcut abonelik-kontrol cron'una eklenir; yeni cron YOK):
--        subscription_resume_due()                  suresi dolan duraklatmalari otomatik devam ettirir (bayraktan BAGIMSIZ)
--        subscription_apply_scheduled_plan_changes() donemi biten planli dusurmeleri uygular (bayraktan BAGIMSIZ)
--   D. subscription_pause_ready() (authenticated degil, service_role): sutunlar + RPC'ler var mi (kod probe'u).
--
-- NEDEN BAYRAK SQL'DE DE KONTROL EDILIR: RPC'ler authenticated cagrilabilir; yalniz sunucu action'inin bayragi kontrol
--   etmesi dogrudan RPC cagrisiyla atlanirdi. Sinirlar (azami gun, yillik 1 kez) de bu yuzden SQL'dedir.
-- SINIR: duraklatmada "salt-okunur" erisim uygulama katmanindadir (requirePermission: yazma eylemleri reddedilir);
--   dogrudan PostgREST yazimi RLS ile degisen bu migration'da KISITLANMAZ.
-- BAGIMLILIK: 20260825000300 (plan_monthly_amount, plan_campaign_lock_amount), 20260819010500 (cancel_at_period_end),
--   20260817000220 (price_lock_*). On-kosul eksikse HICBIR sey yazmaz.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.subscriptions') is null or to_regclass('public.audit_logs') is null
     or to_regclass('public.platform_settings') is null or to_regclass('public.profiles') is null
     or to_regclass('public.tenants') is null then
    raise exception '20261007001000: subscriptions/audit_logs/platform_settings/profiles/tenants tablolari eksik.';
  end if;
  if to_regprocedure('public.current_tenant_id()') is null then
    raise exception '20261007001000: public.current_tenant_id() yok.';
  end if;
  if to_regprocedure('public.plan_monthly_amount(text)') is null
     or to_regprocedure('public.plan_campaign_lock_amount(text)') is null then
    raise exception '20261007001000: plan_monthly_amount/plan_campaign_lock_amount yok; once 20260825000300 uygulanmali.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'cancel_at_period_end') then
    raise exception '20261007001000: subscriptions.cancel_at_period_end yok; once 20260819010500 uygulanmali.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'price_lock_try') then
    raise exception '20261007001000: subscriptions.price_lock_try yok; once 20260817000220 uygulanmali.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- A. Sema
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists pause_started_at timestamptz,
  add column if not exists pause_ends_at timestamptz,
  add column if not exists pause_last_started_at timestamptz,
  add column if not exists pending_plan text,
  add column if not exists pending_plan_effective_at timestamptz,
  add column if not exists pending_plan_requested_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_pause_pair_check' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions
      add constraint subscriptions_pause_pair_check
      check ((pause_started_at is null) = (pause_ends_at is null) and (pause_ends_at is null or pause_ends_at > pause_started_at));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_pending_plan_check' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions
      add constraint subscriptions_pending_plan_check
      check (pending_plan is null or pending_plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
  end if;
end
$$;

comment on column public.subscriptions.pause_started_at is
  'Duraklatma basladi (dolu = duraklatilmis; status active kalir). Salt-okunur erisim uygulama katmaninda. Devamda donem sonu gercek sure kadar uzar.';
comment on column public.subscriptions.pause_ends_at is 'Duraklatmanin planli bitisi; abonelik-kontrol cron''u bu tarihte otomatik devam ettirir.';
comment on column public.subscriptions.pause_last_started_at is 'Son duraklatmanin baslangici (devamdan sonra da kalir): 365 gunde 1 kez siniri.';
comment on column public.subscriptions.pending_plan is 'Planli dusurme: donem sonunda gecilecek plan (iade yok). Cron uygular.';

-- Yalniz iceriden kullanilan bayrak/ayar okuyuculari (RPC'lerin ortak kaynagi). authenticated/anon ERISEMEZ.
create or replace function public.billing_setting_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select lower(btrim(s.value)) in ('on', 'true', '1') from public.platform_settings s where s.key = p_key),
    false
  );
$$;

create or replace function public.billing_setting_int(p_key text, p_default integer, p_min integer, p_max integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when btrim(s.value) ~ '^[0-9]{1,6}$' and btrim(s.value)::integer between p_min and p_max then btrim(s.value)::integer
              else null
            end
       from public.platform_settings s where s.key = p_key),
    p_default
  );
$$;

revoke all privileges on function public.billing_setting_on(text) from public, anon, authenticated;
revoke all privileges on function public.billing_setting_int(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.billing_setting_on(text) to service_role;
grant execute on function public.billing_setting_int(text, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- B1. Duraklat (yalniz ofis sahibi)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_pause(p_days integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_now timestamptz := now();
  v_max integer;
  v_sub public.subscriptions%rowtype;
  v_ends timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda abonelik duraklatilamaz.' using errcode = '42501';
  end if;
  if not public.billing_setting_on('billing.pause_enabled') then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  perform 1 from public.profiles p
   where p.id = v_uid and p.tenant_id = v_tenant and p.role = 'owner' and p.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;
  v_max := public.billing_setting_int('billing.pause_max_days', 30, 1, 90);
  if p_days is null or p_days < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_days', 'maxDays', v_max);
  end if;
  if p_days > v_max then
    return jsonb_build_object('ok', false, 'code', 'too_long', 'maxDays', v_max);
  end if;

  select * into v_sub from public.subscriptions s where s.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_subscription');
  end if;
  if v_sub.pause_started_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_paused');
  end if;
  if v_sub.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'not_active');
  end if;
  if v_sub.current_period_end is null or v_sub.current_period_end <= v_now then
    return jsonb_build_object('ok', false, 'code', 'period_over');
  end if;
  if coalesce(v_sub.cancel_at_period_end, false) then
    return jsonb_build_object('ok', false, 'code', 'cancel_pending');
  end if;
  if v_sub.pause_last_started_at is not null and v_sub.pause_last_started_at > v_now - interval '365 days' then
    return jsonb_build_object('ok', false, 'code', 'yearly_limit',
                              'nextAllowedAt', v_sub.pause_last_started_at + interval '365 days');
  end if;

  v_ends := v_now + make_interval(days => p_days);
  update public.subscriptions s
     set pause_started_at = v_now,
         pause_ends_at = v_ends,
         pause_last_started_at = v_now,
         updated_at = v_now
   where s.id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'billing.subscription_paused', 'subscription', v_sub.id,
          jsonb_build_object('period_end', v_sub.current_period_end),
          jsonb_build_object('days', p_days, 'pause_ends_at', v_ends));

  return jsonb_build_object('ok', true, 'endsAt', v_ends, 'days', p_days);
end;
$$;

-- ---------------------------------------------------------------------------
-- B2. Devam ettir (sahip/genel mudur)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_resume()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_now timestamptz := now();
  v_sub public.subscriptions%rowtype;
  v_ext interval;
  v_new_end timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda abonelik devam ettirilemez.' using errcode = '42501';
  end if;
  perform 1 from public.profiles p
   where p.id = v_uid and p.tenant_id = v_tenant and p.role in ('owner', 'gm') and p.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;

  select * into v_sub from public.subscriptions s where s.tenant_id = v_tenant for update;
  if not found or v_sub.pause_started_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_paused');
  end if;

  -- Uzama = gercek duraklatma suresi (planli bitisi asamaz).
  v_ext := greatest(least(v_now, v_sub.pause_ends_at) - v_sub.pause_started_at, interval '0');
  v_new_end := case when v_sub.current_period_end is null then null else v_sub.current_period_end + v_ext end;

  update public.subscriptions s
     set current_period_end = v_new_end,
         pause_started_at = null,
         pause_ends_at = null,
         updated_at = v_now
   where s.id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'billing.subscription_resumed', 'subscription', v_sub.id,
          jsonb_build_object('period_end', v_sub.current_period_end, 'pause_started_at', v_sub.pause_started_at),
          jsonb_build_object('period_end', v_new_end, 'extended_seconds', extract(epoch from v_ext)::bigint));

  return jsonb_build_object('ok', true, 'periodEnd', v_new_end, 'extendedSeconds', extract(epoch from v_ext)::bigint);
end;
$$;

-- ---------------------------------------------------------------------------
-- B3. Planli dusurme (donem sonunda uygulanir; iade/kredi YOK)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_schedule_downgrade(p_plan text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_now timestamptz := now();
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_sub public.subscriptions%rowtype;
  v_cur_amount numeric;
  v_new_amount numeric;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda paket degistirilemez.' using errcode = '42501';
  end if;
  if not public.billing_setting_on('billing.plan_change_proration_enabled') then
    return jsonb_build_object('ok', false, 'code', 'disabled');
  end if;
  perform 1 from public.profiles p
   where p.id = v_uid and p.tenant_id = v_tenant and p.role in ('owner', 'gm') and p.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;
  if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise') then
    return jsonb_build_object('ok', false, 'code', 'invalid_plan');
  end if;

  select * into v_sub from public.subscriptions s where s.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_subscription');
  end if;
  if v_sub.status is distinct from 'active' or v_sub.current_period_end is null or v_sub.current_period_end <= v_now then
    return jsonb_build_object('ok', false, 'code', 'not_active');
  end if;
  if v_sub.plan = v_plan then
    return jsonb_build_object('ok', false, 'code', 'same_plan');
  end if;
  v_cur_amount := public.plan_monthly_amount(v_sub.plan);
  v_new_amount := public.plan_monthly_amount(v_plan);
  if v_new_amount is null or v_new_amount <= 0 or v_cur_amount is null or v_new_amount >= v_cur_amount then
    return jsonb_build_object('ok', false, 'code', 'not_downgrade');
  end if;

  update public.subscriptions s
     set pending_plan = v_plan,
         pending_plan_effective_at = v_sub.current_period_end,
         pending_plan_requested_by = v_uid,
         updated_at = v_now
   where s.id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'billing.plan_downgrade_scheduled', 'subscription', v_sub.id,
          jsonb_build_object('plan', v_sub.plan, 'pending_plan', v_sub.pending_plan),
          jsonb_build_object('pending_plan', v_plan, 'effective_at', v_sub.current_period_end));

  return jsonb_build_object('ok', true, 'plan', v_plan, 'effectiveAt', v_sub.current_period_end);
end;
$$;

create or replace function public.subscription_cancel_scheduled_downgrade()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_now timestamptz := now();
  v_sub public.subscriptions%rowtype;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() -> 'app_metadata' ->> 'impersonating')::boolean, false) then
    raise exception 'Destek oturumunda paket degistirilemez.' using errcode = '42501';
  end if;
  perform 1 from public.profiles p
   where p.id = v_uid and p.tenant_id = v_tenant and p.role in ('owner', 'gm') and p.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;
  select * into v_sub from public.subscriptions s where s.tenant_id = v_tenant for update;
  if not found or v_sub.pending_plan is null then
    return jsonb_build_object('ok', false, 'code', 'nothing_scheduled');
  end if;

  update public.subscriptions s
     set pending_plan = null, pending_plan_effective_at = null, pending_plan_requested_by = null, updated_at = v_now
   where s.id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, v_uid, 'billing.plan_downgrade_cancelled', 'subscription', v_sub.id,
          jsonb_build_object('pending_plan', v_sub.pending_plan), jsonb_build_object('pending_plan', null));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- C1. Suresi dolan duraklatmalari otomatik devam ettir (service_role; cron). Bayraktan BAGIMSIZ: bayrak kapansa da
--     duraklatilmis ofis sonsuza dek takili kalmaz.
-- ---------------------------------------------------------------------------
create or replace function public.subscription_resume_due()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  r record;
  v_ext interval;
  v_new_end timestamptz;
  v_ids uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  for r in
    select s.id, s.tenant_id, s.current_period_end, s.pause_started_at, s.pause_ends_at
      from public.subscriptions s
     where s.pause_started_at is not null and s.pause_ends_at <= v_now
     order by s.pause_ends_at
     limit 200
       for update skip locked
  loop
    v_ext := greatest(r.pause_ends_at - r.pause_started_at, interval '0');
    v_new_end := case when r.current_period_end is null then null else r.current_period_end + v_ext end;
    update public.subscriptions s
       set current_period_end = v_new_end, pause_started_at = null, pause_ends_at = null, updated_at = v_now
     where s.id = r.id;
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (r.tenant_id, null, 'billing.subscription_auto_resumed', 'subscription', r.id,
            jsonb_build_object('period_end', r.current_period_end, 'pause_started_at', r.pause_started_at),
            jsonb_build_object('period_end', v_new_end, 'extended_seconds', extract(epoch from v_ext)::bigint));
    v_ids := v_ids || r.tenant_id;
  end loop;
  return jsonb_build_object('ok', true, 'resumed', coalesce(array_length(v_ids, 1), 0), 'tenantIds', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- C2. Donemi biten planli dusurmeleri uygula (service_role; cron). Bayraktan BAGIMSIZ.
--     Fiyat: yeni planin liste fiyati (Founders uyesi yeni planin kampanya fiyatina yeniden kilitlenir; yoksa kilit kalkar,
--     fulfill yenileme kuraliyla ayni). Kapasite tetikleyicisi reddederse planli dusurme IPTAL edilir ve audit'e yazilir.
-- ---------------------------------------------------------------------------
create or replace function public.subscription_apply_scheduled_plan_changes()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  r record;
  v_monthly numeric;
  v_lock numeric;
  v_campaign text;
  v_applied uuid[] := '{}';
  v_failed uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  for r in
    select s.id, s.tenant_id, s.plan, s.pending_plan, s.price_lock_campaign, s.current_period_end
      from public.subscriptions s
     where s.pending_plan is not null
       and s.pause_started_at is null
       and s.current_period_end is not null and s.current_period_end <= v_now
       and s.status in ('active', 'past_due')
     order by s.current_period_end
     limit 200
       for update skip locked
  loop
    if r.pending_plan = r.plan then
      update public.subscriptions s
         set pending_plan = null, pending_plan_effective_at = null, pending_plan_requested_by = null, updated_at = v_now
       where s.id = r.id;
      continue;
    end if;
    begin
      v_monthly := public.plan_monthly_amount(r.pending_plan);
      if v_monthly is null or v_monthly <= 0 then
        raise exception 'Plan amount could not be resolved.' using errcode = '22023';
      end if;
      v_lock := null;
      v_campaign := null;
      if r.price_lock_campaign is not null then
        v_lock := public.plan_campaign_lock_amount(r.pending_plan);
        if v_lock is not null then v_campaign := r.price_lock_campaign; end if;
      end if;
      update public.subscriptions s
         set plan = r.pending_plan,
             amount_try = case when v_lock is not null then least(v_lock, v_monthly) else v_monthly end,
             price_lock_try = v_lock,
             price_lock_campaign = v_campaign,
             pending_plan = null, pending_plan_effective_at = null, pending_plan_requested_by = null,
             updated_at = v_now
       where s.id = r.id;
      update public.tenants t set plan = r.pending_plan, updated_at = v_now where t.id = r.tenant_id;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (r.tenant_id, null, 'billing.plan_downgrade_applied', 'subscription', r.id,
              jsonb_build_object('plan', r.plan), jsonb_build_object('plan', r.pending_plan));
      v_applied := v_applied || r.tenant_id;
    exception when others then
      -- Alt islem geri alindi (kapasite tetikleyicisi vb.): planli dusurmeyi temizle ve nedenini kaydet.
      update public.subscriptions s
         set pending_plan = null, pending_plan_effective_at = null, pending_plan_requested_by = null, updated_at = v_now
       where s.id = r.id;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (r.tenant_id, null, 'billing.plan_downgrade_failed', 'subscription', r.id,
              jsonb_build_object('plan', r.plan, 'pending_plan', r.pending_plan),
              jsonb_build_object('error', left(sqlerrm, 300)));
      v_failed := v_failed || r.tenant_id;
    end;
  end loop;
  return jsonb_build_object('ok', true,
                            'applied', coalesce(array_length(v_applied, 1), 0), 'appliedTenantIds', to_jsonb(v_applied),
                            'failed', coalesce(array_length(v_failed, 1), 0), 'failedTenantIds', to_jsonb(v_failed));
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Hazirlik yoklamasi (kod probe'u; hata firlatmaz)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_pause_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  return (
    select count(*) = 6 from information_schema.columns
     where table_schema = 'public' and table_name = 'subscriptions'
       and column_name in ('pause_started_at', 'pause_ends_at', 'pause_last_started_at',
                           'pending_plan', 'pending_plan_effective_at', 'pending_plan_requested_by')
  ) and to_regprocedure('public.subscription_pause(integer)') is not null
    and to_regprocedure('public.subscription_resume()') is not null
    and to_regprocedure('public.subscription_resume_due()') is not null
    and to_regprocedure('public.subscription_apply_scheduled_plan_changes()') is not null;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
revoke all privileges on function public.subscription_pause(integer) from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_resume() from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_schedule_downgrade(text) from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_cancel_scheduled_downgrade() from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_resume_due() from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_apply_scheduled_plan_changes() from public, anon, authenticated, service_role;
revoke all privileges on function public.subscription_pause_ready() from public, anon, authenticated, service_role;

grant execute on function public.subscription_pause(integer) to authenticated;
grant execute on function public.subscription_resume() to authenticated;
grant execute on function public.subscription_schedule_downgrade(text) to authenticated;
grant execute on function public.subscription_cancel_scheduled_downgrade() to authenticated;
grant execute on function public.subscription_resume_due() to service_role;
grant execute on function public.subscription_apply_scheduled_plan_changes() to service_role;
grant execute on function public.subscription_pause_ready() to service_role;

notify pgrst, 'reload schema';

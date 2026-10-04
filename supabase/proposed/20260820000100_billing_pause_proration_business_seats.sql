-- TASLAK (UYGULANMADI, supabase/migrations'a TASINMADI): abonelik duraklatma, oransal yukseltme,
-- Business plani satisi ve ek kullanici satisi. Tasarim: docs/design/BILLING_PAUSE_PRORATION_DESIGN.md
--
-- Bu dosya calisan uygulamaya bagli DEGILDIR. Uygulanmadan once: (1) restore edilebilir backup/PITR
-- dogrulanmali, (2) `npm run check:migrations -- --database` ve dry-run temiz olmali, (3) dosya
-- supabase/migrations altina yeni zaman damgasiyla tasinmali (forward-only), (4) uygulama kodu ancak
-- getPlanSupport() probe'lari bu sema icin eklendikten SONRA acilmali (sema yokken ozellik gizli kalir).
--
-- KAPSAM
--   A. subscriptions: duraklatma sutunlari + extra_seats
--   B. pause_subscription / resume_subscription (service_role)
--   C. quote_upgrade_proration (salt-okunur hesap)
--   D. Business: fulfill_billing_payment / update_tenant_plan_subscription / provision_registration plan listeleri
--      (canli govdeyi pg_get_functiondef ile okuyup degistirir; K1'in 20260816010100 deseni. Boylece
--       K1'in make_interval(platform_default_trial_days) govdesi KAYBOLMAZ.)
--   E. Ek kullanici: plan kota tetikleyicisinde seat_limit + extra_seats

-- ---------------------------------------------------------------------------
-- A. Sema
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists paused_at timestamptz,
  add column if not exists pause_resume_at timestamptz,
  -- Duraklatma aninda donemden kalan sure; devam ettirilince period_end = now() + bu sure.
  add column if not exists pause_remaining interval,
  add column if not exists extra_seats integer not null default 0
    check (extra_seats >= 0 and extra_seats <= 500);

-- NOT: paused_at icin CHECK yok; eski 'paused' satirlari (platform askisi) paused_at tasimaz.

comment on column public.subscriptions.pause_remaining is
  'Duraklatma aninda kalan donem suresi. Duraklatma sirasinda faturalama ve period_end ilerlemez.';
comment on column public.subscriptions.extra_seats is
  'Satin alinmis ek kullanici sayisi; etkin koltuk limiti = plan_entitlements.seat_limit + extra_seats.';

-- ---------------------------------------------------------------------------
-- B. Duraklatma
-- Kurallar: yalniz status='active' ve donemi suren abonelik; deneme ve past_due duraklatilamaz.
-- En fazla 60 gun. Ayni donemde tekrar duraklatma yok (paused_at >= current_period_start ise reddedilir).
-- Duraklatma ofisi askiya ALMAZ (tenants.status degismez; veri erisimi surer) - yalniz faturalama durur.
-- ---------------------------------------------------------------------------
create or replace function public.pause_subscription(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_resume_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_now timestamptz := now();
  v_resume timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'Subscription not found.' using errcode = 'P0002';
  end if;
  if v_sub.status <> 'active' or v_sub.current_period_end is null or v_sub.current_period_end <= v_now then
    raise exception 'Only an active, running subscription can be paused.' using errcode = '55000';
  end if;
  if v_sub.paused_at is not null and v_sub.paused_at >= v_sub.current_period_start then
    raise exception 'Subscription was already paused in this period.' using errcode = '55000';
  end if;
  v_resume := least(coalesce(p_resume_at, v_now + interval '30 days'), v_now + interval '60 days');
  if v_resume <= v_now then
    raise exception 'Resume date must be in the future.' using errcode = '22023';
  end if;

  update public.subscriptions
  set status = 'paused',
      paused_at = v_now,
      pause_resume_at = v_resume,
      pause_remaining = v_sub.current_period_end - v_now,
      updated_at = v_now
  where id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_tenant_id, p_actor_id, 'billing.subscription_paused', 'subscription', v_sub.id,
          jsonb_build_object('status', v_sub.status, 'period_end', v_sub.current_period_end),
          jsonb_build_object('status', 'paused', 'resume_at', v_resume));

  return jsonb_build_object('ok', true, 'resumeAt', v_resume, 'remainingSeconds',
                            extract(epoch from (v_sub.current_period_end - v_now))::bigint);
end;
$$;

create or replace function public.resume_subscription(
  p_tenant_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_now timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if not found or v_sub.status <> 'paused' or v_sub.paused_at is null then
    raise exception 'Subscription is not paused.' using errcode = '55000';
  end if;

  update public.subscriptions
  set status = 'active',
      current_period_end = v_now + coalesce(v_sub.pause_remaining, interval '0'),
      paused_at = null,
      pause_resume_at = null,
      pause_remaining = null,
      updated_at = v_now
  where id = v_sub.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (p_tenant_id, p_actor_id, 'billing.subscription_resumed', 'subscription', v_sub.id,
          jsonb_build_object('status', 'paused'),
          jsonb_build_object('status', 'active', 'period_end', v_now + coalesce(v_sub.pause_remaining, interval '0')));

  return jsonb_build_object('ok', true);
end;
$$;

-- Otomatik devam: cron (/api/cron/*, recordHeartbeat + CRON_SECRET) pause_resume_at <= now() olanlar icin
-- resume_subscription cagirir. Yeni cron route + vercel.json + check:cron sayisi guncellemesi gerektirir (K-disi is).

-- ---------------------------------------------------------------------------
-- C. Oransal yukseltme hesabi (salt-okunur)
-- Katalog fiyati platform_settings'te (JSON) oldugundan DB yeni donem tutarini PARAMETRE alir;
-- uygulama quotePlan/planAmountOf ile hesaplayip gecirir. DB yalniz zaman oranini ve tavanlari dogrular.
--   kalan_oran    = (period_end - now) / (period_end - period_start)       [0..1]
--   kredi         = mevcut_donem_odenen(amount_try)  * kalan_oran          (KDV haric, kayitli fatura tutari)
--   yeni_maliyet  = yeni_donem_tutari                * kalan_oran
--   odenecek      = greatest(0, round(yeni_maliyet - kredi, 2))
-- Mevcut abonelik amount_try DEGISMEZ; yukseltme faturasi ayri (meta.kind='upgrade_proration') kesilir.
-- Yalniz ayni donemde YUKARI gecis (yeni_maliyet > kredi); asagi gecis bir sonraki yenilemede uygulanir.
-- ---------------------------------------------------------------------------
create or replace function public.quote_upgrade_proration(
  p_tenant_id uuid,
  p_new_plan text,
  p_new_period_amount_try numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_now timestamptz := now();
  v_total numeric;
  v_left numeric;
  v_ratio numeric;
  v_credit numeric;
  v_new_cost numeric;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_new_period_amount_try is null or p_new_period_amount_try <= 0 then
    raise exception 'New period amount is required.' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  if not found or v_sub.status <> 'active'
     or v_sub.current_period_start is null or v_sub.current_period_end is null
     or v_sub.current_period_end <= v_now then
    raise exception 'No running paid period to prorate.' using errcode = '55000';
  end if;
  v_total := extract(epoch from (v_sub.current_period_end - v_sub.current_period_start));
  v_left := extract(epoch from (v_sub.current_period_end - v_now));
  v_ratio := least(1, greatest(0, v_left / nullif(v_total, 0)));
  v_credit := round(coalesce(v_sub.amount_try, 0) * v_ratio, 2);
  v_new_cost := round(p_new_period_amount_try * v_ratio, 2);
  return jsonb_build_object(
    'ok', v_new_cost > v_credit,
    'ratio', v_ratio,
    'creditTry', v_credit,
    'newCostTry', v_new_cost,
    'dueTry', greatest(0, round(v_new_cost - v_credit, 2)),
    'plan', p_new_plan
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Business plani: plan listeleri (canli govde uzerinde metin degistirme + dogrulama)
-- plan CHECK kisitlari ve plan_entitlements('business') satiri 20260817000210 ile ZATEN var.
-- Degisen: fonksiyonlardaki ('advisor','office','professional','enterprise') listesi ve sabit fiyat CASE'leri.
-- Sabit fiyatlar SQL'de kalmaya devam eder (yalniz liste fiyatinin YEDEGI; fatura tutari parametre/kayitlidir):
--   business 8990 (RECOMMENDED_CATALOG_OVERRIDES ile ayni). Yillik yedek: aylik * 10 (eski 12*0.8 yerine; kod 10 ay).
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid oid;
  v_name text;
  v_def text;
  v_new text;
  v_changed integer;
begin
  for v_oid, v_name in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fulfill_billing_payment', 'update_tenant_plan_subscription', 'provision_registration')
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := v_def;
    v_new := replace(v_new, '(''advisor'', ''office'', ''professional'', ''enterprise'')',
                            '(''advisor'', ''office'', ''professional'', ''business'', ''enterprise'')');
    v_new := replace(v_new, E'when ''enterprise'' then 12900',
                            E'when ''business'' then 8990\n    when ''enterprise'' then 12900');
    v_new := replace(v_new, 'v_monthly_amount * 12 * 0.8', 'v_monthly_amount * 10');
    if v_new = v_def then
      -- Beklenen desen bulunamadi: sessizce gecme; migration'i durdur ve govdeyi elle incele.
      raise exception 'Plan list pattern not found in %; review live definition.', v_name;
    end if;
    execute v_new;
  end loop;
end
$$;

-- update_tenant_plan_subscription icindeki v_amount_try CASE'i `when 'enterprise' then 12900` desenini
-- tasidigi icin yukaridaki replace onu da kapsar. NOT: bu fonksiyon plan degisince amount_try'i LISTE aylik fiyatina
-- yazar (kayitli tutari ezer). Tasarim notu: platform plan degisiminde amount_try'in korunmasi ya da parametre
-- (p_amount_try) alinmasi ayri karardir; bu taslak davranisi degistirmez.

-- ---------------------------------------------------------------------------
-- E. Ek kullanici: koltuk limiti = plan limiti + extra_seats
-- profiles ekleme/aktiflestirme ve plan degisimi kontrolleri 20260802000320'de seat_limit'i dogrudan okur.
-- Canli tetikleyici/fonksiyon adlari uygulamadan once `\sf` ile dogrulanmali; asagidaki yardimci tek kaynak olur
-- ve ilgili fonksiyonlar `limits.seat_limit` yerine `public.effective_seat_limit(tenant_id)` cagirir.
-- ---------------------------------------------------------------------------
create or replace function public.effective_seat_limit(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when pe.seat_limit is null then null
              else pe.seat_limit + coalesce(s.extra_seats, 0) end
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  left join public.subscriptions s on s.tenant_id = t.id
  where t.id = p_tenant_id;
$$;

revoke all privileges on function public.effective_seat_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_seat_limit(uuid) to service_role;

revoke all privileges on function public.pause_subscription(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all privileges on function public.resume_subscription(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.quote_upgrade_proration(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.pause_subscription(uuid, uuid, timestamptz) to service_role;
grant execute on function public.resume_subscription(uuid, uuid) to service_role;
grant execute on function public.quote_upgrade_proration(uuid, text, numeric) to service_role;

-- TODO (uygulamadan once cozulecek): seat kontrol tetikleyicilerinin (profiles) effective_seat_limit'e baglanmasi
-- bu dosyada YAZILMADI cunku canli govde okunmadan degistirilemez; ayri taslak/adim olarak eklenecek.

notify pgrst, 'reload schema';

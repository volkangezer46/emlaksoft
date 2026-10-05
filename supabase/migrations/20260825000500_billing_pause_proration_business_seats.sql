-- MIGRATION 20260825000500 (2026-10-05 terfi; eski taslak adi proposed/20261005000800_billing_pause_proration_business_seats.sql).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260825000500_billing_pause_proration_business_seats.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825000500_billing_pause_proration_business_seats.rollback.sql
--   (20260825000600 rollback'inden SONRA, 20260825000300 rollback'inden ONCE).
-- Abonelik duraklatma, oransal yukseltme ve ek kullanici (extra_seats) semasi.
-- Tasarim: docs/design/BILLING_PAUSE_PRORATION_DESIGN.md
--
-- TERFI DUZELTMESI (2026-10-05): taslagin "D. Business plan listeleri" bolumu (pg_get_functiondef + replace ile
-- fulfill_billing_payment / update_tenant_plan_subscription / provision_registration canli govdelerini yamalayan
-- DO blogu) CIKARILDI. Yerini tam govdeli 20260825000300_billing_plan_amount_integrity.sql (eski 20261005000500)
-- aldi; D kalsaydi 000300'den sonra desen bulamayip 'Plan list pattern not found' ile bu dosyayi (A/B/C/E dahil)
-- durdururdu. Bu dosya artik HICBIR mevcut fonksiyonu degistirmez.
--
-- Uygulama kodu ancak getPlanSupport() probe'lari bu semayi gordugunde duraklatma/ek koltuk gosterir
-- (sema yokken ozellik gizli kalir).
-- BAGIMLILIK: 20260825000300 (fiyat butunlugu) ONCE uygulanir (yayin sirasi; bu dosya ona teknik olarak bagli degil).
--
-- KAPSAM
--   A. subscriptions: duraklatma sutunlari + extra_seats
--   B. pause_subscription / resume_subscription (service_role)
--   C. quote_upgrade_proration (salt-okunur hesap)
--   E. Ek kullanici: effective_seat_limit(uuid) yardimcisi (= plan seat_limit + extra_seats). Koltuk
--      tetikleyicilerinin buna baglanmasi 20260825000600_seat_purchase_fulfillment.sql'dedir.
--   (D bolumu yok: yukaridaki terfi duzeltmesi.)

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
-- E. Ek kullanici: koltuk limiti = plan limiti + extra_seats
-- profiles ekleme/aktiflestirme ve plan degisimi kontrolleri 20260802000320'de seat_limit'i dogrudan okur.
-- Asagidaki yardimci tek kaynaktir; enforce_plan_capacity / enforce_tenant_plan_capacity tam govdeli olarak
-- 20260825000600_seat_purchase_fulfillment.sql'de buna baglanir (canli govde md5 on-kosuluyla).
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

-- Koltuk tetikleyicilerinin effective_seat_limit'e baglanmasi bu dosyada YOKTUR: 20260825000600 (eski taslak
-- 20261005000900) tam govdeyle yapar. Bu dosya tek basina uygulanirsa extra_seats sayilmaz (koltuk satisi kapali kalir).

notify pgrst, 'reload schema';

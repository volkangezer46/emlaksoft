-- Rollback: 20260826000900_growth_hotfix
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- ETKI: 9 fonksiyon 20260826000600'deki ORIJINAL govdelerine doner (asagida birebir; md5'leri 000900 on-kosul blogundaki "taban" degerleridir).
--   Yeni ic yardimcilar dusurulur. Veri geri alinmaz (bilerek):
--   * Seed kurali (hold_days 45 / monthly_cap_try 5000) ve ertelenen eligible_at DEGISMEZ; geri almak icin elle:
--       update public.growth_reward_rules set hold_days = 30, monthly_cap_try = null
--       where kind = 'referral' and name = 'Davet odulu: 1 aylik paket bedeli' and hold_days = 45 and monthly_cap_try = 5000 and created_by is null;
--   * Hotfix sonrasi verilmis hos geldin kredileri / odenen talepler / 'tier_below_threshold' ile geri alinan bonuslar KALIR.
-- UYARI: bu geri alma B1-B3/B9-B12/B16 guvenlik duzeltmelerini KALDIRIR (acik program yeniden sahte talep/kredi acigina doner);
--   once growth_referral_enabled'i 'off' yapin.
set local lock_timeout = '5s';

create or replace function public.growth_real_payment(p_invoice uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  v_cash numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return false; end if;
  if i.status <> 'paid' or i.currency <> 'TRY' or coalesce(i.amount_try, 0) <= 0 then return false; end if;
  if i.meta ->> 'kind' is not null then return false; end if;
  if coalesce(i.meta ->> 'plan', '') = '' then return false; end if;
  if coalesce(i.meta ->> 'provider', '') in ('demo', 'account_credit')
     or coalesce(i.meta ->> 'source', '') in ('demo', 'account_credit')
     or coalesce(i.iyzico_payment_id, '') like 'demo-%' then
    return false;
  end if;
  if jsonb_typeof(i.meta -> 'walletCashTry') = 'number' then
    v_cash := (i.meta ->> 'walletCashTry')::numeric;
    if v_cash <= 0 then return false; end if;
  end if;
  if i.meta -> 'refund' is not null then return false; end if;
  return true;
end;
$$;

create or replace function public.growth_register_referral(p_invoice uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  r public.growth_reward_rules%rowtype;
  v_base numeric;
  v_amount numeric;
  v_units numeric;
  v_flags text[];
  v_status text;
  v_note text;
  v_claim uuid;
  v_recent int;
  v_cash numeric;
  v_prior int;
begin
  select * into i from public.invoices where id = p_invoice;
  select * into a from public.signup_attributions where tenant_id = i.tenant_id;
  if not found or a.referrer_tenant_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  if not public.growth_flag_on('growth_referral_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'program_off');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-claim:' || a.referrer_tenant_id::text, 0));

  if exists (select 1 from public.growth_reward_claims c where c.referred_tenant_id = i.tenant_id and c.component = 'base') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  -- ILK gercek odeme: ayni ofisin daha once gercek odenmis plan faturasi varsa bu talep uretilmez.
  if exists (
    select 1 from public.invoices x
    where x.tenant_id = i.tenant_id and x.id <> i.id and x.status = 'paid'
      and public.growth_real_payment(x.id)
      and (x.paid_at < i.paid_at or (x.paid_at = i.paid_at and x.id < i.id))
  ) then
    return jsonb_build_object('ok', true, 'skipped', 'not_first_payment');
  end if;

  select * into r from public.growth_reward_rules
  where kind = 'referral' and is_active and valid_from <= now() and (valid_until is null or valid_until > now())
  order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_rule');
  end if;
  select * into s from public.growth_referral_settings where singleton;

  v_base := public.growth_monthly_equiv(p_invoice);
  v_cash := public.growth_cash_net(p_invoice);
  v_amount := round(case r.reward_type
    when 'monthly_multiple' then v_base * r.reward_value
    when 'fixed_try' then r.reward_value
    else v_cash * r.reward_value / 100 end, 2);
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;
  v_units := case when r.reward_type = 'monthly_multiple' then r.reward_value
                  when v_base > 0 then round(v_amount / v_base, 2) else 0 end;

  v_flags := public.growth_pair_flags(a.referrer_tenant_id, i.tenant_id);
  select count(*) into v_recent from public.growth_reward_claims c
  where c.beneficiary_tenant_id = a.referrer_tenant_id and c.component = 'base' and c.created_at > now() - interval '24 hours';
  if v_recent >= s.velocity_max_per_day then
    v_flags := array_append(v_flags, 'velocity'::text);
  end if;
  -- Nakit orani dusukse (hos geldin/kampanya kredisiyle odenmis fatura) odul otomatik verilmez.
  if i.amount_try > 0 and v_cash < round(i.amount_try * s.min_cash_ratio, 2) then
    v_flags := array_append(v_flags, 'low_cash_ratio'::text);
  end if;
  -- Hos geldin kredisini KULLANAN cift: ayni davetliye verilen hos geldin kredisi harcanmissa manuel onay.
  if exists (select 1 from public.account_credit_ledger l
             where l.idempotency_key = 'try:grant:' || i.tenant_id::text || ':growth-welcome-' || i.tenant_id::text)
     and exists (select 1 from public.try_credit_reservations rv where rv.tenant_id = i.tenant_id and rv.state = 'committed') then
    v_flags := array_append(v_flags, 'welcome_credit_used'::text);
  end if;
  -- Ilk N davetci talebi manuel onaya duser (cok hesap/sahte zincir korumasi).
  select count(*) into v_prior from public.growth_reward_claims c
  where c.beneficiary_tenant_id = a.referrer_tenant_id and c.component = 'base' and c.status not in ('rejected', 'reversed');
  if v_prior < s.manual_review_first_n then
    v_flags := array_append(v_flags, 'first_claims_review'::text);
  end if;

  if 'same_tenant' = any (v_flags) then
    v_status := 'rejected';
    v_note := 'same_tenant';
  elsif coalesce(array_length(v_flags, 1), 0) > 0 then
    v_status := 'pending';
  else
    v_status := 'held';
  end if;

  insert into public.growth_reward_claims
    (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, flags, eligible_at, note,
     component, invoice_id, months_units, base_monthly_try)
  values
    (r.id, a.referrer_tenant_id, i.tenant_id, v_amount, v_status, v_flags,
     coalesce(i.paid_at, now()) + make_interval(days => r.hold_days), v_note,
     'base', i.id, v_units, v_base)
  returning id into v_claim;

  perform public.growth_log_event(v_claim, 'registered', null,
    jsonb_build_object('status', v_status, 'amount', v_amount, 'holdDays', r.hold_days));
  if coalesce(array_length(v_flags, 1), 0) > 0 then
    perform public.growth_log_event(v_claim, 'flagged', null, jsonb_build_object('flags', to_jsonb(v_flags)));
  end if;
  return jsonb_build_object('ok', true, 'claim_id', v_claim, 'status', v_status, 'flags', to_jsonb(v_flags));
end;
$$;

create or replace function public.growth_register_partner(p_invoice uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices%rowtype;
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  p public.growth_partners%rowtype;
  r public.growth_reward_rules%rowtype;
  v_first timestamptz;
  v_months int;
  v_n int;
  v_pct numeric;
  v_amount numeric;
  v_flags text[] := '{}';
  v_claim uuid;
  v_cash numeric;
begin
  select * into i from public.invoices where id = p_invoice;
  select * into a from public.signup_attributions where tenant_id = i.tenant_id;
  if not found or a.partner_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  -- FAZ 2 bayragi kapaliyken HICBIR komisyon uretilmez.
  if not public.growth_flag_on('growth_partner_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'partner_program_off');
  end if;
  select * into p from public.growth_partners where id = a.partner_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'partner_inactive');
  end if;
  select * into r from public.growth_reward_rules
  where id = p.rule_id and kind = 'partner' and is_active and valid_from <= now() and (valid_until is null or valid_until > now());
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_rule');
  end if;
  select * into s from public.growth_referral_settings where singleton;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-partner:' || p.id::text, 0));

  if exists (select 1 from public.growth_reward_claims c
             where c.rule_id = r.id and c.referred_tenant_id = i.tenant_id and c.component = 'commission' and c.invoice_id = i.id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Yinelenen komisyon penceresi: ILK gercek odemeden itibaren duration ay.
  select min(x.paid_at) into v_first from public.invoices x
  where x.tenant_id = i.tenant_id and x.status = 'paid' and public.growth_real_payment(x.id);
  v_months := coalesce(r.duration_months, s.partner_duration_months);
  if v_first is null or i.paid_at > v_first + make_interval(months => v_months) then
    return jsonb_build_object('ok', true, 'skipped', 'out_of_window');
  end if;

  -- Kademe: ortagin AKTIF ucretli musteri sayisi (0-tier1_max / -tier2_max / ustu).
  select count(distinct sa.tenant_id) into v_n
  from public.signup_attributions sa
  join public.subscriptions sub on sub.tenant_id = sa.tenant_id and sub.status = 'active'
  where sa.partner_id = p.id;
  v_pct := case when v_n <= s.partner_tier1_max then s.partner_tier1_pct
                when v_n <= s.partner_tier2_max then s.partner_tier2_pct
                else s.partner_tier3_pct end;
  v_cash := public.growth_cash_net(p_invoice);
  v_amount := round(v_cash * v_pct / 100, 2);
  if v_amount <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;

  if p.owner_tenant_id is not null then
    v_flags := public.growth_pair_flags(p.owner_tenant_id, i.tenant_id);
  end if;
  if i.amount_try > 0 and v_cash < round(i.amount_try * s.min_cash_ratio, 2) then
    v_flags := array_append(v_flags, 'low_cash_ratio'::text);
  end if;

  insert into public.growth_reward_claims
    (rule_id, partner_id, referred_tenant_id, amount_try, status, flags, eligible_at, component, invoice_id, months_units, base_monthly_try)
  values
    (r.id, p.id, i.tenant_id,
     v_amount,
     case when 'same_tenant' = any (v_flags) then 'rejected'
          when coalesce(array_length(v_flags, 1), 0) > 0 then 'pending' else 'held' end,
     v_flags, coalesce(i.paid_at, now()) + make_interval(days => r.hold_days), 'commission', i.id, 0, v_cash)
  returning id into v_claim;
  perform public.growth_log_event(v_claim, 'registered', null,
    jsonb_build_object('pct', v_pct, 'activeCustomers', v_n, 'amount', v_amount));
  return jsonb_build_object('ok', true, 'claim_id', v_claim, 'pct', v_pct);
end;
$$;

create or replace function public.growth_grant_welcome(p_referred uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.signup_attributions%rowtype;
  s public.growth_referral_settings%rowtype;
  v_flags text[];
  v_res jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not public.growth_flag_on('growth_referral_enabled') then
    return jsonb_build_object('ok', true, 'skipped', 'program_off');
  end if;
  select * into s from public.growth_referral_settings where singleton;
  if not found or s.welcome_credit_try <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'not_configured');
  end if;
  select * into a from public.signup_attributions where tenant_id = p_referred and ref_kind = 'referral';
  if not found or a.referrer_tenant_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  v_flags := public.growth_pair_flags(a.referrer_tenant_id, p_referred);
  if coalesce(array_length(v_flags, 1), 0) > 0 then
    return jsonb_build_object('ok', true, 'skipped', 'flagged');
  end if;
  if not public.try_credit_ready() then
    return jsonb_build_object('ok', true, 'skipped', 'wallet_not_ready');
  end if;
  v_res := public.try_credit_grant(
    p_referred, s.welcome_credit_try, 'campaign', 'growth-welcome-' || p_referred::text,
    now() + make_interval(days => s.welcome_expires_days),
    jsonb_build_object('program', 'referral_welcome'));
  return jsonb_build_object('ok', true, 'already', coalesce((v_res ->> 'already')::boolean, false), 'amount', s.welcome_credit_try);
end;
$$;

create or replace function public.growth_reverse_claims(p_invoice uuid, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  v_n int := 0;
begin
  for c in
    select id, payout_id from public.growth_reward_claims
    where invoice_id = p_invoice and status in ('held', 'pending', 'approved', 'paid')
    for update
  loop
    update public.growth_reward_claims
    set status = 'reversed', reversal_reason = left(p_reason, 200), updated_at = now(),
        flags = case when c.payout_id is not null and not ('clawback_due' = any (flags)) then array_append(flags, 'clawback_due'::text) else flags end
    where id = c.id;
    perform public.growth_log_event(c.id, 'reversed', null, jsonb_build_object('reason', left(p_reason, 200)));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.growth_grant_claim(p_claim uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.growth_reward_claims%rowtype;
  r public.growth_reward_rules%rowtype;
  s public.growth_referral_settings%rowtype;
  v_used numeric;
  v_remaining numeric;
  v_units numeric;
  v_amount numeric;
  v_month_used numeric;
  v_month_left numeric;
  v_expires timestamptz;
  v_res jsonb;
  v_idem text;
begin
  select * into c from public.growth_reward_claims where id = p_claim for update;
  if not found or c.beneficiary_tenant_id is null or c.status not in ('held', 'approved') then
    return 'error';
  end if;
  select * into r from public.growth_reward_rules where id = c.rule_id;
  select * into s from public.growth_referral_settings where singleton;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('growth-claim:' || c.beneficiary_tenant_id::text, 0));

  -- Davetcinin kendi aboneligi aktif olmali.
  if not exists (select 1 from public.subscriptions sub where sub.tenant_id = c.beneficiary_tenant_id and sub.status = 'active') then
    if not ('referrer_inactive' = any (c.flags)) then
      update public.growth_reward_claims set flags = array_append(flags, 'referrer_inactive'::text), updated_at = now() where id = c.id;
      perform public.growth_log_event(c.id, 'blocked', null, jsonb_build_object('reason', 'referrer_inactive'));
    end if;
    return 'blocked_referrer';
  elsif 'referrer_inactive' = any (c.flags) then
    update public.growth_reward_claims set flags = array_remove(flags, 'referrer_inactive'), updated_at = now() where id = c.id;
  end if;

  -- Yillik tavan (aylik bedel cinsinden; bonuslar dahil).
  select coalesce(sum(x.months_units), 0) into v_used from public.growth_reward_claims x
  where x.beneficiary_tenant_id = c.beneficiary_tenant_id and x.id <> c.id and x.status = 'paid'
    and x.granted_at > now() - interval '365 days';
  v_remaining := s.annual_cap_months - v_used;
  if v_remaining <= 0 then
    update public.growth_reward_claims set status = 'rejected', note = 'annual_cap', decided_at = now(), updated_at = now() where id = c.id;
    perform public.growth_log_event(c.id, 'rejected', null, jsonb_build_object('reason', 'annual_cap'));
    return 'rejected_cap';
  end if;
  v_units := c.months_units;
  v_amount := c.amount_try;
  if c.months_units > 0 and c.months_units > v_remaining then
    v_units := v_remaining;
    v_amount := round(c.amount_try * v_remaining / c.months_units, 2);
  end if;

  -- Aylik TL tavani (kural): takvim ayi (Europe/Istanbul); dolunca ertesi aya bekler.
  if r.monthly_cap_try is not null then
    select coalesce(sum(x.amount_try), 0) into v_month_used from public.growth_reward_claims x
    where x.beneficiary_tenant_id = c.beneficiary_tenant_id and x.id <> c.id and x.status = 'paid'
      and date_trunc('month', x.granted_at at time zone 'Europe/Istanbul') = date_trunc('month', now() at time zone 'Europe/Istanbul');
    v_month_left := r.monthly_cap_try - v_month_used;
    if v_month_left < 0.01 then
      return 'blocked_cap';
    end if;
    if v_amount > v_month_left then
      v_units := case when v_amount > 0 then round(v_units * v_month_left / v_amount, 2) else v_units end;
      v_amount := round(v_month_left, 2);
    end if;
  end if;
  if v_amount < 0.01 then
    return 'blocked_cap';
  end if;

  v_idem := 'ref-claim-' || c.id::text;
  v_expires := case when r.credit_expires_days is not null then now() + make_interval(days => r.credit_expires_days) else null end;
  begin
    v_res := public.try_credit_grant(c.beneficiary_tenant_id, v_amount, 'referral', v_idem, v_expires,
      jsonb_build_object('claim_id', c.id::text, 'program', 'referral', 'component', c.component));
  exception when others then
    return 'error';
  end;
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return 'error';
  end if;
  update public.growth_reward_claims
  set status = 'paid', amount_try = v_amount, months_units = v_units, grant_idem = v_idem, granted_at = now(),
      decided_at = coalesce(decided_at, now()), updated_at = now()
  where id = c.id;
  perform public.growth_log_event(c.id, 'granted', null, jsonb_build_object('amount', v_amount, 'idem', v_idem));
  return 'paid';
end;
$$;

create or replace function public.growth_claims_process(p_limit integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 200), 1000), 1);
  v_wallet boolean;
  s public.growth_referral_settings%rowtype;
  rc record;
  v_inv uuid;
  v_res text;
  n_registered int := 0;
  n_reversed int := 0;
  n_paid int := 0;
  n_blocked int := 0;
  n_rejected int := 0;
  n_clawback int := 0;
  n_wallet_skip int := 0;
  n_bonus int := 0;
  n_partner int := 0;
  n_payout int := 0;
  v_count int;
  v_bonus_id uuid;
  v_payout record;
  v_grant jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  v_wallet := public.try_credit_ready();
  select * into s from public.growth_referral_settings where singleton;

  -- A. Kacirilmis talep uretimi (odeme kancasi hata verdiyse): son 60 gunun odenmis atifli faturalari.
  for v_inv in
    select i.id from public.invoices i
    join public.signup_attributions sa on sa.tenant_id = i.tenant_id and sa.ref_kind in ('referral', 'partner')
    where i.status = 'paid' and i.paid_at > now() - interval '60 days'
      and not exists (select 1 from public.growth_reward_claims c where c.invoice_id = i.id)
    order by i.paid_at desc limit v_limit
  loop
    if (public.growth_claim_register(v_inv) ->> 'claim_id') is not null then
      n_registered := n_registered + 1;
    end if;
  end loop;

  -- B. Iade / iptal / chargeback: odenmis olmayan, iade kaydi olan ya da yakalamasi iade edilen fatura.
  for v_inv in
    select distinct c.invoice_id from public.growth_reward_claims c
    join public.invoices i on i.id = c.invoice_id
    where c.status in ('held', 'pending', 'approved', 'paid')
      and (i.status <> 'paid'
           or i.meta -> 'refund' is not null
           or exists (select 1 from public.billing_payment_captures bc
                      where bc.conversation_id = i.meta ->> 'conversationId' and bc.status in ('refunded', 'refund_required')))
    limit v_limit
  loop
    n_reversed := n_reversed + public.growth_reverse_claims(v_inv, 'invoice_refunded_or_void');
  end loop;
  -- Davet edilen abonelik IPTAL: bekleme suresinde iptal = geri al.
  for rc in
    select distinct x.invoice_id from public.growth_reward_claims x
    join public.subscriptions sub on sub.tenant_id = x.referred_tenant_id
    where x.status in ('held', 'pending', 'approved') and x.component in ('base', 'tier1', 'tier2') and sub.status = 'cancelled'
    limit v_limit
  loop
    n_reversed := n_reversed + public.growth_reverse_claims(rc.invoice_id, 'referred_cancelled');
  end loop;

  -- C. Vadesi gelen / onaylanan davetci talepleri -> TL kredisi
  for rc in
    select x.id, x.referred_tenant_id, x.component from public.growth_reward_claims x
    where x.component in ('base', 'tier1', 'tier2') and x.beneficiary_tenant_id is not null
      and ((x.status = 'held' and x.eligible_at <= now() and cardinality(array_remove(x.flags, 'referrer_inactive')) = 0)
           or x.status = 'approved')
    order by x.eligible_at nulls first limit v_limit
  loop
    if not v_wallet then
      n_wallet_skip := n_wallet_skip + 1;
      continue;
    end if;
    -- Davet edilen abonelik aktif olmali (askida/gecikmis = bekle).
    if exists (select 1 from public.growth_reward_claims q where q.id = rc.id and q.status = 'held')
       and not exists (select 1 from public.subscriptions sub where sub.tenant_id = rc.referred_tenant_id and sub.status = 'active') then
      n_blocked := n_blocked + 1;
      continue;
    end if;
    v_res := public.growth_grant_claim(rc.id);
    if v_res = 'paid' then
      n_paid := n_paid + 1;
    elsif v_res in ('blocked_referrer', 'blocked_cap') then
      n_blocked := n_blocked + 1;
    elsif v_res = 'rejected_cap' then
      n_rejected := n_rejected + 1;
    end if;
  end loop;

  -- C2. Kademe bonusu: yeni odenen taban taleplerden sonra (davetci basina bir kez). Program bayragi KAPALIYKEN uretilmez;
  -- tarama yalniz ilk-odeme (taban) taleplerinden bonusu henuz eksik davetcilerle sinirli ve limitlidir.
  if v_wallet and public.growth_flag_on('growth_referral_enabled') then
    for rc in
      select b.beneficiary_tenant_id as ref_tenant, count(*) as paid_n
      from public.growth_reward_claims b
      where b.component = 'base' and b.status = 'paid' and b.beneficiary_tenant_id is not null
        and ((s.tier1_bonus_months > 0 and not exists (
                select 1 from public.growth_reward_claims t
                where t.beneficiary_tenant_id = b.beneficiary_tenant_id and t.component = 'tier1' and t.status <> 'rejected'))
             or (s.tier2_bonus_months > 0 and not exists (
                select 1 from public.growth_reward_claims t
                where t.beneficiary_tenant_id = b.beneficiary_tenant_id and t.component = 'tier2' and t.status <> 'rejected')))
      group by b.beneficiary_tenant_id
      having count(*) >= s.tier1_at
      order by min(b.granted_at) nulls last
      limit v_limit
    loop
      v_count := rc.paid_n;
      -- tier1
      if s.tier1_bonus_months > 0 and v_count >= s.tier1_at
         and not exists (select 1 from public.growth_reward_claims t where t.beneficiary_tenant_id = rc.ref_tenant and t.component = 'tier1' and t.status <> 'rejected') then
        insert into public.growth_reward_claims
          (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, eligible_at, component, invoice_id, months_units, base_monthly_try)
        select b.rule_id, b.beneficiary_tenant_id, b.referred_tenant_id,
               round(coalesce(b.base_monthly_try, 0) * s.tier1_bonus_months, 2), 'approved', now(), 'tier1', b.invoice_id,
               s.tier1_bonus_months, b.base_monthly_try
        from public.growth_reward_claims b
        where b.beneficiary_tenant_id = rc.ref_tenant and b.component = 'base' and b.status = 'paid'
        order by b.granted_at asc offset (s.tier1_at - 1) limit 1
        on conflict do nothing
        returning id into v_bonus_id;
        if v_bonus_id is not null then
          perform public.growth_log_event(v_bonus_id, 'registered', null, jsonb_build_object('tier', 1, 'paidReferrals', v_count));
          if public.growth_grant_claim(v_bonus_id) = 'paid' then n_bonus := n_bonus + 1; end if;
          v_bonus_id := null;
        end if;
      end if;
      if s.tier2_bonus_months > 0 and v_count >= s.tier2_at
         and not exists (select 1 from public.growth_reward_claims t where t.beneficiary_tenant_id = rc.ref_tenant and t.component = 'tier2' and t.status <> 'rejected') then
        insert into public.growth_reward_claims
          (rule_id, beneficiary_tenant_id, referred_tenant_id, amount_try, status, eligible_at, component, invoice_id, months_units, base_monthly_try)
        select b.rule_id, b.beneficiary_tenant_id, b.referred_tenant_id,
               round(coalesce(b.base_monthly_try, 0) * s.tier2_bonus_months, 2), 'approved', now(), 'tier2', b.invoice_id,
               s.tier2_bonus_months, b.base_monthly_try
        from public.growth_reward_claims b
        where b.beneficiary_tenant_id = rc.ref_tenant and b.component = 'base' and b.status = 'paid'
        order by b.granted_at asc offset (s.tier2_at - 1) limit 1
        on conflict do nothing
        returning id into v_bonus_id;
        if v_bonus_id is not null then
          perform public.growth_log_event(v_bonus_id, 'registered', null, jsonb_build_object('tier', 2, 'paidReferrals', v_count));
          if public.growth_grant_claim(v_bonus_id) = 'paid' then n_bonus := n_bonus + 1; end if;
          v_bonus_id := null;
        end if;
      end if;
    end loop;
  end if;

  -- D. Clawback
  n_clawback := public.growth_clawback_pending(v_limit, v_wallet);

  -- E. Ortak komisyonlari: vadesi gelen -> 'approved' (odenebilir bakiye). Ortak programi kapaliysa DOKUNULMAZ.
  if public.growth_flag_on('growth_partner_enabled') then
    with up as (
      update public.growth_reward_claims x
      set status = 'approved', decided_at = now(), updated_at = now()
      where x.id in (
        select y.id from public.growth_reward_claims y
        join public.growth_partners p on p.id = y.partner_id and p.status = 'active'
        where y.component = 'commission' and y.status = 'held' and y.eligible_at <= now() and cardinality(y.flags) = 0
        order by y.eligible_at limit v_limit)
      returning x.id)
    select count(*) into n_partner from up;

    -- F. Hesap kredisi olarak talep edilen ortak odemeleri (kredi yazimi yalniz burada).
    if v_wallet then
      for v_payout in
        select po.id, po.amount_try, p.owner_tenant_id from public.growth_partner_payouts po
        join public.growth_partners p on p.id = po.partner_id
        where po.status = 'requested' and po.method = 'account_credit' and p.owner_tenant_id is not null
        order by po.created_at limit 50
      loop
        begin
          v_grant := public.try_credit_grant(v_payout.owner_tenant_id, v_payout.amount_try, 'partner',
            'partner-payout-' || v_payout.id::text, null, jsonb_build_object('payout_id', v_payout.id::text, 'program', 'partner'));
          if coalesce((v_grant ->> 'ok')::boolean, false) then
            update public.growth_partner_payouts set status = 'paid', paid_at = (now() at time zone 'Europe/Istanbul')::date
            where id = v_payout.id;
            update public.growth_reward_claims set status = 'paid', granted_at = now(), updated_at = now()
            where payout_id = v_payout.id and status = 'approved';
            n_payout := n_payout + 1;
          end if;
        exception when others then
          null;
        end;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'wallet_ready', v_wallet, 'registered', n_registered, 'reversed', n_reversed, 'paid', n_paid,
    'bonus', n_bonus, 'blocked', n_blocked, 'rejected', n_rejected, 'clawback', n_clawback,
    'wallet_skipped', n_wallet_skip, 'partner_approved', n_partner, 'partner_payouts_credited', n_payout);
end;
$$;

create or replace function public.growth_my_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  s public.growth_referral_settings%rowtype;
  r public.growth_reward_rules%rowtype;
  v_code text;
  v_clicks bigint := 0;
  v_invites jsonb;
  v_earned numeric;
  v_pending numeric;
  v_paid_n int;
  v_signups int;
  v_waiting int;
  v_cancelled int;
  v_trial int;
  v_enabled boolean := public.growth_flag_on('growth_referral_enabled');
begin
  if v_tenant is null then
    return null;
  end if;
  select * into s from public.growth_referral_settings where singleton;
  select * into r from public.growth_reward_rules
  where kind = 'referral' and is_active and valid_from <= now() and (valid_until is null or valid_until > now())
  order by created_at desc limit 1;
  select c.code into v_code from public.growth_referral_codes c where c.tenant_id = v_tenant and c.is_active;
  if v_code is not null then
    select coalesce(sum(n), 0) into v_clicks from public.growth_click_counters where kind = 'referral' and code = v_code;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into v_invites
  from (
    select sa.created_at as at,
           case
             when c.status = 'paid' then 'paid'
             when c.status in ('held', 'approved', 'pending') then 'waiting'
             when c.status in ('reversed', 'rejected') then 'cancelled'
             else 'trial' end as stage,
           coalesce(c.amount_try, 0) as amount
    from public.signup_attributions sa
    left join public.growth_reward_claims c on c.referred_tenant_id = sa.tenant_id and c.component = 'base'
    where sa.referrer_tenant_id = v_tenant and sa.ref_kind = 'referral'
    order by sa.created_at desc limit 200
  ) x;

  select coalesce(sum(amount_try), 0) into v_earned from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status = 'paid';
  select coalesce(sum(amount_try), 0) into v_pending from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and status in ('held', 'approved', 'pending');
  select count(*) into v_paid_n from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status = 'paid';
  select count(*) into v_signups from public.signup_attributions where referrer_tenant_id = v_tenant and ref_kind = 'referral';
  select count(*) into v_waiting from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('held', 'approved', 'pending');
  select count(*) into v_cancelled from public.growth_reward_claims
  where beneficiary_tenant_id = v_tenant and component = 'base' and status in ('reversed', 'rejected');
  v_trial := greatest(v_signups - v_paid_n - v_waiting - v_cancelled, 0);

  return jsonb_build_object(
    'enabled', v_enabled,
    'code', v_code,
    'clicks', v_clicks,
    'signups', v_signups,
    'trial', v_trial,
    'waiting', v_waiting,
    'paid', v_paid_n,
    'cancelled', v_cancelled,
    'earned_try', v_earned,
    'pending_try', v_pending,
    'invites', v_invites,
    'rule', case when r.id is null then null else jsonb_build_object(
      'reward_type', r.reward_type, 'reward_value', r.reward_value, 'hold_days', r.hold_days,
      'credit_expires_days', r.credit_expires_days) end,
    'tiers', jsonb_build_object(
      'tier1_at', s.tier1_at, 'tier1_bonus_months', s.tier1_bonus_months, 'tier1_badge', s.tier1_badge,
      'tier2_at', s.tier2_at, 'tier2_bonus_months', s.tier2_bonus_months, 'tier2_badge', s.tier2_badge,
      'annual_cap_months', s.annual_cap_months),
    'welcome_credit_try', s.welcome_credit_try);
end;
$$;

create or replace function public.growth_invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_welcome numeric;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{6,12}$' or not public.growth_flag_on('growth_referral_enabled') then
    return null;
  end if;
  select t.name into v_name
  from public.growth_referral_codes c join public.tenants t on t.id = c.tenant_id
  where c.code = p_code and c.is_active;
  if v_name is null then
    return null;
  end if;
  select welcome_credit_try into v_welcome from public.growth_referral_settings where singleton;
  return jsonb_build_object('office_name', left(v_name, 80), 'welcome_credit_try', coalesce(v_welcome, 0));
end;
$$;

drop function if exists public.growth_tier_revalidate(uuid);
drop function if exists public.growth_welcome_apply(uuid);
drop function if exists public.growth_returning_customer(uuid);
drop function if exists public.growth_referred_ready(uuid, uuid, text);
drop function if exists public.growth_renewal_ok(uuid, uuid);
drop function if exists public.growth_referred_qualified(uuid);

notify pgrst, 'reload schema';

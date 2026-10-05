-- MIGRATION 20260826000500_try_credit_invoice_payment.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000500_try_credit_invoice_payment.sql` ile uygular (000400'den SONRA).
-- Geri alma: supabase/rollbacks/20260826000500_try_credit_invoice_payment.rollback.sql.
--
-- TL HESAP KREDISI ile FATURA ODEMESI (plan / ek kullanici / kontor paketi). 000400 cuzdanini fatura akisina baglar.
-- fulfill_billing_payment ve fulfill_billing_payment_v2 govdelerine DOKUNULMAZ (md5 on-kosullu, kirilgan): bu dosya
-- onlari ICERDEN cagiran YENI bir sarmalayici tanimlar. Sarmalayici tek transaction'dir: kredi kesinlestirme + mevcut
-- fulfill; fulfill hata verirse kredi harcamasi da geri alinir (rezerv 'reserved' kalir).
--
-- NE DEGISIR (hepsi YENI fonksiyon; tablo/sutun/veri degisikligi YOK)
--   try_credit_invoice_hold(p_tenant, p_conversation_id)       service_role  fatura-rezerv okuma (odeme dogrulamada beklenen nakit)
--   try_credit_fulfill_invoice(...)                            service_role  kredi + (varsa) iyzico nakit = fatura toplami; fulfill'i cagirir
--   try_credit_release_invoice(p_tenant, p_invoice, p_reason)  service_role  odeme baslamadan/basarisiz: rezervi birak
--   try_credit_release_dead(p_limit)                           service_role  void/expired faturalarin acik rezervlerini birak (reconciliation)
--   try_credit_refund_invoice(...)                             service_role  iade/iptalde harcanan krediyi geri yaz (reverse + satiri)
--   try_credit_ready()                                         YENIDEN TANIM: 000400 + bu dosya + fulfill/v2 varligi
--
-- ODEME MODELI
--   Fatura TOPLAMI (KDV dahil, total_try) DEGISMEZ. Kredi toplama uygulanir: nakit = toplam - kredi.
--   1) Kismi kredi (kredi < toplam): iyzico YALNIZ nakit tutari icin acilir (price = paidPrice = nakit). Odeme dogrulaninca
--      TS capture'i NAKIT tutarla kaydeder (record_billing_payment_capture) ve try_credit_fulfill_invoice(p_cash_try = nakit)
--      cagirir: kredi + nakit = fatura toplami dogrulanir, kredi kesinlestirilir, fulfill_billing_payment_v2 faturanin
--      TAM toplamiyla (p_expected_amount_try = total_try) cagrilir => mevcut tutar/KDV/plan dogrulamalari AYNEN gecerli.
--   2) Tam kredi (kredi = toplam; yalniz p_max_share = 1 yapilandirmasinda mumkun): iyzico CAGRILMAZ. Sarmalayici
--      p_cash_try = 0 ile cagrilir; fulfill 'demo' saglayicisi/kaynagiyla (mevcut izinli, capture gerektirmeyen yol)
--      calistirilir ve fatura meta'sina paidWith='account_credit' yazilir. Tek-sefer garantisi: billing_fulfillment_events
--      tekil claim'i + fatura 'paid' kontrolu + rezerv durum gecisi tek yonlu.
--   Iade/iptal: nakit once (iade tutari once nakit kismindan dusulur), artan kisim krediye geri yazilir
--   (try_credit_refund_invoice: pozitif 'reverse' satiri, harcanan krediyi ASAMAZ, kismi/tekrarli iade idempotent).
--   Sahipsiz rezerv (fatura void/expired): try_credit_release_dead + markCheckoutInvoiceFailed -> try_credit_release_invoice.
--   Iyzico nakit odendikten SONRA rezerv serbest birakilmissa (sure asimi/void yarisi): sarmalayici 22023 verir ->
--   capture 'refund_required' (mevcut sinif) ; kredi harcanmamistir.
--
-- KILIT SIRASI: try-credit:<tenant> -> (fulfill_v2 icinde) plan-capacity:<tenant>. Ters sira hicbir yolda yok.
-- BAGIMLILIK: 20260826000400 + canlida fulfill_billing_payment_v2 (20260810000100) ve fulfill_billing_payment (10 arg).
--   On-kosul blogu eksikse HICBIR sey yazmadan durur. Fulfill govdelerinin md5'ine BAGIMLI DEGIL (cagirir, kopyalamaz).

-- ---------------------------------------------------------------------------
-- 0. On-kosul
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.try_credit_reservations') is null
    or pg_catalog.to_regprocedure('public.try_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_calc_balance(uuid)') is null then
    raise exception '20260826000500: TL kredi cuzdani yok; once 20260826000400 uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)') is null
    or pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)') is null then
    raise exception '20260826000500: fulfill_billing_payment/v2 yok.';
  end if;
  if pg_catalog.to_regclass('public.billing_fulfillment_events') is null
    or pg_catalog.to_regclass('public.invoices') is null then
    raise exception '20260826000500: faturalama tablolari eksik.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. try_credit_invoice_hold(p_tenant, p_conversation_id) -> jsonb
--    {has_hold, reservation_id, invoice_id, state, amount, total_try, cash_try}
--    Faturanin EN SON rezervi (her durumda): iyzico acilisinda nakit = toplam - rezerv.amount; rezerv sonradan
--    serbest kalsa da odeme o nakit tutarla gelir.
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_invoice_hold(p_tenant uuid, p_conversation_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conv text := btrim(coalesce(p_conversation_id, ''));
  v_invoice_id uuid;
  v_total numeric;
  v_res public.try_credit_reservations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or v_conv = '' or char_length(v_conv) > 512 then
    raise exception 'Invalid arguments.' using errcode = '22023';
  end if;

  select i.id, i.total_try into v_invoice_id, v_total
  from public.invoices i
  where i.tenant_id = p_tenant and i.meta ->> 'conversationId' = v_conv
  order by i.created_at desc, i.id desc
  limit 1;

  if v_invoice_id is null then
    return jsonb_build_object('has_hold', false);
  end if;

  select r.* into v_res
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.invoice_id = v_invoice_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found then
    return jsonb_build_object('has_hold', false, 'invoice_id', v_invoice_id::text, 'total_try', v_total);
  end if;

  return jsonb_build_object(
    'has_hold', true,
    'reservation_id', v_res.id::text,
    'invoice_id', v_invoice_id::text,
    'state', v_res.state,
    'amount', v_res.amount,
    'total_try', v_total,
    'cash_try', round(v_total - v_res.amount, 2)
  );
end;
$$;

revoke all on function public.try_credit_invoice_hold(uuid, text) from public, anon, authenticated;
grant execute on function public.try_credit_invoice_hold(uuid, text) to service_role;
comment on function public.try_credit_invoice_hold(uuid, text) is
  'Faturanin (conversationId) en son TL kredi rezervi ve beklenen nakit tutari. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 2. try_credit_fulfill_invoice: kredi kesinlestir + mevcut fulfill (tek transaction)
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_fulfill_invoice(
  p_conversation_id text,
  p_expected_tenant_id uuid,
  p_payment_id text default null,
  p_source text default 'callback',
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_cash_try numeric default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conv text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_cash numeric := coalesce(p_cash_try, 0);
  v_invoice_id uuid;
  v_invoice_status text;
  v_total numeric;
  v_currency text;
  v_res public.try_credit_reservations%rowtype;
  v_commit jsonb;
  v_provider text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_expected_tenant_id is null or v_conv = '' or char_length(v_conv) > 512 then
    raise exception 'Invalid arguments.' using errcode = '22023';
  end if;
  if left(v_conv, 6) = 'plink-' then
    raise exception 'Wallet credit applies to subscription invoices only.' using errcode = '22023';
  end if;
  if v_cash < 0 or v_cash <> round(v_cash, 2) then
    raise exception 'Invalid cash amount.' using errcode = '22023';
  end if;
  if v_cash > 0 then
    if v_payment_id is null or v_source not in ('callback', 'webhook') then
      raise exception 'Cash portion requires a provider payment and callback/webhook source.' using errcode = '22023';
    end if;
    v_provider := 'iyzico';
  else
    if v_payment_id is not null then
      raise exception 'Full-credit payment must not carry a provider payment id.' using errcode = '22023';
    end if;
    v_provider := 'demo';
    v_source := 'demo';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_expected_tenant_id::text, 0));

  select i.id, i.status, i.total_try, i.currency
    into v_invoice_id, v_invoice_status, v_total, v_currency
  from public.invoices i
  where i.tenant_id = p_expected_tenant_id and i.meta ->> 'conversationId' = v_conv
  order by i.created_at desc, i.id desc
  limit 1
  for update;

  if not found then
    raise exception 'Billing invoice not found.' using errcode = 'P0002';
  end if;
  if upper(btrim(coalesce(v_currency, ''))) <> 'TRY' or v_total is null or v_total <= 0 then
    raise exception 'Invoice currency or total is invalid.' using errcode = '22023';
  end if;

  select r.* into v_res
  from public.try_credit_reservations r
  where r.tenant_id = p_expected_tenant_id and r.invoice_id = v_invoice_id and r.state in ('reserved', 'committed')
  limit 1
  for update;

  if not found then
    raise exception 'Wallet credit reservation is not active.' using errcode = '22023';
  end if;

  if abs(v_total - (v_cash + v_res.amount)) > 0.01 then
    raise exception 'Wallet credit and cash do not add up to the invoice total.' using errcode = '22023';
  end if;

  if v_res.state = 'reserved' then
    v_commit := public.try_credit_commit(
      p_expected_tenant_id,
      v_res.id,
      jsonb_build_object('invoiceId', v_invoice_id::text, 'cashTry', v_cash)
    );
    if coalesce((v_commit ->> 'ok')::boolean, false) is not true then
      raise exception 'Wallet credit could not be committed.' using errcode = '22023';
    end if;
  end if;

  v_result := public.fulfill_billing_payment_v2(
    v_provider,
    v_conv,
    v_payment_id,
    v_source,
    'subscription',
    p_expected_tenant_id,
    p_expected_plan,
    p_expected_cycle,
    v_total,
    'TRY'
  );

  -- Izleme: odeme sekli fatura meta'sina + olay sonucuna yazilir (tutar/KDV alanlarina DOKUNULMAZ).
  update public.invoices i
  set meta = i.meta || jsonb_build_object(
    'walletReservationId', v_res.id::text,
    'walletCreditTry', v_res.amount,
    'walletCashTry', v_cash,
    'paidWith', case when v_cash > 0 then 'account_credit+iyzico' else 'account_credit' end
  ) || case when v_cash > 0 then '{}'::jsonb
            else jsonb_build_object('provider', 'account_credit', 'source', 'account_credit') end
  where i.id = v_invoice_id and i.tenant_id = p_expected_tenant_id;

  update public.billing_fulfillment_events e
  set result = coalesce(e.result, '{}'::jsonb) || jsonb_build_object(
    'walletCreditTry', v_res.amount,
    'walletCashTry', v_cash
  )
  where e.provider = v_provider and e.conversation_id = v_conv;

  return v_result || jsonb_build_object(
    'walletCreditTry', v_res.amount,
    'walletCashTry', v_cash,
    'walletReservationId', v_res.id::text
  );
end;
$$;

revoke all on function public.try_credit_fulfill_invoice(text, uuid, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.try_credit_fulfill_invoice(text, uuid, text, text, text, text, numeric) to service_role;
comment on function public.try_credit_fulfill_invoice(text, uuid, text, text, text, text, numeric) is
  'Kredi + nakit = fatura toplami: rezervi kesinlestirir ve fulfill_billing_payment_v2''yi fatura TAM toplamiyla cagirir (tek transaction). p_cash_try=0: iyzico yok (tam kredi). Service-role-only.';

-- ---------------------------------------------------------------------------
-- 3. try_credit_release_invoice(p_tenant, p_invoice, p_reason) -> jsonb TrySettleResult
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_release_invoice(
  p_tenant uuid,
  p_invoice uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_res_id uuid;
  v_out jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_invoice is null then
    raise exception 'Tenant and invoice are required.' using errcode = '22023';
  end if;

  select r.id into v_res_id
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.invoice_id = p_invoice
  order by r.created_at desc, r.id desc
  limit 1;

  if v_res_id is null then
    return jsonb_build_object('ok', true, 'state', 'unknown', 'already', false);
  end if;

  v_out := public.try_credit_release(p_tenant, v_res_id, coalesce(p_reason, 'invoice_released'));

  if coalesce((v_out ->> 'ok')::boolean, false) and coalesce((v_out ->> 'already')::boolean, false) is false then
    update public.invoices i
    set meta = (i.meta - 'walletReservationId' - 'walletCreditTry' - 'walletCashTry')
      || jsonb_build_object('walletReleased', true)
    where i.id = p_invoice and i.tenant_id = p_tenant;
  end if;
  return v_out;
end;
$$;

revoke all on function public.try_credit_release_invoice(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.try_credit_release_invoice(uuid, uuid, text) to service_role;
comment on function public.try_credit_release_invoice(uuid, uuid, text) is
  'Faturanin TL kredi rezervini serbest birakir (odeme baslatilamadi/iptal); committed ise ok=false. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 4. try_credit_release_dead(p_limit) -> integer: void/expired fatura rezervlerini birak (reconciliation worker)
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_release_dead(p_limit integer default 500)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'Invalid limit.' using errcode = '22023';
  end if;

  for v_row in
    select r.id, r.tenant_id
    from public.try_credit_reservations r
    join public.invoices i on i.id = r.invoice_id
    where r.state = 'reserved'
      and (
        i.status = 'void'
        or (i.status = 'draft' and coalesce(i.checkout_status, '') in ('expired', 'initialization_failed'))
      )
    order by r.tenant_id, r.created_at, r.id
    limit p_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || v_row.tenant_id::text, 0));
    update public.try_credit_reservations r
    set state = 'released', reason = 'invoice_dead', settled_at = now()
    where r.id = v_row.id and r.state = 'reserved';
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.try_credit_release_dead(integer) from public, anon, authenticated;
grant execute on function public.try_credit_release_dead(integer) to service_role;
comment on function public.try_credit_release_dead(integer) is
  'void/expired faturalarin acik TL kredi rezervlerini serbest birakir; en cok p_limit. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 5. try_credit_refund_invoice: iade/iptalde harcanan krediyi geri yaz
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_refund_invoice(
  p_tenant uuid,
  p_invoice uuid,
  p_amount numeric,
  p_idem text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_res public.try_credit_reservations%rowtype;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
  v_restored numeric;
  v_remaining numeric;
  v_amount numeric;
  v_key text;
  v_existing numeric;
  v_bal jsonb;
  v_spend_meta jsonb;
  v_segs jsonb;
  v_rest numeric;
  v_seg record;
  v_skip numeric;
  v_left numeric;
  v_avail numeric;
  v_take numeric;
  v_idx integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant is null or p_invoice is null then
    raise exception 'Tenant and invoice are required.' using errcode = '22023';
  end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'Invalid idempotency key.' using errcode = '22023';
  end if;
  if p_amount is not null and (p_amount < 0.01 or p_amount <> round(p_amount, 2)) then
    raise exception 'Invalid amount.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' || p_tenant::text, 0));

  v_key := 'try:refund:' || p_tenant::text || ':' || p_idem;

  -- Iade parcalara bolunebilir (orijinal vade basina bir satir): ilk satir v_key, digerleri v_key || ':<n>'.
  select sum(l.amount) into v_existing
  from public.account_credit_ledger l
  where l.idempotency_key = v_key or l.idempotency_key like v_key || ':%';
  if v_existing is not null then
    if p_amount is not null and v_existing <> p_amount then
      raise exception 'Idempotency key reused with a different refund.' using errcode = '22023';
    end if;
    v_bal := public.try_credit_calc_balance(p_tenant);
    return jsonb_build_object(
      'ok', true, 'already', true, 'restored', v_existing,
      'available', v_bal -> 'available', 'balance', v_bal -> 'balance'
    );
  end if;

  select r.* into v_res
  from public.try_credit_reservations r
  where r.tenant_id = p_tenant and r.invoice_id = p_invoice and r.state = 'committed'
  limit 1
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_credit_used');
  end if;

  select coalesce(sum(l.amount), 0) into v_restored
  from public.account_credit_ledger l
  where l.tenant_id = p_tenant and l.unit = 'try' and l.entry_type = 'reverse' and l.amount > 0
    and l.meta ->> 'refundOfReservation' = v_res.id::text;

  v_remaining := v_res.amount - v_restored;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'exceeds_credit_used', 'remaining', 0);
  end if;
  if v_amount > v_remaining then
    return jsonb_build_object('ok', false, 'code', 'exceeds_credit_used', 'remaining', v_remaining);
  end if;

  -- ORIJINAL VADE: harcama satirinin meta.consumedExpiries'i (vadeli kovalar, en erkenden baslayarak) + vadesiz kalan.
  -- Iade tutari, daha once geri yazilan (v_restored) kisim atlanarak bu parcalara sirayla dagitilir; her parca kendi
  -- vadesiyle yazilir (geri yazilan kredi orijinalinden UZUN omurlu olamaz). Eski satirlarda (meta yok) tamami vadesiz.
  select l.meta into v_spend_meta
  from public.account_credit_ledger l
  where l.idempotency_key = 'try:spend:' || v_res.id::text;
  v_segs := coalesce(v_spend_meta -> 'consumedExpiries', '[]'::jsonb);
  select v_res.amount - coalesce(sum((e ->> 'amount')::numeric), 0) into v_rest
  from jsonb_array_elements(v_segs) e;
  if v_rest > 0 then
    v_segs := v_segs || jsonb_build_array(jsonb_build_object('amount', v_rest, 'expires_at', null));
  end if;

  v_skip := v_restored;
  v_left := v_amount;
  for v_seg in
    select (t.e ->> 'amount')::numeric as amt, nullif(t.e ->> 'expires_at', '')::timestamptz as exp
    from jsonb_array_elements(v_segs) with ordinality as t(e, n)
    order by t.n
  loop
    exit when v_left <= 0;
    v_avail := v_seg.amt;
    if v_skip > 0 then
      v_take := least(v_skip, v_avail);
      v_skip := v_skip - v_take;
      v_avail := v_avail - v_take;
    end if;
    if v_avail <= 0 then
      continue;
    end if;
    v_take := least(v_left, v_avail);
    v_idx := v_idx + 1;
    insert into public.account_credit_ledger
      (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, expires_at, feature, meta, created_at)
    values
      (p_tenant, 'try', 'reverse', v_take, 'refund', v_res.id,
       case when v_idx = 1 then v_key else v_key || ':' || v_idx::text end, v_seg.exp, 'invoice_refund',
       jsonb_build_object(
         'invoiceId', p_invoice::text,
         'reservationId', v_res.id::text,
         'refundOfReservation', v_res.id::text,
         'reason', coalesce(v_reason, 'invoice_refund')
       ),
       clock_timestamp());
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    v_idx := v_idx + 1;
    insert into public.account_credit_ledger
      (tenant_id, unit, entry_type, amount, source, source_id, idempotency_key, feature, meta, created_at)
    values
      (p_tenant, 'try', 'reverse', v_left, 'refund', v_res.id,
       case when v_idx = 1 then v_key else v_key || ':' || v_idx::text end, 'invoice_refund',
       jsonb_build_object(
         'invoiceId', p_invoice::text,
         'reservationId', v_res.id::text,
         'refundOfReservation', v_res.id::text,
         'reason', coalesce(v_reason, 'invoice_refund')
       ),
       clock_timestamp());
  end if;

  v_bal := public.try_credit_calc_balance(p_tenant);
  return jsonb_build_object(
    'ok', true,
    'already', false,
    'restored', v_amount,
    'remaining', v_remaining - v_amount,
    'available', v_bal -> 'available',
    'balance', v_bal -> 'balance'
  );
end;
$$;

revoke all on function public.try_credit_refund_invoice(uuid, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.try_credit_refund_invoice(uuid, uuid, numeric, text, text) to service_role;
comment on function public.try_credit_refund_invoice(uuid, uuid, numeric, text, text) is
  'Iade/iptalde harcanan TL krediyi geri yazar (pozitif reverse); harcanan krediyi asamaz; (tenant,p_idem) tekil. Service-role-only.';

-- ---------------------------------------------------------------------------
-- 6. try_credit_ready() NIHAI surum (000400 surumunun yerine gecer)
-- ---------------------------------------------------------------------------
create or replace function public.try_credit_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- SQL editorunde auth.role() service_role degildir: FALSE beklenir, hata degildir.
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if pg_catalog.to_regclass('public.try_credit_reservations') is null then
    return false;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = pg_catalog.to_regclass('public.account_credit_ledger')
      and c.conname = 'account_credit_ledger_try_entry_check'
  ) then
    return false;
  end if;
  if pg_catalog.to_regprocedure('public.try_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric)') is null
    or pg_catalog.to_regprocedure('public.try_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_release(uuid, uuid, text)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reverse(uuid, numeric, text, text, text, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_invoice_hold(uuid, text)') is null
    or pg_catalog.to_regprocedure('public.try_credit_fulfill_invoice(text, uuid, text, text, text, text, numeric)') is null
    or pg_catalog.to_regprocedure('public.try_credit_release_invoice(uuid, uuid, text)') is null
    or pg_catalog.to_regprocedure('public.try_credit_release_dead(integer)') is null
    or pg_catalog.to_regprocedure('public.try_credit_refund_invoice(uuid, uuid, numeric, text, text)') is null
    or pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)') is null then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.try_credit_ready() from public, anon, authenticated;
grant execute on function public.try_credit_ready() to service_role;
comment on function public.try_credit_ready() is
  'TL kredi hazir mi: cuzdan + fatura odeme RPC''leri + fulfill/v2. Hata firlatmaz; yalniz service_role kimliginde true.';

notify pgrst, 'reload schema';

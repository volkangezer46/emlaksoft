-- MIGRATION 20260826000300_ef_credit_pack_fulfillment.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000300_ef_credit_pack_fulfillment.sql` ile uygular (YAYIN_PENCERESI_2.md §7).
-- Geri alma: supabase/rollbacks/20260826000300_ef_credit_pack_fulfillment.rollback.sql (iki fonksiyon 20260825000600
--   govdelerine doner -> ef_credit_ready false -> paket satisi kapanir; eklenmis kontor DEFTERDE KALIR).
--
-- EmlakFiyati KONTOR PAKETI faturasinin tamamlanmasi (`meta.kind = 'credit_pack'`). TAM GOVDELI yeniden tanim:
-- pg_get_functiondef + replace ile canli govde YAMALANMAZ. Iki govde 20260825000600'deki son tanimin BAYT BAYT
-- kopyasidir; yalniz `-- credit-pack:v1 >>>` ... `-- credit-pack:v1 <<<` isaretli bloklar EKLENMISTIR (silinen ya
-- da degisen taban satiri YOK). Kanit: src/lib/ef-credits/ef-wallet-sql-contract.test.ts isaretli bloklari cikarip
-- govde md5'inin 20260825000600 govdesiyle (0f5b4589... / 5fc1c655...) AYNI oldugunu dogrular; prova (db:rehearse --ef)
-- plan yenileme + extra_seats smoke'unu yeni govdelerle tekrar calistirir.
--
-- NE DEGISIR
--   1. fulfill_billing_payment (10 arg): fatura meta.kind = 'credit_pack' ise (tur kontrolunden ONCE, ayri blok):
--      tutar YALNIZ faturadan (net amount_try > 0; toplam = round(net * 1.20, 2) = p_expected_amount_try, 22023);
--      meta {packId (katalog bicimi), units (tamsayi 1..100000), priceNetTry (= fatura net, kurus toleransi)}
--      aksi halde 22023 'Credit pack invoice metadata is invalid.'; ef_credit_grant(tenant, units, 'purchase',
--      'invoice:<fatura id>', {invoiceId, packId, conversationId, priceNetTry}) ile kontor eklenir; fatura 'paid'
--      (period_start = period_end = odeme ani; subscription_id ve meta plan/cycle yazilmaz). subscriptions
--      (plan, durum, donem, amount_try, price_lock_*, extra_seats) ve tenants DEGISMEZ.
--      TEK SEFER (uc katman): billing_fulfillment_events tekil claim'i + 'paid' fatura kontrolu (legacy) + grant
--      idempotency ('invoice:<id>' -> defter anahtari 'ef:grant:<tenant>:invoice:<id>').
--      Sonuc JSON: extra_seats ile ayni cekirdek + kind 'credit_pack', packId, units, creditGranted.
--   2. fulfill_billing_payment_v2: ic sonuc kind = 'credit_pack' ise donem UZATILMAZ (extra_seats ile ayni kalip);
--      yalniz checkout_status = 'fulfilled'.
--   Bilinmeyen meta.kind reddi (22023 'Unsupported invoice kind.') AYNEN korunur; kind yoksa (plan yenileme) ve
--   'extra_seats' davranisi AYNEN korunur (taban metin degismedi). seat-fulfillment:v1 isareti korunur
--   (seat_purchase_ready true kalir). 'credit-pack:v1' isareti ef_credit_ready() (20260826000100) icindir.
--   9 argumanli ESKI fulfill overload'una (20260731000138) dokunulmaz. Tablo/sutun/veri degisikligi YOK.
--
-- KOD SOZLESMESI (TS henuz YOK, sahibi onayiyla yazilacak): fatura meta {conversationId, kind:'credit_pack', packId,
--   units, priceNetTry, source}; amount_try = priceNetTry (KDV haric), checkout mevcut iyzico/demo akisi.
--   fulfill_billing_payment_v2 p_expected_plan/p_expected_cycle verilmeyebilir (NULL); verilirse meta plan/cycle
--   (yoksa 'office'/'monthly' varsayilani) ile karsilastirilir: paket faturasinda bunlari NULL gecin.
--
-- BAGIMLILIK: 20260826000100 (ef_credit_grant) + canlida 20260825000600 govdeleri. On-kosul blogu canli govde
--   md5'ini dogrular; sapma ya da eksik bagimlilik = HICBIR sey yazmadan DUR.
--
-- TABAN (md5(replace(prosrc, E'\r', '')), 20260825000600 BEKLENEN SONRA; ajan dosyadan yeniden hesapladi):
--   fulfill_billing_payment (10 arg)  0f5b4589c3608509d3c7390e08c7834d
--   fulfill_billing_payment_v2        5fc1c6552b2fe6f963fb72ea3264e03e
-- BEKLENEN SONRA (bu dosyanin govdeleri):
--   fulfill_billing_payment (10 arg)  48be5cd7f2f755c860d326209f52c9a3
--   fulfill_billing_payment_v2        47f246dea3152903ef17edd8cd08f95d
--
-- SALT-OKUNUR DOGRULAMA (ONCE ve SONRA; YAYIN_PENCERESI_2.md §7.3):
-- select p.proname, p.pronargs, md5(replace(p.prosrc, E'\r', '')) as body_md5,
--        position('credit-pack:v1' in p.prosrc) > 0 as credit_pack_v1,
--        position('seat-fulfillment:v1' in p.prosrc) > 0 as seat_v1
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('fulfill_billing_payment', 'fulfill_billing_payment_v2')
--   and not (p.proname = 'fulfill_billing_payment' and p.pronargs = 9)
-- order by 1;
-- BEKLENEN (ONCE):  fulfill_billing_payment 10 0f5b4589c3608509d3c7390e08c7834d f t
--                   fulfill_billing_payment_v2 10 5fc1c6552b2fe6f963fb72ea3264e03e f t
-- BEKLENEN (SONRA): fulfill_billing_payment 10 48be5cd7f2f755c860d326209f52c9a3 t t
--                   fulfill_billing_payment_v2 10 47f246dea3152903ef17edd8cd08f95d t t
-- Hazirlik (salt-okunur transaction): begin read only; select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   select public.ef_credit_ready() as ef_hazir, public.seat_purchase_ready() as koltuk_hazir; rollback;   -> t | t
--   Claim ayarlanmadan dogrudan cagri FALSE doner (SQL editorunde beklenen, hata degil).

-- ---------------------------------------------------------------------------
-- 0. On-kosul (ilk deyim; eksik bagimlilik ya da beklenmeyen canli govdede HICBIR sey yazmadan durur)
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  if pg_catalog.to_regprocedure('public.ef_credit_grant(uuid, integer, text, text, jsonb)') is null then
    raise exception '20260826000300: public.ef_credit_grant yok; once 20260826000100 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.billing_fulfillment_events') is null
    or pg_catalog.to_regclass('public.invoices') is null then
    raise exception '20260826000300: faturalama tablolari eksik.';
  end if;

  -- Canli govde = 20260825000600 (ya da bu dosyanin kendi govdesi: yeniden calistirma). Sapma = DUR:
  -- tam govde bu tabandan turetildi; farkli bir canli govdenin ustune yazmak oradaki degisikligi silerdi.
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)');
  if v_src is null then
    raise exception '20260826000300: fulfill_billing_payment (10 arg) yok.';
  end if;
  if position('credit-pack:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> '0f5b4589c3608509d3c7390e08c7834d' then
    raise exception '20260826000300: fulfill_billing_payment (10 arg) canli govdesi 20260825000600 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;

  v_src := null;
  select p.prosrc into v_src
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)');
  if v_src is null then
    raise exception '20260826000300: fulfill_billing_payment_v2 yok.';
  end if;
  if position('credit-pack:v1' in v_src) = 0
    and md5(replace(v_src, E'\r', '')) <> '5fc1c6552b2fe6f963fb72ea3264e03e' then
    raise exception '20260826000300: fulfill_billing_payment_v2 canli govdesi 20260825000600 tabanindan farkli; govde yeniden turetilmeden uygulanmaz.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. fulfill_billing_payment, 10 arg (TABAN: 20260825000600 tam govdesi; + meta.kind = 'credit_pack')
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_billing_payment(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_expected_currency text := upper(btrim(coalesce(p_expected_currency, '')));
  v_event_id uuid;
  v_completed_event_id uuid;
  v_existing_event public.billing_fulfillment_events%rowtype;
  v_match_count integer;
  v_now timestamptz := now();
  v_result jsonb;

  v_invoice_id uuid;
  v_tenant_id uuid;
  v_invoice_status text;
  v_amount_try numeric;
  v_invoice_currency text;
  v_invoice_meta jsonb;
  v_plan text;
  v_cycle text;
  v_period_end timestamptz;
  v_tax_try numeric;
  v_total_try numeric;
  v_monthly_amount numeric;
  v_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_tenant_id uuid;

  v_sub_plan text;
  v_old_lock_try numeric;
  v_old_lock_campaign text;
  v_meta_lock_try numeric;
  v_meta_lock_campaign text;
  v_lock_try numeric;
  v_lock_campaign text;
  v_subscription_amount numeric;

  -- seat-fulfillment:v1 (20261005000900) ek kullanici faturasi degiskenleri
  v_kind text;
  v_seat_from_num numeric;
  v_seat_to_num numeric;
  v_seat_total_num numeric;
  v_seat_charge_net numeric;
  v_seat_quoted_period numeric;
  v_seat_from integer;
  v_seat_to integer;
  v_seat_total integer;
  v_seat_sub_cycle text;
  v_seat_sub_status text;
  v_seat_sub_extra integer;
  v_seat_sub_period_end timestamptz;
  v_seat_invoice_sub_id uuid;
  v_seat_updated_sub_id uuid;
  -- credit-pack:v1 >>> (20260826000300) kontor paketi faturasi degiskenleri
  v_pack_units_num numeric;
  v_pack_units integer;
  v_pack_price_net numeric;
  v_pack_id text;
  v_pack_grant jsonb;
  -- credit-pack:v1 <<<

  v_link_token text;
  v_payment_link_id uuid;
  v_payment_link_tenant_id uuid;
  v_payment_link_commission_id uuid;
  v_payment_link_status text;
  v_payment_link_amount_try numeric;
  v_payment_link_expires_at timestamptz;
  v_updated_payment_link_id uuid;
  v_updated_commission_id uuid;
  v_notification_id uuid;
  v_commission_changed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider not in ('iyzico', 'demo') then
    raise exception 'Unsupported payment provider.' using errcode = '22023';
  end if;

  if v_conversation_id = '' or char_length(v_conversation_id) > 512 then
    raise exception 'Invalid conversation identity.' using errcode = '22023';
  end if;

  if v_payment_id is not null and char_length(v_payment_id) > 512 then
    raise exception 'Invalid payment identity.' using errcode = '22023';
  end if;

  if v_source not in ('callback', 'webhook', 'demo')
    or (v_provider = 'demo' and v_source <> 'demo')
    or (v_provider = 'iyzico' and v_source = 'demo') then
    raise exception 'Invalid fulfillment source.' using errcode = '22023';
  end if;

  if v_target_type not in ('subscription', 'payment_link') then
    raise exception 'Invalid fulfillment target.' using errcode = '22023';
  end if;

  if p_expected_amount_try is null or p_expected_amount_try <= 0 then
    raise exception 'Expected payment amount is required.' using errcode = '22023';
  end if;

  if v_expected_currency <> 'TRY' then
    raise exception 'Expected payment currency must be TRY.' using errcode = '22023';
  end if;

  if (v_target_type = 'payment_link' and left(v_conversation_id, 6) <> 'plink-')
    or (v_target_type = 'subscription' and left(v_conversation_id, 6) = 'plink-') then
    raise exception 'Conversation and fulfillment target do not match.' using errcode = '22023';
  end if;

  -- The unique insert is the race winner. A downstream exception rolls the
  -- claim back together with every side effect, allowing a safe provider retry.
  begin
    insert into public.billing_fulfillment_events (
      provider,
      conversation_id,
      payment_id,
      source,
      target_type,
      status
    ) values (
      v_provider,
      v_conversation_id,
      v_payment_id,
      v_source,
      v_target_type,
      'processing'
    )
    returning id into v_event_id;
  exception when unique_violation then
    select count(*)
      into v_match_count
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      );

    if v_match_count <> 1 then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    select e.*
      into v_existing_event
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      )
    limit 1;

    if v_existing_event.conversation_id is distinct from v_conversation_id
      or v_existing_event.target_type is distinct from v_target_type
      or (
        v_payment_id is not null
        and v_existing_event.payment_id is not null
        and v_existing_event.payment_id is distinct from v_payment_id
      ) then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    if v_existing_event.status <> 'completed' then
      raise exception 'Payment fulfillment is not complete.' using errcode = '55000';
    end if;

    if p_expected_tenant_id is not null
      and v_existing_event.result ->> 'tenantId' is distinct from p_expected_tenant_id::text then
      raise exception 'Completed payment tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(v_existing_event.result ->> 'plan'))
        is distinct from lower(btrim(p_expected_plan)) then
      raise exception 'Completed payment plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(v_existing_event.result ->> 'cycle'))
        is distinct from lower(btrim(p_expected_cycle)) then
      raise exception 'Completed payment cycle does not match.' using errcode = '22023';
    end if;

    if nullif(v_existing_event.result ->> 'amountTry', '') is null
      or abs((v_existing_event.result ->> 'amountTry')::numeric - p_expected_amount_try) > 0.01 then
      raise exception 'Completed payment amount does not match.' using errcode = '22023';
    end if;

    if upper(coalesce(v_existing_event.result ->> 'currency', '')) <> v_expected_currency then
      raise exception 'Completed payment currency does not match.' using errcode = '22023';
    end if;

    if v_existing_event.payment_id is null and v_payment_id is not null then
      update public.billing_fulfillment_events
      set payment_id = v_payment_id
      where id = v_existing_event.id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Existing fulfillment claim could not be updated.' using errcode = '55000';
      end if;
    end if;

    return coalesce(v_existing_event.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already', true);
  end;

  if v_target_type = 'subscription' then
    select
      i.id,
      i.tenant_id,
      i.status,
      i.amount_try,
      i.currency,
      i.meta
    into
      v_invoice_id,
      v_tenant_id,
      v_invoice_status,
      v_amount_try,
      v_invoice_currency,
      v_invoice_meta
    from public.invoices i
    where i.meta ->> 'conversationId' = v_conversation_id
    order by i.created_at desc, i.id desc
    limit 1
    for update;

    if not found then
      raise exception 'Billing invoice not found.' using errcode = 'P0002';
    end if;

    if v_invoice_status not in ('open', 'paid') then
      raise exception 'Invoice is not payable.' using errcode = '22023';
    end if;

    if upper(btrim(coalesce(v_invoice_currency, ''))) <> v_expected_currency then
      raise exception 'Invoice currency does not match.' using errcode = '22023';
    end if;

    v_plan := coalesce(nullif(btrim(v_invoice_meta ->> 'plan'), ''), 'office');
    v_cycle := coalesce(nullif(btrim(v_invoice_meta ->> 'cycle'), ''), 'monthly');

    if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')
      or v_cycle not in ('monthly', 'yearly') then
      raise exception 'Invoice billing metadata is invalid.' using errcode = '22023';
    end if;

    if p_expected_tenant_id is not null and p_expected_tenant_id is distinct from v_tenant_id then
      raise exception 'Invoice tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(p_expected_plan)) is distinct from v_plan then
      raise exception 'Invoice plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(p_expected_cycle)) is distinct from v_cycle then
      raise exception 'Invoice billing cycle does not match.' using errcode = '22023';
    end if;

    -- seat-fulfillment:v1 (20261005000900) ------------------------------------------------------------
    -- Fatura turu: meta.kind YOKSA plan yenileme/aktivasyon (asagidaki mevcut akis, AYNEN).
    -- 'extra_seats' = ek kullanici satisi: plan yenilemesi SAYILMAZ (plan, amount_try, price_lock_*,
    -- current_period_* ve tenants DEGISMEZ; yalniz subscriptions.extra_seats artar ve fatura 'paid' olur).
    -- Bilinmeyen tur reddedilir: ileride eklenecek bir fatura turu yanlislikla tam plan yenilemesi gibi
    -- islenip donemi uzatmasin.
    v_kind := nullif(btrim(coalesce(v_invoice_meta ->> 'kind', '')), '');
    -- credit-pack:v1 >>> (20260826000300) -------------------------------------------------------------
    -- 'credit_pack' = EmlakFiyati kontor paketi satisi. Plan yenilemesi SAYILMAZ: subscriptions (plan, durum,
    -- donem, amount_try, price_lock_*, extra_seats) ve tenants DEGISMEZ; yalniz ef_credit_grant ile kontor
    -- eklenir ve fatura 'paid' olur. Meta sozlesmesi: {packId, units, priceNetTry} (src/lib/ef-credits/config.ts
    -- efPackSchema: units 1..100000; priceNetTry KDV haric net = fatura amount_try). TEK SEFER (uc katman):
    -- billing_fulfillment_events tekil claim'i + 'paid' fatura kontrolu + grant idempotency ('invoice:<id>').
    -- Bu blok asagidaki tur kontrolunden ONCE doner; bilinmeyen tur reddi (asagida) AYNEN korunur.
    if v_kind = 'credit_pack' then
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Credit pack invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      if jsonb_typeof(v_invoice_meta -> 'units') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'priceNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'packId') is distinct from 'string' then
        raise exception 'Credit pack invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_pack_units_num := (v_invoice_meta ->> 'units')::numeric;
      v_pack_price_net := (v_invoice_meta ->> 'priceNetTry')::numeric;
      v_pack_id := btrim(v_invoice_meta ->> 'packId');

      -- units tamsayi 1..100000; packId katalog bicimi; fatura net tutari meta priceNetTry ile ayni (kurus toleransi).
      if v_pack_units_num <> trunc(v_pack_units_num)
        or v_pack_units_num < 1 or v_pack_units_num > 100000
        or v_pack_id !~ '^[a-z0-9][a-z0-9-]{1,31}$'
        or abs(v_pack_price_net - v_amount_try) > 0.01 then
        raise exception 'Credit pack invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_pack_units := v_pack_units_num::integer;

      -- Olay tablosundan once 'paid' olmus satir: kontor IKINCI KEZ EKLENMEZ.
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'credit_pack',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'packId', v_pack_id,
          'units', v_pack_units,
          'creditGranted', false
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      v_pack_grant := public.ef_credit_grant(
        v_tenant_id,
        v_pack_units,
        'purchase',
        'invoice:' || v_invoice_id::text,
        jsonb_build_object(
          'invoiceId', v_invoice_id::text,
          'packId', v_pack_id,
          'conversationId', v_conversation_id,
          'priceNetTry', v_amount_try
        )
      );

      if coalesce((v_pack_grant ->> 'ok')::boolean, false) is not true then
        raise exception 'Credit pack could not be granted.' using errcode = '55000';
      end if;

      -- Fatura: anlik satis (donem = odeme ani). subscription_id ve meta plan/cycle YAZILMAZ.
      update public.invoices i
      set
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = v_now,
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'credit_pack',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'packId', v_pack_id,
        'units', v_pack_units,
        'creditGranted', not coalesce((v_pack_grant ->> 'already')::boolean, false)
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- credit-pack:v1 <<<
    if v_kind is not null and v_kind <> 'extra_seats' then
      raise exception 'Unsupported invoice kind.' using errcode = '22023';
    end if;

    if v_kind = 'extra_seats' then
      -- Tutar YALNIZ faturadan (sunucu oransal hesapladi); plan donem tutari yedegi KULLANILMAZ.
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Seat invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      -- Meta sozlesmesi (src/lib/billing/seat-purchase.ts createSeatInvoice): conversationId, plan, cycle,
      -- source, fromExtraSeats, toExtraSeats, targetTotalSeats, chargeNetTry, quotedPeriodTry.
      if jsonb_typeof(v_invoice_meta -> 'fromExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'toExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'targetTotalSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'chargeNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'quotedPeriodTry') is distinct from 'number' then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from_num := (v_invoice_meta ->> 'fromExtraSeats')::numeric;
      v_seat_to_num := (v_invoice_meta ->> 'toExtraSeats')::numeric;
      v_seat_total_num := (v_invoice_meta ->> 'targetTotalSeats')::numeric;
      v_seat_charge_net := (v_invoice_meta ->> 'chargeNetTry')::numeric;
      v_seat_quoted_period := (v_invoice_meta ->> 'quotedPeriodTry')::numeric;

      -- extra_seats CHECK (0..500) ile ayni sinir; yalniz ARTIS (to > from); toplam koltuk ek koltuktan buyuk
      -- (pakete en az 1 kullanici dahil); fatura net tutari meta chargeNetTry ile ayni (kurus toleransi).
      if v_seat_from_num <> trunc(v_seat_from_num)
        or v_seat_from_num < 0 or v_seat_from_num > 500
        or v_seat_to_num <> trunc(v_seat_to_num)
        or v_seat_to_num < 1 or v_seat_to_num > 500
        or v_seat_to_num <= v_seat_from_num
        or v_seat_total_num <> trunc(v_seat_total_num)
        or v_seat_total_num <= v_seat_to_num or v_seat_total_num > 100000
        or v_seat_quoted_period < 0
        or abs(v_seat_charge_net - v_amount_try) > 0.01 then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from := v_seat_from_num::integer;
      v_seat_to := v_seat_to_num::integer;
      v_seat_total := v_seat_total_num::integer;

      -- Olay tablosundan once 'paid' olmus eski satir: ikinci kez ARTIS YAPILMAZ (plan akisindaki kural).
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'extra_seats',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'fromExtraSeats', v_seat_from,
          'toExtraSeats', v_seat_to,
          'targetTotalSeats', v_seat_total
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      select s.id, s.plan, s.billing_cycle, s.status, s.extra_seats, s.current_period_end
        into v_subscription_id, v_sub_plan, v_seat_sub_cycle, v_seat_sub_status, v_seat_sub_extra,
             v_seat_sub_period_end
      from public.subscriptions s
      where s.tenant_id = v_tenant_id
      for update;

      if not found then
        raise exception 'Subscription not found.' using errcode = 'P0002';
      end if;

      select i.subscription_id
        into v_seat_invoice_sub_id
      from public.invoices i
      where i.id = v_invoice_id;

      if v_seat_invoice_sub_id is not null and v_seat_invoice_sub_id is distinct from v_subscription_id then
        raise exception 'Seat invoice subscription does not match.' using errcode = '22023';
      end if;

      -- Teklif ayni plan/donem icin hesaplandi; arada plan ya da donem degistiyse tutar gecersizdir.
      if v_sub_plan is distinct from v_plan or v_seat_sub_cycle is distinct from v_cycle then
        raise exception 'Seat invoice plan does not match subscription.' using errcode = '22023';
      end if;

      -- startSeatPurchase yalniz 'active' abonelikte satar; tahsilat aninda da ayni kosul aranir.
      if v_seat_sub_status is distinct from 'active' then
        raise exception 'Subscription is not active for seat purchase.' using errcode = '22023';
      end if;

      -- Yalniz teklif anindaki koltuk sayisindan ARTIS: arada baska bir koltuk satisi/degisikligi islendiyse
      -- tahsil edilen oransal tutar artik dogru degildir; reddedilir (tahsilat kaydi refund_required'a duser).
      -- toExtraSeats mevcut extra_seats'tan kucuk/esitse de bu kosulla reddedilir (to > from zorunlu).
      if coalesce(v_seat_sub_extra, 0) <> v_seat_from then
        raise exception 'Extra seat count changed since quote.' using errcode = '22023';
      end if;

      update public.subscriptions s
      set
        extra_seats = v_seat_to,
        updated_at = v_now
      where s.id = v_subscription_id
        and s.tenant_id = v_tenant_id
        and s.extra_seats = v_seat_from
      returning s.id into v_seat_updated_sub_id;

      if v_seat_updated_sub_id is null then
        raise exception 'Extra seats could not be updated.' using errcode = '55000';
      end if;

      -- Fatura donemi: simdi -> mevcut donem sonu (oransal tahsilatin kapsadigi aralik). Abonelik donemi DEGISMEZ.
      update public.invoices i
      set
        subscription_id = v_subscription_id,
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = greatest(coalesce(v_seat_sub_period_end, v_now), v_now),
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'plan', v_plan,
          'cycle', v_cycle,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'extra_seats',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'fromExtraSeats', v_seat_from,
        'toExtraSeats', v_seat_to,
        'targetTotalSeats', v_seat_total
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- seat-fulfillment:v1 sonu: bundan sonrasi plan yenileme/aktivasyon (20261005000500 govdesi, AYNEN).

    -- Aylik liste fiyati plan tanimindan (platform katalogu; ayar yoksa onayli katalog).
    v_monthly_amount := public.plan_monthly_amount(v_plan);
    if v_monthly_amount is null or v_monthly_amount <= 0 then
      raise exception 'Plan amount could not be resolved.' using errcode = '22023';
    end if;

    -- Fatura tutari yoksa yedek: donem tutari (yillik = aylik * yillik odenen ay; 0.8 carpani yok).
    if v_amount_try is null or v_amount_try <= 0 then
      v_amount_try := public.plan_period_amount(v_plan, v_cycle);
    end if;

    v_tax_try := round(v_amount_try * 0.20, 2);
    v_total_try := round(v_amount_try + v_tax_try, 2);

    if abs(v_total_try - p_expected_amount_try) > 0.01 then
      raise exception 'Invoice total does not match.' using errcode = '22023';
    end if;

    -- Legacy paid rows may predate the event table. Claim them without extending
    -- the subscription period a second time.
    if v_invoice_status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'already', true,
        'targetType', 'subscription',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    -- Fiyat kilidi (Founders). Kaynak sirasi: (1) sunucunun faturaya yazdigi teklif kilidi,
    -- (2) ayni planda mevcut kilit korunur, (3) plan degisiminde Founders uyesi yeni planin kampanya
    -- fiyatina yeniden kilitlenir (yoksa kilit kalkar).
    if v_invoice_meta ? 'priceLockTry' or v_invoice_meta ? 'priceLockCampaign' then
      if jsonb_typeof(v_invoice_meta -> 'priceLockTry') is distinct from 'number'
        or char_length(btrim(coalesce(v_invoice_meta ->> 'priceLockCampaign', ''))) not between 1 and 60 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
      v_meta_lock_try := (v_invoice_meta ->> 'priceLockTry')::numeric;
      v_meta_lock_campaign := btrim(v_invoice_meta ->> 'priceLockCampaign');
      if v_meta_lock_try <= 0 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
    end if;

    select s.plan, s.price_lock_try, s.price_lock_campaign
      into v_sub_plan, v_old_lock_try, v_old_lock_campaign
    from public.subscriptions s
    where s.tenant_id = v_tenant_id
    for update;

    if v_meta_lock_try is not null and v_meta_lock_try < v_monthly_amount then
      v_lock_try := v_meta_lock_try;
      v_lock_campaign := v_meta_lock_campaign;
    elsif v_old_lock_try is not null and v_sub_plan is not distinct from v_plan then
      v_lock_try := v_old_lock_try;
      v_lock_campaign := v_old_lock_campaign;
    elsif v_old_lock_campaign is not null and v_sub_plan is distinct from v_plan then
      v_lock_try := public.plan_campaign_lock_amount(v_plan);
      v_lock_campaign := case when v_lock_try is not null then v_old_lock_campaign end;
    end if;

    -- subscriptions.amount_try kanonik aylik (MRR) tutardir; kilit varsa kilitli fiyat.
    v_subscription_amount := case
      when v_lock_try is not null then least(v_lock_try, v_monthly_amount)
      else v_monthly_amount
    end;

    v_period_end := case
      when v_cycle = 'yearly' then v_now + interval '1 year'
      else v_now + interval '1 month'
    end;
    insert into public.subscriptions (
      tenant_id,
      plan,
      status,
      billing_cycle,
      amount_try,
      price_lock_try,
      price_lock_campaign,
      current_period_start,
      current_period_end,
      trial_ends_at,
      cancelled_at,
      iyzico_subscription_ref,
      updated_at
    ) values (
      v_tenant_id,
      v_plan,
      'active',
      v_cycle,
      v_subscription_amount,
      v_lock_try,
      v_lock_campaign,
      v_now,
      v_period_end,
      null,
      null,
      coalesce(v_payment_id, v_conversation_id),
      v_now
    )
    on conflict (tenant_id) do update
    set
      plan = excluded.plan,
      status = 'active',
      billing_cycle = excluded.billing_cycle,
      amount_try = excluded.amount_try,
      price_lock_try = excluded.price_lock_try,
      price_lock_campaign = excluded.price_lock_campaign,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_ends_at = null,
      cancelled_at = null,
      iyzico_subscription_ref = excluded.iyzico_subscription_ref,
      updated_at = v_now
    returning id into v_subscription_id;

    if v_subscription_id is null then
      raise exception 'Subscription could not be updated.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      subscription_id = v_subscription_id,
      status = 'paid',
      amount_try = v_amount_try,
      tax_try = v_tax_try,
      total_try = v_total_try,
      period_start = v_now,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      paid_at = coalesce(i.paid_at, v_now),
      iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
      meta = i.meta || jsonb_build_object(
        'conversationId', v_conversation_id,
        'plan', v_plan,
        'cycle', v_cycle,
        'source', v_source,
        'provider', v_provider
      )
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Invoice could not be updated.' using errcode = '55000';
    end if;

    update public.tenants t
    set plan = v_plan, status = 'active', updated_at = v_now
    where t.id = v_tenant_id
    returning t.id into v_updated_tenant_id;

    if v_updated_tenant_id is null then
      raise exception 'Tenant could not be updated.' using errcode = '55000';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'already', false,
      'targetType', 'subscription',
      'tenantId', v_tenant_id::text,
      'invoiceId', v_invoice_id::text,
      'plan', v_plan,
      'cycle', v_cycle,
      'amountTry', v_total_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_tenant_id,
      invoice_id = v_invoice_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  v_link_token := substring(v_conversation_id from 7);
  if nullif(v_link_token, '') is null then
    raise exception 'Payment link identity is invalid.' using errcode = '22023';
  end if;

  select
    pl.id,
    pl.tenant_id,
    pl.commission_id,
    pl.status,
    pl.amount_try,
    pl.expires_at
  into
    v_payment_link_id,
    v_payment_link_tenant_id,
    v_payment_link_commission_id,
    v_payment_link_status,
    v_payment_link_amount_try,
    v_payment_link_expires_at
  from public.payment_links pl
  where pl.token = v_link_token
  for update;

  if not found then
    raise exception 'Payment link not found.' using errcode = 'P0002';
  end if;

  if v_payment_link_status not in ('open', 'paid') then
    raise exception 'Payment link is not payable.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'open'
    and v_payment_link_expires_at is not null
    and v_payment_link_expires_at <= v_now then
    raise exception 'Payment link has expired.' using errcode = '22023';
  end if;

  if p_expected_tenant_id is not null
    and p_expected_tenant_id is distinct from v_payment_link_tenant_id then
    raise exception 'Payment link tenant does not match.' using errcode = '22023';
  end if;

  if p_expected_plan is not null or p_expected_cycle is not null then
    raise exception 'Payment link does not accept subscription expectations.'
      using errcode = '22023';
  end if;

  if v_payment_link_amount_try is null
    or v_payment_link_amount_try <= 0
    or abs(v_payment_link_amount_try - p_expected_amount_try) > 0.01 then
    raise exception 'Payment link amount does not match.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true,
      'already', true,
      'targetType', 'payment_link',
      'tenantId', v_payment_link_tenant_id::text,
      'paymentLinkId', v_payment_link_id::text,
      'amountTry', v_payment_link_amount_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_payment_link_tenant_id,
      payment_link_id = v_payment_link_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  update public.payment_links pl
  set
    status = 'paid',
    paid_at = coalesce(pl.paid_at, v_now),
    meta = pl.meta || jsonb_build_object(
      'conversationId', v_conversation_id,
      'source', v_source,
      'provider', v_provider
    )
  where pl.id = v_payment_link_id
    and pl.tenant_id = v_payment_link_tenant_id
    and pl.status = 'open'
  returning pl.id into v_updated_payment_link_id;

  if v_updated_payment_link_id is null then
    raise exception 'Payment link could not be updated.' using errcode = '55000';
  end if;

  if v_payment_link_commission_id is not null then
    update public.commissions c
    set status = 'paid'
    where c.id = v_payment_link_commission_id
      and c.tenant_id = v_payment_link_tenant_id
      and c.status not in ('paid', 'collected')
    returning c.id into v_updated_commission_id;

    if v_updated_commission_id is not null then
      v_commission_changed := true;
    else
      perform 1
      from public.commissions c
      where c.id = v_payment_link_commission_id
        and c.tenant_id = v_payment_link_tenant_id
        and c.status in ('paid', 'collected');

      if not found then
        raise exception 'Payment link commission does not belong to tenant.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.notifications (
    tenant_id,
    title,
    body,
    href,
    kind,
    meta
  ) values (
    v_payment_link_tenant_id,
    'Ödeme linki tahsil edildi',
    case
      when v_source = 'demo' then 'Demo tahsilat tamamlandı.'
      else 'Kaparo / komisyon ödemesi alındı.'
    end,
    '/app/komisyon',
    'success',
    jsonb_build_object(
      'payment_link_id', v_payment_link_id,
      'fulfillment_event_id', v_event_id
    )
  )
  returning id into v_notification_id;

  if v_notification_id is null then
    raise exception 'Payment notification could not be created.' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'already', false,
    'targetType', 'payment_link',
    'tenantId', v_payment_link_tenant_id::text,
    'paymentLinkId', v_payment_link_id::text,
    'commissionUpdated', v_commission_changed,
    'amountTry', v_payment_link_amount_try,
    'currency', v_expected_currency
  );

  update public.billing_fulfillment_events
  set
    status = 'completed',
    tenant_id = v_payment_link_tenant_id,
    payment_link_id = v_payment_link_id,
    result = v_result,
    completed_at = v_now
  where id = v_event_id
  returning id into v_completed_event_id;

  if v_completed_event_id is null then
    raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

comment on function public.fulfill_billing_payment(
  text, text, text, text, text, uuid, text, text, numeric, text
) is
  'Service-role-only atomic fulfillment. Unique provider/conversation and provider/payment claims serialize callback/webhook races. meta.kind=extra_seats: extra_seats atomik artar, donem/plan/tutar degismez. meta.kind=credit_pack (credit-pack:v1): ef_credit_grant ile kontor eklenir, abonelik degismez.';

-- ---------------------------------------------------------------------------
-- 2. fulfill_billing_payment_v2 (TABAN: 20260825000600 tam govdesi; credit_pack'te donem uzatilmaz)
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_billing_payment_v2(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_now timestamptz := now();
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_period_base timestamptz;
  v_period_end timestamptz;
  v_cycle text;
  v_tenant_id uuid;
  v_invoice_id uuid;
  v_updated_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_event_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider = 'iyzico' then
    perform 1
    from public.billing_payment_captures c
    where c.provider = v_provider
      and c.conversation_id = v_conversation_id
      and c.payment_id = v_payment_id
      and c.target_type = v_target_type
      and c.tenant_id = p_expected_tenant_id
      and c.status in ('captured_pending', 'retry_pending', 'manual_review', 'fulfilled');
    if not found then
      raise exception 'Durable captured payment claim required.' using errcode = '55000';
    end if;
  end if;

  if v_target_type = 'subscription' then
    if p_expected_tenant_id is null then
      raise exception 'Subscription tenant is required.' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('plan-capacity:' || p_expected_tenant_id::text, 0)
    );

    select s.current_period_start, s.current_period_end
    into v_previous_start, v_previous_end
    from public.subscriptions s
    where s.tenant_id = p_expected_tenant_id
    for update;

    update public.invoices i
    set
      status = 'open',
      checkout_status = 'captured_pending'
    where i.tenant_id = p_expected_tenant_id
      and i.meta ->> 'conversationId' = v_conversation_id
      and i.status = 'draft'
      and (
        (v_provider = 'demo' and i.checkout_status = 'pending_checkout')
        or (v_provider = 'iyzico' and i.checkout_status = 'initialized')
      );
  end if;

  v_result := public.fulfill_billing_payment(
    p_provider,
    p_conversation_id,
    p_payment_id,
    p_source,
    p_target_type,
    p_expected_tenant_id,
    p_expected_plan,
    p_expected_cycle,
    p_expected_amount_try,
    p_expected_currency
  );

  if v_target_type = 'subscription' and coalesce((v_result ->> 'already')::boolean, false) = false then
    v_tenant_id := (v_result ->> 'tenantId')::uuid;
    v_invoice_id := (v_result ->> 'invoiceId')::uuid;

    -- seat-fulfillment:v1 (20261005000900): ek kullanici faturasi plan yenilemesi DEGILDIR. Abonelik donemi
    -- (current_period_start/end) ve fatura donemi (ic fonksiyon yazdi) DEGISMEZ; yalniz checkout kapanir.
    -- credit-pack:v1 >>> (20260826000300): kontor paketi faturasi plan yenilemesi DEGILDIR. Abonelik donemi
    -- DEGISMEZ (extra_seats ile ayni kalip); yalniz checkout kapanir.
    if v_result ->> 'kind' = 'credit_pack' then
      update public.invoices i
      set
        due_at = coalesce(i.due_at, v_now),
        checkout_status = 'fulfilled'
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Credit pack invoice checkout could not be closed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- credit-pack:v1 <<<
    if v_result ->> 'kind' = 'extra_seats' then
      update public.invoices i
      set
        due_at = coalesce(i.due_at, v_now),
        checkout_status = 'fulfilled'
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Seat invoice checkout could not be closed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    v_cycle := lower(btrim(v_result ->> 'cycle'));
    v_period_base := greatest(coalesce(v_previous_end, v_now), v_now);
    v_period_end := case
      when v_cycle = 'yearly' then v_period_base + interval '1 year'
      else v_period_base + interval '1 month'
    end;

    update public.subscriptions s
    set
      current_period_start = case
        when v_previous_end is not null and v_previous_end > v_now
          then coalesce(v_previous_start, v_now)
        else v_now
      end,
      current_period_end = v_period_end,
      updated_at = v_now
    where s.tenant_id = v_tenant_id
    returning s.id into v_updated_subscription_id;

    if v_updated_subscription_id is null then
      raise exception 'Renewed subscription could not be extended.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      period_start = v_period_base,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      checkout_status = 'fulfilled'
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Renewal invoice period could not be updated.' using errcode = '55000';
    end if;

    v_result := v_result || jsonb_build_object(
      'periodStart', v_period_base,
      'periodEnd', v_period_end
    );

    update public.billing_fulfillment_events e
    set result = v_result
    where e.provider = v_provider and e.conversation_id = v_conversation_id
    returning e.id into v_updated_event_id;

    if v_updated_event_id is null then
      raise exception 'Renewal event result could not be updated.' using errcode = '55000';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all privileges on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) to service_role;

comment on function public.fulfill_billing_payment_v2(
  text, text, text, text, text, uuid, text, text, numeric, text
) is
  'Service-role-only fulfillment wrapper: durable capture claim, draft->open, renewal period extension (extra_seats ve credit_pack faturasinda donem uzatilmaz; credit-pack:v1).';

notify pgrst, 'reload schema';

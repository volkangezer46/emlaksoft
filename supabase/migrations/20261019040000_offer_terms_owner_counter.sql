-- MIGRATION 20261019040000_offer_terms_owner_counter.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutunlar yokken teklif formu kosullari kaydetmez ("etkin degil" uyarisi),
--   karsilastirma tablosu yalniz tutar/gecerlilik gosterir, malik portalinda karsi teklif formu "etkin degil" der.
-- Geri alma: supabase/rollbacks/20261019040000_offer_terms_owner_counter.rollback.sql
-- BAGIMLILIK: public.offers, public.owner_portal_tokens, public.enqueue_public_mutation_effect (20260810000990).
--
-- NE (SP2, yapilandirilmis teklif kosullari + malik karsi teklifi):
--   offers'a odeme sekli (pesin | kredi | takas | karma), kapora tutari, onerilen tapu tarihi, kredi sarti ve takas notu.
--   offers'a malik portalindan gelen karsi teklif (owner_counter_*) — ALICIYA OTOMATIK GITMEZ: teklif durumu degismez,
--   danisman bildirim alir ve isterse "Karsi teklif turu" olarak iletir.
--   owner_counter_offer_atomic: token dogrulama + durum + gecerlilik + tutar kontrolu, yazim ve bildirim niyeti (outbox)
--   TEK transaction'da. Yalniz service_role cagirir (sunucu eylemi IP hizi sinirini uygular).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.offers') is null or pg_catalog.to_regclass('public.owner_portal_tokens') is null then
    raise exception 'offers/owner_portal_tokens yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.offers add column if not exists payment_method text;
alter table public.offers add column if not exists deposit_amount numeric(14,2);
alter table public.offers add column if not exists proposed_deed_date date;
alter table public.offers add column if not exists credit_contingency boolean not null default false;
alter table public.offers add column if not exists swap_note text;
alter table public.offers add column if not exists owner_counter_amount numeric(14,2);
alter table public.offers add column if not exists owner_counter_note text;
alter table public.offers add column if not exists owner_counter_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'offers_payment_method_check') then
    alter table public.offers add constraint offers_payment_method_check
      check (payment_method is null or payment_method in ('pesin', 'kredi', 'takas', 'karma'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'offers_deposit_amount_check') then
    alter table public.offers add constraint offers_deposit_amount_check
      check (deposit_amount is null or (deposit_amount >= 0 and deposit_amount <= 100000000000));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'offers_swap_note_check') then
    alter table public.offers add constraint offers_swap_note_check
      check (swap_note is null or char_length(swap_note) <= 1000);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'offers_owner_counter_check') then
    alter table public.offers add constraint offers_owner_counter_check
      check (
        (owner_counter_amount is null or (owner_counter_amount >= 1 and owner_counter_amount <= 100000000000))
        and (owner_counter_note is null or char_length(owner_counter_note) <= 1000)
        and ((owner_counter_amount is null) = (owner_counter_at is null))
      );
  end if;
end $$;

comment on column public.offers.payment_method is 'SP2: odeme sekli pesin | kredi | takas | karma (bos = belirtilmedi)';
comment on column public.offers.deposit_amount is 'SP2: teklifle birlikte onerilen kapora tutari (TL)';
comment on column public.offers.proposed_deed_date is 'SP2: alicinin onerdigi tapu devir tarihi';
comment on column public.offers.credit_contingency is 'SP2: teklif kredi onayina bagli mi (kredi sarti)';
comment on column public.offers.owner_counter_amount is 'SP2: malik portalindan gelen karsi teklif; aliciya otomatik iletilmez';

create or replace function public.owner_counter_offer_atomic(
  p_token text,
  p_offer_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := clock_timestamp();
  v_tenant_id uuid;
  v_property_id uuid;
  v_owner_name text;
  v_assigned_to uuid;
  v_property_label text;
  v_offer record;
  v_target_user uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(v_token) not between 1 and 256
     or p_offer_id is null
     or p_amount is null or p_amount < 1 or p_amount > 100000000000
     or round(p_amount, 2) <> p_amount
     or char_length(coalesce(v_note, '')) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select opt.tenant_id, opt.property_id, opt.owner_name, p.assigned_to, coalesce(p.title, p.property_code, 'Portföy')
    into v_tenant_id, v_property_id, v_owner_name, v_assigned_to, v_property_label
  from public.owner_portal_tokens opt
  inner join public.tenants t
    on t.id = opt.tenant_id
   and t.status in ('trial', 'active', 'past_due')
  inner join public.properties p
    on p.id = opt.property_id
   and p.tenant_id = opt.tenant_id
   and p.deleted_at is null
  where opt.token = v_token
    and opt.expires_at >= v_now;
  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;

  select o.id, o.status::text as status, o.valid_until, o.created_by, o.owner_counter_amount, o.owner_counter_note
    into v_offer
  from public.offers o
  where o.id = p_offer_id
    and o.tenant_id = v_tenant_id
    and o.property_id = v_property_id
  for update of o;
  if not found then
    return jsonb_build_object('outcome', 'offer_not_found');
  end if;
  if v_offer.status not in ('submitted', 'countered') then
    return jsonb_build_object('outcome', 'already_finalized', 'current_status', v_offer.status);
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until < (v_now at time zone 'Europe/Istanbul')::date then
    return jsonb_build_object('outcome', 'expired');
  end if;
  -- Ayni tutar + not yeniden gonderilirse (cift tik, geri tusu) yeni bildirim uretilmez.
  if v_offer.owner_counter_amount = p_amount and v_offer.owner_counter_note is not distinct from v_note then
    return jsonb_build_object('outcome', 'replay', 'offer_id', v_offer.id);
  end if;

  update public.offers
     set owner_counter_amount = p_amount,
         owner_counter_note = v_note,
         owner_counter_at = v_now,
         updated_at = v_now
   where id = v_offer.id
     and tenant_id = v_tenant_id
     and status::text in ('submitted', 'countered');
  if not found then
    raise exception 'Offer counter target changed.' using errcode = '40001';
  end if;

  select pr.id
    into v_target_user
  from public.profiles pr
  where pr.tenant_id = v_tenant_id
    and pr.is_active = true
    and pr.id in (v_assigned_to, v_offer.created_by)
  order by case when pr.id = v_assigned_to then 0 else 1 end
  limit 1;

  perform public.enqueue_public_mutation_effect(
    p_tenant_id => v_tenant_id,
    p_dedupe_key => 'owner_offer_counter:' || v_offer.id::text || ':' || floor(extract(epoch from v_now) * 1000)::bigint::text,
    p_workflow => 'owner_offer_counter',
    p_entity_type => 'offer',
    p_entity_id => v_offer.id,
    p_audit_actor_id => null,
    p_audit_action => 'offer.owner_counter',
    p_audit_old_value => jsonb_build_object('owner_counter_amount', v_offer.owner_counter_amount),
    p_audit_new_value => jsonb_build_object(
      'owner_counter_amount', p_amount,
      'source', 'owner_portal',
      'owner_name', v_owner_name
    ),
    p_notification_user_id => v_target_user,
    p_notification_title => 'Malik karşı teklif önerdi',
    p_notification_body => left(
      v_property_label || ' · ' || to_char(p_amount, 'FM999G999G999G990') || ' ₺ · alıcıya iletmeden önce gözden geçirin',
      1000
    ),
    p_notification_href => '/app/teklifler/' || v_offer.id::text,
    p_notification_kind => 'info',
    p_notification_pref_key => 'portal'
  );

  return jsonb_build_object('outcome', 'applied', 'offer_id', v_offer.id);
end;
$$;

revoke all on function public.owner_counter_offer_atomic(text, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.owner_counter_offer_atomic(text, uuid, numeric, text) to service_role;

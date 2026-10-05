-- Rollback: 20260826000600_growth_referral_engine
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- Etki: referans/ortak motoru RPC'leri, ayar tablosu ve olay izi kalkar; talep tablosu 000800'deki haline doner
-- (yeni sutunlar/indeksler dusurulur; reward_type CHECK'i eski listeye doner).
-- ONCE: bayraklari kapatin (growth_referral_enabled, growth_partner_enabled, growth_cash_payout_enabled = off) ve
--   select count(*) from public.growth_reward_claims;  -- dolu ise denetim izi kaybolur
-- Dolu iken yine de dusurmek icin: set local emlaksoft.rollback_force = 'on';
-- Verilmis TL krediler (defter append-only) KALIR; clawback/odeme kayitlari bu dosyayla geri alinmaz.

drop function if exists public.growth_invite_preview(text);
drop function if exists public.growth_admin_partner_update(uuid, jsonb);
drop function if exists public.growth_admin_payout_create(uuid, text, text, date, text);
drop function if exists public.growth_admin_save_settings(jsonb);
drop function if exists public.growth_admin_decide(uuid, text, text);
drop function if exists public.growth_staff_super_admin();
drop function if exists public.growth_engine_ready();
drop function if exists public.growth_admin_queue(text, integer);
drop function if exists public.growth_admin_metrics();
drop function if exists public.growth_my_partner_dashboard();
drop function if exists public.growth_my_dashboard();
drop function if exists public.growth_claims_reverse_for_invoice(uuid, text);
drop function if exists public.growth_claims_process(integer);
drop function if exists public.growth_grant_claim(uuid);
drop function if exists public.growth_clawback_pending(integer, boolean);
drop function if exists public.growth_reverse_claims(uuid, text);
drop function if exists public.growth_grant_welcome(uuid);
drop function if exists public.growth_claim_register(uuid);
drop function if exists public.growth_register_partner(uuid);
drop function if exists public.growth_register_referral(uuid);
drop function if exists public.growth_log_event(uuid, text, uuid, jsonb);
drop function if exists public.growth_real_payment(uuid);
drop function if exists public.growth_monthly_equiv(uuid);
drop function if exists public.growth_pair_flags(uuid, uuid);
drop function if exists public.growth_tenant_phone_tails(uuid);
drop function if exists public.growth_tenant_email_domains(uuid);
drop function if exists public.growth_public_email_domain(text);
drop function if exists public.growth_flag_on(text);

do $$
declare
  v_force boolean := coalesce(current_setting('emlaksoft.rollback_force', true), '') = 'on';
  v_rows boolean := false;
begin
  if pg_catalog.to_regclass('public.growth_reward_claims') is not null then
    execute 'select exists (select 1 from public.growth_reward_claims)' into v_rows;
    if v_rows and not v_force then
      raise exception 'growth_reward_claims dolu: denetim izi korunur. Zorlamak icin set local emlaksoft.rollback_force = ''on''.';
    end if;
  end if;
end $$;

-- Zorlama yolu: eski tekillik (kural, davet edilen ofis) yalniz taban talepler icin gecerlidir; bonus/komisyon satirlari silinir.
drop table if exists public.growth_claim_events;
delete from public.growth_reward_claims where component <> 'base';
drop table if exists public.growth_referral_settings;
drop function if exists public.growth_claim_events_immutable();

drop index if exists public.uq_growth_claims_component;
drop index if exists public.uq_growth_claims_base_once;
drop index if exists public.uq_growth_claims_tier_once;
drop index if exists public.idx_growth_claims_status;
drop index if exists public.idx_growth_claims_beneficiary;
drop index if exists public.idx_growth_claims_partner;
drop index if exists public.idx_growth_claims_invoice;
alter table public.growth_reward_claims drop constraint if exists growth_reward_claims_commission_partner_check;
alter table public.growth_reward_claims drop constraint if exists growth_reward_claims_component_check;
alter table public.growth_reward_claims
  drop column if exists component,
  drop column if exists invoice_id,
  drop column if exists months_units,
  drop column if exists base_monthly_try,
  drop column if exists grant_idem,
  drop column if exists granted_at,
  drop column if exists clawed_back_at,
  drop column if exists reversal_reason,
  drop column if exists payout_id,
  drop column if exists updated_at;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'growth_reward_claims_rule_id_referred_tenant_id_key'
                 and conrelid = 'public.growth_reward_claims'::regclass) then
    alter table public.growth_reward_claims add constraint growth_reward_claims_rule_id_referred_tenant_id_key unique (rule_id, referred_tenant_id);
  end if;
end $$;

alter table public.growth_partner_payouts drop constraint if exists growth_partner_payouts_paid_check;
alter table public.growth_partner_payouts drop constraint if exists growth_partner_payouts_status_check;
alter table public.growth_partner_payouts drop column if exists status, drop column if exists note, drop column if exists marked_by_staff;
alter table public.growth_partners drop constraint if exists growth_partners_tax_no_check;
alter table public.growth_partners drop column if exists is_tax_payer, drop column if exists tax_no;

alter table public.growth_reward_rules drop constraint if exists growth_reward_rules_reward_type_check;
alter table public.growth_reward_rules
  add constraint growth_reward_rules_reward_type_check check (reward_type in ('fixed_try', 'percent_of_payment')) not valid;
-- NOT VALID: mevcut 'monthly_multiple' kural satirlari (varsa) silinmez, yalniz yeni yazimlar eski listeyle sinirlanir.

notify pgrst, 'reload schema';

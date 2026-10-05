-- Rollback: 20260826000800_default_program_settings. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- DIKKAT: bu seed'in yazdigi degerlere ait satirlari siler/geri alir; seed'den SONRA panelden yapilan ayni anahtar degisiklikleri de gider
-- (platform_settings satirlari updated_by IS NULL ise silinir; panel yazdiysa updated_by dolu olur ve KORUNUR).
update public.growth_reward_rules set is_active = false
where kind = 'referral' and name = 'Davet odulu: 1 aylik paket bedeli';
delete from public.growth_reward_rules r
where r.kind = 'referral' and r.name = 'Davet odulu: 1 aylik paket bedeli'
  and not exists (select 1 from public.growth_reward_claims c where c.rule_id = r.id);

update public.growth_referral_settings set welcome_credit_try = 0, updated_at = now()
where singleton and updated_by is null and welcome_credit_try = 300;

update public.platform_settings set value = 'off', updated_at = now()
where key = 'growth_referral_enabled' and updated_by is null;
delete from public.platform_settings
where key in ('growth_partner_enabled', 'growth_cash_payout_enabled', 'try_credit.max_invoice_share', 'billing.auto_renew_enabled',
              'billing.plan_definitions', 'ef.tariff', 'ef.packs')
  and updated_by is null;

update public.plan_entitlements set seat_limit = 20, updated_at = now() where plan = 'professional' and seat_limit = 15;

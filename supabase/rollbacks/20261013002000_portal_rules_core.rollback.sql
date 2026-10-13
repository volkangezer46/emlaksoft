-- 20261013002000 geri alma: ogrenen kural tablolari ve yardimcilari dusurulur (ters sira; once 20261013002020 ve
-- 20261013002010 geri alinmali). VERI KAYBI: kural surumleri, oneriler, oylar ve gozlemler silinir (kisisel veri yok;
-- eklenti tohum kurallarla calismaya devam eder). Mevcut tablolar/politikalar etkilenmez.
set local lock_timeout = '5s';

drop table if exists public.portal_fill_events;
drop table if exists public.portal_form_reports;
drop table if exists public.portal_form_versions;
drop table if exists public.portal_form_fields;
drop table if exists public.portal_rule_tenant_trust;
drop table if exists public.portal_rule_votes;
drop table if exists public.portal_rule_proposals;
drop table if exists public.portal_rule_sets;
drop function if exists public.pt_rule_sets_immutable();
drop function if exists public.pt_rules_validate_content(text, jsonb);
drop function if exists public.pt_rules_is_super_admin();
drop function if exists public.pt_rules_is_operator();

notify pgrst, 'reload schema';

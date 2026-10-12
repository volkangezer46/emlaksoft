-- Rollback: 20261012002100_service_role_write_grants. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
revoke insert on table public.growth_referral_codes from service_role;
revoke insert on table public.signup_attributions from service_role;
revoke insert, update on table public.growth_partners from service_role;
revoke insert, update on table public.growth_reward_rules from service_role;
revoke insert, update on table public.document_request_files from service_role;
revoke update on table public.document_requests from service_role;
revoke update on table public.kvkk_requests from service_role;
notify pgrst, 'reload schema';

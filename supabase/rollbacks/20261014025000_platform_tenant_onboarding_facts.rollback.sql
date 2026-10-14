-- Geri alma: 20261014025000_platform_tenant_onboarding_facts.sql
-- Yalniz salt-okunur fonksiyon kaldirilir; veri degismez. Kod fonksiyon yokken kurulum ilerlemesini "hazir degil" gosterir,
-- saglik skoru kurulum girdisi olmadan (eski agirliklarla) hesaplanir.
drop function if exists public.platform_tenant_onboarding_facts(uuid);

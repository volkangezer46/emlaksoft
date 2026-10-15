-- 20261019060001 geri alma: limit kullanimi ve deger sayimi fonksiyonlari duser; genisleme icgoruleri silinir ve
--   platform_insights.kind CHECK'i eski listeye doner. Kod fonksiyonlar yokken suzgecte "kurulum bekliyor" der, deger
--   ozeti/geri kazanim e-postasi gondermez.
set local lock_timeout = '5s';

drop function if exists public.platform_tenant_value_counts(uuid[]);
drop function if exists public.platform_tenant_limit_usage(uuid[], numeric);

do $$
begin
  if pg_catalog.to_regclass('public.platform_insights') is null then
    return;
  end if;
  delete from public.platform_insights where kind = 'revenue_opportunity';
  alter table public.platform_insights drop constraint if exists platform_insights_kind_check;
  alter table public.platform_insights add constraint platform_insights_kind_check check (kind in (
    'tenant_churn', 'revenue_anomaly', 'payment_risk', 'system_health', 'partner_signal', 'anomaly', 'forecast', 'digest'
  ));
end $$;

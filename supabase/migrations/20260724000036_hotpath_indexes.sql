-- Ek hot-path index'leri (performans turu — 24 Temmuz 2026)
-- Danışman KPI / ekip dağılımı assigned_to bazlı gruplama yapıyor; admin satış/billing
-- ekranları status bazlı filtreliyor. Bu sorgular için kapsayan index'ler.

-- customers — tenant + danışman (danışman-kpi & ekip yük dağılımı)
create index if not exists idx_customers_tenant_assigned
  on public.customers(tenant_id, assigned_to)
  where deleted_at is null;

-- properties — tenant + danışman (danışman portföy yükü, portföy detay assignee)
create index if not exists idx_properties_tenant_assigned
  on public.properties(tenant_id, assigned_to)
  where deleted_at is null;

-- subscriptions — tenant + status (billing özeti, aktif abonelik)
create index if not exists idx_subscriptions_tenant_status
  on public.subscriptions(tenant_id, status);

-- demo_requests — status + tarih (admin satış CRM açık talepler)
create index if not exists idx_demo_requests_status_created
  on public.demo_requests(status, created_at desc);

-- valuations — tenant + tarih (değerleme geçmişi listesi)
create index if not exists idx_valuations_tenant_created
  on public.valuations(tenant_id, created_at desc);

-- offers — created_by + status (danışman-kpi teklif dağılımı)
create index if not exists idx_offers_creator_status
  on public.offers(created_by, status);

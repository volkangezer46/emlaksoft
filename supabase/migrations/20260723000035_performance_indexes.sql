-- Performans kritik index'leri
-- Mevcut index'lere ek olarak sık kullanılan sorgu kalıpları için

-- customers — silinmemiş + tenant + tarih
create index if not exists idx_customers_tenant_active
  on public.customers(tenant_id, created_at desc)
  where deleted_at is null;

-- properties — silinmemiş + tenant + tarih
create index if not exists idx_properties_tenant_active
  on public.properties(tenant_id, created_at desc)
  where deleted_at is null;

-- properties — tenant + status (dashboard filtre)
create index if not exists idx_properties_tenant_status
  on public.properties(tenant_id, status)
  where deleted_at is null;

-- portal_listings — tenant + status (live sayısı)
create index if not exists idx_portal_listings_tenant_status
  on public.portal_listings(tenant_id, status);

-- portal_listings — property_id + status
create index if not exists idx_portal_listings_prop_status
  on public.portal_listings(property_id, status);

-- listing_closures — tenant + created_at (aylık kayıp)
create index if not exists idx_listing_closures_tenant_created
  on public.listing_closures(tenant_id, created_at desc);

-- commissions — tenant + status + created_at (aylık komisyon)
create index if not exists idx_commissions_tenant_status
  on public.commissions(tenant_id, status, created_at desc);

-- calls — tenant + started_at (bugünkü çağrı sayısı)
create index if not exists idx_calls_tenant_started
  on public.calls(tenant_id, started_at desc);

-- deals — tenant + stage + updated_at
create index if not exists idx_deals_tenant_stage
  on public.deals(tenant_id, stage, updated_at desc);

-- customer_demands — tenant + status
create index if not exists idx_demands_tenant_status
  on public.customer_demands(tenant_id, status);

-- audit_logs — tenant + created_at (son aktiviteler)
create index if not exists idx_audit_logs_tenant_created
  on public.audit_logs(tenant_id, created_at desc)
  where tenant_id is not null;

-- appointments — tenant + scheduled_at (yaklaşan randevular)
create index if not exists idx_appointments_tenant_scheduled
  on public.appointments(tenant_id, scheduled_at asc);

-- tasks — tenant + status + due_at
create index if not exists idx_tasks_tenant_status_due
  on public.tasks(tenant_id, status, due_at asc);

-- communications — customer_id + created_at
create index if not exists idx_communications_cust_created
  on public.communications(customer_id, created_at desc);

-- property_status_history — property_id + created_at
create index if not exists idx_prop_status_history_prop
  on public.property_status_history(property_id, created_at desc);

-- owner_portal_tokens — property_id + expires_at
create index if not exists idx_owner_portal_tokens_prop_exp
  on public.owner_portal_tokens(property_id, expires_at desc);

-- campaigns — tenant + created_at
create index if not exists idx_campaigns_tenant_created
  on public.campaigns(tenant_id, created_at desc);

-- contracts — tenant + status + created_at
create index if not exists idx_contracts_tenant_status
  on public.contracts(tenant_id, status, created_at desc);

-- offers — tenant + status + created_at
create index if not exists idx_offers_tenant_status
  on public.offers(tenant_id, status, created_at desc);

-- expenses — tenant + expense_date
create index if not exists idx_expenses_tenant_date
  on public.expenses(tenant_id, expense_date desc);

-- Müşteri-360 detay sayfası hot-path index'leri (denetim bulgusu)
-- Müşteri detayı her açılışta customer_id/entity_id ile ~16 sorgu atıyor; bu tablolarda
-- müşteri-kapsamlı index eksikti → büyük tenant'larda seq-scan.

create index if not exists idx_calls_customer
  on public.calls(tenant_id, customer_id, started_at desc)
  where customer_id is not null;

create index if not exists idx_appointments_customer
  on public.appointments(tenant_id, customer_id)
  where customer_id is not null;

create index if not exists idx_deals_customer
  on public.deals(tenant_id, customer_id)
  where customer_id is not null;

create index if not exists idx_audit_logs_entity
  on public.audit_logs(tenant_id, entity_id, created_at desc)
  where entity_id is not null;

create index if not exists idx_iys_consents_customer
  on public.iys_consents(customer_id, created_at desc);

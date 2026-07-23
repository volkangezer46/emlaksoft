-- Kayıp-kaçak SLA uyarıları ve dedikasyon takibi
alter table public.portal_closures
  add column if not exists sla_warning_sent_at timestamptz,
  add column if not exists leak_severity text check (leak_severity in ('low','medium','high','critical'));

create index if not exists idx_closures_sla on public.portal_closures(tenant_id, sla_warning_sent_at)
  where sla_warning_sent_at is null and deal_happened is null;

comment on column public.portal_closures.sla_warning_sent_at is
  'Proaktif uyarı gönderildi mi? (7/14/30 gün SLA)';
comment on column public.portal_closures.leak_severity is
  'Ciddiyeti: yüksek deal_amount + gecikme → critical';

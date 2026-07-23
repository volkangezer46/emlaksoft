-- FIX: 000012 kolonları yanlışlıkla var olmayan `portal_closures` tablosuna eklenmişti.
-- Gerçek tablo `listing_closures`. SLA takip kolonlarını doğru tabloya ekliyoruz.

alter table public.listing_closures
  add column if not exists sla_warning_sent_at timestamptz,
  add column if not exists leak_severity text check (leak_severity in ('low','medium','high','critical'));

create index if not exists idx_listing_closures_sla
  on public.listing_closures(tenant_id, sla_warning_sent_at)
  where sla_warning_sent_at is null;

comment on column public.listing_closures.sla_warning_sent_at is
  'Proaktif kayıp-kaçak uyarısı gönderildi mi? (7/14/30 gün SLA)';
comment on column public.listing_closures.leak_severity is
  'Ciddiyet: yüksek kayıp komisyon + gecikme → critical';

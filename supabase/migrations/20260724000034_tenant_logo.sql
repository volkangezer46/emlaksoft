-- Migration: tenants tablosuna logo_url + website kolonları ekle
alter table tenants
  add column if not exists logo_url text,
  add column if not exists website  text;

comment on column tenants.logo_url is 'Supabase Storage public URL (tenant-logos bucket)';
comment on column tenants.website  is 'Ofis web sitesi URL';

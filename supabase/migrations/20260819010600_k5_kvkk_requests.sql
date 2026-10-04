-- K5 / P1-F5, F6: KVKK veri sahibi talepleri + ofis hesap kapatma / veri indirme talepleri.
-- Forward-only, yeniden calistirilabilir. Hukuki metin icermez; yalniz talep kaydi ve durum takibi.
-- RLS: ofis kendi kayitlarini gorur ve yazar (current_tenant_id), platform personeli tum kayitlara erisir.

create table if not exists public.kvkk_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  request_type    text not null
    check (request_type in ('access','portability','rectification','objection','erasure','account_closure','data_export')),
  customer_id     uuid references public.customers(id) on delete set null,
  requester_name  text,
  note            text,
  status          text not null default 'open'
    check (status in ('open','in_progress','completed','rejected')),
  due_at          timestamptz not null default (now() + interval '30 days'),
  resolution_note text,
  created_by      uuid references public.profiles(id) on delete set null,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_kvkk_requests_tenant
  on public.kvkk_requests (tenant_id, status, due_at);

alter table public.kvkk_requests enable row level security;

drop policy if exists kvkk_requests_tenant_select on public.kvkk_requests;
create policy kvkk_requests_tenant_select on public.kvkk_requests
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists kvkk_requests_tenant_insert on public.kvkk_requests;
create policy kvkk_requests_tenant_insert on public.kvkk_requests
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists kvkk_requests_tenant_update on public.kvkk_requests;
create policy kvkk_requests_tenant_update on public.kvkk_requests
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists kvkk_requests_staff on public.kvkk_requests;
create policy kvkk_requests_staff on public.kvkk_requests
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

grant select, insert, update on public.kvkk_requests to authenticated;

notify pgrst, 'reload schema';

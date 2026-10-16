-- MIGRATION 20261020010001_customer_relations.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken Musteri 360 "Iliskili kisiler" karti "kurulum bekliyor" der.
-- Geri alma: supabase/rollbacks/20261020010001_customer_relations.rollback.sql (iliskiler silinir; musteriler kalir).
-- BAGIMLILIK: 20261020010000 (kvkk_erasure_purge_customer_extras ilk tanimi), customers(id, tenant_id) benzersiz indeksi.
--
-- NE (CRM-G8, musteriler arasi iliski: es, aile, is ortagi, sirket yetkilisi, avukat, tavsiye eden):
--   customer_relations: tek satir iki yonlu okunur. Satir (customer_id = A, related_customer_id = B, relation = k)
--   "B, A'nin k'sidir" demektir; B'nin kartinda A ters etiketle gorunur (src/lib/customer-relations.ts: es<->es,
--   sirket_yetkilisi<->sirket, avukat<->muvekkil, tavsiye_eden<->tavsiye_ettigi). Ayni cift icin TEK satir (sirasiz cift
--   benzersiz indeksi). Birlestirme (merge_customers, 20261020010004) ic ciftleri siler, disari iliskileri ana kayda tasir.
--   KVKK anonimlestirmesi musterinin iliskilerini de siler (kvkk_erasure_purge_customer_extras yeniden tanimlanir).
--
-- GUVENLIK: RLS — oturum ofisi + customers:view (okuma) / customers:edit (yazma) + IKI musteri de oturuma gorunur
--   (kapsam disi musterinin adi iliski uzerinden sizmaz).
set local lock_timeout = '5s';

create table if not exists public.customer_relations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  customer_id         uuid not null,
  related_customer_id uuid not null,
  relation            text not null check (relation in (
    'es', 'aile', 'ortak', 'sirket_yetkilisi', 'sirket', 'avukat', 'muvekkil', 'tavsiye_eden', 'tavsiye_ettigi', 'diger'
  )),
  note                text check (note is null or char_length(note) <= 200),
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint customer_relations_customer_fkey foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade,
  constraint customer_relations_related_fkey foreign key (related_customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade,
  constraint customer_relations_not_self check (customer_id <> related_customer_id)
);

comment on table public.customer_relations is
  'CRM-G8: musteriler arasi iliski (tek satir, iki yonlu okunur). (A, B, k) = B, A''nin k''sidir; ters etiket kodda.';

create unique index if not exists customer_relations_pair_uidx
  on public.customer_relations (tenant_id, least(customer_id, related_customer_id), greatest(customer_id, related_customer_id));
create index if not exists idx_customer_relations_customer on public.customer_relations (customer_id);
create index if not exists idx_customer_relations_related on public.customer_relations (related_customer_id);
create index if not exists idx_customer_relations_created_by on public.customer_relations (created_by);

alter table public.customer_relations enable row level security;

drop policy if exists customer_relations_select on public.customer_relations;
create policy customer_relations_select on public.customer_relations
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'view'))
    and exists (select 1 from public.customers c where c.id = customer_relations.customer_id and c.deleted_at is null)
    and exists (select 1 from public.customers c where c.id = customer_relations.related_customer_id and c.deleted_at is null)
  );

drop policy if exists customer_relations_insert on public.customer_relations;
create policy customer_relations_insert on public.customer_relations
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_relations.customer_id and c.deleted_at is null)
    and exists (select 1 from public.customers c where c.id = customer_relations.related_customer_id and c.deleted_at is null)
  );

drop policy if exists customer_relations_update on public.customer_relations;
create policy customer_relations_update on public.customer_relations
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_relations.customer_id)
    and exists (select 1 from public.customers c where c.id = customer_relations.related_customer_id)
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_relations.customer_id and c.deleted_at is null)
    and exists (select 1 from public.customers c where c.id = customer_relations.related_customer_id and c.deleted_at is null)
  );

drop policy if exists customer_relations_delete on public.customer_relations;
create policy customer_relations_delete on public.customer_relations
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and exists (select 1 from public.customers c where c.id = customer_relations.customer_id)
    and exists (select 1 from public.customers c where c.id = customer_relations.related_customer_id)
  );

-- KVKK: anonimlestirilen musterinin ek iletisim bilgileri VE iliskileri silinir (20261020010000 tanimini genisletir).
create or replace function public.kvkk_erasure_purge_customer_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_contacts
   where customer_id = new.customer_id and tenant_id = new.tenant_id;
  delete from public.customer_relations
   where tenant_id = new.tenant_id
     and (customer_id = new.customer_id or related_customer_id = new.customer_id);
  return null;
end;
$$;

revoke all on function public.kvkk_erasure_purge_customer_extras() from public, anon, authenticated;

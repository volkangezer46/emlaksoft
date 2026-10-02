-- Customer/property document boundary hardening.
-- New rows must bind their relational parent and private storage key to the
-- same tenant. NOT VALID preserves legacy rollout while enforcing all future
-- inserts and updates immediately.

create unique index if not exists idx_customers_id_tenant_unique
  on public.customers(id, tenant_id);
create unique index if not exists idx_properties_id_tenant_unique
  on public.properties(id, tenant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_files'::regclass
      and conname = 'customer_files_customer_tenant_fkey'
  ) then
    alter table public.customer_files
      add constraint customer_files_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_files'::regclass
      and conname = 'customer_files_uploader_tenant_fkey'
  ) then
    alter table public.customer_files
      add constraint customer_files_uploader_tenant_fkey
      foreign key (uploaded_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass
      and conname = 'property_media_property_tenant_fkey'
  ) then
    alter table public.property_media
      add constraint property_media_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass
      and conname = 'property_media_uploader_tenant_fkey'
  ) then
    alter table public.property_media
      add constraint property_media_uploader_tenant_fkey
      foreign key (uploaded_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_files'::regclass
      and conname = 'customer_files_verified_metadata_check'
  ) then
    alter table public.customer_files
      add constraint customer_files_verified_metadata_check
      check (
        file_size between 1 and 10485760
        and file_type in (
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        and char_length(file_name) between 1 and 160
        and file_name !~ '[[:cntrl:]/\\]'
        and storage_path ~ (
          '^' || tenant_id::text || '/' || customer_id::text ||
          '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
          '[.](jpg|png|gif|webp|pdf|doc|docx|xls|xlsx)$'
        )
      )
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass
      and conname = 'property_media_verified_metadata_check'
  ) then
    alter table public.property_media
      add constraint property_media_verified_metadata_check
      check (
        storage_path is null
        or (
          file_size between 1 and 15728640
          and file_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
          and char_length(file_name) between 1 and 160
          and file_name !~ '[[:cntrl:]/\\]'
          and storage_path ~ (
            '^' || tenant_id::text || '/' || property_id::text ||
            '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
            '[.](jpg|png|gif|webp)$'
          )
        )
      )
      not valid;
  end if;
end;
$$;

-- Replace broad legacy table policies with action-aware active-tenant gates.
drop policy if exists customer_files_tenant on public.customer_files;
drop policy if exists identity_customer_files_select on public.customer_files;
drop policy if exists identity_customer_files_insert on public.customer_files;
drop policy if exists identity_customer_files_delete on public.customer_files;

create policy identity_customer_files_select on public.customer_files
for select to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'view')
);

create policy identity_customer_files_insert on public.customer_files
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);

create policy identity_customer_files_delete on public.customer_files
for delete to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and (
    public.has_effective_permission('customers', 'edit')
    or public.has_effective_permission('customers', 'delete')
  )
);

drop policy if exists property_media_tenant on public.property_media;
drop policy if exists identity_property_media_select on public.property_media;
drop policy if exists identity_property_media_insert on public.property_media;
drop policy if exists identity_property_media_update on public.property_media;
drop policy if exists identity_property_media_delete on public.property_media;

create policy identity_property_media_select on public.property_media
for select to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'view')
);

create policy identity_property_media_insert on public.property_media
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);

create policy identity_property_media_update on public.property_media
for update to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
)
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);

create policy identity_property_media_delete on public.property_media
for delete to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);

-- Storage is private and accessed only through authorized server boundaries.
-- Remove the historical policy names documented for manual setup so a direct
-- authenticated storage request cannot bypass table/object authorization.
drop policy if exists "Tenant users read own files" on storage.objects;
drop policy if exists "Tenant users insert own files" on storage.objects;
drop policy if exists "Tenant users delete own files" on storage.objects;
drop policy if exists "Authenticated tenant access" on storage.objects;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[]
where id = 'customer-files';

update storage.buckets
set public = false,
    file_size_limit = 15728640,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ]::text[]
where id = 'property-media';

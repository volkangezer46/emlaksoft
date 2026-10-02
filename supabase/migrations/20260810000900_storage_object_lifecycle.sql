-- Durable storage-object lifecycle.
--
-- Relational metadata is the source of truth. Deleting customer_files or
-- property_media now writes a retryable outbox row in the SAME transaction;
-- an asynchronous service-role worker removes the object afterwards. A
-- storage outage can therefore never leave a live DB row pointing at a file
-- that was already destroyed.

alter table public.storage_deletion_outbox
  add column if not exists parent_id uuid;

update public.storage_deletion_outbox
set parent_id = customer_id
where parent_id is null
  and bucket = 'customer-files'
  and customer_id is not null;

comment on column public.storage_deletion_outbox.parent_id is
  'Path owner id (customer, property or profile). Null only for tenant-root objects such as tenant logos.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.storage_deletion_outbox'::regclass
      and conname = 'storage_deletion_outbox_bucket_allowlist_check'
  ) then
    alter table public.storage_deletion_outbox
      add constraint storage_deletion_outbox_bucket_allowlist_check
      check (bucket in ('customer-files', 'property-media', 'agent-photos', 'tenant-logos'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.storage_deletion_outbox'::regclass
      and conname = 'storage_deletion_outbox_parent_required_check'
  ) then
    alter table public.storage_deletion_outbox
      add constraint storage_deletion_outbox_parent_required_check
      check (
        (bucket = 'customer-files' and coalesce(parent_id, customer_id) is not null)
        or (bucket in ('property-media', 'agent-photos') and parent_id is not null)
        or bucket = 'tenant-logos'
      )
      not valid;
  end if;
end;
$$;

create or replace function public.enqueue_deleted_storage_metadata()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket text;
  v_parent_id uuid;
  v_customer_id uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unsupported storage metadata schema.' using errcode = '22023';
  end if;

  if tg_table_name = 'customer_files' then
    v_bucket := 'customer-files';
    v_parent_id := old.customer_id;
    v_customer_id := old.customer_id;
  elsif tg_table_name = 'property_media' then
    if old.storage_path is null then
      return old;
    end if;
    v_bucket := 'property-media';
    v_parent_id := old.property_id;
    v_customer_id := null;
  else
    raise exception 'Unsupported storage metadata table: %', tg_table_name using errcode = '22023';
  end if;

  if nullif(btrim(old.storage_path), '') is null
     or position('..' in old.storage_path) > 0
     or position(E'\\' in old.storage_path) > 0
     or old.storage_path !~ (
       '^' || old.tenant_id::text || '/' || v_parent_id::text ||
       '/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$'
     ) then
    raise exception 'Unsafe storage metadata path for %.%', tg_table_name, old.id
      using errcode = '22023';
  end if;

  insert into public.storage_deletion_outbox (
    tenant_id,
    customer_id,
    parent_id,
    bucket,
    object_path,
    source_table,
    source_id,
    reason
  ) values (
    old.tenant_id,
    v_customer_id,
    v_parent_id,
    v_bucket,
    old.storage_path,
    tg_table_name,
    old.id,
    'metadata_deleted'
  )
  on conflict (bucket, object_path) do update
  set
    tenant_id = excluded.tenant_id,
    customer_id = excluded.customer_id,
    parent_id = excluded.parent_id,
    source_table = excluded.source_table,
    source_id = excluded.source_id,
    status = case
      when storage_deletion_outbox.status in ('completed', 'failed') then 'pending'
      else storage_deletion_outbox.status
    end,
    attempt_count = case
      when storage_deletion_outbox.status in ('completed', 'failed') then 0
      else storage_deletion_outbox.attempt_count
    end,
    next_attempt_at = case
      when storage_deletion_outbox.status in ('completed', 'failed') then now()
      else least(storage_deletion_outbox.next_attempt_at, now())
    end,
    last_error = case
      when storage_deletion_outbox.status in ('completed', 'failed') then null
      else storage_deletion_outbox.last_error
    end,
    completed_at = case
      when storage_deletion_outbox.status in ('completed', 'failed') then null
      else storage_deletion_outbox.completed_at
    end,
    updated_at = now();

  return old;
end;
$$;

revoke all privileges on function public.enqueue_deleted_storage_metadata()
  from public, anon, authenticated, service_role;

drop trigger if exists customer_files_enqueue_storage_deletion on public.customer_files;
create trigger customer_files_enqueue_storage_deletion
after delete on public.customer_files
for each row execute function public.enqueue_deleted_storage_metadata();

drop trigger if exists property_media_enqueue_storage_deletion on public.property_media;
create trigger property_media_enqueue_storage_deletion
after delete on public.property_media
for each row execute function public.enqueue_deleted_storage_metadata();

comment on function public.enqueue_deleted_storage_metadata() is
  'Atomically records customer/property object deletion after authorized metadata deletion; storage is removed asynchronously.';

-- Direct PostgREST callers must not forge upload attribution. Server actions
-- already derive uploaded_by from the authenticated gate; RLS now enforces the
-- same invariant at the database boundary.
drop policy if exists identity_customer_files_insert on public.customer_files;
create policy identity_customer_files_insert on public.customer_files
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
  and uploaded_by = (select auth.uid())
);

drop policy if exists identity_property_media_insert on public.property_media;
create policy identity_property_media_insert on public.property_media
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
  and uploaded_by = (select auth.uid())
);

-- The historical constraint names used "verified", but these checks only
-- enforce canonical metadata. They are not malware/AV verdicts.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_files'::regclass
      and conname = 'customer_files_verified_metadata_check'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_files'::regclass
      and conname = 'customer_files_signature_mime_metadata_check'
  ) then
    alter table public.customer_files
      rename constraint customer_files_verified_metadata_check
      to customer_files_signature_mime_metadata_check;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass
      and conname = 'property_media_verified_metadata_check'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass
      and conname = 'property_media_signature_mime_metadata_check'
  ) then
    alter table public.property_media
      rename constraint property_media_verified_metadata_check
      to property_media_signature_mime_metadata_check;
  end if;
end;
$$;

comment on constraint customer_files_signature_mime_metadata_check on public.customer_files is
  'Canonical size/MIME/name/path metadata only; does not assert malware cleanliness.';
comment on constraint property_media_signature_mime_metadata_check on public.property_media is
  'Canonical image signature/MIME metadata only; does not assert malware cleanliness.';

-- Ticket attachment validation likewise checks signature, MIME and SHA-256;
-- no malware engine is configured. Keep the legacy column for compatibility,
-- but make its value and documentation honest.
alter table public.support_ticket_attachments
  drop constraint if exists support_ticket_attachments_scan_status_check,
  drop constraint if exists support_ticket_attachment_scan_check;

drop index if exists public.idx_ticket_attachments_tenant_sha;

update public.support_ticket_attachments
set scan_status = 'signature_verified'
where scan_status = 'verified';

alter table public.support_ticket_attachments
  alter column scan_status set default 'signature_verified',
  add constraint support_ticket_attachments_scan_status_check
    check (scan_status in ('signature_verified', 'blocked')),
  add constraint support_ticket_attachment_validation_check check (
    (scan_status = 'signature_verified' and blocked_reason is null)
    or (scan_status = 'blocked' and nullif(btrim(blocked_reason), '') is not null)
  );

create index idx_ticket_attachments_tenant_sha
  on public.support_ticket_attachments(tenant_id, sha256)
  where deleted_at is null and scan_status = 'signature_verified';

comment on column public.support_ticket_attachments.scan_status is
  'signature_verified means signature/MIME/structure/SHA-256 validation only; it is not a malware-clean verdict.';

notify pgrst, 'reload schema';

-- Signed direct-to-Storage upload sessions for customer documents and
-- property images. The browser may only receive a server-generated bucket,
-- path and write token. Relational metadata is created by a service-role RPC
-- after bounded server-side signature/MIME verification.

create table public.direct_file_uploads (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('customer_file', 'property_media')),
  customer_id uuid,
  property_id uuid,
  requested_by uuid not null,
  bucket text not null,
  storage_path text not null unique,
  file_name text not null,
  file_size bigint not null,
  claimed_mime text not null,
  canonical_extension text not null,
  label text,
  has_watermark boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'finalizing', 'finalized', 'blocked', 'expired', 'cleanup_queued')),
  lease_id uuid,
  lease_expires_at timestamptz,
  finalize_attempt_count integer not null default 0
    check (finalize_attempt_count between 0 and 100),
  finalize_expires_at timestamptz not null,
  signed_token_expires_at timestamptz not null,
  cleanup_after timestamptz not null,
  blocked_reason text,
  finalized_at timestamptz,
  cleanup_queued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_file_uploads_customer_tenant_fkey
    foreign key (customer_id, tenant_id)
    references public.customers(id, tenant_id)
    on delete cascade,
  constraint direct_file_uploads_property_tenant_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id)
    on delete cascade,
  constraint direct_file_uploads_requester_tenant_fkey
    foreign key (requested_by, tenant_id)
    references public.profiles(id, tenant_id)
    on delete cascade,
  constraint direct_file_uploads_parent_kind_check check (
    (
      kind = 'customer_file'
      and customer_id is not null
      and property_id is null
      and bucket = 'customer-files'
      and has_watermark = false
      and file_size between 1 and 10485760
      and claimed_mime in (
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
    ) or (
      kind = 'property_media'
      and property_id is not null
      and customer_id is null
      and bucket = 'property-media'
      and label is null
      and file_size between 1 and 15728640
      and claimed_mime in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
    )
  ),
  constraint direct_file_uploads_extension_mime_check check (
    (canonical_extension = 'jpg' and claimed_mime = 'image/jpeg')
    or (canonical_extension = 'png' and claimed_mime = 'image/png')
    or (canonical_extension = 'gif' and claimed_mime = 'image/gif')
    or (canonical_extension = 'webp' and claimed_mime = 'image/webp')
    or (canonical_extension = 'pdf' and claimed_mime = 'application/pdf')
    or (canonical_extension = 'doc' and claimed_mime = 'application/msword')
    or (
      canonical_extension = 'docx'
      and claimed_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    or (canonical_extension = 'xls' and claimed_mime = 'application/vnd.ms-excel')
    or (
      canonical_extension = 'xlsx'
      and claimed_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  ),
  constraint direct_file_uploads_metadata_check check (
    char_length(file_name) between 1 and 160
    and file_name !~ '[[:cntrl:]/\\]'
    and lower(file_name) like ('%.' || canonical_extension)
    and (label is null or (char_length(label) between 1 and 200 and label !~ '[[:cntrl:]]'))
    and storage_path = (
      tenant_id::text || '/' || coalesce(customer_id, property_id)::text || '/' ||
      id::text || '.' || canonical_extension
    )
  ),
  constraint direct_file_uploads_lease_check check (
    (status = 'finalizing' and lease_id is not null and lease_expires_at is not null)
    or (status <> 'finalizing' and lease_id is null and lease_expires_at is null)
  ),
  constraint direct_file_uploads_time_check check (
    finalize_expires_at > created_at
    and signed_token_expires_at > finalize_expires_at
    and cleanup_after > signed_token_expires_at
  )
);

create index direct_file_uploads_cleanup_queue_idx
  on public.direct_file_uploads(cleanup_after, created_at)
  where status in ('pending', 'finalizing', 'blocked', 'expired', 'cleanup_queued');

create index direct_file_uploads_requester_idx
  on public.direct_file_uploads(requested_by, created_at desc);

alter table public.direct_file_uploads enable row level security;
revoke all privileges on table public.direct_file_uploads
  from public, anon, authenticated;
grant select, insert, update, delete on table public.direct_file_uploads
  to service_role;

comment on table public.direct_file_uploads is
  'Service-role-only signed upload envelopes. A finalized row means signature/MIME validation, not malware cleanliness.';
comment on column public.direct_file_uploads.finalize_expires_at is
  'Short application authorization window. It is intentionally shorter than the Storage provider token lifetime.';
comment on column public.direct_file_uploads.signed_token_expires_at is
  'Supabase signed upload tokens are provider-controlled and currently valid for two hours.';
comment on column public.direct_file_uploads.cleanup_after is
  'Earliest safe cleanup time, including a buffer after the provider token can no longer write.';

-- Atomically owns a pending/stale upload for finalization. Context fields are
-- repeated here so a privileged caller cannot accidentally cross tenant or
-- parent boundaries while handling a browser-provided session id.
create or replace function public.claim_direct_file_upload(
  p_session_id uuid,
  p_kind text,
  p_tenant_id uuid,
  p_parent_id uuid,
  p_requested_by uuid,
  p_lease_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.direct_file_uploads%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_lease_id is null then
    raise exception 'Lease id is required.' using errcode = '22023';
  end if;

  select * into v_session
  from public.direct_file_uploads u
  where u.id = p_session_id
    and u.kind = p_kind
    and u.tenant_id = p_tenant_id
    and u.requested_by = p_requested_by
    and (
      (p_kind = 'customer_file' and u.customer_id = p_parent_id)
      or (p_kind = 'property_media' and u.property_id = p_parent_id)
    )
  for update;

  if not found then
    return null;
  end if;

  if v_session.status = 'pending'
     or (
       v_session.status = 'finalizing'
       and coalesce(v_session.lease_expires_at, '-infinity'::timestamptz) <= now()
     ) then
    if v_session.finalize_expires_at <= now() then
      update public.direct_file_uploads
      set status = 'expired',
          lease_id = null,
          lease_expires_at = null,
          blocked_reason = 'finalize_window_expired',
          updated_at = now()
      where id = v_session.id
      returning * into v_session;
    else
      update public.direct_file_uploads
      set status = 'finalizing',
          lease_id = p_lease_id,
          lease_expires_at = now() + interval '2 minutes',
          finalize_attempt_count = finalize_attempt_count + 1,
          blocked_reason = null,
          updated_at = now()
      where id = v_session.id
      returning * into v_session;
    end if;
  end if;

  return to_jsonb(v_session);
end;
$$;

revoke all privileges on function public.claim_direct_file_upload(
  uuid, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_direct_file_upload(
  uuid, text, uuid, uuid, uuid, uuid
) to service_role;

-- Metadata insertion and envelope finalization are one database transaction.
-- The caller supplies only the MIME/size result of bounded byte validation;
-- bucket, path, filename, owner and attribution always come from the envelope.
create or replace function public.finalize_direct_file_upload(
  p_session_id uuid,
  p_kind text,
  p_tenant_id uuid,
  p_parent_id uuid,
  p_requested_by uuid,
  p_lease_id uuid,
  p_detected_mime text,
  p_detected_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.direct_file_uploads%rowtype;
  v_sort_order integer;
  v_is_cover boolean;
  v_created boolean := false;
  v_matches boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select * into v_session
  from public.direct_file_uploads u
  where u.id = p_session_id
    and u.kind = p_kind
    and u.tenant_id = p_tenant_id
    and u.requested_by = p_requested_by
    and (
      (p_kind = 'customer_file' and u.customer_id = p_parent_id)
      or (p_kind = 'property_media' and u.property_id = p_parent_id)
    )
  for update;

  if not found then
    raise exception 'Upload session not found.' using errcode = 'P0002';
  end if;

  if v_session.status = 'finalized' then
    if v_session.kind = 'customer_file' then
      select exists(
        select 1 from public.customer_files f
        where f.id = v_session.id
          and f.tenant_id = v_session.tenant_id
          and f.customer_id = v_session.customer_id
          and f.storage_path = v_session.storage_path
      ) into v_matches;
    else
      select exists(
        select 1 from public.property_media m
        where m.id = v_session.id
          and m.tenant_id = v_session.tenant_id
          and m.property_id = v_session.property_id
          and m.storage_path = v_session.storage_path
      ) into v_matches;
    end if;
    if not v_matches then
      raise exception 'Finalized upload metadata is missing.' using errcode = 'P0002';
    end if;
    return jsonb_build_object('id', v_session.id, 'created', false, 'status', 'finalized');
  end if;

  if v_session.status <> 'finalizing'
     or v_session.lease_id is distinct from p_lease_id
     or v_session.lease_expires_at <= now() then
    raise exception 'Upload finalization lease is not active.' using errcode = '55000';
  end if;
  if p_detected_mime is distinct from v_session.claimed_mime
     or p_detected_size is distinct from v_session.file_size then
    raise exception 'Verified object metadata does not match the upload envelope.' using errcode = '22023';
  end if;

  if v_session.kind = 'customer_file' then
    perform 1 from public.customers c
    where c.id = v_session.customer_id and c.tenant_id = v_session.tenant_id
    for update;
    if not found then
      raise exception 'Customer no longer exists.' using errcode = '23503';
    end if;

    insert into public.customer_files (
      id, tenant_id, customer_id, file_name, file_size, file_type,
      storage_path, label, uploaded_by
    ) values (
      v_session.id, v_session.tenant_id, v_session.customer_id,
      v_session.file_name, p_detected_size, p_detected_mime,
      v_session.storage_path, v_session.label, v_session.requested_by
    )
    on conflict (id) do nothing;
    get diagnostics v_sort_order = row_count;
    v_created := v_sort_order = 1;

    select exists(
      select 1 from public.customer_files f
      where f.id = v_session.id
        and f.tenant_id = v_session.tenant_id
        and f.customer_id = v_session.customer_id
        and f.storage_path = v_session.storage_path
        and f.file_size = p_detected_size
        and f.file_type = p_detected_mime
        and f.uploaded_by = v_session.requested_by
    ) into v_matches;
  else
    perform 1 from public.properties p
    where p.id = v_session.property_id and p.tenant_id = v_session.tenant_id
    for update;
    if not found then
      raise exception 'Property no longer exists.' using errcode = '23503';
    end if;

    select count(*)::integer into v_sort_order
    from public.property_media m
    where m.tenant_id = v_session.tenant_id
      and m.property_id = v_session.property_id;
    select not exists(
      select 1 from public.property_media m
      where m.tenant_id = v_session.tenant_id
        and m.property_id = v_session.property_id
        and m.kind = 'image'
    ) into v_is_cover;

    insert into public.property_media (
      id, tenant_id, property_id, kind, storage_path, file_name, file_type,
      file_size, is_cover, sort_order, has_watermark, uploaded_by
    ) values (
      v_session.id, v_session.tenant_id, v_session.property_id, 'image',
      v_session.storage_path, v_session.file_name, p_detected_mime,
      p_detected_size, v_is_cover, v_sort_order, v_session.has_watermark,
      v_session.requested_by
    )
    on conflict (id) do nothing;
    get diagnostics v_sort_order = row_count;
    v_created := v_sort_order = 1;

    select exists(
      select 1 from public.property_media m
      where m.id = v_session.id
        and m.tenant_id = v_session.tenant_id
        and m.property_id = v_session.property_id
        and m.kind = 'image'
        and m.storage_path = v_session.storage_path
        and m.file_size = p_detected_size
        and m.file_type = p_detected_mime
        and m.uploaded_by = v_session.requested_by
    ) into v_matches;
  end if;

  if not v_matches then
    raise exception 'Upload metadata id belongs to another object.' using errcode = '23505';
  end if;

  update public.direct_file_uploads
  set status = 'finalized',
      lease_id = null,
      lease_expires_at = null,
      blocked_reason = null,
      finalized_at = now(),
      updated_at = now()
  where id = v_session.id;

  return jsonb_build_object('id', v_session.id, 'created', v_created, 'status', 'finalized');
end;
$$;

revoke all privileges on function public.finalize_direct_file_upload(
  uuid, text, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_direct_file_upload(
  uuid, text, uuid, uuid, uuid, uuid, text, bigint
) to service_role;

-- Parent cascades must not lose a pending object's cleanup envelope. The
-- outbox job is delayed until the provider token has certainly expired.
create or replace function public.enqueue_deleted_direct_file_upload()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('finalized', 'cleanup_queued') then
    return old;
  end if;

  insert into public.storage_deletion_outbox (
    tenant_id,
    customer_id,
    parent_id,
    bucket,
    object_path,
    source_table,
    source_id,
    reason,
    next_attempt_at
  ) values (
    old.tenant_id,
    old.customer_id,
    coalesce(old.customer_id, old.property_id),
    old.bucket,
    old.storage_path,
    'direct_file_uploads',
    old.id,
    'upload_session_parent_deleted',
    greatest(old.cleanup_after, now())
  )
  on conflict (bucket, object_path) do update
  set next_attempt_at = greatest(excluded.next_attempt_at, now()),
      status = case
        when storage_deletion_outbox.status in ('completed', 'failed') then 'pending'
        else storage_deletion_outbox.status
      end,
      updated_at = now();

  return old;
end;
$$;

revoke all privileges on function public.enqueue_deleted_direct_file_upload()
  from public, anon, authenticated, service_role;

create trigger direct_file_uploads_enqueue_storage_deletion
after delete on public.direct_file_uploads
for each row execute function public.enqueue_deleted_direct_file_upload();

notify pgrst, 'reload schema';

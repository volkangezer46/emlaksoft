-- Destek talebi ekleri: private bucket, doğrulanmış metadata ve fail-closed RLS.
-- Dosya baytlarına doğrudan Storage URL'siyle erişilmez; uygulamadaki yetkili
-- Route Handler her indirmede ticket + actor yetkisini yeniden doğrular.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'text/csv'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Vercel Function payload limiti 10 MB dosyayı uygulama sunucusundan geçirmeye
-- izin vermez. Sunucu kısa ömürlü, yalnız upload yetkili token üretir; nesne
-- finalize edilene kadar bu service-role-only oturum tablosunda bekler. Okuma için
-- signed URL hiçbir zaman üretilmez.
create table if not exists public.support_ticket_attachment_uploads (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_ticket_messages(id) on delete set null,
  -- Kullanıcı pending upload sırasında silinse bile envelope kalır; cleanup
  -- private nesneyi path üzerinden temizleyebilir. Null requester finalize olamaz.
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_kind text not null check (requested_by_kind in ('tenant', 'staff')),
  visibility text not null check (visibility in ('public', 'internal')),
  file_name text not null,
  claimed_mime text not null check (
    claimed_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv')
  ),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'finalizing', 'finalized', 'blocked', 'expired')),
  blocked_reason text,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint support_ticket_attachment_upload_name_check check (
    char_length(file_name) between 1 and 180
    and position('/' in file_name) = 0
    and position(E'\\' in file_name) = 0
  ),
  constraint support_ticket_attachment_upload_path_check check (
    storage_path = lower(storage_path)
    and position('..' in storage_path) = 0
    and split_part(storage_path, '/', 1) = tenant_id::text
    and split_part(storage_path, '/', 2) = ticket_id::text
    and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|txt|csv)$'
  )
);

create index if not exists idx_ticket_attachment_uploads_expiry
  on public.support_ticket_attachment_uploads(expires_at)
  where status = 'pending';

alter table public.support_ticket_attachment_uploads enable row level security;

drop policy if exists support_ticket_attachment_uploads_deny on public.support_ticket_attachment_uploads;
create policy support_ticket_attachment_uploads_deny
on public.support_ticket_attachment_uploads for all to authenticated
using (false) with check (false);

revoke all privileges on public.support_ticket_attachment_uploads from public, anon, authenticated;
grant all on public.support_ticket_attachment_uploads to service_role;

create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_ticket_messages(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_kind text not null check (uploaded_by_kind in ('tenant', 'staff', 'system')),
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv')
  ),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null default 'verified' check (scan_status in ('verified', 'blocked')),
  blocked_reason text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_by_kind text check (deleted_by_kind in ('tenant', 'staff', 'system')),
  constraint support_ticket_attachment_file_name_check check (
    char_length(file_name) between 1 and 180
    and position('/' in file_name) = 0
    and position(E'\\' in file_name) = 0
  ),
  constraint support_ticket_attachment_path_check check (
    storage_path = lower(storage_path)
    and position('..' in storage_path) = 0
    and split_part(storage_path, '/', 1) = tenant_id::text
    and split_part(storage_path, '/', 2) = ticket_id::text
    and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|txt|csv)$'
  ),
  constraint support_ticket_attachment_scan_check check (
    (scan_status = 'verified' and blocked_reason is null)
    or (scan_status = 'blocked' and nullif(btrim(blocked_reason), '') is not null)
  )
);

create index if not exists idx_ticket_attachments_ticket_created
  on public.support_ticket_attachments(ticket_id, created_at)
  where deleted_at is null;

create index if not exists idx_ticket_attachments_message
  on public.support_ticket_attachments(message_id, created_at)
  where message_id is not null and deleted_at is null;

create index if not exists idx_ticket_attachments_tenant_sha
  on public.support_ticket_attachments(tenant_id, sha256)
  where deleted_at is null and scan_status = 'verified';

create or replace function public.validate_support_ticket_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_tenant uuid;
  v_message_ticket uuid;
  v_message_visibility text;
  v_message_author uuid;
  v_message_author_kind text;
begin
  select tenant_id into v_ticket_tenant
    from public.support_tickets
   where id = new.ticket_id;

  if v_ticket_tenant is null or v_ticket_tenant <> new.tenant_id then
    raise exception 'Attachment ticket tenant mismatch.' using errcode = '23514';
  end if;

  if new.message_id is not null then
    select ticket_id, visibility, author_user_id, author_kind
      into v_message_ticket, v_message_visibility, v_message_author, v_message_author_kind
      from public.support_ticket_messages
     where id = new.message_id;

    if v_message_ticket is null or v_message_ticket <> new.ticket_id then
      raise exception 'Attachment message ticket mismatch.' using errcode = '23514';
    end if;
    if v_message_visibility <> new.visibility then
      raise exception 'Attachment visibility must match its message.' using errcode = '23514';
    end if;
    if new.uploaded_by is distinct from v_message_author
      or new.uploaded_by_kind is distinct from v_message_author_kind then
      raise exception 'Attachment uploader must match its message author.' using errcode = '23514';
    end if;
  end if;

  if new.uploaded_by_kind = 'tenant' and new.visibility <> 'public' then
    raise exception 'Tenant attachments cannot be internal.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists support_ticket_attachment_validate on public.support_ticket_attachments;
create trigger support_ticket_attachment_validate
before insert or update of tenant_id, ticket_id, message_id, visibility, uploaded_by, uploaded_by_kind
on public.support_ticket_attachments
for each row execute function public.validate_support_ticket_attachment();

-- Ek audit'i metadata ile aynı transaction'da kalır. Gövde/bayt veya storage
-- URL'si audit JSON'una yazılmaz.
create or replace function public.audit_support_ticket_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.support_ticket_events (
      ticket_id, tenant_id, actor_user_id, actor_kind, event_type,
      visibility, old_value, new_value
    ) values (
      new.ticket_id,
      new.tenant_id,
      new.uploaded_by,
      new.uploaded_by_kind,
      'attachment.uploaded',
      new.visibility,
      null,
      jsonb_build_object(
        'attachment_id', new.id,
        'mime_type', new.mime_type,
        'file_size', new.file_size
      )
    );
  elsif old.deleted_at is null and new.deleted_at is not null then
    insert into public.support_ticket_events (
      ticket_id, tenant_id, actor_user_id, actor_kind, event_type,
      visibility, old_value, new_value
    ) values (
      new.ticket_id,
      new.tenant_id,
      new.deleted_by,
      coalesce(new.deleted_by_kind, 'system'),
      'attachment.deleted',
      new.visibility,
      jsonb_build_object(
        'attachment_id', new.id,
        'mime_type', new.mime_type,
        'file_size', new.file_size
      ),
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists support_ticket_attachment_audit on public.support_ticket_attachments;
create trigger support_ticket_attachment_audit
after insert or update of deleted_at
on public.support_ticket_attachments
for each row execute function public.audit_support_ticket_attachment();

alter table public.support_ticket_attachments enable row level security;

drop policy if exists support_ticket_attachments_select on public.support_ticket_attachments;
create policy support_ticket_attachments_select
on public.support_ticket_attachments
for select
using (
  deleted_at is null
  and (
    exists (
      select 1
        from public.platform_staff ps
       where ps.id = auth.uid()
         and ps.is_active = true
         and ps.role in ('super_admin', 'ops', 'support')
    )
    or (
      visibility = 'public'
      and exists (
        select 1
          from public.support_tickets t
         where t.id = ticket_id
           and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)
      )
    )
  )
);

-- Storage ve metadata mutasyonları yalnız uygulama sunucusundaki service role
-- akışından geçer. Doğrudan PostgREST yazmaları açıkça fail-closed.
drop policy if exists support_ticket_attachments_insert_deny on public.support_ticket_attachments;
create policy support_ticket_attachments_insert_deny
on public.support_ticket_attachments for insert to authenticated
with check (false);

drop policy if exists support_ticket_attachments_update_deny on public.support_ticket_attachments;
create policy support_ticket_attachments_update_deny
on public.support_ticket_attachments for update to authenticated
using (false) with check (false);

drop policy if exists support_ticket_attachments_delete_deny on public.support_ticket_attachments;
create policy support_ticket_attachments_delete_deny
on public.support_ticket_attachments for delete to authenticated
using (false);

revoke all privileges on public.support_ticket_attachments from anon, authenticated;
grant select on public.support_ticket_attachments to authenticated;
grant all on public.support_ticket_attachments to service_role;

revoke all privileges on function public.validate_support_ticket_attachment() from public, anon, authenticated;
revoke all privileges on function public.audit_support_ticket_attachment() from public, anon, authenticated;

comment on table public.support_ticket_attachments is
  'Private destek ekleri: doğrulanmış MIME/imza, SHA-256, public/internal görünürlük ve soft-delete metadata.';

-- TicketThread attachment INSERT'lerini dinler. Publication üyeliği
-- migration tekrarında duplicate üretmeyecek şekilde kontrol edilir.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'support_ticket_attachments'
  ) then
    alter publication supabase_realtime add table public.support_ticket_attachments;
  end if;
end $$;

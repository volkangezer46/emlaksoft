-- Gider fişi gerçek dosya yükleme (PB52) — mevcut güvenli doğrudan yükleme hattına yeni tür `expense_receipt`.
--
-- NEDEN: Gider fişi yalnız https BAĞLANTISI olarak saklanabiliyordu (§29 SAHİP KARARI 1). Yükleme hattı
--   (direct_file_uploads + claim/finalize, 20260810000940) imzalı tek-nesne yazma jetonu + bayt imzası doğrulaması
--   + kalıcı silme kuyruğu (storage_deletion_outbox) sağlar; yeni tür aynı güvenceleri devralır.
-- İÇERİK:
--   1) Özel (private) depolama kovası `expense-receipts` (10 MB; JPEG/PNG/WEBP/PDF). Tarayıcı yalnız sunucunun ürettiği
--      tek nesne jetonunu alır; okuma yalnız sunucu indirme ucundan (`/api/expense-receipts/<id>/download`).
--   2) `expense_receipt_files` meta tablosu (gider başına EN ÇOK 1 dosya; tenant_id + RLS: okuma giderler:görüntüle,
--      silme giderler:düzenle; ekleme YALNIZ finalize_direct_file_upload [service_role] içinden).
--      Silinen satırın nesnesi AYNI transaction'da silme kuyruğuna yazılır (tetikleyici); gider silinince cascade.
--   3) direct_file_uploads: `expense_id` sütunu + tür/üst kayıt/yol kısıtları üç türe genişler.
--   4) claim_direct_file_upload / finalize_direct_file_upload / enqueue_deleted_direct_file_upload TAM GÖVDEYLE
--      yeniden yazılır (taban: 20260810000940; önceki iki tür bayt bayt aynı davranır). Yeni fiş eskisinin yerine geçer
--      (eski satır aynı transaction'da silinir → nesnesi kuyruğa).
--   5) storage_deletion_outbox kova izin listesi + üst kayıt kısıtı `expense-receipts`i kapsar.
-- Mevcut `expenses.receipt_url` (https bağlantı) DEĞİŞMEZ; geriye dönük korunur.
-- BAĞIMLILIK: 20260723000031 (expenses), 20260802000147 + 20260810000900 (storage_deletion_outbox),
--   20260810000940 (direct_file_uploads + RPC'ler), 20260802000300 (current_active_tenant_id / has_effective_permission).
-- GERİ ALMA: rollbacks/20261007000700_expense_receipt_uploads.rollback.sql (önceki fonksiyon gövdeleri + kısıtlar geri
--   gelir; fiş meta tablosu düşer; kovadaki nesneler SİLİNMEZ — Supabase depolama tablosu doğrudan silinemez).
-- RİSK: orta (yükleme hattının üç fonksiyonu yeniden yazılır). Ön koşul bloğu taban şemayı doğrular; eksikse yazmadan durur.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.direct_file_uploads') is null
     or pg_catalog.to_regclass('public.storage_deletion_outbox') is null
     or pg_catalog.to_regprocedure('public.claim_direct_file_upload(uuid,text,uuid,uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('public.finalize_direct_file_upload(uuid,text,uuid,uuid,uuid,uuid,text,bigint)') is null
     or pg_catalog.to_regprocedure('public.enqueue_deleted_direct_file_upload()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null then
    raise exception '20261007000700: taban sema eksik (expenses / direct_file_uploads / storage_deletion_outbox / yukleme RPC''leri).';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.direct_file_uploads'::regclass and conname = 'direct_file_uploads_kind_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.direct_file_uploads'::regclass and conname = 'direct_file_uploads_parent_kind_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.direct_file_uploads'::regclass and conname = 'direct_file_uploads_metadata_check'
  ) then
    raise exception '20261007000700: direct_file_uploads kisit adlari beklenenden farkli; yazmadan duruldu.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Özel kova
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'expense-receipts', 'expense-receipts', false, 10485760,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = 10485760,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[];
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Fiş meta tablosu
-- ---------------------------------------------------------------------------
create unique index if not exists idx_expenses_id_tenant_unique
  on public.expenses (id, tenant_id);

create table if not exists public.expense_receipt_files (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  expense_id   uuid not null,
  file_name    text not null,
  file_size    bigint not null check (file_size between 1 and 10485760),
  file_type    text not null check (file_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  storage_path text not null unique,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint expense_receipt_files_expense_fkey
    foreign key (expense_id, tenant_id) references public.expenses (id, tenant_id) on delete cascade,
  constraint expense_receipt_files_one_per_expense unique (expense_id),
  constraint expense_receipt_files_metadata_check check (
    char_length(file_name) between 1 and 160
    and file_name !~ '[[:cntrl:]/\\]'
    and storage_path ~ (
      '^' || tenant_id::text || '/' || expense_id::text || '/' || id::text || '\.(jpg|png|webp|pdf)$'
    )
  )
);

create index if not exists idx_expense_receipt_files_tenant
  on public.expense_receipt_files (tenant_id, created_at desc);

alter table public.expense_receipt_files enable row level security;

drop policy if exists expense_receipt_files_select on public.expense_receipt_files;
create policy expense_receipt_files_select on public.expense_receipt_files
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
  );

drop policy if exists expense_receipt_files_delete on public.expense_receipt_files;
create policy expense_receipt_files_delete on public.expense_receipt_files
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'edit'))
  );

revoke all on table public.expense_receipt_files from public, anon, authenticated;
grant select, delete on table public.expense_receipt_files to authenticated;
grant all on table public.expense_receipt_files to service_role;

comment on table public.expense_receipt_files is
  'Gider fisi dosyasi meta kaydi (gider basina 1). Ekleme yalniz finalize_direct_file_upload (service_role); nesne silme storage_deletion_outbox uzerinden.';

-- ---------------------------------------------------------------------------
-- 5) Silme kuyruğu kova izin listesi + üst kayıt kısıtı
-- ---------------------------------------------------------------------------
alter table public.storage_deletion_outbox
  drop constraint if exists storage_deletion_outbox_bucket_allowlist_check;
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_bucket_allowlist_check
  check (bucket in ('customer-files', 'property-media', 'agent-photos', 'tenant-logos', 'expense-receipts'))
  not valid;
alter table public.storage_deletion_outbox
  validate constraint storage_deletion_outbox_bucket_allowlist_check;

alter table public.storage_deletion_outbox
  drop constraint if exists storage_deletion_outbox_parent_required_check;
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_parent_required_check
  check (
    (bucket = 'customer-files' and coalesce(parent_id, customer_id) is not null)
    or (bucket in ('property-media', 'agent-photos', 'expense-receipts') and parent_id is not null)
    or bucket = 'tenant-logos'
  )
  not valid;
alter table public.storage_deletion_outbox
  validate constraint storage_deletion_outbox_parent_required_check;

-- Fiş meta satırı silinince nesne aynı transaction'da kuyruğa yazılır (gider cascade'i dahil).
create or replace function public.enqueue_deleted_expense_receipt()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(old.storage_path), '') is null
     or position('..' in old.storage_path) > 0
     or position(E'\\' in old.storage_path) > 0
     or old.storage_path !~ (
       '^' || old.tenant_id::text || '/' || old.expense_id::text || '/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$'
     ) then
    raise exception 'Unsafe expense receipt path for %', old.id using errcode = '22023';
  end if;

  insert into public.storage_deletion_outbox (
    tenant_id, customer_id, parent_id, bucket, object_path, source_table, source_id, reason
  ) values (
    old.tenant_id, null, old.expense_id, 'expense-receipts', old.storage_path,
    'expense_receipt_files', old.id, 'metadata_deleted'
  )
  on conflict (bucket, object_path) do update
  set
    tenant_id = excluded.tenant_id,
    parent_id = excluded.parent_id,
    source_table = excluded.source_table,
    source_id = excluded.source_id,
    status = case
      when public.storage_deletion_outbox.status in ('completed', 'failed') then 'pending'
      else public.storage_deletion_outbox.status
    end,
    attempt_count = case
      when public.storage_deletion_outbox.status in ('completed', 'failed') then 0
      else public.storage_deletion_outbox.attempt_count
    end,
    next_attempt_at = case
      when public.storage_deletion_outbox.status in ('completed', 'failed') then now()
      else least(public.storage_deletion_outbox.next_attempt_at, now())
    end,
    last_error = case
      when public.storage_deletion_outbox.status in ('completed', 'failed') then null
      else public.storage_deletion_outbox.last_error
    end,
    completed_at = case
      when public.storage_deletion_outbox.status in ('completed', 'failed') then null
      else public.storage_deletion_outbox.completed_at
    end,
    updated_at = now();

  return old;
end;
$$;

revoke all privileges on function public.enqueue_deleted_expense_receipt()
  from public, anon, authenticated, service_role;

drop trigger if exists expense_receipt_files_enqueue_storage_deletion on public.expense_receipt_files;
create trigger expense_receipt_files_enqueue_storage_deletion
after delete on public.expense_receipt_files
for each row execute function public.enqueue_deleted_expense_receipt();

-- ---------------------------------------------------------------------------
-- 3) direct_file_uploads genişlemesi
-- ---------------------------------------------------------------------------
alter table public.direct_file_uploads
  add column if not exists expense_id uuid;

alter table public.direct_file_uploads
  drop constraint if exists direct_file_uploads_expense_tenant_fkey;
alter table public.direct_file_uploads
  add constraint direct_file_uploads_expense_tenant_fkey
  foreign key (expense_id, tenant_id) references public.expenses (id, tenant_id) on delete cascade;

alter table public.direct_file_uploads drop constraint direct_file_uploads_kind_check;
alter table public.direct_file_uploads
  add constraint direct_file_uploads_kind_check
  check (kind in ('customer_file', 'property_media', 'expense_receipt'));

alter table public.direct_file_uploads drop constraint direct_file_uploads_parent_kind_check;
alter table public.direct_file_uploads
  add constraint direct_file_uploads_parent_kind_check check (
    (
      kind = 'customer_file'
      and customer_id is not null
      and property_id is null
      and expense_id is null
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
      and expense_id is null
      and bucket = 'property-media'
      and label is null
      and file_size between 1 and 15728640
      and claimed_mime in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
    ) or (
      kind = 'expense_receipt'
      and expense_id is not null
      and customer_id is null
      and property_id is null
      and bucket = 'expense-receipts'
      and label is null
      and has_watermark = false
      and file_size between 1 and 10485760
      and claimed_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    )
  );

alter table public.direct_file_uploads drop constraint direct_file_uploads_metadata_check;
alter table public.direct_file_uploads
  add constraint direct_file_uploads_metadata_check check (
    char_length(file_name) between 1 and 160
    and file_name !~ '[[:cntrl:]/\\]'
    and lower(file_name) like ('%.' || canonical_extension)
    and (label is null or (char_length(label) between 1 and 200 and label !~ '[[:cntrl:]]'))
    and storage_path = (
      tenant_id::text || '/' || coalesce(customer_id, property_id, expense_id)::text || '/' ||
      id::text || '.' || canonical_extension
    )
  );

-- ---------------------------------------------------------------------------
-- 4) RPC'ler (TAM GÖVDE; taban 20260810000940)
-- ---------------------------------------------------------------------------
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
      or (p_kind = 'expense_receipt' and u.expense_id = p_parent_id)
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
      or (p_kind = 'expense_receipt' and u.expense_id = p_parent_id)
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
    elsif v_session.kind = 'expense_receipt' then
      select exists(
        select 1 from public.expense_receipt_files r
        where r.id = v_session.id
          and r.tenant_id = v_session.tenant_id
          and r.expense_id = v_session.expense_id
          and r.storage_path = v_session.storage_path
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
  elsif v_session.kind = 'expense_receipt' then
    perform 1 from public.expenses e
    where e.id = v_session.expense_id and e.tenant_id = v_session.tenant_id
    for update;
    if not found then
      raise exception 'Expense no longer exists.' using errcode = '23503';
    end if;

    -- Gider başına tek fiş: önceki fiş satırı silinir (tetikleyici nesnesini silme kuyruğuna yazar).
    delete from public.expense_receipt_files r
    where r.tenant_id = v_session.tenant_id
      and r.expense_id = v_session.expense_id
      and r.id <> v_session.id;

    insert into public.expense_receipt_files (
      id, tenant_id, expense_id, file_name, file_size, file_type,
      storage_path, uploaded_by
    ) values (
      v_session.id, v_session.tenant_id, v_session.expense_id,
      v_session.file_name, p_detected_size, p_detected_mime,
      v_session.storage_path, v_session.requested_by
    )
    on conflict (id) do nothing;
    get diagnostics v_sort_order = row_count;
    v_created := v_sort_order = 1;

    select exists(
      select 1 from public.expense_receipt_files r
      where r.id = v_session.id
        and r.tenant_id = v_session.tenant_id
        and r.expense_id = v_session.expense_id
        and r.storage_path = v_session.storage_path
        and r.file_size = p_detected_size
        and r.file_type = p_detected_mime
        and r.uploaded_by = v_session.requested_by
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
    coalesce(old.customer_id, old.property_id, old.expense_id),
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

notify pgrst, 'reload schema';

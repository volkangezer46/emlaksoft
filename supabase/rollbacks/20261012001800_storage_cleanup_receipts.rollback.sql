-- Rollback: 20261012001800_storage_cleanup_receipts
-- Tetikleyici/fonksiyon/indeks düşer; kova izin listesi 5 kovaya döner. Kuyrukta bekleyen rent-receipts işleri
-- izin listesine sığmadığı için SİLİNİR (nesneler kovada kalır; gerekirse panelden temizlenir).
set local lock_timeout = '5s';

drop trigger if exists rent_payment_notices_enqueue_receipt_deletion on public.rent_payment_notices;
drop function if exists public.enqueue_orphaned_rent_receipt();
drop index if exists public.idx_rent_notices_receipt_stale;

delete from public.storage_deletion_outbox where bucket = 'rent-receipts';

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

notify pgrst, 'reload schema';

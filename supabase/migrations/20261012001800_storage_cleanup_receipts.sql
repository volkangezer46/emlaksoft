-- Kiracı dekontu (rent-receipts) için kalıcı depo temizliği.
-- BAĞIMLILIK: 20261012000900_rent_notice_receipt.sql (rent_payment_notices.receipt_* + kova),
--             20260810000900 + 20261007000700 (storage_deletion_outbox ve kova izin listesi).
-- Sorun: dekontlu bildirim silinince (cascade dahil) ya da dekont yolu değişince (yeniden prepare / süresi dolan
-- yükleme temizliği) depo nesnesi sahipsiz kalıyordu. Çözüm: bildirim satırındaki receipt_path silindiğinde veya
-- başka değere/boşa çevrildiğinde eski nesne AYNI işlemde storage_deletion_outbox'a düşer (tetikleyici).
-- Kuyruk işçisi nesneyi silmeden önce bildirimde hâlâ aynı yola işaret eden satır var mı bakar (kodda).
-- Mevcut tablo/fonksiyon gövdeleri DEĞİŞMEZ; yalnız kova izin listesi genişler + yeni tetikleyici eklenir.

do $$
begin
  if pg_catalog.to_regclass('public.rent_payment_notices') is null
     or pg_catalog.to_regclass('public.storage_deletion_outbox') is null then
    raise exception '20261012001800: taban sema eksik (rent_payment_notices / storage_deletion_outbox).';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rent_payment_notices' and column_name = 'receipt_path'
  ) then
    raise exception '20261012001800: rent_payment_notices.receipt_path yok (20261012000900 uygulanmali).';
  end if;
end $$;

alter table public.storage_deletion_outbox
  drop constraint if exists storage_deletion_outbox_bucket_allowlist_check;
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_bucket_allowlist_check
  check (bucket in ('customer-files', 'property-media', 'agent-photos', 'tenant-logos', 'expense-receipts', 'rent-receipts'))
  not valid;
alter table public.storage_deletion_outbox
  validate constraint storage_deletion_outbox_bucket_allowlist_check;

alter table public.storage_deletion_outbox
  drop constraint if exists storage_deletion_outbox_parent_required_check;
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_parent_required_check
  check (
    (bucket = 'customer-files' and coalesce(parent_id, customer_id) is not null)
    or (bucket in ('property-media', 'agent-photos', 'expense-receipts', 'rent-receipts') and parent_id is not null)
    or bucket = 'tenant-logos'
  )
  not valid;
alter table public.storage_deletion_outbox
  validate constraint storage_deletion_outbox_parent_required_check;

create or replace function public.enqueue_orphaned_rent_receipt()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text := old.receipt_path;
begin
  if v_path is null then
    return coalesce(new, old);
  end if;
  -- UPDATE: yol değişmediyse (ör. durum geçişi) hiçbir şey yapma.
  if tg_op = 'UPDATE' and new.receipt_path is not distinct from old.receipt_path then
    return new;
  end if;
  -- Yalnız beklenen biçim kuyruğa girer; biçim dışı değer silme işini asla engellemez.
  if v_path !~ ('^' || old.tenant_id::text || '/' || old.customer_id::text || '/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$') then
    return coalesce(new, old);
  end if;

  insert into public.storage_deletion_outbox (
    tenant_id, customer_id, parent_id, bucket, object_path,
    source_table, source_id, reason, next_attempt_at
  ) values (
    old.tenant_id, null, old.customer_id, 'rent-receipts', v_path,
    'rent_payment_notices', old.id,
    case when tg_op = 'DELETE' then 'rent_notice_deleted' else 'rent_receipt_replaced_or_expired' end,
    -- İmzalı yükleme belirteci 2 saat geçerli: geç gelen yüklemeyi de yakalamak için bekle.
    now() + interval '2 hours'
  )
  on conflict (bucket, object_path) do update
  set next_attempt_at = greatest(excluded.next_attempt_at, now()),
      status = case
        when public.storage_deletion_outbox.status in ('completed', 'failed') then 'pending'
        else public.storage_deletion_outbox.status
      end,
      attempt_count = case
        when public.storage_deletion_outbox.status in ('completed', 'failed') then 0
        else public.storage_deletion_outbox.attempt_count
      end,
      completed_at = case
        when public.storage_deletion_outbox.status in ('completed', 'failed') then null
        else public.storage_deletion_outbox.completed_at
      end,
      updated_at = now();

  return coalesce(new, old);
end;
$$;

revoke all privileges on function public.enqueue_orphaned_rent_receipt()
  from public, anon, authenticated, service_role;

drop trigger if exists rent_payment_notices_enqueue_receipt_deletion on public.rent_payment_notices;
create trigger rent_payment_notices_enqueue_receipt_deletion
  after delete or update of receipt_path on public.rent_payment_notices
  for each row execute function public.enqueue_orphaned_rent_receipt();

-- Süresi dolan yarım yüklemeleri tarayan temizlik sorgusu için kısmi indeks.
create index if not exists idx_rent_notices_receipt_stale
  on public.rent_payment_notices (receipt_prepared_at)
  where receipt_status in ('pending', 'blocked');

notify pgrst, 'reload schema';

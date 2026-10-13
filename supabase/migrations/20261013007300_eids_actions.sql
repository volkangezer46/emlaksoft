-- 20261013007300 — EİDS aksiyon motoru (EP4): yetki olayından görev, kaldırma kontrol listesi, yükseltme.
--
-- Kapsam (forward-only; mevcut veriye DOKUNMAZ, yalnız genişletir/ekler):
--   A. tasks.kind CHECK'i 'eids_publish' (yetki geldi, ilanı hazırla/yayınla) ve 'eids_takedown' (iptal/süre bitti,
--      3 günde kaldır) ile genişler; tasks.priority CHECK'ine 'urgent' eklenir.
--   B. tasks.dedupe_key (+ kısmi tekil indeks): aynı olay için ikinci görev açılmaz (idempotent üretim).
--      tasks.escalated_at: 48 saatte kapanmayan kaldırma görevinin ofis sahibine yükseltildiği an (tek kez).
--   C. public.eids_takedown_items: kaldırma görevinin kontrol listesi (portal kaydı / vitrin / paylaşım / sosyal).
--      Okuma ve işaretleme ofis içi görev yetkisiyle (RLS); kalem ekleme/silme yalnız sunucu (service_role).
--   D. Tetik: eids_takedown görevi bekleyen kalem varken 'done' yapılamaz (iptal edilebilir).
--   E. Tetik: listing-control sağlık kaydı 'confirmed_missing' olunca ilgili bekleyen kalem kendiliğinden
--      "kaldırıldı (eklenti)" işaretlenir.
--   F. properties.authority_reminder_channel CHECK'ine 'email' eklenir.
--
-- Kod sütun/tablo yokken eski davranışa düşer (görev üretimi "kurulum bekliyor" der, ekranlar kartı çizmez).
-- Geri alma: supabase/rollbacks/20261013007300_eids_actions.rollback.sql

-- ---------------------------------------------------------------------------
-- A. tasks: tür ve öncelik genişlemesi
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks
  add constraint tasks_kind_check
  check (kind = any (array['followup', 'call', 'visit', 'document', 'other', 'eids_publish', 'eids_takedown']));

alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks
  add constraint tasks_priority_check
  check (priority = any (array['low', 'normal', 'high', 'urgent']));

-- ---------------------------------------------------------------------------
-- B. tasks: idempotent üretim anahtarı + yükseltme izi
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists dedupe_key text,
  add column if not exists escalated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tasks_dedupe_key_len_check') then
    alter table public.tasks
      add constraint tasks_dedupe_key_len_check
      check (dedupe_key is null or char_length(dedupe_key) between 1 and 200);
  end if;
end
$$;

create unique index if not exists tasks_tenant_dedupe_key_uidx
  on public.tasks (tenant_id, dedupe_key)
  where dedupe_key is not null;

-- Yükseltme taraması: açık, henüz yükseltilmemiş kaldırma görevleri.
create index if not exists idx_tasks_eids_takedown_open
  on public.tasks (tenant_id, created_at)
  where kind = 'eids_takedown' and status = 'open';

-- ---------------------------------------------------------------------------
-- C. eids_takedown_items: kaldırma kontrol listesi
-- ---------------------------------------------------------------------------
create table if not exists public.eids_takedown_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  property_id uuid,
  -- Portal anahtarı (sahibinden / hepsiemlak / emlakjet ...) ya da EmlakSoft yüzeyi: vitrin / paylasim / sosyal.
  target text not null check (char_length(target) between 1 and 40),
  portal_listing_id uuid references public.portal_listings(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'removed', 'not_found')),
  verified_by text check (verified_by is null or verified_by in ('extension', 'manual', 'system')),
  evidence_path text check (evidence_path is null or char_length(evidence_path) <= 500),
  -- Geri alınabilir otomatik kapatma için önceki hal (vitrin: önceki portföy durumu; paylaşım: bağlantı bitişleri).
  restore_meta jsonb,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint eids_takedown_items_task_tenant_fkey
    foreign key (task_id, tenant_id) references public.tasks(id, tenant_id) on delete cascade,
  constraint eids_takedown_items_done_check
    check ((status = 'pending') = (done_at is null))
);

create unique index if not exists eids_takedown_items_task_target_uidx
  on public.eids_takedown_items (task_id, target, coalesce(portal_listing_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_eids_takedown_items_tenant_status
  on public.eids_takedown_items (tenant_id, status);
create index if not exists idx_eids_takedown_items_listing
  on public.eids_takedown_items (portal_listing_id)
  where portal_listing_id is not null and status = 'pending';

alter table public.eids_takedown_items enable row level security;

drop policy if exists eids_takedown_items_select on public.eids_takedown_items;
create policy eids_takedown_items_select on public.eids_takedown_items
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'view'))
  );

-- İşaretleme (pending -> removed/not_found) görev düzenleme yetkisiyle; ekleme/silme politikası YOK (yalnız sunucu).
drop policy if exists eids_takedown_items_update on public.eids_takedown_items;
create policy eids_takedown_items_update on public.eids_takedown_items
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'edit'))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'edit'))
  );

revoke all on public.eids_takedown_items from anon;
grant select, update on public.eids_takedown_items to authenticated;
grant all on public.eids_takedown_items to service_role;

-- ---------------------------------------------------------------------------
-- D. Tetik: bekleyen kalem varken kaldırma görevi tamamlanamaz
-- ---------------------------------------------------------------------------
create or replace function public.eids_takedown_guard_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer;
begin
  if new.kind = 'eids_takedown' and new.status = 'done' and old.status is distinct from 'done' then
    select count(*) into v_pending
      from public.eids_takedown_items i
     where i.task_id = new.id and i.tenant_id = new.tenant_id and i.status = 'pending';
    if v_pending > 0 then
      raise exception 'eids_takedown_pending_items: % kalem işaretlenmedi', v_pending
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eids_takedown_guard_complete on public.tasks;
create trigger trg_eids_takedown_guard_complete
  before update of status on public.tasks
  for each row execute function public.eids_takedown_guard_complete();

-- ---------------------------------------------------------------------------
-- E. Tetik: eklenti "kalktı" (confirmed_missing) sonucu kalemi işaretler
-- ---------------------------------------------------------------------------
create or replace function public.eids_takedown_mark_from_health()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.check_state = 'confirmed_missing' and old.check_state is distinct from 'confirmed_missing' then
    update public.eids_takedown_items i
       set status = 'removed', verified_by = 'extension', done_at = now()
     where i.portal_listing_id = new.portal_listing_id
       and i.tenant_id = new.tenant_id
       and i.status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eids_takedown_mark_from_health on public.portal_listing_health;
create trigger trg_eids_takedown_mark_from_health
  after update of check_state on public.portal_listing_health
  for each row execute function public.eids_takedown_mark_from_health();

revoke all on function public.eids_takedown_guard_complete() from public, anon, authenticated;
revoke all on function public.eids_takedown_mark_from_health() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- F. Malik hatırlatma kanalı: e-posta
-- ---------------------------------------------------------------------------
alter table public.properties drop constraint if exists properties_authority_reminder_channel_check;
alter table public.properties
  add constraint properties_authority_reminder_channel_check
  check (authority_reminder_channel is null or authority_reminder_channel in ('sms', 'whatsapp', 'email'));

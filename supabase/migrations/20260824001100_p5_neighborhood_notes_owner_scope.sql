-- P5 (PANEL_KARAR_1 §4) / güvenlik denetimi 3 devamı: neighborhood_notes — yazma kapsamı not sahibi veya yönetim.
--
-- NEDEN: 20260821000100 INSERT/UPDATE/DELETE politikaları yalnız tenant koşulu taşıyordu. Ofisteki her üye
--   PostgREST ile başkasının notunu değiştirebiliyor, yumuşak silebiliyor (deleted_at) veya gerçek DELETE ile
--   yok edebiliyordu; INSERT'te created_by başka bir kullanıcı olarak yazılabiliyordu (yazar sahteciliği).
--   Uygulama kapısı (src/app/actions/neighborhood-notes.ts: properties:create / properties:edit) DB'de
--   karşılıksızdı ve not sahibine bakmıyordu.
--
-- NE YAPAR (politika adları aynı kalır, yalnız gövdeler daralır; SELECT DEĞİŞMEZ = ofis içi paylaşım sürer):
--   INSERT (authenticated): tenant + created_by = auth.uid() + deleted_at boş + properties:create.
--   UPDATE (authenticated): USING ve WITH CHECK aynı: tenant + properties:edit +
--     (created_by = auth.uid() VEYA rol owner/gm/branch_manager). Yumuşak silme (deleted_at) bu yoldan geçer.
--   DELETE (authenticated, gerçek silme; uygulama kullanmaz): tenant + properties:delete +
--     (created_by = auth.uid() VEYA rol owner/gm/branch_manager).
--   BEFORE UPDATE trigger (guard_neighborhood_note_update, SECURITY INVOKER; yalnız authenticated/anon):
--     tenant_id, created_by, created_at değişmez (yönetici de başkasının adına yazar değiştiremez;
--     created_by yalnız NULL'a düşebilir = profil silindiğinde FK `on delete set null`).
--   Platform personeli için ayrı politika yoktu; eklenmedi. service_role (seed:demo) RLS'e tabi değildir.
--
-- KOD UYUMU (okundu): createNeighborhoodNote insert'i tenant_id=gate.tenantId, created_by=gate.userId yazar,
--   deleted_at yazmaz (NULL) → geçerli. deleteNeighborhoodNote yalnız deleted_at/updated_at günceller (yumuşak
--   silme) → not sahibi ve yöneticiler için geçerli. DAVRANIŞ DEĞİŞİKLİĞİ: yönetici olmayan bir üye BAŞKASININ
--   notunda "Sil" derse UPDATE 0 satır etkiler, hata dönmez; action bugün sonucu sayıdan kontrol etmediği için
--   { ok: true } döner ama not silinmez. Öneri (kod sahibine, bu dosya kodu DEĞİŞTİRMEZ): action'da
--   `.select("id")` ile etkilenen satırı doğrula; sayfada "Sil" düğmesini yalnız not sahibine ve
--   owner/gm/branch_manager'a göster.
-- ETKİ: yalnız politika/trigger DDL; veri değişmez, kilit kısa (policy DDL).
-- GERİ ALMA: supabase/rollbacks/20260824001100_p5_neighborhood_notes_owner_scope.rollback.sql
-- SIRA: 20260821000100 ile AYNI pencerede, ondan SONRA uygulanmalı (tablo yoksa bu dosya hata verir).
-- TASLAK: canlı DB'de çalıştırılmadı; yalnız statik denetlendi. Canlı uygulama restore edilebilir backup/PITR
--   doğrulandıktan sonra sahibi tarafından kontrollü `npm run db:migrate` ile yapılır.

alter table public.neighborhood_notes enable row level security;

drop policy if exists neighborhood_notes_tenant_insert on public.neighborhood_notes;
create policy neighborhood_notes_tenant_insert on public.neighborhood_notes
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and deleted_at is null
    and (select public.has_effective_permission('properties', 'create'))
  );

drop policy if exists neighborhood_notes_tenant_update on public.neighborhood_notes;
create policy neighborhood_notes_tenant_update on public.neighborhood_notes
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
    and (
      created_by = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
    and (
      created_by = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
  );

drop policy if exists neighborhood_notes_tenant_delete on public.neighborhood_notes;
create policy neighborhood_notes_tenant_delete on public.neighborhood_notes
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'delete'))
    and (
      created_by = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
  );

comment on policy neighborhood_notes_tenant_insert on public.neighborhood_notes is
  'Yalnız kendi adına (created_by = auth.uid()), silinmemiş, properties:create.';
comment on policy neighborhood_notes_tenant_update on public.neighborhood_notes is
  'Not sahibi veya owner/gm/branch_manager; properties:edit. Yumuşak silme bu yoldan. Alan kuralı: guard_neighborhood_note_update.';
comment on policy neighborhood_notes_tenant_delete on public.neighborhood_notes is
  'Gerçek silme (uygulama kullanmaz): not sahibi veya owner/gm/branch_manager; properties:delete.';

create or replace function public.guard_neighborhood_note_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- created_by -> NULL serbest: profiles silinince FK `on delete set null` bu UPDATE'i üretir.
  if new.tenant_id is distinct from old.tenant_id
     or (new.created_by is not null and new.created_by is distinct from old.created_by)
     or new.created_at is distinct from old.created_at then
    raise exception 'Mahalle notunun sahibi ve ofisi degistirilemez.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_neighborhood_note_update() is
  'neighborhood_notes BEFORE UPDATE: tenant_id, created_by (NULL hariç), created_at değişmez (authenticated/anon).';

revoke all on function public.guard_neighborhood_note_update() from public, anon, authenticated;

drop trigger if exists trg_neighborhood_notes_guard on public.neighborhood_notes;
create trigger trg_neighborhood_notes_guard
  before update on public.neighborhood_notes
  for each row execute function public.guard_neighborhood_note_update();

notify pgrst, 'reload schema';

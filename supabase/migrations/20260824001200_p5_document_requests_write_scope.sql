-- P5 (PANEL_KARAR_1 §4) / güvenlik denetimi 3 devamı: document_requests — yazma kapsamı (evrak toplama linki).
--
-- NEDEN: 20260821000300 INSERT/UPDATE politikaları yalnız tenant koşulu taşıyordu. Ofisteki her üye PostgREST ile
--   başkasının linkinde şunları yapabiliyordu: iptal edilmiş/tamamlanmış linki yeniden 'active' yapmak,
--   expires_at'i uzatmak, max_files'ı büyütmek / file_count'u sıfırlamak (yükleme kotasını aşmak),
--   customer_id/property_id'yi başka kayda çevirmek (müşterinin yüklediği evrakı başka dosyaya bağlamak),
--   token_hash'i bildiği bir token'ın özetiyle değiştirmek (linki ele geçirmek). INSERT'te created_by başka
--   kullanıcı, status 'completed', file_count keyfi yazılabiliyordu. Uygulama kapısı
--   (src/app/actions/document-requests.ts: customers:edit) DB'de karşılıksızdı.
--
-- NE YAPAR (politika adları aynı; SELECT ve platform personeli politikaları DEĞİŞMEZ):
--   INSERT (authenticated): tenant + created_by = auth.uid() + customers:edit + status 'active' + file_count 0 +
--     revoked_at/completed_at/last_opened_at boş.
--   UPDATE (authenticated): USING = tenant + customers:edit + (created_by = auth.uid() VEYA rol
--     owner/gm/branch_manager); WITH CHECK = aynı + status = 'revoked'. Yani oturumlu kullanıcı için UPDATE
--     yalnız "iptal" demektir (uygulamanın tek authenticated UPDATE yolu revokeDocumentRequest).
--   BEFORE UPDATE trigger (guard_document_request_update, SECURITY INVOKER; yalnız authenticated/anon,
--     platform personeli hariç): status yalnız active -> revoked değişebilir; revoked_at yalnız bu geçişte
--     yazılır; diğer tüm sütunlar değişmez (customer_id/property_id/created_by yalnız NULL'a düşebilir =
--     FK `on delete set null`).
--   service_role (public yükleme akışı: file_count, completed, last_opened_at) RLS'e ve trigger'a tabi değildir.
--   document_request_files: authenticated için yalnız SELECT vardı; değişmedi.
--
-- KOD UYUMU (okundu): createDocumentRequest insert'i tenant_id/customer_id/property_id/title/requested_types/
--   token_hash/max_files/expires_at/is_sample/created_by=gate.userId yazar (status/file_count varsayılan) → geçerli.
--   revokeDocumentRequest yalnız status='revoked', revoked_at yazar (.eq status active) → link sahibi ve
--   yöneticiler için geçerli. src/app/actions/document-request-public.ts ve src/lib/doc-request/server.ts admin
--   (service_role) istemcisi kullanır → etkilenmez.
--   DAVRANIŞ DEĞİŞİKLİĞİ: yönetici olmayan bir üye BAŞKASININ linkini iptal edemez; action bugün
--   "Link bulunamadı veya zaten kapalı." döner. Öneri (kod sahibine, bu dosya kodu DEĞİŞTİRMEZ): listede
--   "İptal" düğmesini yalnız link sahibine ve owner/gm/branch_manager'a göster.
-- ETKİ: yalnız politika/trigger DDL; veri değişmez.
-- GERİ ALMA: supabase/rollbacks/20260824001200_p5_document_requests_write_scope.rollback.sql
-- SIRA: 20260821000300 ile AYNI pencerede, ondan SONRA uygulanmalı (tablo yoksa bu dosya hata verir).
-- TASLAK: canlı DB'de çalıştırılmadı; yalnız statik denetlendi. Canlı uygulama restore edilebilir backup/PITR
--   doğrulandıktan sonra sahibi tarafından kontrollü `npm run db:migrate` ile yapılır.

alter table public.document_requests enable row level security;

drop policy if exists document_requests_tenant_insert on public.document_requests;
create policy document_requests_tenant_insert on public.document_requests
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.has_effective_permission('customers', 'edit'))
    and status = 'active'
    and file_count = 0
    and revoked_at is null
    and completed_at is null
    and last_opened_at is null
  );

drop policy if exists document_requests_tenant_update on public.document_requests;
create policy document_requests_tenant_update on public.document_requests
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and (
      created_by = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and (
      created_by = (select auth.uid())
      or (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    )
    and status = 'revoked'
  );

comment on policy document_requests_tenant_insert on public.document_requests is
  'Kendi adına, active, sayaçlar sıfır; customers:edit.';
comment on policy document_requests_tenant_update on public.document_requests is
  'Yalnız iptal (status=revoked): link sahibi veya owner/gm/branch_manager; customers:edit. Alan kuralı: guard_document_request_update.';

create or replace function public.guard_document_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Platform personeli kendi politikasıyla (document_requests_staff) çalışır.
  if public.is_platform_staff() then
    return new;
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'revoked') then
    raise exception 'Evrak linki yalnizca iptal edilebilir.' using errcode = '42501';
  end if;

  if new.revoked_at is distinct from old.revoked_at
     and not (old.status = 'active' and new.status = 'revoked' and new.revoked_at is not null) then
    raise exception 'Iptal zamani yalnizca iptal sirasinda yazilir.' using errcode = '42501';
  end if;

  if row(new.id, new.tenant_id, new.title, new.requested_types, new.token_hash, new.max_files, new.file_count,
         new.expires_at, new.completed_at, new.last_opened_at, new.is_sample, new.created_at)
     is distinct from
     row(old.id, old.tenant_id, old.title, old.requested_types, old.token_hash, old.max_files, old.file_count,
         old.expires_at, old.completed_at, old.last_opened_at, old.is_sample, old.created_at)
     or (new.customer_id is not null and new.customer_id is distinct from old.customer_id)
     or (new.property_id is not null and new.property_id is distinct from old.property_id)
     or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'Evrak linkinin icerigi degistirilemez; iptal edip yenisini olusturun.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_document_request_update() is
  'document_requests BEFORE UPDATE (authenticated/anon, platform personeli hariç): yalnız active->revoked + revoked_at.';

revoke all on function public.guard_document_request_update() from public, anon, authenticated;

drop trigger if exists trg_document_requests_guard on public.document_requests;
create trigger trg_document_requests_guard
  before update on public.document_requests
  for each row execute function public.guard_document_request_update();

notify pgrst, 'reload schema';

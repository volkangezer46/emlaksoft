-- `db:rls-audit` bu 4 tabloda RLS açık ama hiç policy yok diye işaretliyordu.
-- Doğrulandı: hiçbiri permission_defaults sınıfı bir hata DEĞİL — tabloya
-- `anon`/`authenticated` için hiç GRANT verilmemiş (yalnız `service_role`),
-- ve `service_role` zaten RLS'i atlıyor (BYPASSRLS). Yani policy eksikliği şu an
-- zararsız/ölü kod. Yine de niyeti açıkça yazmak ve denetim gürültüsünü
-- kesmek için service_role-only policy ekleniyor.
create policy iys_consent_events_service_role_only
  on public.iys_consent_events
  for all to service_role using (true) with check (true);

create policy lead_capture_token_revocations_service_role_only
  on public.lead_capture_token_revocations
  for all to service_role using (true) with check (true);

create policy public_lead_consent_events_service_role_only
  on public.public_lead_consent_events
  for all to service_role using (true) with check (true);

create policy storage_deletion_outbox_service_role_only
  on public.storage_deletion_outbox
  for all to service_role using (true) with check (true);

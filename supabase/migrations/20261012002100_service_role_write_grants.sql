-- MIGRATION 20261012002100_service_role_write_grants.sql
-- Davet kodu ("Davet kodu oluşturulamadı") ve diğer sunucu yazma yolları: service_role'e EKSİK yazma yetkileri.
--
-- KÖK NEDEN (canlı DB, salt-okunur doğrulama 2026-10-12): aşağıdaki tablolar açık GRANT'sız oluşturulmuş; service_role'de
--   yalnız SELECT/TRIGGER/REFERENCES/TRUNCATE var, INSERT/UPDATE yok. Yetkiyi kaldıran bir migration yok (20261010000400 yalnız
--   anon/authenticated'tan truncate/trigger/references alır). Admin client (service_role) ile yazan kod 42501 alıp sessizce düşüyor.
--
-- ENVANTER (yalnız createAdminClient ile GERÇEKTEN yazılan tablo/işlem çiftleri; fazla yetki verilmez, DELETE hiçbirinde yok):
--   growth_referral_codes   INSERT          src/lib/growth/store.ts ensureReferralCode  -> /app/buyume "Davet bağlantımı oluştur"
--   signup_attributions     INSERT          src/lib/growth/store.ts (kayıtta davet/ortak atfı)
--   growth_partners         INSERT, UPDATE  src/app/actions/growth.ts (admin ortak programı)
--   growth_reward_rules     INSERT, UPDATE  src/app/actions/growth.ts (admin ödül kuralları)
--   document_request_files  INSERT, UPDATE  src/app/actions/document-request-public.ts (müşteri evrak yükleme portalı),
--                                           src/lib/public-upload-cleanup.ts (yarım yükleme -> blocked)
--   document_requests       UPDATE          src/app/actions/document-request-public.ts (portal yükleme sonrası durum)
--   kvkk_requests           UPDATE          src/app/actions/platform-tenant-closure.ts (ofis kapanış talebini işleme)
-- Zaten yeterli olanlar (dokunulmaz): audit_logs/platform_audit_logs/public_lead_consent_events INSERT (append-only),
--   geo_change_requests UPDATE, plan_entitlements INSERT+UPDATE. Oturum istemcisiyle yazılan tablolar kapsam dışı.
-- Geri alma: supabase/rollbacks/20261012002100_service_role_write_grants.rollback.sql

grant insert on table public.growth_referral_codes to service_role;
grant insert on table public.signup_attributions to service_role;
grant insert, update on table public.growth_partners to service_role;
grant insert, update on table public.growth_reward_rules to service_role;
grant insert, update on table public.document_request_files to service_role;
grant update on table public.document_requests to service_role;
grant update on table public.kvkk_requests to service_role;

notify pgrst, 'reload schema';

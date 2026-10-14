-- Geri alma: yalniz DG7 oturum RPC'leri kaldirilir. Politika degerleri (tenant_settings office.security.*) yerinde
-- kalir; kod RPC yokken "kurulum bekliyor" der (veri kaybi yok).
drop function if exists public.office_revoke_session(uuid, uuid);
drop function if exists public.office_list_sessions(uuid);

notify pgrst, 'reload schema';

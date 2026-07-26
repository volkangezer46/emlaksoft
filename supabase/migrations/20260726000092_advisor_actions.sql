-- Migration 092: AI asistan eylem kartlarının kalıcılığı
-- Asistan mesajıyla birlikte üretilen onaylı eylem önerileri (suggest_task /
-- draft_sms / list_hot_customers) mesaj satırında jsonb olarak saklanır;
-- geçmiş oturum açılınca kartlar yeniden render edilir.
-- (bkz. 20260726000076_tenant_advisor_sessions.sql — tablo tanımı)

alter table public.tenant_advisor_messages
  add column if not exists actions jsonb;

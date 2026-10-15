-- 20261018070000 geri alma: PostgreSQL enum değeri silinemez. Güvenli geri alma: bu tetikleyicili otomasyonları pasifleştir.
update public.automations set status = 'inactive' where trigger_type::text in ('inbound_message', 'lead_form_submitted') and status = 'active';

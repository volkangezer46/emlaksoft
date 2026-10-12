-- 20261012002510 geri alma: PostgreSQL enum değeri silinemez. Güvenli geri alma: bu tetikleyicili otomasyonları pasifleştir.
update public.automations set status = 'inactive' where trigger_type::text in ('new_fsbo_lead', 'fsbo_no_contact_days') and status = 'active';

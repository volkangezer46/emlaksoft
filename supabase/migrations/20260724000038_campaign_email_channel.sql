-- Kampanya kanalına 'email' ekle (SMS/WhatsApp'a ek e-posta kampanyası)
alter type public.campaign_channel add value if not exists 'email';

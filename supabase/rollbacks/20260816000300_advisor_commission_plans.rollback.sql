-- Rollback: 20260816000300_advisor_commission_plans
-- Kod henüz plan tablosunu okumuyorsa güvenlidir; okuyorsa önce o kod kapatılmalı (varsayılan pay 50'ye döner).
drop table if exists public.advisor_commission_plans;

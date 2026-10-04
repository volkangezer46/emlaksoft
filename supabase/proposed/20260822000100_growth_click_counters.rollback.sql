-- ROLLBACK TASLAĞI (UYGULANMADI) — 20260822000100_growth_click_counters.sql
drop function if exists public.growth_count_click(text, text);
drop table if exists public.growth_click_counters;

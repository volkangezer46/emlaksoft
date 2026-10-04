-- Anket modülü geri alma: anket görevleri, şablonlar ve ayarlar silinir.
-- Mevcut `surveys` (kapanış NPS) tablosuna DOKUNULMAZ.
delete from public.permission_defaults where module = 'surveys';
drop table if exists public.survey_attempts;
drop table if exists public.survey_answers;
drop table if exists public.survey_tasks;
drop table if exists public.survey_questions;
drop table if exists public.survey_templates;
drop table if exists public.survey_triggers;
drop table if exists public.survey_assignees;
drop table if exists public.survey_settings;

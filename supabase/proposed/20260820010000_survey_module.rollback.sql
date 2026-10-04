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
-- Güvenlik yardımcıları (denetim 3 / #7). Tablolardan SONRA düşer (politikalar tablolarla birlikte gider).
drop function if exists public.guard_survey_task_update();
drop function if exists public.survey_can_work_task(uuid);
drop function if exists public.survey_is_manager();

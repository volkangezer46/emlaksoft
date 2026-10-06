-- Rollback: 20261007000400_survey_matrix_channels
-- DIKKAT: yeni olay/kitle (rent_renewal, tenant_annual, advisor_pulse, advisor) gorev/sablon/tetikleyici satirlari ve
-- ekip nabzi cevaplari SILINIR; dusuk puan kapanis notlari ve gonderim izi sutunlariyla birlikte kaybolur.
-- "0-10 arasi" soru metni duzeltmesi GERI ALINMAZ (zararsiz metin). Kod bu sutunlar/RPC'ler yokken eski yola duser.

set local lock_timeout = '5s';

drop function if exists public.survey_submit_advisor_pulse(uuid, text, jsonb);
drop function if exists public.survey_close_low_score(uuid, text);
drop table if exists public.survey_pulse_responses;

delete from public.survey_tasks where event_type in ('rent_renewal', 'tenant_annual', 'advisor_pulse') or audience = 'advisor';
delete from public.survey_templates where event_type in ('rent_renewal', 'tenant_annual', 'advisor_pulse') or audience = 'advisor';
delete from public.survey_triggers where event_type in ('rent_renewal', 'tenant_annual', 'advisor_pulse');
delete from public.survey_questions where tag = 'advisor';

-- Eski guard govdesi (20260825000700) geri yuklenir.
create or replace function public.guard_survey_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.survey_is_manager() then
    return new;
  end if;

  if row(new.id, new.tenant_id, new.event_type, new.audience, new.event_key, new.event_summary, new.event_at,
         new.template_id, new.customer_id, new.property_id, new.deal_id, new.agent_id, new.assigned_to,
         new.due_at, new.max_attempts, new.public_token, new.created_by, new.created_at)
     is distinct from
     row(old.id, old.tenant_id, old.event_type, old.audience, old.event_key, old.event_summary, old.event_at,
         old.template_id, old.customer_id, old.property_id, old.deal_id, old.agent_id, old.assigned_to,
         old.due_at, old.max_attempts, old.public_token, old.created_by, old.created_at) then
    raise exception 'Anketor yalnizca arama ve cevap alanlarini guncelleyebilir.' using errcode = '42501';
  end if;

  if new.completed_by is not null
     and new.completed_by is distinct from old.completed_by
     and new.completed_by is distinct from v_uid then
    raise exception 'Gorevi baskasi adina tamamlayamazsiniz.' using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    if row(new.status, new.attempts, new.next_attempt_at, new.last_outcome,
           new.score, new.comment, new.answered_via, new.completed_at, new.completed_by)
       is distinct from
       row(old.status, old.attempts, old.next_attempt_at, old.last_outcome,
           old.score, old.comment, old.answered_via, old.completed_at, old.completed_by)
       or (old.low_score_handled and not new.low_score_handled) then
      raise exception 'Kapanmis anket gorevi degistirilemez.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_survey_task_update() from public, anon, authenticated;

drop index if exists public.idx_survey_tasks_low_open;
drop index if exists public.idx_survey_tasks_unsent;

alter table public.survey_tasks
  drop constraint if exists survey_tasks_sent_via_check,
  drop constraint if exists survey_tasks_send_attempts_check,
  drop constraint if exists survey_tasks_escalation_level_check,
  drop constraint if exists survey_tasks_low_score_note_check,
  drop column if exists sent_via,
  drop column if exists sent_at,
  drop column if exists send_attempts,
  drop column if exists followup_task_id,
  drop column if exists escalation_level,
  drop column if exists low_score_note,
  drop column if exists low_score_handled_at,
  drop column if exists low_score_handled_by;

alter table public.survey_settings
  drop constraint if exists survey_settings_whatsapp_template_check,
  drop constraint if exists survey_settings_whatsapp_language_check,
  drop column if exists auto_send,
  drop column if exists whatsapp_template,
  drop column if exists whatsapp_language,
  drop column if exists promoter_invite;

alter table public.survey_templates
  drop constraint if exists survey_templates_event_type_check,
  drop constraint if exists survey_templates_audience_check,
  add constraint survey_templates_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done')),
  add constraint survey_templates_audience_check check (audience in
    ('owner','buyer','seller','tenant','landlord','customer','visitor'));

alter table public.survey_triggers
  drop constraint if exists survey_triggers_event_type_check,
  add constraint survey_triggers_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done'));

alter table public.survey_tasks
  drop constraint if exists survey_tasks_event_type_check,
  drop constraint if exists survey_tasks_audience_check,
  add constraint survey_tasks_event_type_check check (event_type in
    ('property_unpublished','authority_extended','deal_won','deal_lost','demand_lost','appointment_done')),
  add constraint survey_tasks_audience_check check (audience in
    ('owner','buyer','seller','tenant','landlord','customer','visitor'));

alter table public.survey_questions
  drop constraint if exists survey_questions_tag_check,
  add constraint survey_questions_tag_check check (tag in ('primary','reason'));

notify pgrst, 'reload schema';

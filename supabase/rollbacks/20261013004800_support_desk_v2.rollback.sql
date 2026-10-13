-- 20261013004800 geri alma: destek masası 2.0 (SLA matrisi, iş saatleri, otomatik atama, etiket, makro eylemleri).
-- UYARI: bilet etiketleri (support_tickets.tags), makro eylemleri/kullanım sayacı ve SLA/atama ayarları silinir.
-- SLA hesabı 20260731000142'deki sabit takvim saatlerine döner; muhasebe rolü yeniden destek personeli sayılmaz.
-- Kod tablolar/kolonlar yokken eski davranışa düşer (etiket ve atama arayüzü "kurulum bekliyor" der).

drop trigger if exists trg_support_auto_assign_ticket on public.support_tickets;
drop trigger if exists trg_support_auto_assign_event on public.support_tickets;

drop function if exists public.process_support_ticket_waiting_automation(integer, integer, integer);
drop function if exists public.support_macro_used(uuid);
drop function if exists public.support_update_ticket_tags(uuid, uuid, text[], text[]);
drop function if exists public.support_record_auto_assign_event();
drop function if exists public.support_auto_assign_ticket();
drop function if exists public.support_pick_assignee(text);

create or replace function public.support_set_derived_ticket_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.first_response_due_at := coalesce(
      new.first_response_due_at,
      new.created_at + public.support_first_response_interval(new.priority)
    );
    new.resolution_due_at := coalesce(
      new.resolution_due_at,
      new.created_at + public.support_resolution_interval(new.priority)
    );
    new.last_activity_at := coalesce(new.last_activity_at, new.created_at);
    new.version := greatest(coalesce(new.version, 1), 1);
  else
    if new.priority is distinct from old.priority then
      if new.first_response_at is null then
        new.first_response_due_at := coalesce(new.reopened_at, new.created_at)
          + public.support_first_response_interval(new.priority);
      end if;
      if new.resolved_at is null and new.closed_at is null then
        new.resolution_due_at := coalesce(new.reopened_at, new.created_at)
          + public.support_resolution_interval(new.priority);
      end if;
    end if;

    -- These columns are historical evidence. Reopen and priority changes may
    -- create a new deadline, but must never erase a previous breach timestamp.
    new.first_response_breached_at := coalesce(
      old.first_response_breached_at,
      new.first_response_breached_at
    );
    new.resolution_breached_at := coalesce(
      old.resolution_breached_at,
      new.resolution_breached_at
    );
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create or replace function public.support_first_response_interval(p_priority text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_priority
    when 'urgent' then interval '1 hour'
    when 'high' then interval '4 hours'
    when 'low' then interval '24 hours'
    else interval '8 hours'
  end;
$$;

create or replace function public.support_resolution_interval(p_priority text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_priority
    when 'urgent' then interval '8 hours'
    when 'high' then interval '24 hours'
    when 'low' then interval '120 hours'
    else interval '72 hours'
  end;
$$;

drop function if exists public.support_first_response_interval(text, text);
drop function if exists public.support_sla_due_at(text, uuid, text, timestamptz);
drop function if exists public.support_add_business_minutes(timestamptz, integer);
drop function if exists public.support_sla_minutes(text, text, text);

create or replace function public.support_actor_is_valid(p_actor_id uuid, p_actor_kind text, p_tenant_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_actor_kind
    when 'tenant' then exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id
        and p.tenant_id = p_tenant_id
        and p.is_active = true
    )
    when 'staff' then exists (
      select 1
      from public.platform_staff s
      where s.id = p_actor_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    )
    else false
  end;
$$;

create or replace function public.support_is_ticket_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and s.role in ('super_admin', 'ops', 'support')
  );
end;
$$;

drop index if exists public.idx_support_tickets_tags;
alter table public.support_tickets drop constraint if exists support_tickets_tags_limit;
alter table public.support_tickets drop column if exists tags;

alter table public.ticket_macros drop constraint if exists ticket_macros_actions_object;
alter table public.ticket_macros
  drop column if exists actions_json,
  drop column if exists use_count,
  drop column if exists last_used_at,
  drop column if exists updated_at;

drop table if exists public.support_staff_availability;
drop table if exists public.support_assignment_rules;
drop table if exists public.support_holidays;
drop table if exists public.support_business_hours;
drop table if exists public.support_sla_policies;

notify pgrst, 'reload schema';

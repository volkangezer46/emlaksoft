-- AD9 — Destek masası 2.0
--
-- 1) SLA politikaları adminden: öncelik × plan matrisi (iş dakikası), iş saatleri ve tatil takvimi.
--    `support_first_response_interval` / `support_resolution_interval` artık sabit değil, bu tabloyu okur.
--    Yeni bilet ve öncelik/yeniden açılma değişikliklerinde hedef zaman İŞ SAATİNE göre hesaplanır
--    (Europe/Istanbul; cuma 17:30 + 2 iş saati = pazartesi 10:30).
-- 2) Otomatik atama: kategori kuralı + sıralı dağıtım (round robin); izinli/pasif personel atlanır.
--    Ana anahtar: platform_settings 'support.auto_assign_enabled' (yoksa açık).
-- 3) Bilet etiketleri (support_tickets.tags) ve makro eylemleri/kullanım sayacı (ticket_macros).
-- 4) Yanıt bekleyen bilet otomasyonu (hatırlatma + otomatik kapanış) RPC'si; ticket-sla cron'u ayrı adım olarak çağırır.
-- 5) Muhasebe (billing) rolü destek personeli sayılır: 'Faturalama' kategorisi muhasebeye atanabilir.
--
-- Yeni tablolar yalnız service_role ile okunur/yazılır (RLS açık, politika yok). Kod, tablolar/kolonlar yokken
-- eski davranışa düşer (sabit takvim saatli SLA, atama yok, etiket/makro eylemi yok).

-- ---------------------------------------------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.support_sla_policies (
  id uuid primary key default gen_random_uuid(),
  plan text not null,
  priority text not null,
  first_response_minutes integer not null,
  resolution_minutes integer not null,
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint support_sla_policies_plan_check
    check (plan in ('*', 'advisor', 'office', 'professional', 'business', 'enterprise')),
  constraint support_sla_policies_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_sla_policies_first_response_check
    check (first_response_minutes between 15 and 43200),
  constraint support_sla_policies_resolution_check
    check (resolution_minutes between 30 and 129600),
  constraint support_sla_policies_unique unique (plan, priority)
);
comment on table public.support_sla_policies is
  'Destek SLA matrisi (iş dakikası). plan=* tüm planların varsayılanı; plana özel satır onu ezer.';

create table if not exists public.support_business_hours (
  weekday smallint primary key,
  is_open boolean not null default true,
  open_minute smallint not null default 540,
  close_minute smallint not null default 1080,
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint support_business_hours_weekday_check check (weekday between 1 and 7),
  constraint support_business_hours_range_check
    check (open_minute between 0 and 1439 and close_minute between 1 and 1440 and close_minute > open_minute)
);
comment on table public.support_business_hours is
  'Destek iş saatleri (ISO gün: 1=pazartesi … 7=pazar; dakika Europe/Istanbul yerel saatidir).';

create table if not exists public.support_holidays (
  day date primary key,
  label text not null,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint support_holidays_label_check check (char_length(btrim(label)) between 1 and 80)
);
comment on table public.support_holidays is 'Destek tatil takvimi: bu günler SLA hesabında çalışılmayan gün sayılır.';

create table if not exists public.support_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  target_role text,
  target_staff_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  last_assigned_staff_id uuid references public.platform_staff(id) on delete set null,
  last_assigned_at timestamptz,
  assigned_count integer not null default 0,
  created_by uuid references public.platform_staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_assignment_rules_category_check check (char_length(btrim(category)) between 1 and 80),
  constraint support_assignment_rules_role_check
    check (target_role is null or target_role in ('super_admin', 'ops', 'support', 'billing')),
  constraint support_assignment_rules_target_check
    check (target_role is not null or cardinality(target_staff_ids) > 0),
  constraint support_assignment_rules_staff_limit check (cardinality(target_staff_ids) <= 50)
);
comment on table public.support_assignment_rules is
  'Otomatik atama kuralları: kategori (* = tümü) → rol ve/veya personel listesi; aday arasında sıralı dağıtım.';
create index if not exists idx_support_assignment_rules_category
  on public.support_assignment_rules (category, sort_order) where is_active;

create table if not exists public.support_staff_availability (
  staff_id uuid primary key references public.platform_staff(id) on delete cascade,
  is_away boolean not null default false,
  away_until timestamptz,
  note text,
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint support_staff_availability_note_check check (note is null or char_length(note) <= 200)
);
comment on table public.support_staff_availability is
  'Destek personeli izin durumu: izinli personel otomatik atamada atlanır (away_until geçince kendiliğinden döner).';

alter table public.support_tickets
  add column if not exists tags text[] not null default '{}';
alter table public.support_tickets
  drop constraint if exists support_tickets_tags_limit;
alter table public.support_tickets
  add constraint support_tickets_tags_limit check (cardinality(tags) <= 10) not valid;
create index if not exists idx_support_tickets_tags on public.support_tickets using gin (tags);

alter table public.ticket_macros
  add column if not exists actions_json jsonb not null default '{}'::jsonb,
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists updated_at timestamptz;
alter table public.ticket_macros
  drop constraint if exists ticket_macros_actions_object;
alter table public.ticket_macros
  add constraint ticket_macros_actions_object check (jsonb_typeof(actions_json) = 'object');

-- Erişim: yalnız service_role (admin ekranları sunucuda createAdminClient ile okur/yazar).
do $$
declare
  t text;
begin
  foreach t in array array[
    'support_sla_policies', 'support_business_hours', 'support_holidays',
    'support_assignment_rules', 'support_staff_availability'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Varsayılanlar (güvenli; hepsi adminden değiştirilebilir)
-- ---------------------------------------------------------------------------------------------------------------

insert into public.support_sla_policies (plan, priority, first_response_minutes, resolution_minutes)
values
  ('*', 'urgent', 60, 480),
  ('*', 'high', 240, 1080),
  ('*', 'normal', 480, 1620),
  ('*', 'low', 960, 2700)
on conflict (plan, priority) do nothing;

insert into public.support_business_hours (weekday, is_open, open_minute, close_minute)
values
  (1, true, 540, 1080),
  (2, true, 540, 1080),
  (3, true, 540, 1080),
  (4, true, 540, 1080),
  (5, true, 540, 1080),
  (6, false, 540, 1080),
  (7, false, 540, 1080)
on conflict (weekday) do nothing;

-- Yalnız sabit tarihli resmî tatiller; dini bayramlar her yıl adminden eklenir.
insert into public.support_holidays (day, label)
values
  ('2026-10-29', 'Cumhuriyet Bayramı'),
  ('2027-01-01', 'Yılbaşı'),
  ('2027-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'),
  ('2027-05-01', 'Emek ve Dayanışma Günü'),
  ('2027-05-19', 'Atatürk''ü Anma, Gençlik ve Spor Bayramı'),
  ('2027-07-15', 'Demokrasi ve Millî Birlik Günü'),
  ('2027-08-30', 'Zafer Bayramı'),
  ('2027-10-29', 'Cumhuriyet Bayramı')
on conflict (day) do nothing;

insert into public.support_assignment_rules (category, target_role, sort_order)
select 'billing', 'billing', 10
where not exists (select 1 from public.support_assignment_rules r where r.category = 'billing');

-- ---------------------------------------------------------------------------------------------------------------
-- SLA hesabı
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.support_sla_minutes(p_kind text, p_plan text, p_priority text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select case when p_kind = 'first_response' then s.first_response_minutes else s.resolution_minutes end
      from public.support_sla_policies s
      where s.plan = p_plan and s.priority = p_priority
    ),
    (
      select case when p_kind = 'first_response' then s.first_response_minutes else s.resolution_minutes end
      from public.support_sla_policies s
      where s.plan = '*' and s.priority = p_priority
    ),
    case
      when p_kind = 'first_response' then
        case p_priority when 'urgent' then 60 when 'high' then 240 when 'low' then 1440 else 480 end
      else
        case p_priority when 'urgent' then 480 when 'high' then 1440 when 'low' then 7200 else 4320 end
    end
  );
$$;

-- Takvim aralığı uyumluluğu: eski çağıranlar (reopen yolu vb.) için tablo değerini takvim dakikası döndürür.
-- Kalıcı hedefler tetikleyicide iş saatine göre yeniden hesaplanır.
create or replace function public.support_first_response_interval(p_priority text)
returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(mins => public.support_sla_minutes('first_response', '*', p_priority));
$$;

create or replace function public.support_first_response_interval(p_priority text, p_plan text)
returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(mins => public.support_sla_minutes('first_response', coalesce(p_plan, '*'), p_priority));
$$;

create or replace function public.support_resolution_interval(p_priority text)
returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(mins => public.support_sla_minutes('resolution', '*', p_priority));
$$;

comment on function public.support_first_response_interval(text) is
  'AD9: support_sla_policies (plan=*) ilk yanıt hedefi, takvim aralığı olarak. Kalıcı hedef support_sla_due_at ile iş saatine göre.';

/**
 * Başlangıçtan itibaren N iş dakikası sonrası. İş günü/saatleri support_business_hours, tatiller support_holidays.
 * Hiç açık gün tanımlı değilse takvim dakikasına düşer (asla sonsuz döngü yok; en fazla 800 gün taranır).
 */
create or replace function public.support_add_business_minutes(p_start timestamptz, p_minutes integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz constant text := 'Europe/Istanbul';
  v_local timestamp;
  v_remaining numeric;
  v_day date;
  v_hours record;
  v_day_start timestamp;
  v_day_end timestamp;
  v_cursor timestamp;
  v_available numeric;
  v_i integer := 0;
begin
  if p_start is null then
    return null;
  end if;
  if coalesce(p_minutes, 0) <= 0 then
    return p_start;
  end if;
  if not exists (select 1 from public.support_business_hours h where h.is_open) then
    return p_start + make_interval(mins => p_minutes);
  end if;

  v_local := p_start at time zone v_tz;
  v_remaining := p_minutes;

  while v_i < 800 loop
    v_i := v_i + 1;
    v_day := v_local::date;
    select h.is_open, h.open_minute, h.close_minute into v_hours
    from public.support_business_hours h
    where h.weekday = extract(isodow from v_day)::smallint;

    if found and v_hours.is_open
      and not exists (select 1 from public.support_holidays d where d.day = v_day) then
      v_day_start := v_day + make_interval(mins => v_hours.open_minute);
      v_day_end := v_day + make_interval(mins => v_hours.close_minute);
      v_cursor := greatest(v_local, v_day_start);
      if v_cursor < v_day_end then
        v_available := extract(epoch from (v_day_end - v_cursor)) / 60.0;
        if v_available >= v_remaining then
          return (v_cursor + make_interval(secs => v_remaining * 60)) at time zone v_tz;
        end if;
        v_remaining := v_remaining - v_available;
      end if;
    end if;

    v_local := (v_day + 1)::timestamp;
  end loop;

  return p_start + make_interval(mins => p_minutes);
end;
$$;

create or replace function public.support_sla_due_at(
  p_kind text,
  p_tenant_id uuid,
  p_priority text,
  p_from timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select public.support_add_business_minutes(
    p_from,
    public.support_sla_minutes(
      p_kind,
      coalesce((select t.plan from public.tenants t where t.id = p_tenant_id), '*'),
      p_priority
    )
  );
$$;

create or replace function public.support_set_derived_ticket_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base timestamptz;
begin
  if tg_op = 'INSERT' then
    new.first_response_due_at := coalesce(
      new.first_response_due_at,
      public.support_sla_due_at('first_response', new.tenant_id, new.priority, new.created_at)
    );
    new.resolution_due_at := coalesce(
      new.resolution_due_at,
      public.support_sla_due_at('resolution', new.tenant_id, new.priority, new.created_at)
    );
    new.last_activity_at := coalesce(new.last_activity_at, new.created_at);
    new.version := greatest(coalesce(new.version, 1), 1);
    new.tags := coalesce(new.tags, '{}');
  else
    v_base := coalesce(new.reopened_at, new.created_at);
    if new.priority is distinct from old.priority
      or (new.reopened_at is not null and new.reopened_at is distinct from old.reopened_at) then
      if new.first_response_at is null then
        new.first_response_due_at :=
          public.support_sla_due_at('first_response', new.tenant_id, new.priority, v_base);
      end if;
      if new.resolved_at is null and new.closed_at is null then
        new.resolution_due_at :=
          public.support_sla_due_at('resolution', new.tenant_id, new.priority, v_base);
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

-- ---------------------------------------------------------------------------------------------------------------
-- Destek personeli: muhasebe rolü eklendi (Faturalama biletleri muhasebeye atanabilir)
-- ---------------------------------------------------------------------------------------------------------------

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
        and s.role in ('super_admin', 'ops', 'support', 'billing')
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
      and s.role in ('super_admin', 'ops', 'support', 'billing')
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Otomatik atama
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.support_pick_assignee(p_category text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_candidates uuid[];
  v_pick uuid;
begin
  for v_rule in
    select r.*
    from public.support_assignment_rules r
    where r.is_active
      and (r.category = btrim(coalesce(p_category, '')) or r.category = '*')
    order by (r.category = '*'), r.sort_order, r.created_at
    for update
  loop
    select array_agg(s.id order by s.id) into v_candidates
    from public.platform_staff s
    where s.is_active = true
      and s.role in ('super_admin', 'ops', 'support', 'billing')
      and (v_rule.target_role is null or s.role = v_rule.target_role)
      and (cardinality(v_rule.target_staff_ids) = 0 or s.id = any (v_rule.target_staff_ids))
      and not exists (
        select 1
        from public.support_staff_availability a
        where a.staff_id = s.id
          and a.is_away
          and (a.away_until is null or a.away_until > now())
      );

    if coalesce(cardinality(v_candidates), 0) = 0 then
      continue;
    end if;

    -- Sıralı dağıtım: son atanan kişiden sonraki aday; liste sonundaysa başa dön.
    select c into v_pick
    from unnest(v_candidates) c
    where v_rule.last_assigned_staff_id is not null and c > v_rule.last_assigned_staff_id
    order by c
    limit 1;
    v_pick := coalesce(v_pick, v_candidates[1]);

    update public.support_assignment_rules
    set last_assigned_staff_id = v_pick,
        last_assigned_at = now(),
        assigned_count = assigned_count + 1
    where id = v_rule.id;
    return v_pick;
  end loop;
  return null;
end;
$$;

create or replace function public.support_auto_assign_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text;
begin
  if new.assigned_staff_id is not null or new.assigned_to is not null then
    return new;
  end if;
  select lower(btrim(coalesce(ps.value, ''))) into v_flag
  from public.platform_settings ps
  where ps.key = 'support.auto_assign_enabled';
  if v_flag in ('off', 'false', '0') then
    return new;
  end if;
  new.assigned_staff_id := public.support_pick_assignee(new.category);
  return new;
end;
$$;

create or replace function public.support_record_auto_assign_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_staff_id is not null then
    perform public.support_record_event(
      new.id,
      new.tenant_id,
      null,
      'system',
      'assign',
      'internal',
      null,
      jsonb_build_object('assigned_staff_id', new.assigned_staff_id, 'auto', true, 'category', new.category),
      null
    );
  end if;
  return null;
end;
$$;

-- Ad sırası önemli: BEFORE INSERT tetikleyicileri ada göre çalışır; atama, kanonik atanan senkronundan ÖNCE.
drop trigger if exists trg_support_auto_assign_ticket on public.support_tickets;
create trigger trg_support_auto_assign_ticket
  before insert on public.support_tickets
  for each row execute function public.support_auto_assign_ticket();

drop trigger if exists trg_support_auto_assign_event on public.support_tickets;
create trigger trg_support_auto_assign_event
  after insert on public.support_tickets
  for each row execute function public.support_record_auto_assign_event();

-- ---------------------------------------------------------------------------------------------------------------
-- Etiketler ve makrolar
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.support_update_ticket_tags(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_add text[],
  p_remove text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_add text[];
  v_remove text[];
  v_next text[];
begin
  perform public.support_require_service_role();
  if not public.support_actor_is_valid(p_actor_id, 'staff', null) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;

  -- Giriş sırası korunur (ilk görülen), tekrar atılır, geçersiz biçim sessizce düşer.
  select array_agg(x order by o) into v_add
  from (
    select lower(btrim(u.v)) as x, min(u.o) as o
    from unnest(coalesce(p_add, '{}')) with ordinality as u(v, o)
    group by lower(btrim(u.v))
  ) s
  where x ~ '^[[:alnum:]çğıöşü][[:alnum:]çğıöşü _-]{0,31}$';
  select array_agg(distinct lower(btrim(v))) into v_remove from unnest(coalesce(p_remove, '{}')) v;

  select * into v_ticket from public.support_tickets t where t.id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(tag order by first_seen), '{}') into v_next
  from (
    select tag, min(ord) as first_seen
    from unnest(coalesce(v_ticket.tags, '{}') || coalesce(v_add, '{}')) with ordinality as u(tag, ord)
    where not (tag = any (coalesce(v_remove, '{}')))
    group by tag
  ) s;

  if cardinality(v_next) > 10 then
    raise exception 'Too many tags.' using errcode = '22023';
  end if;

  if v_next is distinct from coalesce(v_ticket.tags, '{}') then
    update public.support_tickets
    set tags = v_next, updated_at = now()
    where id = p_ticket_id;
    perform public.support_record_event(
      v_ticket.id, v_ticket.tenant_id, p_actor_id, 'staff', 'tags', 'internal',
      jsonb_build_object('tags', to_jsonb(coalesce(v_ticket.tags, '{}'))),
      jsonb_build_object('tags', to_jsonb(v_next)),
      null
    );
  end if;

  return jsonb_build_object('ok', true, 'ticketId', v_ticket.id, 'tags', to_jsonb(v_next));
end;
$$;

create or replace function public.support_macro_used(p_macro_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform public.support_require_service_role();
  update public.ticket_macros
  set use_count = use_count + 1, last_used_at = now()
  where id = p_macro_id
  returning use_count into v_count;
  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Yanıt bekleyen bilet otomasyonu (ticket-sla cron'unun ayrı adımı)
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.process_support_ticket_waiting_automation(
  p_reminder_days integer,
  p_close_days integer,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_row record;
  v_message_id uuid;
  v_closed jsonb := '[]'::jsonb;
  v_reminded jsonb := '[]'::jsonb;
begin
  perform public.support_require_service_role();

  if coalesce(p_close_days, 0) > 0 then
    for v_row in
      select t.*
      from public.support_tickets t
      where t.status = 'waiting'
        and t.last_staff_reply_at is not null
        and t.last_staff_reply_at <= v_now - make_interval(days => p_close_days)
        and (t.last_customer_reply_at is null or t.last_customer_reply_at < t.last_staff_reply_at)
      order by t.last_staff_reply_at
      limit v_limit
      for update skip locked
    loop
      update public.support_tickets
      set status = 'closed',
          resolved_at = coalesce(resolved_at, v_now),
          closed_at = v_now,
          resolution_code = 'auto_closed_no_reply',
          resolution_summary = format('Müşteriden %s gün yanıt gelmediği için talep otomatik kapatıldı.', p_close_days),
          last_activity_at = v_now,
          updated_at = v_now
      where id = v_row.id;
      perform public.support_record_event(
        v_row.id, v_row.tenant_id, null, 'system', 'status', 'public',
        jsonb_build_object('status', v_row.status),
        jsonb_build_object('status', 'closed', 'auto', true, 'resolution_code', 'auto_closed_no_reply'),
        null
      );
      v_closed := v_closed || jsonb_build_object(
        'ticketId', v_row.id, 'tenantId', v_row.tenant_id, 'createdBy', v_row.created_by,
        'ticketNo', v_row.ticket_no, 'subject', v_row.subject
      );
    end loop;
  end if;

  if coalesce(p_reminder_days, 0) > 0 then
    for v_row in
      select t.*
      from public.support_tickets t
      where t.status = 'waiting'
        and t.last_staff_reply_at is not null
        and t.last_staff_reply_at <= v_now - make_interval(days => p_reminder_days)
        and (t.last_customer_reply_at is null or t.last_customer_reply_at < t.last_staff_reply_at)
        and not exists (
          select 1 from public.support_ticket_events e
          where e.ticket_id = t.id
            and e.event_type = 'auto_reminder'
            and e.created_at >= t.last_staff_reply_at
        )
      order by t.last_staff_reply_at
      limit v_limit
      for update skip locked
    loop
      insert into public.support_ticket_messages (ticket_id, author_user_id, author_kind, body, visibility, created_at)
      values (
        v_row.id,
        null,
        'system',
        case
          when coalesce(p_close_days, 0) > p_reminder_days then format(
            'Bu talep için yanıtınızı bekliyoruz. %s gün içinde yanıt gelmezse talep otomatik olarak kapatılır.',
            p_close_days - p_reminder_days
          )
          else 'Bu talep için yanıtınızı bekliyoruz. Sorununuz çözüldüyse talebi kapatabilirsiniz.'
        end,
        'public',
        v_now
      )
      returning id into v_message_id;
      perform public.support_record_event(
        v_row.id, v_row.tenant_id, null, 'system', 'auto_reminder', 'public',
        null, jsonb_build_object('reminder_days', p_reminder_days), v_message_id
      );
      v_reminded := v_reminded || jsonb_build_object(
        'ticketId', v_row.id, 'tenantId', v_row.tenant_id, 'createdBy', v_row.created_by,
        'ticketNo', v_row.ticket_no, 'subject', v_row.subject
      );
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'closed', v_closed, 'reminded', v_reminded);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Yetkiler: yeni RPC'ler yalnız service_role
-- ---------------------------------------------------------------------------------------------------------------

revoke all on function public.support_sla_minutes(text, text, text) from public, anon, authenticated;
revoke all on function public.support_add_business_minutes(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.support_sla_due_at(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.support_first_response_interval(text, text) from public, anon, authenticated;
revoke all on function public.support_pick_assignee(text) from public, anon, authenticated;
revoke all on function public.support_auto_assign_ticket() from public, anon, authenticated;
revoke all on function public.support_record_auto_assign_event() from public, anon, authenticated;
revoke all on function public.support_update_ticket_tags(uuid, uuid, text[], text[]) from public, anon, authenticated;
revoke all on function public.support_macro_used(uuid) from public, anon, authenticated;
revoke all on function public.process_support_ticket_waiting_automation(integer, integer, integer) from public, anon, authenticated;

grant execute on function public.support_sla_minutes(text, text, text) to service_role;
grant execute on function public.support_add_business_minutes(timestamptz, integer) to service_role;
grant execute on function public.support_sla_due_at(text, uuid, text, timestamptz) to service_role;
grant execute on function public.support_first_response_interval(text, text) to service_role;
grant execute on function public.support_update_ticket_tags(uuid, uuid, text[], text[]) to service_role;
grant execute on function public.support_macro_used(uuid) to service_role;
grant execute on function public.process_support_ticket_waiting_automation(integer, integer, integer) to service_role;

notify pgrst, 'reload schema';

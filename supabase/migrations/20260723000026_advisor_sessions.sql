-- Migration 026: Yapay zeka danışman sohbet geçmişi
-- platform_staff başına kalıcı oturum + mesaj kaydı

-- Oturum tablosu (her platform personeli üyesinin sohbet dizisi)
create table if not exists advisor_sessions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references platform_staff(id) on delete cascade,
  title       text,                          -- ilk sorudan otomatik türetilir
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists advisor_sessions_staff_id_idx on advisor_sessions(staff_id);
create index if not exists advisor_sessions_updated_at_idx on advisor_sessions(updated_at desc);

-- Mesaj tablosu
create table if not exists advisor_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references advisor_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  used_ai     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists advisor_messages_session_id_idx on advisor_messages(session_id);
create index if not exists advisor_messages_created_at_idx on advisor_messages(created_at);

-- RLS: yalnızca kendi oturumlarına erişim
alter table advisor_sessions enable row level security;
alter table advisor_messages enable row level security;

-- platform_staff kendi satırlarını okuyabilir/yazabilir (service role bypass olur)
create policy "platform_staff_own_sessions"
  on advisor_sessions for all
  using  (staff_id = auth.uid())
  with check (staff_id = auth.uid());

create policy "platform_staff_own_messages"
  on advisor_messages for all
  using  (session_id in (
    select id from advisor_sessions where staff_id = auth.uid()
  ))
  with check (session_id in (
    select id from advisor_sessions where staff_id = auth.uid()
  ));

-- updated_at otomatik güncelleme
create or replace function update_advisor_session_ts()
returns trigger language plpgsql as $$
begin
  update advisor_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists advisor_messages_update_session_ts on advisor_messages;
create trigger advisor_messages_update_session_ts
  after insert on advisor_messages
  for each row execute function update_advisor_session_ts();

-- service role tam erişim
grant all on advisor_sessions to service_role;
grant all on advisor_messages to service_role;

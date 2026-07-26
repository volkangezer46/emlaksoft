-- Migration 076: Ofis (tenant) yapay zeka asistanı sohbet geçmişi
-- advisor_sessions şemasının tenant uyarlaması: tenant_id + user_id + RLS
-- (bkz. 20260723000026_advisor_sessions.sql — platform tarafındaki eşdeğeri)

-- Oturum tablosu (her ofis kullanıcısının kendi sohbet dizisi)
create table if not exists public.tenant_advisor_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text,                          -- ilk sorudan otomatik türetilir
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tenant_advisor_sessions_tenant_user_idx
  on public.tenant_advisor_sessions(tenant_id, user_id);
create index if not exists tenant_advisor_sessions_updated_at_idx
  on public.tenant_advisor_sessions(updated_at desc);

-- Mesaj tablosu
create table if not exists public.tenant_advisor_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.tenant_advisor_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  used_ai     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists tenant_advisor_messages_session_id_idx
  on public.tenant_advisor_messages(session_id);
create index if not exists tenant_advisor_messages_created_at_idx
  on public.tenant_advisor_messages(created_at);

-- RLS: yalnızca kendi ofisindeki kendi oturumlarına erişim
alter table public.tenant_advisor_sessions enable row level security;
alter table public.tenant_advisor_messages enable row level security;

drop policy if exists tenant_advisor_sessions_own on public.tenant_advisor_sessions;
create policy tenant_advisor_sessions_own
  on public.tenant_advisor_sessions for all
  using  (tenant_id = public.current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.current_tenant_id() and user_id = auth.uid());

drop policy if exists tenant_advisor_messages_own on public.tenant_advisor_messages;
create policy tenant_advisor_messages_own
  on public.tenant_advisor_messages for all
  using  (session_id in (
    select id from public.tenant_advisor_sessions
    where tenant_id = public.current_tenant_id() and user_id = auth.uid()
  ))
  with check (session_id in (
    select id from public.tenant_advisor_sessions
    where tenant_id = public.current_tenant_id() and user_id = auth.uid()
  ));

-- updated_at otomatik güncelleme (admin tarafındaki desenle aynı)
create or replace function public.update_tenant_advisor_session_ts()
returns trigger language plpgsql as $$
begin
  update public.tenant_advisor_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists tenant_advisor_messages_update_session_ts on public.tenant_advisor_messages;
create trigger tenant_advisor_messages_update_session_ts
  after insert on public.tenant_advisor_messages
  for each row execute function public.update_tenant_advisor_session_ts();

grant all on public.tenant_advisor_sessions to authenticated, service_role;
grant all on public.tenant_advisor_messages to authenticated, service_role;

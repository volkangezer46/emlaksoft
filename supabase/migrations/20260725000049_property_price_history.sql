-- Portföy fiyat geçmişi
--
-- Neden: properties.list_price üzerine yazılıyor, eski değer kayboluyor.
-- Bir portföyün "3 ayda 2 kez indirime girdiği" bilgisi hem danışman
-- disiplininin hem de piyasa analizinin temel girdisi — kalıcı tutulmalı.
--
-- Tasarım kararları:
--  * Kayıt trigger ile düşer, uygulama koduna bağımlı değil. properties'i
--    güncelleyen her yol (server action, bulk update, admin, SQL) kapsanır.
--  * price_field ayrımı sayesinde liste/min/gizli fiyat aynı tabloda ama
--    ayrı seriler halinde izlenir.
--  * change_pct generated column — okuma tarafında hesaplama tekrarı olmasın.
--  * Mevcut portföyler için created_at tarihli bir taban kayıt seed edilir,
--    böylece grafik ilk günden başlar.

-- ============================================================
-- Tablo
-- ============================================================
create table if not exists public.property_price_history (
  id           uuid        primary key default gen_random_uuid(),
  property_id  uuid        not null references public.properties(id) on delete cascade,
  tenant_id    uuid        not null references public.tenants(id)    on delete cascade,
  price_field  text        not null default 'list_price'
                 check (price_field in ('list_price', 'min_price', 'hidden_price')),
  old_price    numeric,
  new_price    numeric     not null,
  change_pct   numeric     generated always as (
                 case
                   when old_price is not null and old_price > 0
                   then round(((new_price - old_price) / old_price) * 100, 2)
                 end
               ) stored,
  reason       text,
  changed_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table  public.property_price_history       is 'Portföy fiyat değişim tarihçesi — trigger ile otomatik dolar';
comment on column public.property_price_history.price_field is 'Hangi fiyat alanı değişti: list_price | min_price | hidden_price';
comment on column public.property_price_history.change_pct  is 'Önceki fiyata göre yüzde değişim (generated)';

create index if not exists idx_pph_property
  on public.property_price_history(property_id, price_field, created_at desc);

create index if not exists idx_pph_tenant
  on public.property_price_history(tenant_id, created_at desc);

-- ============================================================
-- RLS — diğer tenant tabloları ile aynı desen
-- ============================================================
alter table public.property_price_history enable row level security;

drop policy if exists pph_tenant        on public.property_price_history;
drop policy if exists pph_tenant_insert on public.property_price_history;

create policy pph_tenant on public.property_price_history
  using (tenant_id = public.current_tenant_id());

create policy pph_tenant_insert on public.property_price_history for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.property_price_history to authenticated, service_role;

-- ============================================================
-- Trigger — fiyat alanları değiştiğinde kayıt düşer
-- ============================================================
create or replace function public.log_property_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
begin
  -- auth.uid() service_role/cron çağrılarında null döner; profiles'ta
  -- karşılığı yoksa FK patlamasın diye açıkça doğruluyoruz.
  select p.id into actor
  from public.profiles p
  where p.id = auth.uid();

  if (tg_op = 'INSERT') then
    if (new.list_price is not null) then
      insert into public.property_price_history
        (property_id, tenant_id, price_field, old_price, new_price, reason, changed_by, created_at)
      values
        (new.id, new.tenant_id, 'list_price', null, new.list_price, 'Portföy oluşturuldu', actor, coalesce(new.created_at, now()));
    end if;
    return new;
  end if;

  if (new.list_price is not null and new.list_price is distinct from old.list_price) then
    insert into public.property_price_history
      (property_id, tenant_id, price_field, old_price, new_price, changed_by)
    values
      (new.id, new.tenant_id, 'list_price', old.list_price, new.list_price, actor);
  end if;

  if (new.min_price is not null and new.min_price is distinct from old.min_price) then
    insert into public.property_price_history
      (property_id, tenant_id, price_field, old_price, new_price, changed_by)
    values
      (new.id, new.tenant_id, 'min_price', old.min_price, new.min_price, actor);
  end if;

  if (new.hidden_price is not null and new.hidden_price is distinct from old.hidden_price) then
    insert into public.property_price_history
      (property_id, tenant_id, price_field, old_price, new_price, changed_by)
    values
      (new.id, new.tenant_id, 'hidden_price', old.hidden_price, new.hidden_price, actor);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_property_price_history on public.properties;

create trigger trg_property_price_history
  after insert or update of list_price, min_price, hidden_price
  on public.properties
  for each row
  execute function public.log_property_price_change();

-- ============================================================
-- Seed — mevcut portföyler için taban kayıt (idempotent)
-- ============================================================
insert into public.property_price_history
  (property_id, tenant_id, price_field, old_price, new_price, reason, created_at)
select
  p.id, p.tenant_id, 'list_price', null, p.list_price, 'Geçmiş kaydı başlangıcı', p.created_at
from public.properties p
where p.list_price is not null
  and p.deleted_at is null
  and not exists (
    select 1 from public.property_price_history h
    where h.property_id = p.id and h.price_field = 'list_price'
  );

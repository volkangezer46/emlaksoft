-- Anahtar & emanet takibi — property_keys + property_key_events
--
-- Neden:
--  * Emlak ofisinin klasik kayıp kaynağı: "anahtar kimde?". Ana kapı, bina
--    girişi, yedek anahtarlar danışmanlar ve müşteriler arasında elden ele
--    dolaşıyor; hiçbir yerde kaydı yok. Kaybolan anahtar = çilingir masrafı,
--    mal sahibiyle güven kaybı.
--  * property_keys her portföyün fiziksel anahtarlarını tutar; kim aldı, ne
--    zaman, ne zaman iade edecek. property_key_events ise hareket geçmişi —
--    "kim ne zaman aldı/iade etti" sorusunun denetlenebilir cevabı.
--
-- Tasarım kararları:
--  * status metin + check (enum DEĞİL): enum ADD VALUE + kullanım aynı
--    migration'da olamaz kuralı ileride yeni durum eklemeyi zorlaştırırdı.
--    Değerler: ofiste | danisanda | musteride | kayip | iade_edildi.
--    ('iade_edildi' geçici bir durum değil — anahtar kalıcı olarak mal
--     sahibine/3. tarafa geri verilmiş demektir; ofiste'ye dönmez.)
--  * holder_staff_id ve holder_name AYRI: anahtar ya bir danışmanda (profil
--    kaydı var) ya da bir müşteri/3. kişide (yalnız ad+telefon) olur. Tek
--    kolonla ikisini birden temsil etmek raporlamayı bozardı.
--  * holder_staff_id on delete set null — personel silinse de anahtarın
--    kaydı ve geçmişi kalır.
--  * due_at null olabilir: "süresiz" çıkışlar (mal sahibi kendi anahtarı)
--    gecikme hesabına girmez.
--  * events tablosunda from_status/to_status snapshot: anahtar satırı sonradan
--    değişse de geçmiş satırı ne olduğunu kendi başına anlatır.

create table if not exists public.property_keys (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants(id)    on delete cascade,
  property_id      uuid        not null references public.properties(id) on delete cascade,
  label            text        not null check (char_length(label) between 1 and 80),
  key_code         text        check (key_code is null or char_length(key_code) <= 40),
  status           text        not null default 'ofiste'
                     check (status in ('ofiste', 'danisanda', 'musteride', 'kayip', 'iade_edildi')),
  holder_staff_id  uuid        references public.profiles(id) on delete set null,
  holder_name      text        check (holder_name is null or char_length(holder_name) <= 120),
  holder_phone     text        check (holder_phone is null or char_length(holder_phone) <= 30),
  taken_at         timestamptz,
  due_at           timestamptz,
  returned_at      timestamptz,
  note             text        check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  created_by       uuid        references public.profiles(id) on delete set null
);

comment on table  public.property_keys                 is 'Portföy anahtarları — fiziksel anahtar/emanet takibi ("anahtar kimde?")';
comment on column public.property_keys.label           is 'Anahtar etiketi — "Ana kapı", "Bina girişi", "Yedek" vb.';
comment on column public.property_keys.key_code        is 'Anahtarlıktaki etiket/numara (opsiyonel)';
comment on column public.property_keys.status          is 'ofiste | danisanda | musteride | kayip | iade_edildi';
comment on column public.property_keys.holder_staff_id is 'Anahtar bir danışmandaysa profil kaydı';
comment on column public.property_keys.holder_name     is 'Anahtar müşteri/3. kişideyse adı (staff_id null olur)';
comment on column public.property_keys.due_at          is 'İade vadesi — null ise süresiz, gecikme hesabına girmez';

create index if not exists idx_property_keys_property
  on public.property_keys(property_id);
create index if not exists idx_property_keys_tenant_status
  on public.property_keys(tenant_id, status);
-- Gecikme taraması: vadesi geçmiş ve iade edilmemiş anahtarlar
create index if not exists idx_property_keys_due
  on public.property_keys(due_at)
  where due_at is not null and returned_at is null;
create index if not exists idx_property_keys_holder_staff
  on public.property_keys(holder_staff_id);

-- ============================================================
-- Hareket geçmişi
-- ============================================================
create table if not exists public.property_key_events (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id)        on delete cascade,
  key_id       uuid        not null references public.property_keys(id)  on delete cascade,
  action       text        not null check (action in ('cikis', 'iade', 'kayip', 'not', 'olusturma')),
  from_status  text,
  to_status    text,
  holder_name  text        check (holder_name is null or char_length(holder_name) <= 160),
  staff_id     uuid        references public.profiles(id) on delete set null,
  note         text        check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now()
);

comment on table  public.property_key_events            is 'Anahtar hareket geçmişi — çıkış/iade/kayıp kayıtları';
comment on column public.property_key_events.action     is 'cikis | iade | kayip | not | olusturma';
comment on column public.property_key_events.holder_name is 'Hareket anındaki taşıyıcının adı (danışman ya da müşteri) — snapshot';
comment on column public.property_key_events.staff_id   is 'İşlemi yapan/anahtarı alan danışman profili';

create index if not exists idx_property_key_events_key
  on public.property_key_events(key_id, created_at desc);
create index if not exists idx_property_key_events_tenant
  on public.property_key_events(tenant_id, created_at desc);

-- ============================================================
-- RLS — tenant deseni (bkz. deal_checklist_items)
-- ============================================================
alter table public.property_keys       enable row level security;
alter table public.property_key_events enable row level security;

drop policy if exists property_keys_tenant_select on public.property_keys;
drop policy if exists property_keys_tenant_insert on public.property_keys;
drop policy if exists property_keys_tenant_update on public.property_keys;
drop policy if exists property_keys_tenant_delete on public.property_keys;

create policy property_keys_tenant_select on public.property_keys for select
  using (tenant_id = public.current_tenant_id());

create policy property_keys_tenant_insert on public.property_keys for insert
  with check (tenant_id = public.current_tenant_id());

create policy property_keys_tenant_update on public.property_keys for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy property_keys_tenant_delete on public.property_keys for delete
  using (tenant_id = public.current_tenant_id());

drop policy if exists property_key_events_tenant_select on public.property_key_events;
drop policy if exists property_key_events_tenant_insert on public.property_key_events;
drop policy if exists property_key_events_tenant_delete on public.property_key_events;

create policy property_key_events_tenant_select on public.property_key_events for select
  using (tenant_id = public.current_tenant_id());

create policy property_key_events_tenant_insert on public.property_key_events for insert
  with check (tenant_id = public.current_tenant_id());

-- Geçmiş satırı GÜNCELLENMEZ (denetim izi). Silme yalnız anahtar silinince
-- cascade ile olur; yine de tenant kapılı delete politikası bırakıldı.
create policy property_key_events_tenant_delete on public.property_key_events for delete
  using (tenant_id = public.current_tenant_id());

grant all on public.property_keys       to authenticated, service_role;
grant all on public.property_key_events to authenticated, service_role;

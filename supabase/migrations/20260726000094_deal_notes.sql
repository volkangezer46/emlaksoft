-- Anlaşma notları (deal_notes) — anlaşma detayındaki yorum/not akışı
--
-- Neden:
--  * Denetim bulgusu: "anlaşmaya yorum yazılamıyor" — pipeline'ın en değerli
--    kaydında ekip içi hiçbir serbest metin izi tutulamıyordu.
--  * Teklif → anlaşma dönüşümünün kaynak izi yalnız audit_logs'a düşüyordu
--    (deal.from_offer); kullanıcı görünür bir yerde okuyamıyordu. Dönüşümde
--    artık otomatik sistem notu buraya yazılır.
--
-- Tasarım kararları:
--  * author_id on delete set null — yazar silinse de not (ve dönüşüm izi)
--    yaşamaya devam eder; UI "Ayrılmış kullanıcı" gösterir.
--  * body 1..2000 karakter check — boş not ve makale girişini DB de keser.
--  * delete YALNIZ yazara açık (update politikası bilinçli olarak yok —
--    not düzenlenemez, akış değiştirilemez bir iz olarak kalır).

create table if not exists public.deal_notes (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  deal_id    uuid        not null references public.deals(id)   on delete cascade,
  author_id  uuid        references public.profiles(id) on delete set null,
  body       text        not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table  public.deal_notes           is 'Anlaşma not/yorum akışı — ekip içi izler + otomatik sistem notları (örn. teklif dönüşümü)';
comment on column public.deal_notes.author_id is 'Notu yazan profil — kullanıcı silinirse null kalır, not yaşar';
comment on column public.deal_notes.body      is 'Not gövdesi, 1-2000 karakter';

create index if not exists idx_deal_notes_tenant_deal
  on public.deal_notes(tenant_id, deal_id, created_at desc);

-- ============================================================
-- RLS — tenant deseni (bkz. deal_costs) + yazar kilitleri
-- ============================================================
alter table public.deal_notes enable row level security;

drop policy if exists deal_notes_tenant_select on public.deal_notes;
drop policy if exists deal_notes_tenant_insert on public.deal_notes;
drop policy if exists deal_notes_author_delete on public.deal_notes;

create policy deal_notes_tenant_select on public.deal_notes for select
  using (tenant_id = public.current_tenant_id());

-- insert: kendi tenant'ına ve yalnız kendi adına (author sahteciliği kapalı)
create policy deal_notes_tenant_insert on public.deal_notes for insert
  with check (
    tenant_id = public.current_tenant_id()
    and author_id = auth.uid()
  );

-- delete: yalnız notun yazarı (tenant koşulu ek emniyet)
create policy deal_notes_author_delete on public.deal_notes for delete
  using (
    tenant_id = public.current_tenant_id()
    and author_id = auth.uid()
  );

grant all on public.deal_notes to authenticated, service_role;

-- ============================================================
-- Onay akışları — approval_requests + approval_comments
-- ============================================================
-- Neden:
--  * Danışman standart komisyonun (bkz. `src/lib/commission.ts` → %3) altında oran
--    teklif etmek istediğinde, ya da olağandışı bir gider/indirim çıktığında bu
--    bugün SÖZLE hallediliyor. Kim istedi, kim onayladı, gerekçe neydi — hiçbir iz
--    kalmıyor. Ay sonunda hakediş tartışması çıktığında kimse ispat edemiyor.
--  * Bu tablo o konuşmayı kayda alır: talep → yöneticiye bildirim → gerekçeli
--    onay/ret → audit_logs. Tek merkez /app/onaylar.
--
-- Tasarım kararları:
--  * kind/status text + check (enum DEĞİL): küçük sabit kümeler; enum ADD VALUE ile
--    kullanımı aynı migration'da olamadığı için (087/087b deseni) text daha ucuz.
--  * entity_type/entity_id GENERIC (FK yok): talep bir anlaşmaya, bir gidere ya da
--    bir portföye asılabiliyor. Üç ayrı nullable FK yerine tek çift; ilgili kayıt
--    silinirse talep satırı kalmalı (denetim izi), bu yüzden cascade de istemiyoruz.
--  * current_value / requested_value numeric: türüne göre BİRİMİ değişir —
--    komisyon_indirimi'nde YÜZDE (3 → 2), gider/fiyat_degisikligi'nde TL. Birim
--    bilgisi `kind`'ten türer (bkz. `src/lib/approvals.ts`), ayrı kolon tutulmaz.
--  * decision_note: RET için uygulama katmanında ZORUNLU (DB'de değil — onayda
--    boş kalabiliyor, tek kolonu iki kurala birden bağlamak check'i okunmaz yapardı).
--  * status 'iptal': talep sahibi bekleyen talebini geri çeker. Satır SİLİNMEZ.
--
-- İlgili: /app/onaylar · src/app/actions/approvals.ts · src/lib/approvals.ts

create table if not exists public.approval_requests (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  kind            text        not null
                              check (kind in ('komisyon_indirimi', 'gider', 'fiyat_degisikligi', 'ozel_izin', 'diger')),
  title           text        not null,
  description     text,
  amount          numeric(14,2),
  current_value   numeric(14,2),
  requested_value numeric(14,2),
  entity_type     text,
  entity_id       uuid,
  status          text        not null default 'bekliyor'
                              check (status in ('bekliyor', 'onaylandi', 'reddedildi', 'iptal')),
  requested_by    uuid        references public.profiles(id) on delete set null,
  decided_by      uuid        references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  public.approval_requests                 is 'Müdür onayı gerektiren talepler (komisyon indirimi, olağandışı gider, fiyat değişikliği…) — gerekçeli karar izi';
comment on column public.approval_requests.kind            is 'komisyon_indirimi | gider | fiyat_degisikligi | ozel_izin | diger — rozet/ikon/SLA bu değerden türer';
comment on column public.approval_requests.current_value   is 'Mevcut değer. BİRİM kind''e bağlı: komisyon_indirimi → yüzde, gider/fiyat → TL';
comment on column public.approval_requests.requested_value is 'Talep edilen değer; current_value ile birlikte delta gösterimini besler (formatDelta)';
comment on column public.approval_requests.entity_type     is 'İlgili kayıt türü: deal | expense | property (FK yok — kayıt silinse de talep izi kalır)';
comment on column public.approval_requests.status          is 'bekliyor | onaylandi | reddedildi | iptal (sahibi geri çekti). Satır hiçbir durumda silinmez.';
comment on column public.approval_requests.decision_note   is 'Karar gerekçesi — RET için uygulama katmanında zorunlu, onayda opsiyonel';

-- Ana liste sorgusu: tenant + durum sekmesi + tarih sırası.
create index if not exists idx_approval_requests_tenant_status_created
  on public.approval_requests(tenant_id, status, created_at desc);

-- "Benim taleplerim" sekmesi (?kim=benim).
create index if not exists idx_approval_requests_tenant_requester
  on public.approval_requests(tenant_id, requested_by, created_at desc);

-- İlgili kayıttan talebe gidiş (anlaşma/gider detayından "bu kaydın onayları").
create index if not exists idx_approval_requests_tenant_entity
  on public.approval_requests(tenant_id, entity_type, entity_id);

-- ============================================================
-- approval_comments — talep eden ile yönetici arasındaki karşılıklı not
-- ============================================================
-- Neden ayrı tablo: karar tek satır (decision_note) ama "neden bu oran?" diyaloğu
-- birden çok mesaj. jsonb dizi yerine satır → sıralama, sayfalama ve yazar FK'si bedava.
create table if not exists public.approval_comments (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  request_id uuid        not null references public.approval_requests(id) on delete cascade,
  author_id  uuid        references public.profiles(id) on delete set null,
  body       text        not null,
  created_at timestamptz not null default now()
);

comment on table public.approval_comments is 'Onay talebi altındaki karşılıklı notlar — talep silinirse cascade';

create index if not exists idx_approval_comments_request
  on public.approval_comments(request_id, created_at);

create index if not exists idx_approval_comments_tenant_created
  on public.approval_comments(tenant_id, created_at desc);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.approval_requests enable row level security;
alter table public.approval_comments enable row level security;

drop policy if exists approval_requests_tenant on public.approval_requests;
create policy approval_requests_tenant on public.approval_requests
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists approval_comments_tenant on public.approval_comments;
create policy approval_comments_tenant on public.approval_comments
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy approval_requests_tenant on public.approval_requests is
  'Kiracı izolasyonu — current_tenant_id(). Rol kısıtı (yalnız yönetici karar verir, yalnız sahibi iptal eder) uygulama katmanında: src/app/actions/approvals.ts';
comment on policy approval_comments_tenant on public.approval_comments is
  'Kiracı izolasyonu — current_tenant_id().';

grant all on public.approval_requests to authenticated, service_role;
grant all on public.approval_comments to authenticated, service_role;

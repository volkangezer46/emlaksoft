-- Sözleşme şablonları + sürüm geçmişi
--
-- contract_templates : hazır sözleşme metinleri.
--   * tenant_id NULL  → platformun sunduğu GLOBAL şablon (her ofis görür, kimse düzenleyemez)
--   * tenant_id dolu  → ofisin kendi kaydettiği şablon (yalnızca o tenant görür/yönetir)
-- contract_versions  : sözleşme içeriği her güncellendiğinde ÖNCEKİ hali buraya
--   yazılır ("Sürüm geçmişi" + "Bu sürüme dön"). Sözleşme silinirse cascade.
--
-- Tasarım kararları:
--  * Global şablon seed'leri sabit UUID ile eklenir (on conflict do nothing →
--    migration tekrar koşarsa çift kayıt oluşmaz).
--  * contract_versions.version_no: unique(contract_id, version_no) — sıra
--    action tarafında max+1 ile hesaplanır, yarışta unique ihlali yut(ul)maz.

-- ============================================================
-- Şablonlar
-- ============================================================
create table if not exists public.contract_templates (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        references public.tenants(id) on delete cascade, -- NULL = global
  type       public.contract_type not null default 'diger',
  title      text        not null,
  content    text        not null,
  is_active  boolean     not null default true,
  created_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table  public.contract_templates           is 'Sözleşme şablonları — tenant_id NULL ise global hazır şablon';
comment on column public.contract_templates.tenant_id is 'NULL = platform (global) şablonu; dolu = ofise özel şablon';

create index if not exists idx_contract_templates_tenant
  on public.contract_templates(tenant_id, is_active);

alter table public.contract_templates enable row level security;

drop policy if exists contract_templates_select on public.contract_templates;
drop policy if exists contract_templates_insert on public.contract_templates;
drop policy if exists contract_templates_update on public.contract_templates;
drop policy if exists contract_templates_delete on public.contract_templates;

-- Okuma: global şablonlar + kendi tenant'ının şablonları
create policy contract_templates_select on public.contract_templates for select
  using (tenant_id is null or tenant_id = public.current_tenant_id());

-- Yazma: yalnızca kendi tenant'ına (global şablon eklenemez/değiştirilemez)
create policy contract_templates_insert on public.contract_templates for insert
  with check (tenant_id = public.current_tenant_id());

create policy contract_templates_update on public.contract_templates for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy contract_templates_delete on public.contract_templates for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.contract_templates to authenticated;
grant all on public.contract_templates to service_role;

-- ============================================================
-- Sürüm geçmişi
-- ============================================================
create table if not exists public.contract_versions (
  id          uuid        primary key default gen_random_uuid(),
  contract_id uuid        not null references public.contracts(id) on delete cascade,
  version_no  integer     not null,
  content     text        not null,
  saved_by    uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (contract_id, version_no)
);

comment on table  public.contract_versions            is 'Sözleşme içerik sürümleri — her düzenlemede önceki içerik buraya yazılır';
comment on column public.contract_versions.version_no is '1''den başlayan sıra; unique(contract_id, version_no)';

create index if not exists idx_contract_versions_contract
  on public.contract_versions(contract_id, version_no desc);

alter table public.contract_versions enable row level security;

drop policy if exists contract_versions_select on public.contract_versions;
drop policy if exists contract_versions_insert on public.contract_versions;

-- Sözleşmenin tenant'ı üzerinden izolasyon (contract_signers deseniyle aynı)
create policy contract_versions_select on public.contract_versions for select
  using (
    contract_id in (
      select id from public.contracts where tenant_id = public.current_tenant_id()
    )
  );

create policy contract_versions_insert on public.contract_versions for insert
  with check (
    contract_id in (
      select id from public.contracts where tenant_id = public.current_tenant_id()
    )
  );

-- update/delete politikası bilinçli olarak YOK: sürüm geçmişi değişmezdir.

grant select, insert on public.contract_versions to authenticated;
grant all on public.contract_versions to service_role;

-- ============================================================
-- GLOBAL hazır şablon seed'leri (tenant_id NULL — her ofis görür)
-- ============================================================
insert into public.contract_templates (id, tenant_id, type, title, content) values
(
  'a1f00001-0000-4000-8000-000000000001', null, 'satis',
  'Tek Yetkili Satış Sözleşmesi',
$tpl$TEK YETKİLİ SATIŞ SÖZLEŞMESİ

Mal Sahibi (İş Sahibi): ___________________________
T.C. Kimlik No: ___________________________
Emlak Ofisi (Yetkili): ___________________________
Taşınmaz: ___________________________
Adres: ___________________________
Talep Edilen Satış Bedeli: ___________________________ TL
Yetki Süresi: ___ ay (___ tarihinden ___ tarihine kadar)

MADDE 1 — Konu ve Yetki
Mal sahibi, yukarıda bilgileri yazılı taşınmazın satışı için belirtilen süre boyunca MÜNHASIRAN (tek yetkili olarak) yukarıda adı geçen emlak ofisini yetkilendirmiştir. Yetki süresi içinde mal sahibi, taşınmazı başka bir aracı eliyle veya bizzat satışa sunamaz.

MADDE 2 — Hizmet Bedeli
Satışın gerçekleşmesi hâlinde mal sahibi, satış bedelinin %___ + KDV tutarında hizmet bedelini emlak ofisine ödemeyi kabul eder. Yetki süresi içinde taşınmazın mal sahibince veya üçüncü kişi aracılığıyla satılması hâlinde de aynı bedel ödenir.

MADDE 3 — Ofisin Yükümlülükleri
Emlak ofisi; taşınmazı ilan portallarında yayınlamayı, alıcı adaylarına yer göstermeyi ve süreç hakkında mal sahibini düzenli bilgilendirmeyi taahhüt eder.

MADDE 4 — Süre Sonu
Yetki süresi içinde ofisin yer gösterdiği bir alıcıya, süre bitiminden sonraki ___ ay içinde satış yapılırsa hizmet bedeli yine ödenir.

MADDE 5 — Uyuşmazlık
Uyuşmazlıklarda ___________________________ mahkemeleri ve icra daireleri yetkilidir.

İmzalar:
Mal Sahibi: ___________________________  Tarih: _______
Emlak Ofisi: ___________________________  Tarih: _______$tpl$
),
(
  'a1f00001-0000-4000-8000-000000000002', null, 'kira',
  'Kiralama Yetki Sözleşmesi',
$tpl$KİRALAMA YETKİ SÖZLEŞMESİ

Mal Sahibi (Kiraya Veren): ___________________________
Emlak Ofisi (Yetkili): ___________________________
Taşınmaz: ___________________________
Adres: ___________________________
Talep Edilen Aylık Kira: ___________________________ TL
Yetki Süresi: ___ ay (___ tarihinden ___ tarihine kadar)

MADDE 1 — Konu
Mal sahibi, yukarıda bilgileri yazılı taşınmazın kiraya verilmesi işlemlerinde belirtilen süreyle yukarıda adı geçen emlak ofisini yetkilendirmiştir.

MADDE 2 — Hizmet Bedeli
Kiralamanın gerçekleşmesi hâlinde mal sahibi, bir aylık kira bedeli + KDV tutarında hizmet bedelini emlak ofisine öder. Kiracıdan alınacak hizmet bedeli bu sözleşmenin kapsamı dışındadır.

MADDE 3 — Ofisin Yükümlülükleri
Emlak ofisi; taşınmazı ilana çıkarmayı, kiracı adaylarına yer göstermeyi, aday hakkında edindiği bilgileri (gelir durumu, referans vb.) mal sahibine iletmeyi taahhüt eder. Kira sözleşmesinin tarafı mal sahibi ile kiracıdır; ofis aracıdır.

MADDE 4 — Beyan
Mal sahibi, taşınmaz üzerinde kiralamaya engel bir hak/kısıtlama bulunmadığını beyan eder.

İmzalar:
Mal Sahibi: ___________________________  Tarih: _______
Emlak Ofisi: ___________________________  Tarih: _______$tpl$
),
(
  'a1f00001-0000-4000-8000-000000000003', null, 'diger',
  'Yer Gösterme Tutanağı',
$tpl$YER GÖSTERME TUTANAĞI

Tarih: ___________________________
Emlak Ofisi / Danışman: ___________________________
Müşteri (Alıcı / Kiracı Adayı): ___________________________
T.C. Kimlik No: ___________________________
Telefon: ___________________________
Gösterilen Taşınmaz: ___________________________
Adres: ___________________________

MADDE 1 — Konu
Yukarıda bilgileri yazılı taşınmaz, belirtilen tarihte emlak ofisi danışmanı eşliğinde müşteriye gezdirilerek gösterilmiştir.

MADDE 2 — Müşteri Beyanı
Müşteri; taşınmazın kendisine ilk kez bu ofis aracılığıyla gösterildiğini, taşınmazla ilgili alım/kiralama görüşmelerini bu ofis aracılığıyla yürüteceğini, mal sahibiyle doğrudan veya üçüncü kişiler aracılığıyla temas kurmayacağını kabul ve beyan eder.

MADDE 3 — Hizmet Bedeli
İşlemin gerçekleşmesi hâlinde müşteri, satışta satış bedelinin %___ + KDV, kiralamada bir aylık kira bedeli + KDV tutarında hizmet bedelini ödemeyi kabul eder.

İmzalar:
Danışman: ___________________________  Tarih: _______
Müşteri:  ___________________________  Tarih: _______$tpl$
),
(
  'a1f00001-0000-4000-8000-000000000004', null, 'satis',
  'Kapora (Bağlanma) Sözleşmesi',
$tpl$KAPORA SÖZLEŞMESİ

Satıcı (Mal Sahibi): ___________________________
Alıcı: ___________________________
Alıcı T.C. Kimlik No: ___________________________
Aracı Emlak Ofisi: ___________________________
Taşınmaz: ___________________________
Adres: ___________________________
Satış Bedeli: ___________________________ TL
Kapora Tutarı: ___________________________ TL
Tapu Devri İçin Son Tarih: ___________________________

MADDE 1 — Konu
Alıcı, yukarıda bilgileri yazılı taşınmazı belirtilen bedelle satın almak istediğini beyan etmiş ve niyetinin ciddiyetini göstermek üzere yukarıda yazılı kapora tutarını ödemiştir.

MADDE 2 — Kaporanın Akıbeti
a) Satış tapuda gerçekleştiğinde kapora, satış bedelinden mahsup edilir.
b) Alıcı haklı bir neden olmaksızın satıştan vazgeçerse kapora satıcıda kalır.
c) Satıcı satıştan vazgeçerse kaporayı alıcıya ___ gün içinde iade eder.

MADDE 3 — Süre
Taraflar, tapu devrinin en geç yukarıda yazılı tarihe kadar tamamlanması konusunda anlaşmıştır. Bu tarihe kadar taşınmaz üçüncü kişilere satışa sunulmaz.

MADDE 4 — Hizmet Bedeli
Satışın gerçekleşmesi hâlinde taraflar, aracı emlak ofisine kararlaştırılan hizmet bedelini öder.

İmzalar:
Satıcı: ___________________________  Tarih: _______
Alıcı:  ___________________________  Tarih: _______
Aracı:  ___________________________  Tarih: _______$tpl$
),
(
  'a1f00001-0000-4000-8000-000000000005', null, 'sozlesme',
  'Alım-Satım Aracılık (Hizmet) Sözleşmesi',
$tpl$ALIM-SATIM ARACILIK SÖZLEŞMESİ

Emlak Ofisi (Aracı): ___________________________
Müşteri (İş Sahibi): ___________________________
T.C. Kimlik No: ___________________________
Telefon: ___________________________
Konu Taşınmaz / Talep: ___________________________
Bütçe / Bedel: ___________________________ TL

MADDE 1 — Kapsam
Emlak ofisi; müşterinin taşınmaz alım/satım sürecinde uygun taşınmazların bulunması, yer gösterilmesi, pazarlık ve tapu işlemlerine eşlik edilmesi konularında aracılık ve danışmanlık hizmeti verir.

MADDE 2 — Hizmet Bedeli
İşlemin gerçekleşmesi hâlinde müşteri, işlem bedelinin %___ + KDV tutarında hizmet bedelini emlak ofisine öder. Hizmet bedeli, tapu devri gününde ödenir.

MADDE 3 — Tarafların Yükümlülükleri
Müşteri, ofisin gösterdiği taşınmazlar için mal sahibiyle doğrudan temas kurmayacağını; ofis, edindiği bilgileri doğru ve eksiksiz aktaracağını taahhüt eder.

MADDE 4 — Kişisel Veriler (KVKK)
Taraflar, bu sözleşme kapsamında paylaşılan kişisel verilerin 6698 sayılı KVKK'ya uygun olarak yalnızca aracılık hizmeti amacıyla işleneceğini kabul eder.

MADDE 5 — Süre
Bu sözleşme ___ tarihinden itibaren ___ ay geçerlidir.

İmzalar:
Emlak Ofisi: ___________________________  Tarih: _______
Müşteri:     ___________________________  Tarih: _______$tpl$
)
on conflict (id) do nothing;

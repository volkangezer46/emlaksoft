-- WhatsApp şablon mesaj kütüphanesi (message_templates)
--
-- Neden:
--  * Sistemde her yerde WhatsApp butonu var (`toWhatsAppLink`) ama mesaj gövdesi
--    yok; danışman her seferinde "Merhaba, ... hakkında yazıyorum" cümlesini
--    sıfırdan yazıyor. Ofis kendi standart metinlerini bir kez tanımlasın,
--    danışman tek tıkla değişkenleri dolu mesajla WhatsApp'ı açsın.
--  * API/otomatik gönderim YOK — kullanıcı kendi telefonundaki WhatsApp'tan
--    gönderir (wa.me deep-link). Bu yüzden İYS/EİDS izin akışıyla ilgisi yoktur;
--    ticari elektronik ileti kapsamına giren SMS tarafı ayrı (bkz. campaigns).
--
-- Tasarım kararları:
--  * body max 1000: WhatsApp deep-link URL'i (?text=...) encode edildikten sonra
--    tarayıcı adres uzunluk sınırlarına takılmasın; 1000 karakter pratikte
--    en uzun ilan bilgilendirmesi için fazlasıyla yeterli.
--  * category text + check (enum değil): 6 sabit kategori için enum migration
--    yükü gereksiz, UI rozet rengi bu değerden türer.
--  * usage_count: hangi şablon işe yarıyor sorusunun cevabı. Sıralama/ölçüm
--    için; atomik artırım `increment_template_usage()` ile yapılır ki iki
--    danışman aynı anda kullandığında okuma-yazma yarışı sayı kaybetmesin.
--  * increment_template_usage security definer: RLS update politikası zaten
--    tenant sınırını çiziyor, ama fonksiyon `where tenant_id = current_tenant_id()`
--    filtresini kendisi uygular — çağıran yalnız kendi tenant'ının şablonunun
--    sayacını artırabilir. Fire-and-forget çağrıldığı için hata fırlatmaz.
--  * sort_order: ofis şablonları kendi öncelik sırasına dizsin (küçük önce).

create table if not exists public.message_templates (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 120),
  body        text        not null check (char_length(body) between 1 and 1000),
  category    text        not null default 'genel'
                check (category in ('genel', 'portfoy', 'randevu', 'teklif', 'takip', 'kutlama')),
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  usage_count integer     not null default 0,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.message_templates             is 'Ofise özel WhatsApp şablon mesajları — wa.me deep-link ile açılır, otomatik gönderim yok';
comment on column public.message_templates.body        is 'Gövde; {musteri} {danisman} {ofis} {portfoy} {fiyat} ... yer tutucuları render sırasında doldurulur (src/lib/message-templates.ts)';
comment on column public.message_templates.category    is 'genel | portfoy | randevu | teklif | takip | kutlama — UI rozet rengi buradan türer';
comment on column public.message_templates.usage_count is 'Kaç kez kullanıldı — increment_template_usage() ile atomik artar';
comment on column public.message_templates.sort_order  is 'Listeleme sırası (küçük önce), eşitlikte usage_count desc';

create index if not exists idx_message_templates_tenant_category
  on public.message_templates(tenant_id, category);

-- ============================================================
-- RLS — tenant izolasyonu; yazma yetkisi uygulama katmanında
-- requirePermission("settings","edit") ile ayrıca kapılı.
-- ============================================================
alter table public.message_templates enable row level security;

drop policy if exists message_templates_tenant_select on public.message_templates;
drop policy if exists message_templates_tenant_insert on public.message_templates;
drop policy if exists message_templates_tenant_update on public.message_templates;
drop policy if exists message_templates_tenant_delete on public.message_templates;

create policy message_templates_tenant_select on public.message_templates for select
  using (tenant_id = public.current_tenant_id());

create policy message_templates_tenant_insert on public.message_templates for insert
  with check (tenant_id = public.current_tenant_id());

create policy message_templates_tenant_update on public.message_templates for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy message_templates_tenant_delete on public.message_templates for delete
  using (tenant_id = public.current_tenant_id());

grant all on public.message_templates to authenticated, service_role;

-- ============================================================
-- Atomik kullanım sayacı
-- ============================================================
create or replace function public.increment_template_usage(p_template_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.message_templates
     set usage_count = usage_count + 1,
         updated_at  = now()
   where id = p_template_id
     and tenant_id = public.current_tenant_id();
$$;

comment on function public.increment_template_usage(uuid)
  is 'Şablon kullanım sayacını atomik +1 artırır; yalnız çağıranın kendi tenant satırına etki eder';

revoke all on function public.increment_template_usage(uuid) from public;
grant execute on function public.increment_template_usage(uuid) to authenticated, service_role;

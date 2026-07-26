-- KVKK yaşam döngüsü: anonimleştirme + silme kanıtı (X5)
--
-- ============================================================================
-- ENVANTER (canlı şemadan çıkarıldı, varsayım değil)
-- ============================================================================
-- Kişisel veri 20 tabloya yayılmış. Kritik olanlar:
--
--   customers            full_name, phone, email, notes, birth_date
--   calls                phone, notes
--   campaign_recipients  full_name, phone      ← DENORMALIZE KOPYA
--   open_house_visitors  full_name, phone, email, notes  ← DENORMALIZE KOPYA
--   contract_signers     full_name, email, phone, ip_address
--   appointments/tasks/offers/valuations/…  notes (serbest metin)
--
-- ============================================================================
-- BULGU 1: SİLME İSTEĞİ ŞU AN YERİNE GETİRİLEMİYOR
-- ============================================================================
-- `deleted_at` yalnızca `customers` ve `properties` tablolarında var ve
-- HİÇBİR ŞEY o satırları temizlemiyor. Yani "silinmiş" bir müşterinin adı,
-- telefonu ve e-postası veritabanında SONSUZA KADAR duruyor. KVKK'nın silme
-- (unutulma) hakkı bu hâliyle karşılanmıyor.
--
-- ============================================================================
-- BULGU 2: GERÇEK SİLME ZATEN MÜMKÜN DEĞİL
-- ============================================================================
-- `deals` ve `calls` tablolarının `customer_id` yabancı anahtarında
-- `ON DELETE` yok — yani NO ACTION (kısıtlayıcı). Bir müşterinin tek bir
-- çağrı kaydı ya da anlaşması varsa `DELETE FROM customers` HATA VERİR.
--
-- Bu bir kusur değil, doğru davranış: ticari kayıtlar (TTK gereği) saklanmak
-- zorunda. Dolayısıyla tek uygulanabilir yol ANONİMLEŞTİRME — satır iskeleti
-- ve finansal bağ kalır, kişiyi işaret eden alanlar maskelenir.
--
-- ============================================================================
-- BULGU 3: DENORMALİZE KOPYALAR ATLANIRSA ANONİMLEŞTİRME SAHTE OLUR
-- ============================================================================
-- `campaign_recipients` ve `open_house_visitors` müşterinin adını ve
-- telefonunu KENDİ satırlarında tutuyor. Yalnızca `customers` maskelenirse
-- kişi bu iki tablodan hâlâ bulunabilir. Fonksiyon ikisini de kapsıyor.

-- ============================================================================
-- Silme kanıtı
-- ============================================================================
-- Denetimde gösterilecek olan bu tablo. `customer_id` için YABANCI ANAHTAR
-- YOK: kayıt anonimleştirilse de silinse de kanıt ayakta kalmalı.
create table if not exists public.kvkk_erasure_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  customer_id   uuid not null,
  /*
   * Maskeli referans: denetimde "hangi kayıt" sorusuna cevap vermek için
   * yeterli, kişiyi yeniden bulmaya yetmeyecek kadar az.
   * Örn. "A** Y*** · 0532****67"
   */
  customer_ref  text not null,
  reason        text,
  actor_id      uuid,
  /** { "customers": 1, "calls": 12, ... } — hangi tabloda kaç satır maskelendi. */
  affected      jsonb not null default '{}'::jsonb,
  performed_at  timestamptz not null default now()
);

create index if not exists idx_kvkk_erasure_tenant
  on public.kvkk_erasure_log (tenant_id, performed_at desc);

alter table public.kvkk_erasure_log enable row level security;

create policy kvkk_erasure_tenant on public.kvkk_erasure_log
  for select
  using (tenant_id = public.current_tenant_id());

create policy kvkk_erasure_staff on public.kvkk_erasure_log
  for all
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

-- ============================================================================
-- Maskeleme yardımcıları
-- ============================================================================

/** "Ayşe Yılmaz" → "A*** Y*****" — denetimde ayırt etmeye yeter, kimliğe götürmez. */
create or replace function public.mask_name(v text)
returns text
language sql
immutable
as $$
  select case
    when v is null or btrim(v) = '' then null
    else (
      select string_agg(
        left(parca, 1) || repeat('*', greatest(1, length(parca) - 1)),
        ' ' order by sira
      )
      from unnest(regexp_split_to_array(btrim(v), '\s+')) with ordinality as t(parca, sira)
    )
  end;
$$;

/** "05321234567" → "0532****67" */
create or replace function public.mask_phone(v text)
returns text
language sql
immutable
as $$
  select case
    when v is null or length(v) < 7 then null
    else left(v, 4) || '****' || right(v, 2)
  end;
$$;

-- ============================================================================
-- Anonimleştirme
-- ============================================================================
/*
 * KİRACI KİMLİĞİ PARAMETREDEN ALINMIYOR.
 *
 * Fonksiyon SECURITY DEFINER (RLS'i atlaması gerekiyor, çünkü maskeleyeceği
 * satırların bir kısmı çağıranın RLS'i altında güncellenemez). Bu durumda
 * kiracıyı parametre olarak almak, çağıranın BAŞKA bir kiracının müşterisini
 * anonimleştirmesine izin vermek demektir.
 *
 * Kimlik `current_tenant_id()` ile OTURUMDAN çözülüyor ve müşterinin o
 * kiracıya ait olduğu doğrulanıyor. Aynı hata `notifyTenant`ta bulunmuştu.
 */
create or replace function public.anonymize_customer(
  p_customer_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_actor    uuid := auth.uid();
  v_name     text;
  v_phone    text;
  v_ref      text;
  v_affected jsonb := '{}'::jsonb;
  v_n        integer;
begin
  if v_tenant is null then
    raise exception 'Kiracı kimliği çözülemedi.';
  end if;

  -- Müşteri gerçekten bu kiracıya mı ait? SECURITY DEFINER olduğu için bu
  -- kontrol ŞART; RLS burada devrede değil.
  select full_name, phone into v_name, v_phone
  from public.customers
  where id = p_customer_id and tenant_id = v_tenant;

  if not found then
    raise exception 'Müşteri bulunamadı ya da bu ofise ait değil.';
  end if;

  -- Zaten anonimleştirilmiş mi? Tekrar çalıştırmak kanıt kaydını çoğaltır.
  if exists (
    select 1 from public.kvkk_erasure_log
    where customer_id = p_customer_id and tenant_id = v_tenant
  ) then
    raise exception 'Bu kayıt daha önce anonimleştirilmiş.';
  end if;

  v_ref := coalesce(public.mask_name(v_name), 'İsimsiz') || ' · ' || coalesce(public.mask_phone(v_phone), '—');

  -- 1) Ana kayıt
  update public.customers set
    full_name        = 'Anonimleştirilmiş kayıt',
    phone            = null,
    email            = null,
    notes            = null,
    birth_date       = null,
    anniversary_date = null,
    anniversary_note = null,
    -- NOT: `customers` tablosunda `address_line` kolonu YOK (canli semadan
    -- dogrulandi). Musteri adresi yalnizca il/ilce kimligi olarak tutuluyor,
    -- serbest metin adres portfoyde. Il/ilce tek basina kisiyi isaret etmez,
    -- bolgesel raporlama icin degeri var — bu yuzden korunuyor.
    deleted_at       = coalesce(deleted_at, now()),
    updated_at       = now()
  where id = p_customer_id and tenant_id = v_tenant;
  v_affected := v_affected || jsonb_build_object('customers', 1);

  -- 2) DENORMALİZE KOPYALAR — atlanırsa anonimleştirme sahte olur
  update public.campaign_recipients set full_name = null, phone = ''
  where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('campaign_recipients', v_n); end if;

  update public.open_house_visitors set full_name = 'Anonim', phone = null, email = null, notes = null
  where created_customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('open_house_visitors', v_n); end if;

  -- 3) Çağrı kayıtları: numara maskelenir, sayaç/süre korunur (ticari kayıt)
  update public.calls set phone = null, notes = null
  where customer_id = p_customer_id and tenant_id = v_tenant;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('calls', v_n); end if;

  -- 4) Serbest metin alanları: kişisel bilgi taşıma olasılığı en yüksek yer
  update public.appointments set notes = null
  where customer_id = p_customer_id and tenant_id = v_tenant and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('appointments', v_n); end if;

  update public.tasks set notes = null
  where customer_id = p_customer_id and tenant_id = v_tenant and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('tasks', v_n); end if;

  update public.offers set notes = null
  where customer_id = p_customer_id and tenant_id = v_tenant and notes is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('offers', v_n); end if;

  update public.communications set body = null, subject = null
  where customer_id = p_customer_id and tenant_id = v_tenant;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('communications', v_n); end if;

  -- 5) İzinler geri çekilir — anonim bir kayda mesaj gönderilemez
  update public.iys_consents set status = 'revoked', revoked_at = coalesce(revoked_at, now())
  where customer_id = p_customer_id and tenant_id = v_tenant and status <> 'revoked';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('iys_consents', v_n); end if;

  -- 6) Portal erişim token'ları iptal
  delete from public.customer_portal_tokens where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('customer_portal_tokens', v_n); end if;

  -- 7) KANIT — denetimde gösterilecek olan
  insert into public.kvkk_erasure_log (tenant_id, customer_id, customer_ref, reason, actor_id, affected)
  values (v_tenant, p_customer_id, v_ref, nullif(btrim(coalesce(p_reason, '')), ''), v_actor, v_affected);

  return jsonb_build_object('ok', true, 'ref', v_ref, 'affected', v_affected);
end;
$$;

comment on function public.anonymize_customer(uuid, text) is
  'KVKK silme talebi. GERCEK SILME MUMKUN DEGIL (deals/calls FK kisitlayici + TTK sakli tutma), bu yuzden anonimlestirme yapar. Kiraci kimligi PARAMETREDEN DEGIL current_tenant_id() ile cozulur.';

-- ============================================================================
-- Saklama süresi: soft-delete edilmiş kayıtları anonimleştir
-- ============================================================================
/*
 * `deleted_at` işaretli müşteriler hiç temizlenmiyordu. Bu fonksiyon belirli
 * bir süreden eski soft-delete kayıtlarını anonimleştirir ve kaç kayıt
 * işlendiğini döner. Cron'dan çağrılabilir.
 *
 * VARSAYILAN 1095 GÜN (3 yıl): ticari kayıtların saklanma yükümlülüğü ile
 * silme hakkı arasındaki dengeyi ofis kendi hukuk görüşüne göre ayarlamalı;
 * bu sayı bir öneri, mevzuat hükmü değil.
 */
create or replace function public.purge_stale_customers(p_days integer default 1095)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id     uuid;
  v_count  integer := 0;
begin
  if v_tenant is null then
    raise exception 'Kiracı kimliği çözülemedi.';
  end if;

  for v_id in
    select c.id from public.customers c
    where c.tenant_id = v_tenant
      and c.deleted_at is not null
      and c.deleted_at < now() - make_interval(days => p_days)
      and not exists (
        select 1 from public.kvkk_erasure_log l
        where l.customer_id = c.id and l.tenant_id = v_tenant
      )
  loop
    perform public.anonymize_customer(v_id, 'Saklama süresi doldu (otomatik)');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.anonymize_customer(uuid, text) to authenticated;
grant execute on function public.purge_stale_customers(integer) to authenticated;
grant select on public.kvkk_erasure_log to authenticated;

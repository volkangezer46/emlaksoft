-- `anonymize_customer` düzeltmesi: üç şema kısıtı fonksiyonu çalıştırmıyordu
--
-- ============================================================================
-- CANLI TESTTE ORTAYA ÇIKAN ÜÇ HATA
-- ============================================================================
-- Fonksiyon yazıldı, migration uygulandı — ama gerçek veriyle denenince
-- kısıtlara çarptı. Üçü de sessiz değil, doğrudan hata veriyordu; yani
-- özellik hiç çalışmıyordu.
--
-- 1) `iys_consents.status` CHECK'i 'revoked' KABUL ETMİYOR
--       CHECK (status = ANY (ARRAY['granted','denied','unknown','pending']))
--    Fonksiyon `status = 'revoked'` yazıyordu. Doğru değer 'denied';
--    geri çekilme zamanı zaten ayrı bir `revoked_at` kolonunda tutuluyor.
--
-- 2) `calls.phone` NOT NULL
--    Fonksiyon `phone = null` yazıyordu. Üstelik bir de format kısıtı var:
--       CHECK (phone ~ '^05\d{9}$')
--    Yani numarayı boşaltmak değil, GEÇERLİ AMA GERÇEK OLMAYAN bir değerle
--    değiştirmek gerekiyor. `05000000000` seçildi: 0500 Türkiye'de tahsis
--    edilmiş bir mobil ön ek değil, dolayısıyla kimseye ait olamaz.
--
-- 3) `open_house_visitors.full_name` NOT NULL
--    Fonksiyon zaten 'Anonim' yazıyordu — bu doğruydu, değişiklik yok.
--
-- DERS: Kısıtları okumadan yazılan bir maskeleme fonksiyonu, tam da en
-- gerekli olduğu anda (silme talebi geldiğinde) hata verir.

/** Anonimleştirmede kullanılan yer tutucu numara. 0500 tahsis edilmiş bir ön ek değil. */
comment on function public.mask_phone(text) is
  'Denetim referansi icin telefon maskesi. Anonimlestirmede kullanilan yer tutucu 05000000000 (0500 tahsis edilmis bir on ek degil).';

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
  -- calls.phone NOT NULL + format kısıtlı; boşaltmak yerine yer tutucu.
  c_placeholder constant text := '05000000000';
begin
  if v_tenant is null then
    raise exception 'Kiracı kimliği çözülemedi.';
  end if;

  -- SECURITY DEFINER: RLS devrede değil, sahiplik kontrolü ŞART.
  select full_name, phone into v_name, v_phone
  from public.customers
  where id = p_customer_id and tenant_id = v_tenant;

  if not found then
    raise exception 'Müşteri bulunamadı ya da bu ofise ait değil.';
  end if;

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
    deleted_at       = coalesce(deleted_at, now()),
    updated_at       = now()
  where id = p_customer_id and tenant_id = v_tenant;
  v_affected := v_affected || jsonb_build_object('customers', 1);

  -- 2) Denormalize kopyalar — atlanırsa anonimleştirme sahte olur
  update public.campaign_recipients set full_name = null, phone = c_placeholder
  where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('campaign_recipients', v_n); end if;

  update public.open_house_visitors set full_name = 'Anonim', phone = null, email = null, notes = null
  where created_customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('open_house_visitors', v_n); end if;

  -- 3) Çağrı kayıtları: NOT NULL + format kısıtı yüzünden yer tutucu.
  --    Süre ve sonuç korunuyor — ticari kayıt.
  update public.calls set phone = c_placeholder, notes = null
  where customer_id = p_customer_id and tenant_id = v_tenant;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('calls', v_n); end if;

  -- 4) Serbest metin alanları
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

  -- 5) İzinler: CHECK 'revoked' kabul etmiyor → 'denied'.
  --    Geri çekilme zamanı `revoked_at` kolonunda.
  update public.iys_consents set status = 'denied', revoked_at = coalesce(revoked_at, now())
  where customer_id = p_customer_id and tenant_id = v_tenant and status <> 'denied';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('iys_consents', v_n); end if;

  -- 6) Portal erişimi iptal
  delete from public.customer_portal_tokens where customer_id = p_customer_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_affected := v_affected || jsonb_build_object('customer_portal_tokens', v_n); end if;

  -- 7) Kanıt
  insert into public.kvkk_erasure_log (tenant_id, customer_id, customer_ref, reason, actor_id, affected)
  values (v_tenant, p_customer_id, v_ref, nullif(btrim(coalesce(p_reason, '')), ''), v_actor, v_affected);

  return jsonb_build_object('ok', true, 'ref', v_ref, 'affected', v_affected);
end;
$$;

grant execute on function public.anonymize_customer(uuid, text) to authenticated;

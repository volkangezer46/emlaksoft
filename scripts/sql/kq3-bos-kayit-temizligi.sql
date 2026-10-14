-- KQ3 bir kerelik bakım: test sırasında boş formdan oluşan 4 kayıt (2 anlaşma, 2 randevu), demo-ofis kiracısı.
-- Şema değişikliği YOK; migration değildir. Yalnız aşağıdaki ID'ler ve tenant=demo-ofis koşuluyla çalışır.
--
-- Çalıştırma (yalnız yayın yetkisiyle, sahip onayıyla):
--   docker exec -i <supabase-db-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/sql/kq3-bos-kayit-temizligi.sql
-- Salt-okunur ön kontrol: aşağıdaki "ÖN KONTROL" bölümü tek başına çalıştırılabilir.
--
-- 2026-10-14 salt-okunur kontrol (canlı): 4 satır var, hepsi demo-ofis'te; anlaşmalarda müşteri/portföy/tutar boş
-- (stage=new), randevular katılımcısız yer gösterme (07:00 UTC = 10:00 TR). Anlaşmaya FK ile bağlı tablolar:
-- commissions, deal_checklist_items, deal_costs, deal_notes, deal_process_steps, offers, rentals, surveys, survey_tasks,
-- tasks; randevuya FK yok.
-- 2026-10-14 ÖN KONTROL (canlı, `begin transaction read only` + rollback): deals=2, appointments=2, bağlı FK satırı
-- toplamı 0 (deal_process_steps/checklist dahil; deals/appointments üzerinde satır açan tetikleyici yok — yalnız
-- deals_guard_atomic_stage ve trg_block_readonly_identity_writes), audit_logs=2, notifications=0. Koruma durmaz.
-- SİLME ÇALIŞTIRILMADI: sahip/yayın yetkili oturum çalıştırıp "kalan = 0" çıktısını kayda geçirir.
-- Silme bağlı FK satırı varsa ya da kayıt boş değilse DURUR (DO bloğu). audit_logs/notifications FK değildir;
-- ön kontrolde sayılır, silinmez (denetim izi kalır).

\set ON_ERROR_STOP on

begin;

-- ÖN KONTROL --------------------------------------------------------------------------------------------
with t as (select id from public.tenants where slug = 'demo-ofis'),
ids(deal_id) as (values ('b0dc31b9-7a59-4320-891f-dfb0d17dbe4c'::uuid), ('0a507199-93e8-4537-808b-20388eeb29f1'::uuid)),
appt(appt_id) as (values ('3ea9e851-f452-455e-a5d4-4183d083cf9d'::uuid), ('8f38f8b7-bd19-4428-a220-0f46d00698d1'::uuid))
select 'deals' as tablo, count(*) from public.deals where id in (select deal_id from ids) and tenant_id = (select id from t)
union all select 'appointments', count(*) from public.appointments where id in (select appt_id from appt) and tenant_id = (select id from t)
union all select 'commissions', count(*) from public.commissions where deal_id in (select deal_id from ids)
union all select 'deal_checklist_items', count(*) from public.deal_checklist_items where deal_id in (select deal_id from ids)
union all select 'deal_costs', count(*) from public.deal_costs where deal_id in (select deal_id from ids)
union all select 'deal_notes', count(*) from public.deal_notes where deal_id in (select deal_id from ids)
union all select 'deal_process_steps', count(*) from public.deal_process_steps where deal_id in (select deal_id from ids)
union all select 'offers', count(*) from public.offers where deal_id in (select deal_id from ids)
union all select 'rentals', count(*) from public.rentals where deal_id in (select deal_id from ids)
union all select 'surveys', count(*) from public.surveys where deal_id in (select deal_id from ids)
union all select 'survey_tasks', count(*) from public.survey_tasks where deal_id in (select deal_id from ids)
union all select 'tasks', count(*) from public.tasks where deal_id in (select deal_id from ids)
union all select 'audit_logs', count(*) from public.audit_logs
  where entity_id::text in (select deal_id::text from ids union all select appt_id::text from appt)
union all select 'notifications', count(*) from public.notifications
  where href like any (array['%b0dc31b9-7a59-4320-891f-dfb0d17dbe4c%', '%0a507199-93e8-4537-808b-20388eeb29f1%',
                             '%3ea9e851-f452-455e-a5d4-4183d083cf9d%', '%8f38f8b7-bd19-4428-a220-0f46d00698d1%'])
     or dedupe_key like any (array['%b0dc31b9-7a59-4320-891f-dfb0d17dbe4c%', '%0a507199-93e8-4537-808b-20388eeb29f1%',
                                   '%3ea9e851-f452-455e-a5d4-4183d083cf9d%', '%8f38f8b7-bd19-4428-a220-0f46d00698d1%']);

-- KORUMA: bağlı satır varsa ya da kayıt boş değilse dur (yalnız kimliği bilinen BOŞ test kayıtları silinir) -----------
do $$
declare
  v_tenant uuid := (select id from public.tenants where slug = 'demo-ofis');
  v_deals uuid[] := array['b0dc31b9-7a59-4320-891f-dfb0d17dbe4c', '0a507199-93e8-4537-808b-20388eeb29f1']::uuid[];
  v_appts uuid[] := array['3ea9e851-f452-455e-a5d4-4183d083cf9d', '8f38f8b7-bd19-4428-a220-0f46d00698d1']::uuid[];
  v_linked bigint;
begin
  if v_tenant is null then raise exception 'demo-ofis kiracısı yok'; end if;
  select (select count(*) from public.commissions where deal_id = any(v_deals))
       + (select count(*) from public.deal_checklist_items where deal_id = any(v_deals))
       + (select count(*) from public.deal_costs where deal_id = any(v_deals))
       + (select count(*) from public.deal_notes where deal_id = any(v_deals))
       + (select count(*) from public.deal_process_steps where deal_id = any(v_deals))
       + (select count(*) from public.offers where deal_id = any(v_deals))
       + (select count(*) from public.rentals where deal_id = any(v_deals))
       + (select count(*) from public.surveys where deal_id = any(v_deals))
       + (select count(*) from public.survey_tasks where deal_id = any(v_deals))
       + (select count(*) from public.tasks where deal_id = any(v_deals))
    into v_linked;
  if v_linked > 0 then raise exception 'bağlı satır var (%): silme durduruldu', v_linked; end if;
  if exists (select 1 from public.deals where id = any(v_deals) and tenant_id = v_tenant
             and (customer_id is not null or property_id is not null or deal_value is not null)) then
    raise exception 'anlaşma boş değil: silme durduruldu';
  end if;
  if exists (select 1 from public.appointments where id = any(v_appts) and tenant_id = v_tenant
             and (customer_id is not null or property_id is not null)) then
    raise exception 'randevu boş değil: silme durduruldu';
  end if;

  delete from public.deals where id = any(v_deals) and tenant_id = v_tenant;
  delete from public.appointments where id = any(v_appts) and tenant_id = v_tenant;
end $$;

-- SONRA: 0 beklenir.
select count(*) as kalan from (
  select id from public.deals where id in ('b0dc31b9-7a59-4320-891f-dfb0d17dbe4c', '0a507199-93e8-4537-808b-20388eeb29f1')
  union all
  select id from public.appointments where id in ('3ea9e851-f452-455e-a5d4-4183d083cf9d', '8f38f8b7-bd19-4428-a220-0f46d00698d1')
) x;

commit;

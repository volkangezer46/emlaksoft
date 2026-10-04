-- Rollback: 20260816001400_advisor_specialties_regions
-- Uzmanlık/bölge kayıtları silinir; atama önerisi bu verisiz çalışmaz (önce P-HAVUZ kodunu kapatın).
-- Seed edilen global 'advisor_segment' tanımları (tenant_id null) silinir; ofislerin kendi satırları kalır.
drop table if exists public.advisor_regions;
drop table if exists public.advisor_specialties;
delete from public.definitions where tenant_id is null and category = 'advisor_segment';

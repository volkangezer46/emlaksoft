-- SK7 / B092 — SALT-OKUNUR rapor: aynı telefonla birden çok aktif müşteri (mükerrer grupları).
-- BİRLEŞTİRME YAPMAZ, hiçbir satırı değiştirmez. Birleştirme kararı ofisindir: /app/musteriler → kayıt → "Birleştir"
-- (mergeCustomers, alt kayıtları taşır). Kullanım (sunucuda, yalnız okuma):
--   docker exec supabase-db-<id> psql -U postgres -d postgres -f /yol/customer-duplicate-phone-groups.sql
-- 2026-10-16 canlı taban: Demo Emlak Ofisi'nde 6 grup (05321000001, 05321112233, 05321234567, 05329994107,
-- 05332223344, 05559990001); SK7 kapısı (createCustomer + hızlı kayıt + ilan sahibi) yeni grup oluşmasını engeller.
select
  t.name                                                   as ofis,
  c.phone                                                  as telefon,
  count(*)                                                 as kayit_sayisi,
  string_agg(c.full_name, ' | ' order by c.created_at)     as adlar,
  string_agg(c.id::text, ' | ' order by c.created_at)      as kimlikler,
  min(c.created_at)                                        as ilk_kayit,
  max(c.created_at)                                        as son_kayit
from public.customers c
join public.tenants t on t.id = c.tenant_id
where c.deleted_at is null
  and c.phone is not null
group by t.name, c.phone
having count(*) > 1
order by t.name, c.phone;

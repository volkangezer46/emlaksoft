-- MIGRATION 20261017010100_finance_open_items_v3.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, WP1 (acik kalem gorunumu v3).
-- Geri alma: supabase/rollbacks/20261017010100_finance_open_items_v3.rollback.sql (gorunum 20261014011000 tanimina,
--   finance_v2_source_visible 20261014001100 govdesine doner). 20261017010000 geri alinmadan ONCE calistirilir.
-- BAGIMLILIK: 20261017010000_finance_posting_core (posting_key), 20261014011000 (P12 gorunum), 20260816000400
--   (commission_payouts), 20261008001700 (building_charges), 20260724000039 (property_dues), 20260825000100
--   (properties.owner_customer_id).
--
-- NE (kolonlar ve sira AYNI; yalniz satirlar degisir):
--  1) Komisyon alacagi = gross_amount (KDV HARIC matrah) + vat_amount - net tahsilat (giris - ayna cikis).
--     ESKI HATA: gross_amount - KDV dahil tahsilat -> kismi tahsilatta kalem erken kapanmis gorunuyordu.
--  2) Kayit servisiyle (posting_key) acilmis kalemi olan kaynak hesaplanmis kolda TEKRAR gorunmez (cift sayim yok).
--  3) Yeni kollar: bina aidati alacagi (building_charges), aidat borcu (property_dues, unpaid), danisman hakedis borcu
--     (commission_payouts pending/approved; P12: yalniz kendi hakedisi ya da earnings_all).
--  4) Cari cozumu: komisyon -> anlasma musterisinin carisi, kira -> kiracinin carisi, malik hakedisi -> portfoy malikinin
--     carisi, bina -> odeyenin carisi, hakedis -> danismanin carisi (finance_parties.customer_id / user_id).
--  5) finance_v2_source_visible: 'payout' satiri commissions:view ister (definer okuyuculari icin; RLS ile ayni sonuc).
-- GUVENLIK: gorunum security_invoker (kaynak tablolarin RLS'i gecerli); P12 kosulu recurring ve hakedis kolunda acikca.
-- ETKI: davranis (yaslandirma/cari/tahmin rakamlari duzelir: komisyon alacagi KDV kadar artar, aidat/hakedis kalemleri gorunur).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_open_items_v') is null
     or pg_catalog.to_regclass('public.commission_payouts') is null
     or pg_catalog.to_regclass('public.building_charges') is null
     or pg_catalog.to_regclass('public.building_units') is null
     or pg_catalog.to_regclass('public.buildings') is null
     or pg_catalog.to_regclass('public.property_dues') is null
     or pg_catalog.to_regprocedure('public.finance_party_foreign_advisor(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_source_visible(text)') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'posting_key' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'reversal_of' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.properties'::regclass and attname = 'owner_customer_id' and not attisdropped) then
    raise exception '20261017010100: once 20261017010000 (kayit cekirdegi), 20261014011000, 20261008001700 ve 20260825000100 uygulanmali.';
  end if;
end $$;

create or replace function public.finance_v2_source_visible(p_source text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_source in ('rent', 'owner_payout') then public.has_effective_permission('rentals', 'view')
    when p_source in ('commission', 'payout') then public.has_effective_permission('commissions', 'view')
    else true
  end;
$$;

create or replace view public.finance_open_items_v
with (security_invoker = true)
as
select 'manual:' || o.id::text as key,
       'manual'::text as source,
       o.id as source_id,
       o.tenant_id,
       o.direction,
       o.party_id,
       coalesce(p.name, '')::text as party_label,
       o.title,
       o.category,
       (o.amount - o.paid_amount)::numeric as amount_open,
       o.currency,
       o.due_date,
       ('/app/giderler?sekme=cari&kalem=' || o.id::text)::text as href
from public.finance_open_items o
left join public.finance_parties p on p.id = o.party_id
where o.status in ('open', 'partial') and o.amount > o.paid_amount
union all
select 'rent:' || c.id::text,
       'rent',
       c.id,
       c.tenant_id,
       'receivable',
       rp.id,
       coalesce(cu.full_name, '')::text,
       ('Kira ' || pg_catalog.to_char(c.period, 'MM.YYYY'))::text,
       'kira_tahsilat'::text,
       (c.amount - coalesce(c.paid_amount, 0))::numeric,
       'TRY'::text,
       (c.period + (least(greatest(coalesce(r.due_day, 1), 1), 28) - 1))::date,
       ('/app/kiralama/' || r.id::text)::text
from public.rent_charges c
join public.rentals r on r.id = c.rental_id and r.tenant_id = c.tenant_id
left join public.customers cu on cu.id = r.renter_customer_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = c.tenant_id and fp.customer_id = r.renter_customer_id and fp.archived_at is null
   order by (fp.kind = 'kiraci') desc, fp.created_at, fp.id
   limit 1
) rp on true
where c.status <> 'paid' and c.amount > coalesce(c.paid_amount, 0)
union all
select 'commission:' || m.id::text,
       'commission',
       m.id,
       m.tenant_id,
       'receivable',
       mp.id,
       coalesce(cu.full_name, '')::text,
       'Komisyon'::text,
       'komisyon'::text,
       (m.gross_amount + greatest(coalesce(m.vat_amount, 0), 0) - col.collected)::numeric,
       'TRY'::text,
       (m.created_at at time zone 'Europe/Istanbul')::date,
       ('/app/anlasmalar/' || m.deal_id::text)::text
from public.commissions m
left join public.deals d on d.id = m.deal_id
left join public.customers cu on cu.id = d.customer_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = m.tenant_id and fp.customer_id = d.customer_id and fp.archived_at is null
   order by (fp.kind = 'musteri') desc, fp.created_at, fp.id
   limit 1
) mp on true
cross join lateral (
  select coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0) as collected
    from public.cash_entries e
   where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null
) col
where m.status = 'calculated' and m.is_sample = false
  and m.gross_amount + greatest(coalesce(m.vat_amount, 0), 0) > col.collected
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = m.tenant_id and x.source_type = 'commission' and x.source_id = m.id
                     and x.posting_key is not null)
union all
select 'recurring:' || rr.id::text,
       'recurring',
       rr.id,
       rr.tenant_id,
       case when rr.direction = 'in' then 'receivable' else 'payable' end,
       rr.party_id,
       coalesce(p.name, '')::text,
       rr.title,
       rr.category,
       rr.amount::numeric,
       a.currency,
       rr.next_due,
       '/app/giderler?sekme=duzenli'::text
from public.recurring_rules rr
join public.finance_accounts a on a.id = rr.account_id and a.tenant_id = rr.tenant_id
left join public.finance_parties p on p.id = rr.party_id
where rr.active and rr.next_due is not null and rr.scope = 'office'
  and (rr.party_id is null or (select public.has_effective_permission('earnings_all', 'view')) or not public.finance_party_foreign_advisor(rr.party_id))
union all
select 'owner_payout:' || ag.rental_id::text,
       'owner_payout',
       ag.rental_id,
       ag.tenant_id,
       'payable',
       op.id,
       coalesce(pr.title, '')::text,
       'Mülk sahibi hakediş ödemesi'::text,
       'mulk_sahibi_odeme'::text,
       bal.payable::numeric,
       'TRY'::text,
       (pg_catalog.date_trunc('month', (pg_catalog.now() at time zone 'Europe/Istanbul'))::date + (ag.payout_day - 1))::date,
       ('/app/kiralama/' || ag.rental_id::text)::text
from public.rental_management_agreements ag
join public.rentals r on r.id = ag.rental_id and r.tenant_id = ag.tenant_id
left join public.properties pr on pr.id = r.property_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = ag.tenant_id and pr.owner_customer_id is not null and fp.customer_id = pr.owner_customer_id
     and fp.archived_at is null
   order by (fp.kind = 'malik') desc, fp.created_at, fp.id
   limit 1
) op on true
cross join lateral (
  select coalesce((select sum(rp.amount - coalesce(rp.management_fee, 0)) from public.rent_payments rp
                    where rp.rental_id = ag.rental_id and rp.tenant_id = ag.tenant_id and rp.voided_at is null), 0)
       - coalesce((select sum(l.amount) from public.owner_charge_links l
                    where l.rental_id = ag.rental_id and l.tenant_id = ag.tenant_id), 0)
       - coalesce((select sum(op2.amount) from public.owner_payouts op2
                    where op2.rental_id = ag.rental_id and op2.tenant_id = ag.tenant_id and op2.voided_at is null), 0) as payable
) bal
where ag.managed and bal.payable > 0
union all
select 'building:' || bc.id::text,
       'building',
       bc.id,
       bc.tenant_id,
       'receivable',
       bp.id,
       coalesce(bcu.full_name, '')::text,
       ('Aidat ' || coalesce(b.name, '') || ' / ' || coalesce(u.unit_no, ''))::text,
       'aidat_tahsilat'::text,
       (bc.amount - bc.paid_amount)::numeric,
       'TRY'::text,
       bc.due_date,
       ('/app/aidat?sekme=binalar&bina=' || bc.building_id::text || '&bolum=tahsilat')::text
from public.building_charges bc
left join public.buildings b on b.id = bc.building_id and b.tenant_id = bc.tenant_id
left join public.building_units u on u.id = bc.unit_id and u.tenant_id = bc.tenant_id
left join public.customers bcu on bcu.id = bc.payer_customer_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = bc.tenant_id and bc.payer_customer_id is not null and fp.customer_id = bc.payer_customer_id
     and fp.archived_at is null
   order by (fp.kind = case when bc.payer_role = 'tenant' then 'kiraci' else 'malik' end) desc, fp.created_at, fp.id
   limit 1
) bp on true
where bc.voided_at is null and bc.status <> 'paid' and bc.amount > bc.paid_amount
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = bc.tenant_id and x.source_type = 'building_charge' and x.source_id = bc.id
                     and x.posting_key is not null)
union all
select 'due:' || du.id::text,
       'due',
       du.id,
       du.tenant_id,
       'payable',
       null::uuid,
       coalesce(dp.title, '')::text,
       du.title,
       'aidat'::text,
       du.amount::numeric,
       'TRY'::text,
       coalesce(du.due_date, du.period),
       '/app/aidat'::text
from public.property_dues du
left join public.properties dp on dp.id = du.property_id
where du.status = 'unpaid' and du.amount > 0
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = du.tenant_id and x.source_type = 'due' and x.source_id = du.id
                     and x.posting_key is not null)
union all
select 'payout:' || cp.id::text,
       'payout',
       cp.id,
       cp.tenant_id,
       'payable',
       ap.id,
       coalesce(pf.full_name, '')::text,
       'Danışman hakedişi'::text,
       'danisman_hakedis'::text,
       cp.amount::numeric,
       'TRY'::text,
       (coalesce(cp.approved_at, cp.created_at) at time zone 'Europe/Istanbul')::date,
       '/app/cuzdan?sekme=ofis'::text
from public.commission_payouts cp
left join public.profiles pf on pf.id = cp.profile_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = cp.tenant_id and fp.user_id = cp.profile_id and fp.kind = 'danisman' and fp.archived_at is null
   order by fp.created_at, fp.id
   limit 1
) ap on true
where cp.status in ('pending', 'approved') and cp.amount > 0
  and (cp.profile_id = (select auth.uid()) or (select public.has_effective_permission('earnings_all', 'view')))
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = cp.tenant_id and x.posting_key is not null
                     and ((x.source_type = 'commission_split' and x.source_id = cp.split_id)
                          or (x.source_type = 'commission_payout' and x.source_id = cp.id)));

revoke all on public.finance_open_items_v from public, anon, authenticated;
grant select on public.finance_open_items_v to authenticated, service_role;

comment on view public.finance_open_items_v is
  'Acik alacak/borc birlesimi v3: manual (kayit servisi dahil), rent, commission (brut+KDV-net tahsilat), recurring, owner_payout, building, due, payout. Her satir href ve cozulmus cari tasir.';

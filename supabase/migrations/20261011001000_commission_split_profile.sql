-- Komisyon paylaşımı: taraf kimliği (profile_id) + serbest metin eşleme + commission_splits eşzamanlama.
--
-- SORUN (Konsey 2026-10-11 #0+#8): commissions.splits jsonb taraf adını SERBEST METİN tutuyordu; danışman payı
-- ad/etiket eşleşmesine bağlıydı ve eşleşmeyen satırın kazancı sessizce 0 çıkıyordu. commission_splits tablosunu
-- (20260816000200) hiçbir yazan yoktu: kâr/zarar ve kazanç gizliliği RLS'i boş tablodan okuyordu.
-- ÇÖZÜM:
--  1) public.commission_normalize_splits(): jsonb paylaşım dizisini normalleştirir. profile_id'li satır aynen kalır
--     (profil ofise aitse); profile_id'siz satırda: "Ofis" -> kind office; "Danışman" + anlaşma sorumlusu varsa
--     -> o profil; ofiste TAM BİR profille tam ad eşleşmesi varsa -> o profil (kind advisor); aksi hâlde
--     kind other + unresolved=true (görünür uyarı; kazanca eşlenmez). Açıkça dış taraf seçilmiş satır
--     (kind referral/franchise/other, profile_id yok) unresolved SAYILMAZ.
--  2) BEFORE INSERT/UPDATE OF splits tetikleyicisi her yazıcıyı (action, sihirbaz, demo seed, RPC) normalleştirir.
--  3) AFTER tetikleyici commission_splits'i konuma (position) göre yerinde günceller (payouts FK restrict: satır
--     silip yeniden eklenmez); fazla konumlar silinir (hakedişi olan pay silinemez -> işlem hata verir).
--  4) tenant_commission_aggregates() danışman dağılımını profile_id'den okur (etiket birleşmesi biter).
--  5) Mevcut kayıtlar için geriye dönük eşleme: `update commissions set splits = splits` tetikleyiciyi çalıştırır.
-- GERİ ALMA: supabase/rollbacks/20261011001000_commission_split_profile.rollback.sql (tetikleyici/fonksiyonlar/sütunlar;
--   jsonb'ye eklenen profile_id/kind/unresolved anahtarları zararsızdır ve kalır).
-- RİSK: orta-düşük (tetikleyici yalnız splits yazımında; ek sütunlar nullable/varsayılanlı; backfill idempotent).

alter table public.commission_splits add column if not exists position smallint;
alter table public.commission_splits add column if not exists unresolved boolean not null default false;

-- Önceki (kimsenin yazmadığı) satırlar varsa konum ata.
with ranked as (
  select id, (row_number() over (partition by commission_id order by created_at, id) - 1)::smallint as p
  from public.commission_splits where position is null
)
update public.commission_splits s set position = r.p from ranked r where s.id = r.id;

create unique index if not exists uq_commission_splits_position
  on public.commission_splits (commission_id, position) where position is not null;

create or replace function public.commission_normalize_splits(p_tenant uuid, p_deal uuid, p_gross numeric, p_splits jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assigned uuid;
  v_out jsonb := '[]'::jsonb;
  r record;
  v_label text;
  v_key text;
  v_rate numeric;
  v_kind text;
  v_pid uuid;
  v_unres boolean;
  v_n integer;
  v_amount numeric;
begin
  if p_splits is null or pg_catalog.jsonb_typeof(p_splits) <> 'array' then return coalesce(p_splits, '[]'::jsonb); end if;
  if p_deal is not null then
    select d.assigned_to into v_assigned from public.deals d where d.id = p_deal and d.tenant_id = p_tenant;
  end if;
  for r in select e.value as v from pg_catalog.jsonb_array_elements(p_splits) as e(value) loop
    if pg_catalog.jsonb_typeof(r.v) <> 'object' then continue; end if;
    v_label := pg_catalog.btrim(coalesce(r.v ->> 'label', ''));
    v_key := pg_catalog.lower(v_label);
    v_rate := coalesce(nullif(r.v ->> 'rate', '')::numeric, 0);
    v_kind := nullif(r.v ->> 'kind', '');
    v_pid := null;
    v_unres := false;
    if coalesce(r.v ->> 'profile_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.id into v_pid from public.profiles p where p.id = (r.v ->> 'profile_id')::uuid and p.tenant_id = p_tenant;
    end if;
    if v_pid is not null then
      v_kind := 'advisor';
    elsif v_kind in ('office', 'referral', 'franchise') or v_key in ('ofis', 'ofis payı', 'ofis payi') then
      v_kind := case when v_kind in ('referral', 'franchise') then v_kind else 'office' end;
    elsif v_kind = 'other' and coalesce((r.v ->> 'unresolved')::boolean, false) is not true then
      v_kind := 'other'; -- açıkça dış taraf (editör)
    else
      -- Serbest metin: önce "Danışman" -> anlaşma sorumlusu, sonra tek tam ad eşleşmesi.
      if v_key in ('danışman', 'danisman') and v_assigned is not null then
        v_pid := v_assigned;
      else
        select count(*) into v_n from public.profiles p
          where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key and v_key <> '';
        if v_n = 1 then
          select p.id into v_pid from public.profiles p
            where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key;
        end if;
      end if;
      if v_pid is not null then
        v_kind := 'advisor';
      else
        v_kind := 'other';
        v_unres := true;
      end if;
    end if;
    v_amount := case when r.v ? 'amount' and nullif(r.v ->> 'amount', '') is not null
                     then (r.v ->> 'amount')::numeric
                     else pg_catalog.round(coalesce(p_gross, 0) * v_rate / 100, 2) end;
    v_out := v_out || pg_catalog.jsonb_build_array(
      (r.v - 'profile_id' - 'kind' - 'unresolved')
      || pg_catalog.jsonb_build_object('kind', v_kind, 'amount', v_amount)
      || case when v_pid is not null then pg_catalog.jsonb_build_object('profile_id', v_pid) else '{}'::jsonb end
      || case when v_unres then pg_catalog.jsonb_build_object('unresolved', true) else '{}'::jsonb end
    );
  end loop;
  return v_out;
end;
$$;

create or replace function public.commissions_splits_normalize_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.splits := public.commission_normalize_splits(new.tenant_id, new.deal_id, new.gross_amount, new.splits);
  return new;
end;
$$;

drop trigger if exists trg_commissions_splits_normalize on public.commissions;
create trigger trg_commissions_splits_normalize
before insert or update of splits on public.commissions
for each row execute function public.commissions_splits_normalize_trg();

create or replace function public.commissions_splits_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(new.splits) is distinct from 'array' then return null; end if;
  -- Yerinde güncelle / ekle (konuma göre).
  insert into public.commission_splits (tenant_id, commission_id, profile_id, kind, label, share_rate, amount, unresolved, position)
  select new.tenant_id, new.id,
         nullif(e.value ->> 'profile_id', '')::uuid,
         e.value ->> 'kind',
         pg_catalog.left(coalesce(nullif(pg_catalog.btrim(e.value ->> 'label'), ''), 'Taraf'), 120),
         least(100, greatest(0, coalesce(nullif(e.value ->> 'rate', '')::numeric, 0))),
         greatest(0, coalesce(nullif(e.value ->> 'amount', '')::numeric, 0)),
         coalesce((e.value ->> 'unresolved')::boolean, false),
         (e.ord - 1)::smallint
  from pg_catalog.jsonb_array_elements(new.splits) with ordinality as e(value, ord)
  where pg_catalog.jsonb_typeof(e.value) = 'object'
  on conflict (commission_id, position) where position is not null do update
    set profile_id = excluded.profile_id, kind = excluded.kind, label = excluded.label,
        share_rate = excluded.share_rate, amount = excluded.amount, unresolved = excluded.unresolved;
  delete from public.commission_splits s
  where s.commission_id = new.id and s.tenant_id = new.tenant_id
    and (s.position is null or s.position >= (select pg_catalog.jsonb_array_length(new.splits)));
  return null;
end;
$$;

drop trigger if exists trg_commissions_splits_sync on public.commissions;
create trigger trg_commissions_splits_sync
after insert or update of splits on public.commissions
for each row execute function public.commissions_splits_sync_trg();

revoke all on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.commissions_splits_normalize_trg() from public, anon, authenticated;
revoke all on function public.commissions_splits_sync_trg() from public, anon, authenticated;
grant execute on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) to service_role;

-- Komisyon toplulaştırması: danışman dağılımı etiket yerine profile_id'den okunur (CANLI gövde = 20261006000710).
-- Eşleşmeyen serbest metin satırları unresolved=true ile döner (arayüz uyarı gösterir).
create or replace function public.tenant_commission_aggregates(
  p_as_of timestamptz default now(),
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_threshold integer := greatest(coalesce(p_sample_threshold, 5), 0);
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('commissions', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ornek veri kapsami (src/lib/sample-scope.ts includeSample ile ayni).
  select count(*) into v_real_customers from public.customers c
   where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p
   where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < v_threshold and v_real_properties < v_threshold);

  with bounds as (
    -- Ay siniri Istanbul yerel saatine gore (bkz. 20260802000340).
    select date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' as month_start
  ),
  scoped as (
    select c.* from public.commissions c
    where c.tenant_id = v_tenant and (v_include or c.is_sample = false)
  ),
  totals as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c
  ),
  current_month as (
    select
      coalesce(sum(c.gross_amount), 0) as total,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid,
      count(*) as record_count
    from scoped c, bounds b
    where c.created_at >= b.month_start
      and c.created_at < b.month_start + interval '1 month'
  ),
  month_axis as (
    select generate_series(
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '5 months',
      date_trunc('month', p_as_of at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul',
      interval '1 month'
    ) as month_start
  ),
  monthly as (
    select
      m.month_start,
      coalesce(sum(c.gross_amount), 0) as accrued,
      coalesce(sum(c.gross_amount) filter (where c.status in ('paid', 'collected')), 0) as paid
    from month_axis m
    left join scoped c
      on c.created_at >= m.month_start
     and c.created_at < m.month_start + interval '1 month'
    group by m.month_start
    order by m.month_start
  ),
  split_rows as (
    select
      nullif(s.item ->> 'profile_id', '')::uuid as profile_id,
      btrim(s.item ->> 'label') as label,
      coalesce((s.item ->> 'unresolved')::boolean, false) as unresolved,
      c.id,
      c.gross_amount *
        case
          when coalesce(s.item ->> 'rate', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (s.item ->> 'rate')::numeric / 100
          else 0
        end as pay
    from scoped c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.splits) = 'array' then c.splits else '[]'::jsonb end
    ) as s(item)
    where nullif(btrim(s.item ->> 'label'), '') is not null
  ),
  -- Taraf kimliği profile_id'dir (Konsey #0+#8): aynı etiketli iki kişi birleşmez; profil adı güncel adı gösterir.
  advisors as (
    select coalesce(max(p.full_name), max(r.label)) as label,
           r.profile_id,
           bool_or(r.unresolved) as unresolved,
           coalesce(sum(r.pay), 0) as pay,
           count(distinct r.id) as record_count
    from split_rows r
    left join public.profiles p on p.id = r.profile_id and p.tenant_id = v_tenant
    where r.pay > 0
    group by coalesce(r.profile_id::text, r.label), r.profile_id
    order by pay desc, 1
    limit 8
  )
  select jsonb_build_object(
    'total', t.total,
    'paid', t.paid,
    'pending', t.total - t.paid,
    'record_count', t.record_count,
    'month_total', cm.total,
    'month_paid', cm.paid,
    'month_pending', cm.total - cm.paid,
    'month_record_count', cm.record_count,
    'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m.month_start) from monthly m), '[]'::jsonb),
    'advisors', coalesce((select jsonb_agg(to_jsonb(a) order by a.pay desc, a.label) from advisors a), '[]'::jsonb),
    'sample_included', v_include
  ) into v_result
  from totals t cross join current_month cm;

  return v_result;
end;
$$;

revoke all on function public.tenant_commission_aggregates(timestamptz, integer) from public, anon;
grant execute on function public.tenant_commission_aggregates(timestamptz, integer) to authenticated;

-- Geriye dönük eşleme: mevcut serbest metin paylaşımlar normalleşir (ad->profil) ve commission_splits dolar.
update public.commissions c set splits = c.splits
where pg_catalog.jsonb_typeof(c.splits) = 'array' and pg_catalog.jsonb_array_length(c.splits) > 0;

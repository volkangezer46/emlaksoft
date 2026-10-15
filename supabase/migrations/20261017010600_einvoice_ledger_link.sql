-- MIGRATION 20261017010600_einvoice_ledger_link.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, WP5 "Fatura + belge + expenses dondurma" (olay `invoice.issued`).
-- Geri alma: supabase/rollbacks/20261017010600_einvoice_ledger_link.rollback.sql (tetikler, fonksiyonlar ve einvoices.party_id /
--   open_item_id duser; acilmis 'invoice.issued' kalemleri SILINMEZ, muhasebe kaydidir).
-- BAGIMLILIK: 20261017010000 (finance_post_internal / finance_reverse_internal, finance_open_items.invoice_id + posting_key),
--   20261012001000 (einvoice son yazma yollari; durum degisimi yalniz DEFINER RPC'lerden), 20261014011000 (cari).
--
-- NE:
--  1) einvoices.party_id (cari) + einvoices.open_item_id (fatura kaleminin acik kalemi).
--  2) finance_einvoice_ledger_sync(p_id, p_actor, p_create) [yalniz service_role / tetik]:
--     - issued: kaynagin (komisyon / anlasmanin komisyonu) VAR OLAN alacagina baglanir (finance_open_items.invoice_id);
--       'free' (serbest) fatura icin finance_post_internal ile yeni alacak acilir: olay invoice.issued, anahtar
--       einvoice:{id} (iptal/hata sonrasi yeniden resmilesirse einvoice:{id}:r{n}), tutar = gross_total (KDV dahil),
--       KDV = vat_total, tarih = issue_date (KDV fatura tarihinde). Kilitli aya dusen tahakkuk ilk acik aya tarihlenir (WP1).
--       Kira yonetim ucreti faturasi icin alacak YOK (ucret tahsilatta kesilir); yalniz cari baglanir.
--     - cancelled / error: kendi kalemi finance_reverse_internal ile geri alinir (acik donemde iptal, kilitli donemde ayna);
--       kaynak alacagina bagli fatura ise yalniz bag (invoice_id) cozulur, komisyon alacagi yerinde kalir.
--     - Tahsilati olan kalem geri alinamaz (has_settlements): fatura durumu yine yazilir, denetim kaydi duser.
--     - Saglayici sonucu (resmilesme/iptal) ASLA engellenmez: kayit servisi hatasi yakalanir, audit_logs'a yazilir.
--     - Tekrar calismasi yeni satir yazmaz (ayni anahtar `duplicate`, bagli kalem tekrar baglanmaz).
--  3) Tetikler: einvoices AFTER INSERT (issued dogarsa) / AFTER UPDATE OF status (durum degisince). Yalniz tahakkuk; nakit yok.
--  4) finance_open_items AFTER INSERT (komisyon alacagi acilinca; WP2 tahakkuk tetigi): kaynagin resmilesmis faturasi varsa
--     iki yonlu bag kurulur (fatura alacaktan once kesildiyse).
--  5) Geri doldurma: resmilesmis faturalara cari + var olan kaynak alacagina bag. Serbest faturalar icin GECMISE alacak
--     ACILMAZ (tahsil edilip edilmedigi bilinmez; nakit/alacak uydurulmaz). Iki kez calismasi degisiklik yapmaz.
-- GUVENLIK: tum fonksiyonlar SECURITY DEFINER + search_path=''; istemciye kapali (yalniz service_role). Kiraci faturanin
--   kendi tenant_id'sidir; tetik yalniz einvoices satirinin kiracisinda calisir. Cari cozumu danisman carisine baglanmaz (P12).
-- ETKI: davranis (fatura resmilesince/iptal edilince acik kalem yazilir/geri alinir; mevcut fatura akisi ayni).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.einvoices') is null
     or pg_catalog.to_regclass('public.finance_open_items') is null
     or pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.commissions') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.finance_post_internal(uuid,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_reverse_internal(uuid,uuid,uuid,text,date)') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'invoice_id' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'posting_key' and not attisdropped)
     or not exists (select 1 from public.finance_posting_rules r where r.event_type = 'invoice.issued') then
    raise exception '20261017010600: once 20261017010000 (kayit cekirdegi) ve 20261010000700 (e-Fatura) uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Kolonlar
-- ---------------------------------------------------------------------------
alter table public.einvoices add column if not exists party_id uuid references public.finance_parties(id) on delete set null;
alter table public.einvoices add column if not exists open_item_id uuid references public.finance_open_items(id) on delete set null;
create index if not exists idx_einvoices_party on public.einvoices (party_id) where party_id is not null;
create index if not exists idx_einvoices_open_item on public.einvoices (open_item_id) where open_item_id is not null;

comment on column public.einvoices.party_id is 'Alici carisi (finance_parties). Fatura resmilesince cozulur (VKN, yoksa ad).';
comment on column public.einvoices.open_item_id is 'Faturanin acik kalemi: kaynagin alacagi (komisyon) ya da serbest faturanin kendi alacagi (invoice.issued).';

-- ---------------------------------------------------------------------------
-- 2) Cari cozumu: VKN (10 hane) -> ad -> yeni musteri carisi. Danisman carisine baglanmaz.
-- ---------------------------------------------------------------------------
create or replace function public.finance_einvoice_party(p_tenant uuid, p_name text, p_tax_id text, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 120);
  v_tax text := case when p_tax_id ~ '^[0-9]{10}$' then p_tax_id end;
  v_id uuid;
begin
  if p_tenant is null then return null; end if;
  if v_tax is not null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and p.tax_id = v_tax and p.archived_at is null and p.kind <> 'danisman'
     order by (p.kind = 'musteri') desc, p.created_at
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if v_name = '' then return null; end if;
  select p.id into v_id from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.archived_at is null and p.kind <> 'danisman'
   order by (p.kind = 'musteri') desc, p.created_at
   limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.finance_parties (tenant_id, kind, name, tax_id, created_by)
  values (p_tenant, 'musteri', v_name, v_tax, (select pr.id from public.profiles pr where pr.id = p_actor))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = 'musteri' and p.archived_at is null
     limit 1;
  end if;
  return v_id;
end;
$$;

-- Saglayici sonucunu engellemeyen denetim izi.
create or replace function public.finance_einvoice_ledger_note(p_tenant uuid, p_actor uuid, p_id uuid, p_action text, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (p_tenant, p_actor, p_action, 'einvoice', p_id, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- 3) Fatura <-> defter esitlemesi (tek govde: tetik + geri doldurma)
-- ---------------------------------------------------------------------------
create or replace function public.finance_einvoice_ledger_sync(p_id uuid, p_actor uuid, p_create boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.einvoices%rowtype;
  v_item public.finance_open_items%rowtype;
  v_commission uuid;
  v_party uuid;
  v_item_id uuid;
  v_key text;
  v_rev integer;
  v_res jsonb;
  v_outcome text;
begin
  if p_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  select * into e from public.einvoices x where x.id = p_id;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  if e.status = 'issued' then
    -- Zaten canli bir kaleme bagli: degisiklik yok (tekrar cagri yeni satir yazmaz).
    if e.open_item_id is not null and exists (
         select 1 from public.finance_open_items o
          where o.id = e.open_item_id and o.tenant_id = e.tenant_id and o.status <> 'cancelled' and o.reversal_of is null
            and not exists (select 1 from public.finance_open_items m where m.reversal_of = o.id)) then
      return jsonb_build_object('outcome', 'unchanged', 'open_item_id', e.open_item_id);
    end if;

    -- Kaynagin komisyonu (komisyon faturasi ya da anlasma faturasi -> anlasmanin son iptal edilmemis komisyonu).
    if e.source_type = 'commission' then
      v_commission := e.source_id;
    elsif e.source_type = 'deal' and e.source_id is not null then
      select c.id into v_commission from public.commissions c
       where c.deal_id = e.source_id and c.tenant_id = e.tenant_id and c.status is distinct from 'cancelled'
       order by c.created_at desc
       limit 1;
    end if;
    if v_commission is not null then
      select * into v_item from public.finance_open_items o
       where o.tenant_id = e.tenant_id and o.source_type = 'commission' and o.source_id = v_commission
         and o.direction = 'receivable' and o.reversal_of is null and o.status <> 'cancelled'
         and (o.invoice_id is null or o.invoice_id = e.id)
         and not exists (select 1 from public.finance_open_items m where m.reversal_of = o.id)
       order by (o.posting_key = 'commission:' || v_commission::text) desc nulls last, o.created_at
       limit 1
       for update;
    end if;

    v_party := coalesce(v_item.party_id, e.party_id, public.finance_einvoice_party(e.tenant_id, e.buyer_name, e.buyer_tax_id, p_actor));

    if v_item.id is not null then
      update public.finance_open_items
         set invoice_id = e.id, party_id = coalesce(party_id, v_party)
       where id = v_item.id and (invoice_id is distinct from e.id or party_id is null);
      v_item_id := v_item.id;
      v_outcome := 'linked';
    elsif e.source_type = 'free' and coalesce(p_create, true) and e.gross_total >= 0.01 then
      -- Ayni fatura hata/iptal sonrasi yeniden resmilesirse yeni surum anahtari (keys.ts revisedKey ile ayni bicim).
      select pg_catalog.count(*)::integer into v_rev from public.finance_open_items o
       where o.tenant_id = e.tenant_id and o.reversal_of is null
         and (o.posting_key = 'einvoice:' || e.id::text or o.posting_key like 'einvoice:' || e.id::text || ':r%');
      v_key := 'einvoice:' || e.id::text || case when v_rev = 0 then '' else ':r' || (v_rev + 1)::text end;
      begin
        v_res := public.finance_post_internal(e.tenant_id, p_actor, jsonb_build_object(
          'event_type', 'invoice.issued',
          'posting_key', v_key,
          'date', e.issue_date,
          'source_id', e.id,
          'party_id', v_party,
          'title', pg_catalog.left('Fatura' || coalesce(' ' || nullif(pg_catalog.btrim(e.number), ''), '') || ' — ' || e.buyer_name, 160),
          'item', jsonb_build_object(
            'category', 'hizmet_bedeli',
            'amount', e.gross_total,
            'vat_amount', e.vat_total,
            'invoice_id', e.id)));
      exception when sqlstate 'P0001' then
        if sqlerrm not like 'FN:%' and sqlerrm <> 'DONEM_KILITLI' then raise; end if;
        perform public.finance_einvoice_ledger_note(e.tenant_id, p_actor, e.id, 'einvoice.ledger_post_failed',
          jsonb_build_object('reason', sqlerrm, 'posting_key', v_key));
        v_res := null;
      end;
      v_item_id := nullif(v_res ->> 'open_item_id', '')::uuid;
      v_outcome := coalesce(v_res ->> 'outcome', 'post_failed');
    else
      v_outcome := 'party_only';
    end if;

    update public.einvoices
       set party_id = coalesce(v_party, party_id), open_item_id = coalesce(v_item_id, open_item_id)
     where id = e.id
       and (party_id is distinct from coalesce(v_party, party_id) or open_item_id is distinct from coalesce(v_item_id, open_item_id));
    return jsonb_build_object('outcome', v_outcome, 'open_item_id', v_item_id, 'party_id', v_party);
  end if;

  if e.status in ('cancelled', 'error') then
    if e.open_item_id is null then return jsonb_build_object('outcome', 'none'); end if;
    select * into v_item from public.finance_open_items o where o.id = e.open_item_id and o.tenant_id = e.tenant_id for update;
    if not found then return jsonb_build_object('outcome', 'none'); end if;

    if v_item.event_type = 'invoice.issued' and v_item.invoice_id = e.id then
      -- Faturanin kendi alacagi: ters kayit (acik donemde iptal, kilitli donemde ilk acik aya ayna).
      begin
        v_res := public.finance_reverse_internal(e.tenant_id, p_actor, v_item.id,
          case when e.status = 'cancelled' then 'Fatura iptal edildi' else 'Fatura saglayicida reddedildi' end, null);
      exception when sqlstate 'P0001' then
        if sqlerrm not like 'FN:%' and sqlerrm <> 'DONEM_KILITLI' then raise; end if;
        perform public.finance_einvoice_ledger_note(e.tenant_id, p_actor, e.id, 'einvoice.ledger_reverse_skipped',
          jsonb_build_object('reason', sqlerrm, 'open_item_id', v_item.id));
        return jsonb_build_object('outcome', 'reverse_skipped', 'reason', pg_catalog.substr(sqlerrm, 4), 'open_item_id', v_item.id);
      end;
      v_outcome := v_res ->> 'outcome';
    else
      -- Kaynagin alacagi (komisyon) yerinde kalir; yalniz fatura bagi cozulur.
      update public.finance_open_items set invoice_id = null where id = v_item.id and invoice_id = e.id;
      v_outcome := 'unlinked';
    end if;

    -- Hata durumundaki fatura yeniden taslaga donup resmilesebilir: bag temizlenir (iptal edilmis fatura degistirilemez, iz kalir).
    if e.status = 'error' and v_outcome <> 'reverse_skipped' then
      update public.einvoices set open_item_id = null where id = e.id and open_item_id is not null;
    end if;
    return jsonb_build_object('outcome', v_outcome, 'open_item_id', v_item.id);
  end if;

  return jsonb_build_object('outcome', 'none');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Tetikler (yalniz tahakkuk; nakit yok)
-- ---------------------------------------------------------------------------
create or replace function public.einvoices_ledger_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.finance_einvoice_ledger_sync(new.id, coalesce(auth.uid(), new.created_by), true);
  return null;
end;
$$;

drop trigger if exists trg_einvoices_ledger_link_ins on public.einvoices;
create trigger trg_einvoices_ledger_link_ins
  after insert on public.einvoices
  for each row when (new.status = 'issued')
  execute function public.einvoices_ledger_link();
drop trigger if exists trg_einvoices_ledger_link_upd on public.einvoices;
create trigger trg_einvoices_ledger_link_upd
  after update of status on public.einvoices
  for each row when (old.status is distinct from new.status and new.status in ('issued', 'cancelled', 'error'))
  execute function public.einvoices_ledger_link();

-- Komisyon alacagi faturadan SONRA acilirsa (WP2 tahakkuk tetigi): kaynagin resmilesmis faturasi kaleme baglanir.
create or replace function public.finance_open_items_einvoice_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.einvoices%rowtype;
  v_deal uuid;
begin
  if new.invoice_id is not null then
    select * into v_inv from public.einvoices x where x.id = new.invoice_id and x.tenant_id = new.tenant_id and x.status = 'issued';
  else
    select c.deal_id into v_deal from public.commissions c where c.id = new.source_id and c.tenant_id = new.tenant_id;
    select * into v_inv from public.einvoices x
     where x.tenant_id = new.tenant_id and x.status = 'issued'
       and ((x.source_type = 'commission' and x.source_id = new.source_id)
            or (v_deal is not null and x.source_type = 'deal' and x.source_id = v_deal))
       and (x.open_item_id is null
            or not exists (select 1 from public.finance_open_items o where o.id = x.open_item_id and o.status <> 'cancelled'))
     order by x.issue_date desc, x.created_at desc
     limit 1;
  end if;
  if v_inv.id is null then return null; end if;
  update public.finance_open_items
     set invoice_id = v_inv.id, party_id = coalesce(party_id, v_inv.party_id)
   where id = new.id and (invoice_id is distinct from v_inv.id or (party_id is null and v_inv.party_id is not null));
  update public.einvoices
     set open_item_id = new.id, party_id = coalesce(party_id, new.party_id)
   where id = v_inv.id and open_item_id is distinct from new.id;
  return null;
end;
$$;

drop trigger if exists trg_finance_open_items_einvoice_link on public.finance_open_items;
create trigger trg_finance_open_items_einvoice_link
  after insert on public.finance_open_items
  for each row when (new.source_type = 'commission' and new.direction = 'receivable' and new.reversal_of is null and new.source_id is not null)
  execute function public.finance_open_items_einvoice_link();

-- ---------------------------------------------------------------------------
-- 5) Geri doldurma: resmilesmis faturalara cari + var olan kaynak alacagina bag. Gecmis serbest faturaya alacak ACILMAZ.
-- ---------------------------------------------------------------------------
create or replace function public.finance_einvoice_ledger_backfill()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_res jsonb;
  v_n integer := 0;
begin
  for r in
    select x.id from public.einvoices x
     where x.status = 'issued' and (x.party_id is null or x.open_item_id is null)
     order by x.tenant_id, x.issue_date, x.id
  loop
    v_res := public.finance_einvoice_ledger_sync(r.id, null, false);
    if v_res ->> 'outcome' in ('linked', 'party_only') then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Yetkiler: hepsi istemciye kapali
-- ---------------------------------------------------------------------------
revoke all on function public.finance_einvoice_party(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.finance_einvoice_ledger_note(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.finance_einvoice_ledger_sync(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.einvoices_ledger_link() from public, anon, authenticated;
revoke all on function public.finance_open_items_einvoice_link() from public, anon, authenticated;
revoke all on function public.finance_einvoice_ledger_backfill() from public, anon, authenticated;
grant execute on function public.finance_einvoice_ledger_sync(uuid, uuid, boolean) to service_role;
grant execute on function public.finance_einvoice_ledger_backfill() to service_role;

comment on function public.finance_einvoice_ledger_sync(uuid, uuid, boolean) is
  'e-Fatura <-> defter: issued = kaynak alacagina bag ya da serbest faturada invoice.issued alacagi; cancelled/error = ters kayit. Tekrar calismasi yeni satir yazmaz.';

select public.finance_einvoice_ledger_backfill();

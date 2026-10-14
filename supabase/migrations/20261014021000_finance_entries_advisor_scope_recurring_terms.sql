-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- SN1 — Finans tutarlılığı: hareket satırlarında danışman carisi kapsamı + düzenli ödemeden oluşan harekete KDV/stopaj.
-- 20261014011000 (GP1, finance_party_foreign_advisor) ve 20261014001000/001100 (FN1) SONRASI.
--
-- 1) cash_entries SELECT politikası: GP1 kuralı (P12) cari tablolarına ve açık kalemlere uygulanmıştı ama hareket satırı
--    (Hareketler, Kasa/Banka, hesap ekstresi, cari bağlı defter) başka danışmanın carisine bağlıyken `earnings_all` olmayan
--    kullanıcıya görünür kalıyordu. Kural (finance_open_items_select ile birebir): party_id boş ya da `earnings_all:view` ya da
--    cari oturumdaki kullanıcıya ait değilse gizli. security_invoker görünüm finance_ledger_v ve invoker finance_cash_summary bunu
--    devralır. HESAP BAKİYESİ (finance_account_balances, definer) BİLEREK tam kalır: banka/kasa bakiyesi gerçek bakiyedir; gizlenen
--    yalnız satır ayrıntısıdır (kimin carisine ne ödendiği). Bu yüzden ayrı "güvenli toplam" RPC'si gerekmez.
-- 2) Düzenli ödeme hareketi KDV/stopaj ve cari taşır: recurring_rule_set_terms (FN6) kurala party_id / vat_rate / withholding_rate
--    yazıyordu ama recurring_post_occurrence hareketi bunlarsız açıyordu (KDV özeti, muhtasar ve cari ekstresi eksik kalıyordu).
--    Yeni 4 argümanlı recurring_post_occurrence(occ, tutar, aktör, tutar_nakit_mi): kural tutarı BELGE tutarıdır (KDV dahil, stopaj
--    öncesi; Düzenli ödemeler ekranı "brüt · stopaj · net" böyle gösterir). Hesap ayrımı finance_entry_amounts ile (FN1 v2 kaydıyla
--    tek formül): hesaptan çıkan nakit = brüt − stopaj; KDV/stopaj tutarları ve cari harekete yazılır; açılan gider kaydı v2 kuralıyla
--    KDV hariç net tutarı taşır. Koşulu olmayan kuralda (KDV ve stopaj boş) nakit = tutar, gider = tutar: davranış BİREBİR aynı.
--    Yalnız OFİS kuralı koşul taşır (kişisel kural eskisi gibi). Eski 3 argümanlı imza korunur (cron recurring_run_due ve
--    recurring_occurrence_approve onu çağırır) ve belge kipinde yeni fonksiyona devreder.
--    Ekstre yolu (finance_statement_apply, action='recurring') banka satırındaki NAKİT tutarı verir: canlı gövdede yalnız o çağrı
--    `..., v_uid, true)` (nakit kipi) yapılır; stopajlı kuralda belge tutarı nakitten geri çözülür, hareket tutarı ekstre satırıyla
--    birebir aynı kalır (mutabakat bozulmaz). Gövdenin geri kalanı, imza, SECURITY DEFINER ve yetkiler aynen kalır
--    (pg_get_functiondef + tek ifade değişimi; beklenen eşleşme 1 değilse HİÇBİR şey yazılmaz; ikinci çalıştırmada atlanır).
-- GERİ ALMA: supabase/rollbacks/20261014021000_finance_entries_advisor_scope_recurring_terms.rollback.sql
-- RİSK: düşük-orta (RLS sıkılaşır: earnings_all olmayan, expenses:view sahibi özel rollerde başka danışmanın carisine bağlı hareket
-- listeden düşer; stopajlı ofis kuralının yeni dönemleri hesaptan net tutarla düşer — ekranın zaten gösterdiği net).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_party_foreign_advisor(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_entry_amounts(numeric,numeric,boolean,numeric)') is null
     or pg_catalog.to_regprocedure('public.recurring_post_occurrence(uuid,numeric,uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_statement_apply(uuid,jsonb)') is null
     or pg_catalog.to_regclass('public.recurring_occurrences') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.recurring_rules'::regclass and attname = 'withholding_rate' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'withholding_amount' and not attisdropped) then
    raise exception '20261014021000: önce 20261014001000/001100 (finans v2), 20261014011000 (GP1) ve 20261011001400 uygulanmalı.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Hareket satırı: danışman carisi kapsamı (P12)
-- ---------------------------------------------------------------------------
drop policy if exists cash_entries_select on public.cash_entries;
create policy cash_entries_select on public.cash_entries
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.finance_accounts a
      where a.id = cash_entries.account_id and a.tenant_id = cash_entries.tenant_id
        and (a.owner_scope = 'user' or cash_entries.category is distinct from 'maas' or (select public.finance_is_owner_gm()))
    )
    and (party_id is null or (select public.has_effective_permission('earnings_all', 'view')) or not public.finance_party_foreign_advisor(party_id))
  );

-- ---------------------------------------------------------------------------
-- 2) Düzenli ödeme: dönemi KDV / stopaj / cari ile hesaba işle
-- ---------------------------------------------------------------------------
-- Dönüş: posted | archived | before_opening | duplicate | not_found | invalid_input (3 argümanlı sürümle aynı sözleşme).
-- p_amount_is_cash = false: tutar belge tutarıdır (kural/dönem tutarı ya da onayda girilen); true: hesaptan geçen nakittir (ekstre).
create or replace function public.recurring_post_occurrence(p_occ_id uuid, p_amount numeric, p_actor uuid, p_amount_is_cash boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.recurring_occurrences%rowtype;
  r public.recurring_rules%rowtype;
  a public.finance_accounts%rowtype;
  v_amount numeric;
  v_vat_rate numeric;
  v_wh_rate numeric;
  v_div numeric;
  v_gross numeric;
  v_cash numeric;
  v_net numeric;
  v_vat numeric;
  v_wh numeric;
  v_amt record;
  v_exp uuid;
  v_created boolean := false;
  v_entry uuid;
begin
  select * into o from public.recurring_occurrences x where x.id = p_occ_id and x.status = 'pending' for update;
  if not found then return 'not_found'; end if;
  select * into r from public.recurring_rules x where x.id = o.rule_id;
  select * into a from public.finance_accounts x where x.id = r.account_id and x.tenant_id = r.tenant_id;
  if not found then return 'not_found'; end if;
  v_amount := coalesce(p_amount, o.amount);
  if v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount then
    return 'invalid_input';
  end if;
  if a.archived_at is not null then return 'archived'; end if;
  if o.due_date < a.opening_date then return 'before_opening'; end if;

  -- Koşullar yalnız ofis kuralında (recurring_rule_set_terms de yalnız ofis kuralına yazar).
  if r.scope = 'office' then
    v_vat_rate := r.vat_rate;
    v_wh_rate := r.withholding_rate;
  end if;

  if coalesce(p_amount_is_cash, false) and coalesce(v_wh_rate, 0) > 0 then
    -- Nakit (ekstre) tutarından belge tutarı: nakit = brüt − round(net × stopaj); net = brüt / (1 + KDV). Hareket tutarı nakittir.
    v_div := 1 - (v_wh_rate / 100) / (1 + coalesce(v_vat_rate, 0) / 100);
    if v_div <= 0 then return 'invalid_input'; end if;
    v_gross := pg_catalog.round(v_amount / v_div, 2);
    select * into v_amt from public.finance_entry_amounts(v_gross, v_vat_rate, true, v_wh_rate);
    v_cash := v_amount;
    v_wh := greatest(v_gross - v_amount, 0);
    v_vat := v_amt.vat;
    v_net := v_amt.net;
  else
    v_gross := v_amount;
    select * into v_amt from public.finance_entry_amounts(v_amount, v_vat_rate, true, v_wh_rate);
    v_cash := v_amt.cash;
    v_wh := v_amt.withheld;
    v_vat := v_amt.vat;
    v_net := v_amt.net;
  end if;
  if v_cash is null or v_cash < 0.01 then return 'invalid_input'; end if;

  -- Ofis gideri: TL ofis hesabından çıkan, maaş olmayan kural expenses kaydı da üretir (Paket A kuralı). Tutar v2 kuralıyla:
  -- KDV biliniyorsa KDV hariç net, bilinmiyorsa belge tutarı (koşulsuz kuralda eskisi gibi kural tutarı).
  if r.scope = 'office' and r.direction = 'out' and r.create_expense and a.owner_scope = 'office'
     and a.currency = 'TRY' and r.category <> 'maas' then
    insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes, portal_key)
    values (r.tenant_id, p_actor, coalesce(r.expense_category, 'diger'), r.title, v_net, 'TRY', o.due_date, 'Düzenli ödeme', r.portal_key)
    returning id into v_exp;
    v_created := true;
  end if;

  begin
    insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
      expense_id, created_expense, source_type, source_id, created_by,
      party_id, vat_rate, vat_amount, withholding_rate, withholding_amount)
    values (r.tenant_id, r.account_id, r.direction, v_cash, a.currency, o.due_date,
      case when r.direction = 'in' then 'income' else 'expense' end, r.category, r.title,
      v_exp, v_created, 'recurring', o.id, p_actor,
      case when r.scope = 'office' then r.party_id end, v_vat_rate, v_vat, v_wh_rate, v_wh)
    returning id into v_entry;
  exception when unique_violation then
    -- Aynı dönem başka yoldan işlenmiş: üretilen gider kaydı yetim kalmasın.
    if v_exp is not null then delete from public.expenses where id = v_exp; end if;
    return 'duplicate';
  end;

  -- Dönem tutarı her kipte BELGE (brüt) tutarıdır: ekstreden işlenen dönem cron/onay yolu ile aynı anlamı taşır; nakit 'cash'te.
  update public.recurring_occurrences
     set status = 'posted', amount = v_gross, entry_id = v_entry, decided_by = p_actor, decided_at = pg_catalog.now(), skip_reason = null
   where id = o.id;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (r.tenant_id, p_actor, 'recurring.post', 'recurring_rule', r.id,
      jsonb_build_object('period', o.period, 'amount', v_gross, 'entry_id', v_entry, 'mode', r.mode)
        || case when v_vat_rate is null and v_wh_rate is null then '{}'::jsonb
                else jsonb_build_object('cash', v_cash, 'vat_rate', v_vat_rate, 'vat_amount', v_vat,
                                        'withholding_rate', v_wh_rate, 'withholding_amount', v_wh) end);
  end if;
  return 'posted';
end;
$$;

-- Eski imza (cron + onay): belge kipi.
create or replace function public.recurring_post_occurrence(p_occ_id uuid, p_amount numeric, p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return public.recurring_post_occurrence(p_occ_id, p_amount, p_actor, false);
end;
$$;

revoke all on function public.recurring_post_occurrence(uuid, numeric, uuid, boolean) from public, anon, authenticated;
revoke all on function public.recurring_post_occurrence(uuid, numeric, uuid) from public, anon, authenticated;

-- Ekstre yolu: canlı gövdede yalnız düzenli ödeme çağrısı nakit kipine alınır.
do $$
declare
  v_def text := pg_catalog.pg_get_functiondef('public.finance_statement_apply(uuid,jsonb)'::regprocedure);
  v_old constant text := 'public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid)';
  v_new constant text := 'public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid, true)';
  v_count integer;
begin
  if pg_catalog.strpos(v_def, v_new) > 0 then
    return; -- ikinci çalıştırma: zaten dönüştürülmüş
  end if;
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception '20261014021000: finance_statement_apply gövdesinde 1 düzenli ödeme çağrısı bekleniyordu, % bulundu; hiçbir şey yazılmadı.', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end
$$;

notify pgrst, 'reload schema';

-- AD2 — Fatura ve alacak operasyonları: fatura satırları + alacak dekontu (numaralı) + elle fatura RPC'si.
--
-- NE:
--   (1) `invoice_lines`: faturanın kalemleri (açıklama, miktar, KDV hariç birim fiyat, satır KDV oranı, net/KDV/toplam).
--       Mevcut faturalar TEK satırla geriye dönük doldurulur (tutarlar faturadan aynen; oran = KDV/net). Bundan sonra
--       otomatik kesilen faturalar (abonelik/ek kullanıcı/analiz paketi) satır YAZMAZ; okuyucu satırı olmayan faturayı
--       tek satır olarak gösterir (src/lib/billing/manual-invoice.ts `synthesizeLine`). Ödeme akışlarına DOKUNULMAZ.
--   (2) `credit_notes`: alacak dekontu (kısmi/tam iade belgesi) — faturaya bağlı, numaralı (ADK-YYYY-000001).
--       Numara serisi `credit_note_no_seq` (yıl ön ekli; sıra yıllar boyunca artar, boşluk olabilir: iptal edilen
--       işlem numarayı yakar). Dekont, iade kaydı (`invoices.meta.refund`, recordInvoiceRefund) yazıldığı ANDA
--       tetikleyiciyle oluşur: iade akışı değişmez, her iade kaydı belge numarası kazanır. Mevcut iade kayıtları
--       geriye dönük dekontlanır.
--   (3) `platform_create_manual_invoice`: elle fatura / tek seferlik ücret TASLAĞI + satırları TEK işlemde yazar
--       (yalnız service_role). Taslak > kesildi geçişi uygulama katmanında koşullu UPDATE ile yapılır.
-- ERİŞİM: iki tablo da RLS açık; ofis kendi satırlarını/dekontlarını OKUR (invoices_tenant_select ile aynı kural),
--   platform personeli hepsini okur. Yazma yalnız service_role (RPC ve tetikleyici). anon erişimi yok.
-- KOD: tablolar yokken fatura detayı satırı faturadan türetir, defter dekont satırı göstermez, elle fatura formu
--   "kurulum bekliyor" der (hata yutulur).
-- GERİ ALMA: rollbacks/20261013004100_invoice_lines_credit_notes.rollback.sql (UYARI: satır ve dekont kayıtları silinir;
--   invoices.meta.refund olduğu gibi kalır).
-- RİSK: düşük-orta; yeni tablolar + invoices üzerinde YALNIZ meta.refund ilk kez yazıldığında çalışan AFTER UPDATE
--   tetikleyicisi. Tetikleyici hatayı yutmaz (dekontsuz iade olmasın); geçersiz/eksik iade tutarında sessizce atlar.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Fatura satırları
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position smallint not null default 1 check (position between 1 and 50),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  quantity numeric(12, 2) not null default 1 check (quantity > 0 and quantity <= 100000),
  unit_net_try numeric(14, 2) not null check (unit_net_try >= 0),
  vat_rate numeric(6, 4) not null check (vat_rate >= 0 and vat_rate < 1),
  net_try numeric(14, 2) not null check (net_try >= 0),
  tax_try numeric(14, 2) not null check (tax_try >= 0),
  total_try numeric(14, 2) not null check (total_try >= 0),
  created_at timestamptz not null default now(),
  constraint invoice_lines_position_unique unique (invoice_id, position),
  constraint invoice_lines_total_sum check (abs(total_try - (net_try + tax_try)) <= 0.01)
);

create index if not exists invoice_lines_tenant_idx on public.invoice_lines (tenant_id);

alter table public.invoice_lines enable row level security;
revoke all on public.invoice_lines from anon, authenticated;
grant select on public.invoice_lines to authenticated;
grant select, insert, update, delete on public.invoice_lines to service_role;

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_platform_staff()));

-- Geriye dönük: satırı olmayan her faturaya tek satır (tutarlar faturadan aynen).
insert into public.invoice_lines (invoice_id, tenant_id, position, description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try, created_at)
select
  i.id,
  i.tenant_id,
  1,
  case
    when i.meta->>'kind' = 'extra_seats' then 'Ek kullanıcı'
    when i.meta->>'kind' = 'credit_pack' then 'EmlakFiyatı analiz bakiyesi paketi'
    when i.meta->>'kind' = 'plan_upgrade' then 'Paket yükseltme farkı'
    when coalesce(i.meta->>'plan', '') <> '' then 'Abonelik: ' || left(i.meta->>'plan', 60)
    else 'Hizmet bedeli'
  end,
  1,
  greatest(i.amount_try, 0),
  case
    when i.amount_try > 0 then greatest(0, least(0.9999, round(i.tax_try / i.amount_try, 4)))
    else 0
  end,
  greatest(i.amount_try, 0),
  greatest(i.tax_try, 0),
  greatest(i.amount_try, 0) + greatest(i.tax_try, 0),
  i.created_at
from public.invoices i
where not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id);

-- ---------------------------------------------------------------------------
-- 2) Alacak dekontları
-- ---------------------------------------------------------------------------
create sequence if not exists public.credit_note_no_seq;
revoke all on sequence public.credit_note_no_seq from anon, authenticated;
grant usage on sequence public.credit_note_no_seq to service_role;

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  credit_no text not null unique,
  -- BRÜT dekont tutarı (iade kaydıyla aynı birim); net/KDV fatura oranında bölünür.
  amount_try numeric(14, 2) not null check (amount_try > 0),
  net_try numeric(14, 2) not null check (net_try >= 0),
  tax_try numeric(14, 2) not null check (tax_try >= 0),
  reason text not null default '',
  source text not null default 'refund' check (source in ('refund')),
  issued_at timestamptz not null default now(),
  created_by uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_notes_split_sum check (abs(amount_try - (net_try + tax_try)) <= 0.01)
);

-- Bir iade kaydı = bir dekont (tetikleyici yeniden çalışsa da ikinci belge yazılmaz).
create unique index if not exists credit_notes_refund_once on public.credit_notes (invoice_id) where source = 'refund';
create index if not exists credit_notes_issued_idx on public.credit_notes (issued_at desc);
create index if not exists credit_notes_tenant_idx on public.credit_notes (tenant_id);

alter table public.credit_notes enable row level security;
revoke all on public.credit_notes from anon, authenticated;
grant select on public.credit_notes to authenticated;
grant select, insert, update, delete on public.credit_notes to service_role;

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or (select public.is_platform_staff()));

create or replace function public.next_credit_note_no(p_at timestamptz default now())
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select 'ADK-' || to_char(coalesce(p_at, now()) at time zone 'Europe/Istanbul', 'YYYY') || '-' ||
         lpad(nextval('public.credit_note_no_seq')::text, 6, '0');
$$;
revoke all on function public.next_credit_note_no(timestamptz) from public, anon, authenticated;
grant execute on function public.next_credit_note_no(timestamptz) to service_role;

-- İade kaydından dekont: tutar BRÜT, net = brüt × net/brüt (fatura oranı), KDV = kalan.
create or replace function public.credit_note_from_refund(p_invoice public.invoices)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_refund jsonb := p_invoice.meta->'refund';
  v_amount_txt text := v_refund->>'amount_try';
  v_amount numeric;
  v_net numeric;
  v_at timestamptz;
  v_by uuid;
begin
  if v_refund is null or jsonb_typeof(v_refund) <> 'object' then return; end if;
  if v_amount_txt is null or v_amount_txt !~ '^[0-9]+(\.[0-9]+)?$' then return; end if;
  v_amount := round(v_amount_txt::numeric, 2);
  if v_amount <= 0 then return; end if;

  v_net := case when p_invoice.total_try > 0 then round(v_amount * p_invoice.amount_try / p_invoice.total_try, 2) else v_amount end;
  v_net := least(greatest(v_net, 0), v_amount);
  begin
    v_at := (v_refund->>'at')::timestamptz;
  exception when others then
    v_at := null;
  end;
  if coalesce(v_refund->>'by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_by := (v_refund->>'by')::uuid;
  end if;

  insert into public.credit_notes (invoice_id, tenant_id, credit_no, amount_try, net_try, tax_try, reason, source, issued_at, created_by, meta)
  values (
    p_invoice.id,
    p_invoice.tenant_id,
    public.next_credit_note_no(coalesce(v_at, now())),
    v_amount,
    v_net,
    v_amount - v_net,
    left(coalesce(v_refund->>'reason', ''), 300),
    'refund',
    coalesce(v_at, now()),
    v_by,
    jsonb_build_object('invoice_no', p_invoice.invoice_no)
  )
  on conflict (invoice_id) where source = 'refund' do nothing;
end;
$$;
revoke all on function public.credit_note_from_refund(public.invoices) from public, anon, authenticated;

create or replace function public.trg_invoice_refund_credit_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.credit_note_from_refund(new);
  return new;
end;
$$;
revoke all on function public.trg_invoice_refund_credit_note() from public, anon, authenticated;

drop trigger if exists trg_invoice_refund_credit_note on public.invoices;
create trigger trg_invoice_refund_credit_note
  after update of meta on public.invoices
  for each row
  when (old.meta->'refund' is null and new.meta->'refund' is not null)
  execute function public.trg_invoice_refund_credit_note();

-- Geriye dönük: mevcut iade kayıtları (iade tarihine göre sırayla numaralanır).
do $$
declare
  r public.invoices;
begin
  for r in
    select i.* from public.invoices i
    where i.meta->'refund' is not null
      and not exists (select 1 from public.credit_notes c where c.invoice_id = i.id and c.source = 'refund')
    order by i.meta->'refund'->>'at' nulls last, i.created_at
  loop
    perform public.credit_note_from_refund(r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Elle fatura / tek seferlik ücret taslağı (fatura + satırlar tek işlemde)
-- ---------------------------------------------------------------------------
-- p_lines: [{description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try}] (1..50 satır; tutarlar
-- uygulamada hesaplanır, burada tutarlılık doğrulanır). Fatura tutarları satır toplamıdır. Durum 'draft',
-- checkout_status NULL (ödeme oturumu yok), abonelik bağı yok (MRR'a girmez).
create or replace function public.platform_create_manual_invoice(
  p_tenant_id uuid,
  p_invoice_no text,
  p_lines jsonb,
  p_meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_line jsonb;
  v_pos int := 0;
  v_net numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_ln numeric;
  v_lt numeric;
  v_lg numeric;
begin
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'manual_invoice_tenant' using errcode = '22023';
  end if;
  if coalesce(btrim(p_invoice_no), '') = '' or char_length(p_invoice_no) > 64 then
    raise exception 'manual_invoice_no' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 50 then
    raise exception 'manual_invoice_lines' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_ln := round((v_line->>'net_try')::numeric, 2);
    v_lt := round((v_line->>'tax_try')::numeric, 2);
    v_lg := round((v_line->>'total_try')::numeric, 2);
    if v_ln is null or v_lt is null or v_lg is null or v_ln < 0 or v_lt < 0 or abs(v_lg - (v_ln + v_lt)) > 0.01 then
      raise exception 'manual_invoice_line_sum' using errcode = '22023';
    end if;
    v_net := v_net + v_ln;
    v_tax := v_tax + v_lt;
    v_total := v_total + v_lg;
  end loop;
  if v_total <= 0 then
    raise exception 'manual_invoice_total' using errcode = '22023';
  end if;

  insert into public.invoices (tenant_id, subscription_id, invoice_no, status, amount_try, tax_try, total_try, currency, meta)
  values (p_tenant_id, null, btrim(p_invoice_no), 'draft', v_net, v_tax, v_total, 'TRY',
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('kind', 'one_time'))
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    insert into public.invoice_lines (invoice_id, tenant_id, position, description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try)
    values (
      v_id,
      p_tenant_id,
      v_pos,
      left(btrim(v_line->>'description'), 200),
      round((v_line->>'quantity')::numeric, 2),
      round((v_line->>'unit_net_try')::numeric, 2),
      round((v_line->>'vat_rate')::numeric, 4),
      round((v_line->>'net_try')::numeric, 2),
      round((v_line->>'tax_try')::numeric, 2),
      round((v_line->>'total_try')::numeric, 2)
    );
  end loop;

  return v_id;
end;
$$;
revoke all on function public.platform_create_manual_invoice(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.platform_create_manual_invoice(uuid, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';

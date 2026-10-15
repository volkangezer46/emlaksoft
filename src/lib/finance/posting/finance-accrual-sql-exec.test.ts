import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { applyFinanceBase, applyWp2, OWNER_FINANCE_PERMS, readRepo, WP2_ROLLBACKS } from "@/lib/test-support/finance-accrual-db";
import { buildingChargeKey, commissionKey, payoutApprovedKey, revisedKey, splitKey } from "./keys";

/**
 * İŞLEVSEL SQL TESTİ (pglite): WP2 tahakkuk tetikleyicileri (20261017010200) + cari/geri doldurma (20261017010300).
 *  - komisyon / ofis dışı pay / paysız onaylı hakediş / bina aidatı → posting_key'li açık kalem (yalnız tahakkuk, nakit yok);
 *  - tutar değişimi → ters kayıt + `revisedKey` sürümü; aynı değerle yeniden tetik → yeni satır yok; iptal / silme → ters kayıt;
 *  - kilitli ayda değişim → ilk açık aya ayna; tahsil edilmiş kalem değiştirilemez;
 *  - eski yol tahsilat hareketi (source_id) kaleme bağlanır; nakitsiz ödenmiş hakediş / komisyon → offbook + 'kasa dışı';
 *  - geri doldurma iki kez çalışınca hiçbir şey değişmez.
 */
const mod = await loadPglite();

type Json = Record<string, unknown>;

describe.skipIf(!mod)("WP2 tahakkuk tetikleyicileri + geri doldurma (pglite, 20261017010200/010300)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV: string, ADV2: string, CUSTOMER: string, BANKA: string, BUILDING: string, UNIT: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const asOwner = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${OWNER_FINANCE_PERMS}',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  const sudo = async () => db.exec(`reset role`);
  const items = async (sourceId: string) =>
    q(`select posting_key as k, event_type as e, status as s, amount::float8 as a, coalesce(vat_amount,0)::float8 as v, paid_amount::float8 as p,
              offbook_amount::float8 as o, reversal_of is not null as mirror, issue_date::text as d, direction as dir, note
         from public.finance_open_items where source_id = $1 order by created_at, posting_key`, [sourceId]);
  const snapshot = async () =>
    q(`select 'p' as t, id::text as id, kind || '|' || name || '|' || coalesce(user_id::text,'') || '|' || coalesce(customer_id::text,'') as v from public.finance_parties
       union all select 'o', id::text, concat_ws('|', posting_key, status, amount, paid_amount, offbook_amount, party_id, note, issue_date) from public.finance_open_items
       union all select 'e', id::text, concat_ws('|', open_item_id, voided_at) from public.cash_entries
       order by 1, 2`);
  const newDeal = async (customer: string) =>
    (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, customer]))[0]!.id as string;
  const newCommission = async (gross: number, vat: number, at: string, extra: Partial<{ status: string; sample: boolean }> = {}) =>
    (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at, status, is_sample)
              values ($1, $2, $3, $4, $5::timestamptz, $6, $7) returning id`,
      [T, await newDeal(CUSTOMER), gross, vat, at, extra.status ?? "calculated", extra.sample ?? false]))[0]!.id as string;
  const newSplit = async (commission: string, kind: string, amount: number, profile: string | null, label = "Pay") =>
    (await q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount, profile_id, label) values ($1, $2, $3, $4, $5, $6) returning id`,
      [T, commission, kind, amount, profile, label]))[0]!.id as string;

  // Geri doldurma testinde "eski dünya" (WP2 öncesi) verisi.
  let LEGACY_COMM: string, LEGACY_PAID_COMM: string, LEGACY_SPLIT: string, LEGACY_SPLIT2: string, LEGACY_CHARGE: string, LEGACY_ENTRY: string;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await applyFinanceBase(db);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis Sahibi') returning id`, [T]))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Deniz Danışman') returning id`, [T]))[0]!.id as string;
    ADV2 = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ece Danışman') returning id`, [T]))[0]!.id as string;
    CUSTOMER = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Yılmaz') returning id`, [T]))[0]!.id as string;
    BUILDING = (await q(`insert into public.buildings(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    UNIT = (await q(`insert into public.building_units(tenant_id, building_id, unit_no) values ($1, $2, '4') returning id`, [T, BUILDING]))[0]!.id as string;
    await asOwner();
    BANKA = (await one<Json>(`public.finance_account_create('office','bank','Banka',null,'TRY',10000::numeric,'2026-01-01'::date)`)).account_id as string;

    // --- WP2 ÖNCESİ veri: komisyon + paylar, eski yol tahsilat (KDV dahil), ödenmiş hakediş (nakitsiz), bina aidatı + tahsilatı.
    await sudo();
    LEGACY_COMM = await newCommission(100000, 20000, "2026-03-10T10:00:00+03");
    LEGACY_SPLIT = await newSplit(LEGACY_COMM, "advisor", 50000, ADV, "Danışman");
    await newSplit(LEGACY_COMM, "office", 50000, null, "Ofis");
    LEGACY_PAID_COMM = await newCommission(40000, 8000, "2026-04-02T10:00:00+03", { status: "paid" });
    LEGACY_SPLIT2 = await newSplit(LEGACY_PAID_COMM, "advisor", 20000, ADV2, "Danışman");
    await q(`insert into public.commission_payouts(tenant_id, commission_id, split_id, profile_id, amount, status, approved_at, paid_at)
             values ($1, $2, $3, $4, 20000, 'paid', '2026-04-20T10:00:00+03', '2026-04-20T10:00:00+03')`, [T, LEGACY_PAID_COMM, LEGACY_SPLIT2, ADV2]);
    await asOwner();
    LEGACY_ENTRY = (await one<Json>(`public.finance_record_entry($1::uuid, 'in', 60000::numeric, '2026-03-20'::date, 'komisyon', 'Komisyon tahsilatı',
      null, null, null, 'commission', $2::uuid)`, [BANKA, LEGACY_COMM])).entry_id as string;
    await sudo();
    LEGACY_CHARGE = (await q(`insert into public.building_charges(tenant_id, building_id, unit_id, amount, paid_amount, status, due_date, payer_role, payer_customer_id, created_at)
      values ($1, $2, $3, 1500, 1500, 'paid', '2026-05-10', 'owner', $4, '2026-05-01T09:00:00+03') returning id`, [T, BUILDING, UNIT, CUSTOMER]))[0]!.id as string;
    const pay = (await q(`insert into public.building_payments(tenant_id, charge_id, amount) values ($1, $2, 1000) returning id`, [T, LEGACY_CHARGE]))[0]!.id as string;
    await q(`insert into public.building_payments(tenant_id, charge_id, amount) values ($1, $2, 500)`, [T, LEGACY_CHARGE]);
    await asOwner();
    await one(`public.finance_record_entry($1::uuid, 'in', 1000::numeric, '2026-05-12'::date, 'aidat_tahsilat', 'Aidat tahsilatı',
      null, null, null, 'building', $2::uuid)`, [BANKA, pay]);
    await sudo();
    await applyWp2(db, ["triggers", "backfill"]);
  }, 180_000);

  it("geri doldurma: komisyon alacağı (brüt+KDV), ofis dışı pay borcu, eski tahsilat bağlı, kasa dışı kapanışlar", async () => {
    await sudo();
    expect(await items(LEGACY_COMM)).toEqual([
      expect.objectContaining({ k: commissionKey(LEGACY_COMM), e: "commission.accrued", s: "partial", a: 120000, v: 20000, p: 60000, o: 0, d: "2026-03-10", dir: "receivable" }),
    ]);
    expect((await q(`select open_item_id::text as i from public.cash_entries where id = $1`, [LEGACY_ENTRY]))[0]!.i).toBe(
      (await q(`select id::text as i from public.finance_open_items where posting_key = $1`, [commissionKey(LEGACY_COMM)]))[0]!.i);
    // Ofis payı tahakkuk yazmaz; danışman payı açık borç.
    expect(await items(LEGACY_SPLIT)).toEqual([expect.objectContaining({ k: splitKey(LEGACY_SPLIT), s: "open", a: 50000, dir: "payable" })]);
    expect(Number((await q(`select count(*) from public.finance_open_items where event_type = 'commission.split_accrued'`))[0]!.count)).toBe(2);
    // Ödenmiş komisyon (nakitsiz) ve ödenmiş hakediş (nakitsiz): kalem kasa dışı kapanır, NAKİT UYDURULMAZ.
    expect(await items(LEGACY_PAID_COMM)).toEqual([expect.objectContaining({ s: "paid", a: 48000, p: 48000, o: 48000, note: "kasa dışı" })]);
    expect(await items(LEGACY_SPLIT2)).toEqual([expect.objectContaining({ s: "paid", a: 20000, o: 20000, note: "kasa dışı" })]);
    expect(Number((await q(`select count(*) from public.cash_entries where source_type in ('commission_payout') or (source_type = 'commission' and source_id = $1)`, [LEGACY_PAID_COMM]))[0]!.count)).toBe(0);
    // Bina aidatı: 1.000 nakit bağlı + 500 nakitsiz → kapalı (greatest(nakit, kaynakta ödenen)), not kasa dışı.
    expect(await items(LEGACY_CHARGE)).toEqual([
      expect.objectContaining({ k: buildingChargeKey(LEGACY_CHARGE), e: "building.charged", s: "paid", a: 1500, p: 1500, o: 1500, d: "2026-05-01", dir: "receivable", note: "kasa dışı" }),
    ]);
    // Cariler: danışmanlar user_id ile, müşteri customer_id ile, malik (bina ödeyen) customer_id ile.
    const parties = await q(`select kind, name, user_id::text as u, customer_id::text as c from public.finance_parties order by kind, name`);
    expect(parties).toEqual(expect.arrayContaining([
      { kind: "danisman", name: "Deniz Danışman", u: ADV, c: null },
      { kind: "danisman", name: "Ece Danışman", u: ADV2, c: null },
      { kind: "musteri", name: "Ayşe Yılmaz", u: null, c: CUSTOMER },
      { kind: "malik", name: "Ayşe Yılmaz", u: null, c: CUSTOMER },
    ]));
    // Görünüm: hesaplanmış komisyon kolu tekrar etmez; kalan 60.000 tek satır, cari çözülmüş.
    await asOwner();
    const v = await q(`select key, amount_open::float8 as a, party_label from public.finance_open_items_v where key = $1 or key like 'manual:%' and title = 'Komisyon alacağı'`, [`commission:${LEGACY_COMM}`]);
    expect(v).toEqual([expect.objectContaining({ a: 60000, party_label: "Ayşe Yılmaz" })]);
  });

  it("geri doldurma iki kez çalışınca hiçbir şey değişmez (cari, kalem, hareket bağı)", async () => {
    await sudo();
    const before = await snapshot();
    const res = await one<Json>(`public.finance_accrual_backfill()`);
    expect(res).toMatchObject({ new_parties: 0, new_items: 0, new_cash_links: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it("tetikleyici: yeni komisyon + paylar tahakkuk yazar; aynı değerle yeniden tetik yeni satır yazmaz", async () => {
    await sudo();
    const c = await newCommission(10000, 2000, "2026-09-05T10:00:00+03");
    const s1 = await newSplit(c, "advisor", 4000, ADV, "Danışman");
    const s2 = await newSplit(c, "referral", 1000, null, "Yönlendiren Emlak");
    await newSplit(c, "office", 5000, null, "Ofis");
    expect(await items(c)).toEqual([expect.objectContaining({ k: commissionKey(c), s: "open", a: 12000, v: 2000 })]);
    expect(await items(s1)).toEqual([expect.objectContaining({ k: splitKey(s1), a: 4000 })]);
    expect(await items(s2)).toEqual([expect.objectContaining({ k: splitKey(s2), a: 1000 })]);
    expect((await q(`select p.kind, p.name from public.finance_open_items o join public.finance_parties p on p.id = o.party_id where o.source_id = $1`, [s2]))[0])
      .toEqual({ kind: "diger", name: "Yönlendiren Emlak" });
    const before = await snapshot();
    // Komisyon splits eşitlemesi gibi "aynı değerle güncelleme" (upsert) yeni satır yazmaz.
    await q(`update public.commissions set gross_amount = gross_amount, status = status where id = $1`, [c]);
    await q(`update public.commission_splits set amount = amount, kind = kind where commission_id = $1`, [c]);
    expect(await snapshot()).toEqual(before);
    // Tekrar çağrılan eşitleyici de idempotent.
    await one(`public.finance_commission_accrual_sync($1::uuid)`, [c]);
    expect(await snapshot()).toEqual(before);
  });

  it("tutar değişimi: açık dönemde eski kalem iptal, yeni sürüm anahtarı (revisedKey); iptal/silme ters kayıt", async () => {
    await sudo();
    const c = await newCommission(20000, 4000, "2026-09-07T10:00:00+03");
    const s = await newSplit(c, "advisor", 10000, ADV);
    await q(`update public.commissions set gross_amount = 25000, vat_amount = 5000 where id = $1`, [c]);
    expect(await items(c)).toEqual([
      expect.objectContaining({ k: commissionKey(c), s: "cancelled", a: 24000 }),
      expect.objectContaining({ k: revisedKey(commissionKey(c), 2), s: "open", a: 30000, v: 5000 }),
    ]);
    await q(`update public.commission_splits set amount = 12500 where id = $1`, [s]);
    expect((await items(s)).map((r) => [r.k, r.s, r.a])).toEqual([[splitKey(s), "cancelled", 10000], [revisedKey(splitKey(s), 2), "open", 12500]]);
    // Komisyon iptal: kendi kalemi ve pay kalemleri ters kayıtla kapanır.
    await q(`update public.commissions set status = 'cancelled' where id = $1`, [c]);
    expect((await items(c)).every((r) => r.s === "cancelled")).toBe(true);
    expect((await items(s)).every((r) => r.s === "cancelled")).toBe(true);
    // Geri açılınca yeni sürüm (r3) yazılır.
    await q(`update public.commissions set status = 'calculated' where id = $1`, [c]);
    expect((await items(c)).filter((r) => r.s === "open").map((r) => r.k)).toEqual([revisedKey(commissionKey(c), 3)]);
    // Silme (anlaşma yeniden açma akışı): paylar zincirleme silinir, kalemler ters kayıtla kapanır, satır silinmez.
    await q(`delete from public.commissions where id = $1`, [c]);
    expect((await items(c)).length).toBe(3);
    expect((await items(c)).every((r) => r.s === "cancelled")).toBe(true);
    expect((await items(s)).every((r) => r.s === "cancelled")).toBe(true);
    // Örnek veri tahakkuk yazmaz.
    const sample = await newCommission(5000, 1000, "2026-09-08T10:00:00+03", { sample: true });
    expect(await items(sample)).toEqual([]);
  });

  it("tahsil edilmiş kalem değiştirilemez; eski yol yeni tahsilat hareketi kaleme bağlanır; paid → kasa dışı → geri alınca açılır", async () => {
    await sudo();
    const c = await newCommission(5000, 1000, "2026-09-10T10:00:00+03");
    await asOwner();
    const e = (await one<Json>(`public.finance_record_entry($1::uuid, 'in', 2000::numeric, '2026-09-12'::date, 'komisyon', 'Komisyon tahsilatı',
      null, null, null, 'commission', $2::uuid)`, [BANKA, c])).entry_id as string;
    await sudo();
    const [item] = await items(c);
    expect(item).toMatchObject({ s: "partial", p: 2000 });
    expect((await q(`select open_item_id is not null as l from public.cash_entries where id = $1`, [e]))[0]!.l).toBe(true);
    await expect(q(`update public.commissions set gross_amount = 6000 where id = $1`, [c])).rejects.toThrow(/Tahsilat ya da ödeme görmüş tahakkuk/);
    // "Ödendi" işareti (nakitsiz kalan): kalem kasa dışı kapanır; geri alınınca nakit tutarına döner.
    await q(`update public.commissions set status = 'paid' where id = $1`, [c]);
    expect((await items(c))[0]).toMatchObject({ s: "paid", p: 6000, o: 6000, note: "kasa dışı" });
    await q(`update public.commissions set status = 'calculated' where id = $1`, [c]);
    expect((await items(c))[0]).toMatchObject({ s: "partial", p: 2000, o: 0 });
  });

  it("hakediş: paylı hakediş ödenince pay borcu kasa dışı kapanır; paysız onaylı hakediş borç yazar, iptal ters kayıt", async () => {
    await sudo();
    const c = await newCommission(8000, 1600, "2026-09-11T10:00:00+03");
    const s = await newSplit(c, "advisor", 4000, ADV);
    const p = (await q(`insert into public.commission_payouts(tenant_id, commission_id, split_id, profile_id, amount) values ($1, $2, $3, $4, 4000) returning id`,
      [T, c, s, ADV]))[0]!.id as string;
    expect(await items(p)).toEqual([]);
    await q(`update public.commission_payouts set status = 'paid', approved_at = now(), paid_at = now() where id = $1`, [p]);
    expect((await items(s))[0]).toMatchObject({ s: "paid", o: 4000, note: "kasa dışı" });
    await q(`update public.commission_payouts set status = 'cancelled' where id = $1`, [p]);
    expect((await items(s))[0]).toMatchObject({ s: "open", o: 0 });

    const free = (await q(`insert into public.commission_payouts(tenant_id, commission_id, profile_id, amount) values ($1, $2, $3, 750) returning id`,
      [T, c, ADV2]))[0]!.id as string;
    expect(await items(free)).toEqual([]);
    await q(`update public.commission_payouts set status = 'approved', approved_at = '2026-09-15T10:00:00+03' where id = $1`, [free]);
    expect(await items(free)).toEqual([expect.objectContaining({ k: payoutApprovedKey(free), e: "payout.approved", s: "open", a: 750, d: "2026-09-15", dir: "payable" })]);
    await q(`update public.commission_payouts set status = 'cancelled' where id = $1`, [free]);
    expect((await items(free)).map((r) => r.s)).toEqual(["cancelled"]);
  });

  it("kilitli ayda değişim: ters kayıt ilk açık aya ayna; yeni sürüm ilk açık aya tarihlenir", async () => {
    await sudo();
    const c = await newCommission(3000, 600, "2026-06-10T10:00:00+03");
    await asOwner();
    await one(`public.finance_period_lock('2026-06-01'::date, 'Haziran kapandı')`);
    await sudo();
    await q(`update public.commissions set gross_amount = 3500, vat_amount = 700 where id = $1`, [c]);
    const rows = await items(c);
    expect(rows).toEqual([
      expect.objectContaining({ k: commissionKey(c), s: "paid", a: 3600, mirror: false, d: "2026-06-10" }),
      expect.objectContaining({ k: revisedKey(commissionKey(c), 2), s: "open", a: 4200, mirror: false, d: "2026-07-01" }),
      expect.objectContaining({ k: `${commissionKey(c)}:rev`, mirror: true, d: "2026-07-01", dir: "payable" }),
    ]);
    expect(rows[1]!.note).toMatch(/Kilitli dönem: asıl tarih 10\.06\.2026/);
    await asOwner();
    await one(`public.finance_period_unlock('2026-06-01'::date)`);
    await sudo();
  });

  it("bina aidatı: yeni tahakkuk + kısmi tahsilat (eski yol, source_id) bağlanır; iptal ters kayıt", async () => {
    await sudo();
    const ch = (await q(`insert into public.building_charges(tenant_id, building_id, unit_id, amount, due_date, payer_role, payer_customer_id, created_at)
      values ($1, $2, $3, 900, '2026-09-10', 'tenant', $4, '2026-09-01T09:00:00+03') returning id`, [T, BUILDING, UNIT, CUSTOMER]))[0]!.id as string;
    expect(await items(ch)).toEqual([expect.objectContaining({ s: "open", a: 900, d: "2026-09-01" })]);
    expect((await q(`select p.kind from public.finance_open_items o join public.finance_parties p on p.id = o.party_id where o.source_id = $1`, [ch]))[0]!.kind).toBe("kiraci");
    const pay = (await q(`insert into public.building_payments(tenant_id, charge_id, amount) values ($1, $2, 400) returning id`, [T, ch]))[0]!.id as string;
    await asOwner();
    await one(`public.finance_record_entry($1::uuid, 'in', 400::numeric, '2026-09-05'::date, 'aidat_tahsilat', 'Aidat', null, null, null, 'building', $2::uuid)`, [BANKA, pay]);
    await sudo();
    await q(`update public.building_charges set paid_amount = 400, status = 'partial' where id = $1`, [ch]);
    expect((await items(ch))[0]).toMatchObject({ s: "partial", p: 400, o: 400 });
    expect((await items(ch))[0]!.note).toBeNull();
    await expect(q(`update public.building_charges set voided_at = now() where id = $1`, [ch])).rejects.toThrow(/Tahsilat ya da ödeme görmüş/);
    const ch2 = (await q(`insert into public.building_charges(tenant_id, building_id, unit_id, amount, due_date, created_at)
      values ($1, $2, $3, 900, '2026-10-10', '2026-10-01T09:00:00+03') returning id`, [T, BUILDING, UNIT]))[0]!.id as string;
    await q(`update public.building_charges set voided_at = now() where id = $1`, [ch2]);
    expect((await items(ch2)).map((r) => r.s)).toEqual(["cancelled"]);
  });

  it("WP4 (20261017010500) WP2'nin üzerine uygulanır; aidat geri doldurması ve kasa dışı kalem bozulmaz", async () => {
    await sudo();
    await db.exec(`
      alter table public.rentals add column if not exists deposit numeric(14,2), add column if not exists status text not null default 'active',
        add column if not exists deposit_returned boolean not null default false, add column if not exists deposit_returned_at timestamptz;
      alter table public.property_dues add column if not exists notes text, add column if not exists paid_at timestamptz,
        add column if not exists created_by uuid, add column if not exists created_at timestamptz not null default now();`);
    const due = (await q(`insert into public.property_dues(tenant_id, title, amount, period, status) values ($1, 'Site aidatı', 750, '2026-08-01', 'unpaid') returning id`, [T]))[0]!.id as string;
    await db.exec(readRepo("supabase/migrations/20261017010500_property_dues_open_items.sql"));
    expect(await items(due)).toEqual([expect.objectContaining({ k: `due:${due}`, s: "open", a: 750, dir: "payable" })]);
    // Tetikleyiciler ve kasa dışı taban WP4 sonrası da yerinde.
    expect(await items(LEGACY_PAID_COMM)).toEqual([expect.objectContaining({ s: "paid", o: 48000 })]);
    const c = await newCommission(1000, 200, "2026-09-20T10:00:00+03");
    expect(await items(c)).toEqual([expect.objectContaining({ k: commissionKey(c), a: 1200 })]);
  });

  it("tetikleyici kayıtları istemciye kapalı (yalnız service_role)", async () => {
    await asOwner();
    await expect(q(`select public.finance_accrual_backfill()`)).rejects.toThrow(/permission denied/);
    await expect(q(`select public.finance_commission_accrual_sync($1::uuid)`, [LEGACY_COMM])).rejects.toThrow(/permission denied/);
    await sudo();
  });

  it("geri alma (010300 → 010200): tetikleyici durur, kalemler ve kasa dışı kapanış yerinde kalır", async () => {
    await sudo();
    await expect(db.exec(readRepo(WP2_ROLLBACKS.triggers))).rejects.toThrow(/010300/);
    await db.exec(readRepo(WP2_ROLLBACKS.backfill));
    await db.exec(readRepo(WP2_ROLLBACKS.triggers));
    const rows = async (id: string) =>
      q(`select status as s, paid_amount::float8 as p, note from public.finance_open_items where source_id = $1`, [id]);
    expect(await rows(LEGACY_PAID_COMM)).toEqual([{ s: "paid", p: 48000, note: "kasa dışı" }]);
    const c = await newCommission(1000, 200, "2026-09-21T10:00:00+03");
    expect(await rows(c)).toEqual([]);
    expect(Number((await q(`select count(*) from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'offbook_amount' and not attisdropped`))[0]!.count)).toBe(0);
  });
});
